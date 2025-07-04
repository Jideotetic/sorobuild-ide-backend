// import "dotenv/config";
// import express from "express";
// import cors from "cors";
// import fs from "fs/promises";
// import path from "path";
// import { v4 as uuidv4 } from "uuid";
// import helmet from "helmet";
// import multer from "multer";
// import JSZip from "jszip";
// import {
// 	BASE_STORAGE_DIR,
// 	initializeStorage,
// 	__dirname,
// 	getProjectPath,
// 	saveProjectFile,
// 	formatRustCode,
// 	normalizePath,
// 	compileSorobanContract,
// 	runRustTests,
// } from "./utils.js";
// import archiver from "archiver";

// const storage = multer.diskStorage({
// 	destination: (_req, _file, cb) => {
// 		cb(null, path.join(__dirname, "temps"));
// 	},
// 	filename: (_req, file, cb) => {
// 		cb(null, file.originalname);
// 	},
// });
// const upload = multer({ storage });

// const PORT = process.env.PORT;

// const app = express();
// app.use(helmet());
// app.use(
// 	cors({
// 		origin: [
// 			"http://localhost:5173",
// 			"http://127.0.0.1:5173",
// 			"https://rust-ide-five.vercel.app",
// 		],
// 		methods: ["GET", "POST", "PUT"],
// 		credentials: true,
// 	})
// );

// app.use(express.json({ limit: "500mb" }));

// // API Endpoints
// app.post("/api/projects/create", async (req, res) => {
// 	try {
// 		const projectId = uuidv4();

// 		console.log({ req: req.path });

// 		if (req.body?.files && Object.keys(req.body.files).length > 0) {
// 			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

// 			await fs.mkdir(projectDir, { recursive: true });
// 			const { files, rootName = "New Folder" } = req.body;
// 			const targetDir = path.join(projectDir, rootName);

// 			await fs.mkdir(targetDir, { recursive: true });

// 			for (const [filename, content] of Object.entries(files)) {
// 				const filePath = path.join(targetDir, filename);

// 				await fs.writeFile(filePath, content);
// 			}
// 		}

// 		res.json({ projectId });
// 	} catch (err) {
// 		console.error("Project creation failed:", err);
// 		res.status(500).json({ error: "Project creation failed" });
// 	}
// });

// app.post(
// 	"/api/projects/:projectId/upload-zip",
// 	upload.single("file"),
// 	async (req, res) => {
// 		console.log({ req: req.path });
// 		try {
// 			try {
// 				await fs.access(path.join(__dirname, "temps"));
// 			} catch (err) {
// 				console.error("Temp directory missing, recreating...");
// 				await fs.mkdir(path.join(__dirname, "temps"), { recursive: true });
// 			}
// 			const projectId = req.params.projectId;
// 			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

// 			const zip = new JSZip();
// 			const content = await fs.readFile(req.file.path);
// 			const zipData = await zip.loadAsync(content);

// 			await Promise.all(
// 				Object.keys(zipData.files).map(async (relativePath) => {
// 					const file = zipData.files[relativePath];
// 					if (zipData.files[relativePath].dir) return;

// 					const fileContent = await file.async("nodebuffer");
// 					const absolutePath = path.join(projectDir, relativePath);

// 					await fs.mkdir(path.dirname(absolutePath), { recursive: true });
// 					await fs.writeFile(absolutePath, fileContent);
// 				})
// 			);

// 			await fs.unlink(req.file.path);
// 			res.json({ success: true });
// 		} catch (err) {
// 			console.error("Zip extraction failed:", err);
// 			res.status(500).json({ error: "Failed to process zip file" });
// 		}
// 	}
// );

// app.get("/api/projects/:projectId/download", async (req, res) => {
// 	try {
// 		console.log({ req: req.path });
// 		const projectId = req.params.projectId;
// 		const projectDir = await getProjectPath(projectId);

// 		if (!projectDir) {
// 			return res.status(400).json({ error: "No project found" });
// 		}

// 		const items = await fs.readdir(projectDir);
// 		const [rootFolderName] = items;

// 		const targetDir = path.join(projectDir, rootFolderName);

// 		res.setHeader("Content-Type", "application/zip");
// 		res.setHeader(
// 			"Content-Disposition",
// 			`attachment; filename="${rootFolderName}.zip"`
// 		);

// 		const archive = archiver("zip", { zlib: { level: 9 } });

// 		archive.on("error", (err) => {
// 			console.error("Archive error:", err);
// 			res.status(500).end("Failed to create archive");
// 		});

// 		archive.directory(targetDir, rootFolderName);

// 		// Pipe archive directly to response
// 		archive.pipe(res);

// 		// archive.directory(projectDir, false);
// 		await archive.finalize(); // Wait until archive is finished
// 	} catch (error) {
// 		console.error("Download failed:", error);
// 		res.status(500).json({ error: "Download failed", details: error.message });
// 	}
// });

// app.put("/api/projects/:projectId/save", async (req, res) => {
// 	try {
// 		const { path: filePath, content } = req.body;

// 		console.log(filePath);

// 		let finalContent = await formatRustCode(content);

// 		await saveProjectFile(
// 			req.params.projectId,
// 			normalizePath(filePath),
// 			finalContent
// 		);
// 		res.json({ success: true, content: finalContent });
// 	} catch (err) {
// 		console.error("Failed to update file:", err);
// 		res.status(500).json({ error: "Failed to update file" });
// 	}
// });

// app.post("/api/projects/:projectId/build", async (req, res) => {
// 	try {
// 		console.log({ req: req.path });
// 		const projectId = req.params.projectId;
// 		const projectDir = await getProjectPath(projectId);
// 		const result = await compileSorobanContract(projectId);

// 		const items = await fs.readdir(projectDir);
// 		const [rootFolderName] = items;

// 		const targetDir = path.join(projectDir, rootFolderName);

// 		if (!result.success) {
// 			return res.status(400).json({
// 				status: "error",
// 				error: result.error,
// 				output: result.output,
// 				code: result.code,
// 			});
// 		}

// 		res.setHeader("Content-Type", "application/zip");
// 		res.setHeader(
// 			"Content-Disposition",
// 			`attachment; filename="${rootFolderName}.zip"`
// 		);

// 		const archive = archiver("zip", { zlib: { level: 9 } });

// 		archive.on("error", (err) => {
// 			console.error("Archive error:", err);
// 			res.status(500).end("Failed to create archive");
// 		});

// 		archive.directory(targetDir, rootFolderName);

// 		archive.pipe(res);

// 		await archive.finalize();
// 	} catch (err) {
// 		console.error("Build failed:", err);
// 		res.status(500).json({
// 			error: "Unexpected build failure",
// 			details: err.message,
// 		});
// 	}
// });

// // app.post("/api/projects/upload", async (req, res) => {
// // 	try {
// // 		const { projectId, folderName } = req.body;

// // 		if (!projectId || !folderName) {
// // 			return res.status(400).json({ error: "Missing projectId or folderName" });
// // 		}

// // 		const projectDir = path.join(BASE_STORAGE_DIR, projectId);

// // 		try {
// // 			await fs.access(projectDir);
// // 		} catch {
// // 			return res.status(400).json({ error: "Project does not exist" });
// // 		}

// // 		await Promise.all(
// // 			req.files.map(async (file, i) => {
// // 				const paths = Array.isArray(req.body.paths)
// // 					? req.body.paths
// // 					: [req.body.paths];
// // 				const relativePath = paths[i];

// // 				const pathParts = relativePath.split("/").filter(Boolean);
// // 				const fileName = pathParts.pop();
// // 				const dirStructure = pathParts.join("/");

// // 				const absoluteDirPath = path.join(projectDir, dirStructure);
// // 				const absoluteFilePath = path.join(absoluteDirPath, fileName);

// // 				await fs.mkdir(absoluteDirPath, { recursive: true });
// // 				const readStream = fsSync.createReadStream(file.path);
// // 				const writeStream = fsSync.createWriteStream(absoluteFilePath);

// // 				await new Promise((resolve, reject) => {
// // 					readStream
// // 						.pipe(writeStream)
// // 						.on("error", reject)
// // 						.on("finish", resolve);
// // 				});

// // 				// await fs.copyFile(file.path, absoluteFilePath);

// // 				await fs.unlink(file.path).catch((err) => {
// // 					console.warn(
// // 						`Warning: Failed to unlink temp file ${file.path}`,
// // 						err.message
// // 					);
// // 				});
// // 			})
// // 		);

// // 		res.json({ success: true, count: req.files.length });
// // 	} catch (err) {
// // 		console.error("Batch upload failed:", err);
// // 		res.status(500).json({ error: "Batch upload failed" });
// // 	}
// // });

// // app.get("/api/projects/:projectId/files", async (req, res) => {
// // 	try {
// // 		const files = await listProjectFiles(req.params.projectId);
// // 		const contents = {};

// // 		for (const file of files) {
// // 			contents[file] = await fs.readFile(
// // 				path.join(await getProjectPath(req.params.projectId), file),
// // 				"utf8"
// // 			);
// // 		}

// // 		res.json(contents);
// // 	} catch (err) {
// // 		console.error("Failed to get files:", err);
// // 		res.status(500).json({ error: "Failed to get project files" });
// // 	}
// // });

// app.post("/api/projects/:projectId/test", async (req, res) => {
// 	try {
// 		const testResults = await runRustTests(req.params.projectId);

// 		res.json(testResults);
// 	} catch (err) {
// 		console.error("Testing failed:", err);
// 		res.status(500).json({ error: "Testing failed" });
// 	}
// });

// // Start server
// initializeStorage()
// 	.then(() => {
// 		app.listen(PORT, () => {
// 			console.log(`Server running on http://localhost:${PORT}`);
// 		});
// 	})
// 	.catch((err) => {
// 		console.error("Failed to initialize storage:", err);
// 		process.exit(1);
// 	});

// app.use((err, _req, res, _next) => {
// 	console.error("Unhandled error:", err);
// 	res.status(500).json({ error: "Internal Server Error" });
// });

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
	getProjectPath,
	saveProjectFile,
	formatRustCode,
	normalizePath,
	compileSorobanContract,
	runRustTests,
	__filename,
} from "./utils.js";
import archiver from "archiver";
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
const upload = multer({ storage });

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
		methods: ["GET", "POST", "PUT", "OPTIONS"],
		credentials: true,
		allowedHeaders: ["*"],
	})
);

app.use(express.json({ limit: "1000mb" }));

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
// app.post("/api/projects/create", async (req, res) => {
// 	try {
// 		const projectId = uuidv4();

// 		if (req.body?.files && Object.keys(req.body.files).length > 0) {
// 			const projectDir = path.join(BASE_STORAGE_DIR, projectId);
// 			await fs.mkdir(projectDir, { recursive: true });

// 			const { files, rootName = "New Folder" } = req.body;
// 			const targetDir = path.join(projectDir, rootName);
// 			await fs.mkdir(targetDir, { recursive: true });
// 		}

// 		res.json({ projectId });
// 	} catch (err) {
// 		console.error("Project creation failed:", err);
// 		res.status(500).json({ error: "Project creation failed" });
// 	}
// });

app.post(
	"/api/projects/upload-zip",
	upload.single("file"),
	async (req, res) => {
		try {
			// try {
			// 	await fs.access(path.join(__dirname, "temps"));
			// } catch (err) {
			// 	console.error("Temp directory missing, recreating...");
			// 	await fs.mkdir(path.join(__dirname, "temps"), { recursive: true });
			// }

			const projectId = uuidv4();
			// const projectDir = path.join(BASE_STORAGE_DIR, projectId);
			// const zip = new JSZip();
			// const content = await fs.readFile(req.file.path);
			// const zipData = await zip.loadAsync(content);

			const fileBuffer = await fs.readFile(req.file.path);

			const readableStream = new Readable();
			readableStream.push(fileBuffer);
			readableStream.push(null);

			const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
			readableStream.pipe(uploadStream);

			uploadStream.on("finish", async () => {
				await fs.unlink(req.file.path);

				const saved = await Project.create({
					projectId,
					zipFileId: uploadStream.id, // Store GridFS file ID
					size: fileBuffer.length,
				});

				console.log("ZIP stored:", saved);
				res.json({ projectId });
			});

			// const extractedFiles = [];

			// await Promise.all(
			// 	Object.keys(zipData.files).map(async (relativePath) => {
			// 		const file = zipData.files[relativePath];
			// 		if (file.dir) return;

			// 		const fileContent = await file.async("nodebuffer");

			// 		// const readableStream = new Readable();
			// 		// readableStream.push(fileContent);
			// 		// readableStream.push(null);

			// 		// const uploadStream = bucket.openUploadStream(relativePath);
			// 		// const uploadPromise = new Promise((resolve, reject) => {
			// 		// 	uploadStream.on("finish", () => {
			// 		// 		extractedFiles.push({
			// 		// 			path: relativePath,
			// 		// 			fileId: uploadStream.id,
			// 		// 		});
			// 		// 		resolve();
			// 		// 	});
			// 		// 	uploadStream.on("error", reject);
			// 		// });

			// 		// readableStream.pipe(uploadStream);
			// 		// await uploadPromise;

			// 		// extractedFiles.push({
			// 		// 	path: relativePath,
			// 		// 	fileId: uploadStream.id,
			// 		// });

			// 		const absolutePath = path.join(projectDir, relativePath);
			// 		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			// 		await fs.writeFile(absolutePath, fileContent);
			// 	})
			// );

			// await fs.unlink(req.file.path);

			// const saved = await Project.create({
			// 	projectId,
			// 	files: extractedFiles,
			// 	size: content.length,
			// });

			// console.log(saved);

			// res.json({ projectId });

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

app.get("/api/projects/:projectId/load", async (req, res) => {
	try {
		const project = await Project.findOne({ projectId: req.params.projectId });
		if (!project || !project.zipFileId) {
			return res.status(404).json({ error: "ZIP file not found" });
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

app.get("/api/projects/:projectId/download", async (req, res) => {
	try {
		console.log({ req: req.path });
		const projectId = req.params.projectId;
		const projectDir = await getProjectPath(projectId);

		if (!projectDir) {
			return res.status(400).json({ error: "No project found" });
		}

		const items = await fs.readdir(projectDir);
		const [rootFolderName] = items;
		const targetDir = path.join(projectDir, rootFolderName);

		res.setHeader("Content-Type", "application/zip");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${rootFolderName}.zip"`
		);

		const archive = archiver("zip", { zlib: { level: 9 } });
		archive.on("error", (err) => {
			console.error("Archive error:", err);
			res.status(500).end("Failed to create archive");
		});

		archive.directory(targetDir, rootFolderName);
		archive.pipe(res);
		await archive.finalize();
	} catch (error) {
		console.error("Download failed:", error);
		res.status(500).json({ error: "Download failed", details: error.message });
	}
});

app.put("/api/projects/:projectId/save", async (req, res) => {
	try {
		const { path: filePath, content } = req.body;
		console.log(filePath);

		let finalContent = await formatRustCode(content);
		await saveProjectFile(
			req.params.projectId,
			normalizePath(filePath),
			finalContent
		);
		res.json({ success: true, content: finalContent });
	} catch (err) {
		console.error("Failed to update file:", err);
		res.status(500).json({ error: "Failed to update file" });
	}
});

app.post("/api/projects/:projectId/build", async (req, res) => {
	try {
		console.log({ req: req.path });
		const projectId = req.params.projectId;
		const projectDir = await getProjectPath(projectId);
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

		res.setHeader("Content-Type", "application/zip");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${rootFolderName}.zip"`
		);

		const archive = archiver("zip", { zlib: { level: 9 } });
		archive.on("error", (err) => {
			console.error("Archive error:", err);
			res.status(500).end("Failed to create archive");
		});

		archive.directory(targetDir, rootFolderName);
		archive.pipe(res);
		await archive.finalize();
	} catch (err) {
		console.error("Build failed:", err);
		res.status(500).json({
			error: "Unexpected build failure",
			details: err.message,
		});
	}
});

app.post("/api/projects/:projectId/test", async (req, res) => {
	try {
		const testResults = await runRustTests(req.params.projectId);
		res.json(testResults);
	} catch (err) {
		console.error("Testing failed:", err);
		res.status(500).json({ error: "Testing failed" });
	}
});

// Error handling middleware
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
