import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import helmet from "helmet";
import multer from "multer";
import JSZip from "jszip";
import {
	BASE_STORAGE_DIR,
	initializeStorage,
	__dirname,
	formatRustCode,
	compileSorobanContract,
	runRustTests,
	__filename,
} from "./utils.js";
import { WebSocketServer } from "ws";
import { Message, InitializeRequest } from "vscode-languageserver-protocol";
import {
	WebSocketMessageReader,
	WebSocketMessageWriter,
} from "vscode-ws-jsonrpc";
import {
	createConnection,
	createServerProcess,
	forward,
} from "vscode-ws-jsonrpc/server";
import { createServer } from "http";
import { connectToMongoDB } from "./db.js";
import { Project } from "./models/project.js";
import { bucket } from "./db.js";
import { Readable } from "stream";

// Initialize multer for file uploads
const storage = multer.diskStorage({
	destination: (_req, _file, cb) => {
		cb(null, path.join(__dirname, "temps"));
	},
	filename: (_req, file, cb) => {
		cb(null, file.originalname);
	},
});
const upload = multer({
	storage,
});

const PORT = process.env.PORT || 3000;

const app = express();
await connectToMongoDB();
app.use(helmet());
app.use(
	cors({
		origin: [
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"https://rust-ide-five.vercel.app",
		],
		methods: ["GET", "POST", "PUT"],
		credentials: true,
		allowedHeaders: ["*"],
	})
);

app.use(express.json({ limit: "750mb" }));

const server = createServer(app);

// Initialize WebSocket server for Language Server Protocol
const wss = new WebSocketServer({
	noServer: true,
	perMessageDeflate: false,
});

const languageServerConfig = {
	serverName: "RUST ANALYZER WEB SOCKET SERVER",
	pathName: "/rust-analyzer",
	serverPort: PORT,
	runCommand: "rust-analyzer",
	runCommandArgs: [],
	logMessages: false,
};

// Handle WebSocket upgrades for LSP
server.on("upgrade", (request, socket, head) => {
	const baseURL = `http://${request.headers.host}/`;
	const pathName = request.url
		? new URL(request.url, baseURL).pathname
		: undefined;

	if (pathName === languageServerConfig.pathName) {
		wss.handleUpgrade(request, socket, head, (webSocket) => {
			console.log("WebSocket connection established for LSP");
			const socket = {
				send: (content) =>
					webSocket.send(content, (error) => {
						if (error) {
							throw error;
						}
					}),
				onMessage: (cb) =>
					webSocket.on("message", (data) => {
						cb(data);
					}),
				onError: (cb) => webSocket.on("error", cb),
				onClose: (cb) => webSocket.on("close", cb),
				dispose: () => webSocket.close(),
			};

			if (webSocket.readyState === webSocket.OPEN) {
				launchLanguageServer(languageServerConfig, socket);
			} else {
				webSocket.on("open", () => {
					launchLanguageServer(languageServerConfig, socket);
				});
			}
		});
	} else {
		socket.destroy();
	}
});

const launchLanguageServer = (runconfig, socket) => {
	console.log("Attempting to launch language server...");
	const { serverName, runCommand, runCommandArgs } = runconfig;

	const reader = new WebSocketMessageReader(socket);
	const writer = new WebSocketMessageWriter(socket);
	const socketConnection = createConnection(reader, writer, () =>
		socket.dispose()
	);
	const serverConnection = createServerProcess(
		serverName,
		runCommand,
		runCommandArgs
	);

	if (serverConnection) {
		forward(socketConnection, serverConnection, (message) => {
			if (Message.isRequest(message)) {
				console.log("To rust-analyzer:", message);
				if (message.method === InitializeRequest.type.method) {
					const initializeParams = message.params;
					initializeParams.processId = process.pid;
				}

				// if (runconfig.logMessages ?? false) {
				// 	console.log(`${serverName} Server received: ${message.method}`);
				// 	console.log(message);
				// }

				if (runconfig.requestMessageHandler !== undefined) {
					return runconfig.requestMessageHandler(message);
				}
			}
			if (Message.isResponse(message)) {
				// console.log("From rust-analyzer:", message);
				// if (runconfig.logMessages ?? false) {
				// 	console.log(`${serverName} Server sent`);
				// 	console.log(message);
				// }
				if (runconfig.responseMessageHandler !== undefined) {
					return runconfig.responseMessageHandler(message);
				}
			}
			return message;
		});
	}
};

// API Endpoints

app.post(
	"/api/projects/upload-zip",
	upload.single("file"),
	async (req, res) => {
		try {
			const projectId = uuidv4();

			const fileBuffer = await fs.readFile(req.file.path);

			console.log({ projectId, fileBuffer, req: req.file.path });

			const readableStream = new Readable();
			readableStream.push(fileBuffer);
			readableStream.push(null);

			const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
			readableStream.pipe(uploadStream);

			uploadStream.on("finish", async () => {
				await fs.unlink(req.file.path);

				const saved = await Project.create({
					projectId,
					zipFileId: uploadStream.id,
					size: fileBuffer.length,
				});

				console.log("ZIP saved:", saved);
				res.json({ projectId });
			});

			uploadStream.on("error", (err) => {
				console.error("Upload failed:", err);
				res.status(500).json({ error: "Failed to store ZIP in DB" });
			});
		} catch (err) {
			console.error("Zip extraction failed:", err);
			res.status(500).json({ error: "Failed to process zip file" });
		}
	}
);

app.post(
	"/api/projects/:projectId/update",
	upload.single("file"),
	async (req, res) => {
		const { projectId } = req.params;

		try {
			const project = await Project.findOne({ projectId });

			if (!project) {
				return res.status(404).json({ error: "Project not found" });
			}

			const fileBuffer = await fs.readFile(req.file.path);
			const readableStream = new Readable();
			readableStream.push(fileBuffer);
			readableStream.push(null);

			// 1. Delete old file from GridFS (if exists)
			if (project.zipFileId) {
				try {
					await bucket.delete(project.zipFileId);
				} catch (err) {
					console.warn("Failed to delete old zip file:", err.message);
				}
			}

			// 2. Upload new file to GridFS
			const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
			readableStream.pipe(uploadStream);

			uploadStream.on("finish", async () => {
				await fs.unlink(req.file.path);

				// 3. Update Project doc
				project.zipFileId = uploadStream.id;
				project.size = fileBuffer.length;
				await project.save();

				console.log("Project updated:", project);
				res.json({ success: true });
			});

			uploadStream.on("error", (err) => {
				console.error("Upload failed:", err);
				res.status(500).json({ error: "Failed to store new ZIP" });
			});
		} catch (err) {
			console.error("Error uploading zip:", err);
			res.status(500).json({ error: "Internal server error" });
		}
	}
);

app.get("/api/projects/:projectId/load", async (req, res) => {
	try {
		const project = await Project.findOne({ projectId: req.params.projectId });
		if (!project || !project.zipFileId) {
			return res.status(404).json({ error: "Project not found" });
		}

		const downloadStream = bucket.openDownloadStream(project.zipFileId);

		res.set({
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${project.projectId}.zip"`,
		});

		downloadStream.pipe(res);
	} catch (err) {
		console.error("Download failed:", err);
		res.status(500).json({ error: "Failed to download project ZIP" });
	}
});

app.put("/api/projects/:projectId/save", async (req, res) => {
	try {
		const { content } = req.body;

		let finalContent = await formatRustCode(content);

		res.json({ content: finalContent });
	} catch (err) {
		console.error("Failed to update file:", err);
		res.status(500).json({ error: "Failed to update file" });
	}
});

app.post(
	"/api/projects/:projectId/build",
	upload.single("file"),
	async (req, res) => {
		try {
			try {
				await fs.access(path.join(__dirname, "temps"));
			} catch (err) {
				console.error("Temp directory missing, recreating...");
				await fs.mkdir(path.join(__dirname, "temps"), { recursive: true });
			}

			const projectId = req.params.projectId;

			const project = await Project.findOne({ projectId });

			const fileBuffer = await fs.readFile(req.file.path);
			const readableStream = new Readable();
			readableStream.push(fileBuffer);
			readableStream.push(null);

			if (project.zipFileId) {
				try {
					await bucket.delete(project.zipFileId);
				} catch (err) {
					console.warn("Failed to delete old zip file:", err.message);
				}
			}

			const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
			readableStream.pipe(uploadStream);

			uploadStream.on("finish", async () => {
				project.zipFileId = uploadStream.id;
				project.size = fileBuffer.length;
				await project.save();
			});

			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

			try {
				await fs.access(projectDir); // If directory exists, this will succeed
				await fs.rm(projectDir, { recursive: true, force: true });
			} catch (err) {
				// Directory doesn't exist, no need to delete
			}

			const zip = new JSZip();
			const content = await fs.readFile(req.file.path);
			const zipData = await zip.loadAsync(content);

			await Promise.all(
				Object.keys(zipData.files).map(async (relativePath) => {
					const file = zipData.files[relativePath];
					if (file.dir) return;

					const fileContent = await file.async("nodebuffer");

					const absolutePath = path.join(projectDir, relativePath);
					await fs.mkdir(path.dirname(absolutePath), { recursive: true });
					await fs.writeFile(absolutePath, fileContent);
				})
			);

			await fs.unlink(req.file.path);

			const result = await compileSorobanContract(projectId);

			const items = await fs.readdir(projectDir);
			const [rootFolderName] = items;
			const targetDir = path.join(projectDir, rootFolderName);

			if (!result.success) {
				return res.status(400).json({
					status: "error",
					error: result.error,
					output: result.output,
					code: result.code,
				});
			}

			return res.json({
				success: true,
				output: result.output,
				message: "Build completed successfully",
			});
		} catch (err) {
			console.error("Build failed:", err);
			return res.status(500).json({
				success: false,
				error: "Unexpected build failure",
				details: err.message,
			});
		}
	}
);

app.post(
	"/api/projects/:projectId/test",
	upload.single("file"),
	async (req, res) => {
		try {
			try {
				await fs.access(path.join(__dirname, "temps"));
			} catch (err) {
				console.error("Temp directory missing, recreating...");
				await fs.mkdir(path.join(__dirname, "temps"), { recursive: true });
			}

			const projectId = req.params.projectId;
			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

			try {
				await fs.access(projectDir); // If directory exists, this will succeed
				await fs.rm(projectDir, { recursive: true, force: true });
			} catch (err) {
				// Directory doesn't exist, no need to delete
			}

			const zip = new JSZip();
			const content = await fs.readFile(req.file.path);
			const zipData = await zip.loadAsync(content);

			await Promise.all(
				Object.keys(zipData.files).map(async (relativePath) => {
					const file = zipData.files[relativePath];
					if (file.dir) return;

					const fileContent = await file.async("nodebuffer");

					const absolutePath = path.join(projectDir, relativePath);
					await fs.mkdir(path.dirname(absolutePath), { recursive: true });
					await fs.writeFile(absolutePath, fileContent);
				})
			);

			await fs.unlink(req.file.path);

			const testResults = await runRustTests(req.params.projectId);
			res.json(testResults);
		} catch (err) {
			console.error("Testing failed:", err);
			res.status(500).json({ error: "Testing failed" });
		}
	}
);

app.post("/api/projects/:projectId/delete", async (req, res) => {
	try {
		const { projectId } = req.params;
		const projectDir = path.join(BASE_STORAGE_DIR, projectId);

		// Check if the directory exists and delete it
		try {
			await fs.access(projectDir);
			await fs.rm(projectDir, { recursive: true, force: true });
			console.log(`Deleted folder for project ${projectId}`);
		} catch (err) {
			console.warn(
				`No folder to delete for project ${projectId}:`,
				err.message
			);
		}

		return res.json({ success: true, message: "Project folder deleted" });
	} catch (err) {
		console.error("Failed to delete folder:", err);
		res.status(500).json({ error: "Failed to delete folder" });
	}
});

app.use((err, _req, res, _next) => {
	console.error("Unhandled error:", err);
	res.status(500).json({ error: "Internal Server Error" });
});

// Initialize and start the server
initializeStorage()
	.then(() => {
		server.listen(PORT, "0.0.0.0", () => {
			console.log(`Server running on http://localhost:${PORT}`);
			console.log(
				`Language Server available on ws://localhost:${PORT}/rust-analyzer`
			);
			console.log(__dirname);
		});
	})
	.catch((err) => {
		console.error("Failed to initialize storage:", err);
		process.exit(1);
	});
