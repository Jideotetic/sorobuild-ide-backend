import "dotenv/config";
import express from "express";
import cors from "cors";
import { promisify } from "util";
import { exec } from "child_process";
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
} from "./utils.js";
import archiver from "archiver";

const storage = multer.diskStorage({
	destination: (_req, _file, cb) => {
		cb(null, path.join(__dirname, "temps"));
	},
	filename: (_req, file, cb) => {
		cb(null, file.originalname);
	},
});
const upload = multer({ storage });

const PORT = process.env.PORT;

const execAsync = promisify(exec);
const app = express();
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
	})
);

app.use(express.json({ limit: "500mb" }));

// API Endpoints
app.post("/api/projects/create", async (req, res) => {
	try {
		const projectId = uuidv4();

		console.log({ req: req.path });

		if (req.body?.files && Object.keys(req.body.files).length > 0) {
			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

			await fs.mkdir(projectDir, { recursive: true });
			const { files, rootName = "New Folder" } = req.body;
			const targetDir = path.join(projectDir, rootName);

			await fs.mkdir(targetDir, { recursive: true });

			for (const [filename, content] of Object.entries(files)) {
				const filePath = path.join(targetDir, filename);

				await fs.writeFile(filePath, content);
			}
		}

		res.json({ projectId });
	} catch (err) {
		console.error("Project creation failed:", err);
		res.status(500).json({ error: "Project creation failed" });
	}
});

app.post(
	"/api/projects/:projectId/upload-zip",
	upload.single("file"),
	async (req, res) => {
		console.log({ req: req.path });
		try {
			try {
				await fs.access(path.join(__dirname, "temps"));
			} catch (err) {
				console.error("Temp directory missing, recreating...");
				await fs.mkdir(path.join(__dirname, "temps"), { recursive: true });
			}
			const projectId = req.params.projectId;
			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

			const zip = new JSZip();
			const content = await fs.readFile(req.file.path);
			const zipData = await zip.loadAsync(content);

			await Promise.all(
				Object.keys(zipData.files).map(async (relativePath) => {
					const file = zipData.files[relativePath];
					if (zipData.files[relativePath].dir) return;

					const fileContent = await file.async("nodebuffer");
					const absolutePath = path.join(projectDir, relativePath);

					await fs.mkdir(path.dirname(absolutePath), { recursive: true });
					await fs.writeFile(absolutePath, fileContent);
				})
			);

			await fs.unlink(req.file.path);
			res.json({ success: true });
		} catch (err) {
			console.error("Zip extraction failed:", err);
			res.status(500).json({ error: "Failed to process zip file" });
		}
	}
);

// app.post("/api/projects/upload", async (req, res) => {
// 	try {
// 		const { projectId, folderName } = req.body;

// 		if (!projectId || !folderName) {
// 			return res.status(400).json({ error: "Missing projectId or folderName" });
// 		}

// 		const projectDir = path.join(BASE_STORAGE_DIR, projectId);

// 		try {
// 			await fs.access(projectDir);
// 		} catch {
// 			return res.status(400).json({ error: "Project does not exist" });
// 		}

// 		await Promise.all(
// 			req.files.map(async (file, i) => {
// 				const paths = Array.isArray(req.body.paths)
// 					? req.body.paths
// 					: [req.body.paths];
// 				const relativePath = paths[i];

// 				const pathParts = relativePath.split("/").filter(Boolean);
// 				const fileName = pathParts.pop();
// 				const dirStructure = pathParts.join("/");

// 				const absoluteDirPath = path.join(projectDir, dirStructure);
// 				const absoluteFilePath = path.join(absoluteDirPath, fileName);

// 				await fs.mkdir(absoluteDirPath, { recursive: true });
// 				const readStream = fsSync.createReadStream(file.path);
// 				const writeStream = fsSync.createWriteStream(absoluteFilePath);

// 				await new Promise((resolve, reject) => {
// 					readStream
// 						.pipe(writeStream)
// 						.on("error", reject)
// 						.on("finish", resolve);
// 				});

// 				// await fs.copyFile(file.path, absoluteFilePath);

// 				await fs.unlink(file.path).catch((err) => {
// 					console.warn(
// 						`Warning: Failed to unlink temp file ${file.path}`,
// 						err.message
// 					);
// 				});
// 			})
// 		);

// 		res.json({ success: true, count: req.files.length });
// 	} catch (err) {
// 		console.error("Batch upload failed:", err);
// 		res.status(500).json({ error: "Batch upload failed" });
// 	}
// });

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

		// Pipe archive directly to response
		archive.pipe(res);

		// archive.directory(projectDir, false);
		await archive.finalize(); // Wait until archive is finished
	} catch (error) {
		console.error("Download failed:", error);
		res.status(500).json({ error: "Download failed", details: error.message });
	}
});

// app.get("/api/projects/:projectId/files", async (req, res) => {
// 	try {
// 		const files = await listProjectFiles(req.params.projectId);
// 		const contents = {};

// 		for (const file of files) {
// 			contents[file] = await fs.readFile(
// 				path.join(await getProjectPath(req.params.projectId), file),
// 				"utf8"
// 			);
// 		}

// 		res.json(contents);
// 	} catch (err) {
// 		console.error("Failed to get files:", err);
// 		res.status(500).json({ error: "Failed to get project files" });
// 	}
// });

// app.put("/api/projects/:projectId/files", async (req, res) => {
// 	try {
// 		const { path: filePath, content } = req.body;

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

// app.post("/api/projects/:projectId/test", async (req, res) => {
// 	try {
// 		// const testResults = await buildQueue.add(() =>
// 		runRustTests(req.params.projectId);
// 		// );
// 		res.json(testResults);
// 	} catch (err) {
// 		console.error("Testing failed:", err);
// 		res.status(500).json({ error: "Testing failed" });
// 	}
// });

// app.post("/api/projects/:projectId/build", async (req, res) => {
// 	try {
// 		const projectId = req.params.projectId;
// 		const projectDir = await getProjectPath(projectId);
// 		// const result = await buildQueue.add(() =>
// 		compileSorobanContract(projectId);
// 		// );

// 		if (!result.success) {
// 			return res.status(400).json({
// 				status: "error",
// 				error: result.error,
// 				output: result.output,
// 				code: result.code,
// 			});
// 		}

// 		// 2. Create a zip of the entire project
// 		const tempDir = os.tmpdir();
// 		const zipPath = path.join(tempDir, `${projectId}.zip`);
// 		const output = fsSync.createWriteStream(zipPath);
// 		const archive = archiver("zip", { zlib: { level: 9 } });

// 		return new Promise((resolve, reject) => {
// 			// Handle archive errors
// 			archive.on("error", (err) => {
// 				console.error("Archive error:", err);
// 				reject(err);
// 			});

// 			archive.glob("**/*", {
// 				cwd: projectDir,
// 				ignore: ["project.zip"],
// 			});

// 			// Pipe the archive to the output file
// 			archive.pipe(output);

// 			// When the archive is finalized, set up the response
// 			archive.on("finish", () => {
// 				res.setHeader("Content-Type", "application/zip");
// 				res.setHeader(
// 					"Content-Disposition",
// 					`attachment; filename="${projectId}.zip"`
// 				);

// 				// Create read stream and pipe to response
// 				const fileStream = fsSync.createReadStream(zipPath);
// 				fileStream.pipe(res);

// 				// Clean up when done
// 				fileStream.on("end", () => {
// 					fs.unlink(zipPath).catch(console.error);
// 					resolve();
// 				});

// 				fileStream.on("error", (err) => {
// 					console.error("File stream error:", err);
// 					fs.unlink(zipPath).catch(console.error);
// 					reject(err);
// 				});
// 			});

// 			// Add directory to archive
// 			archive.directory(projectDir, false);
// 			archive.finalize();
// 		});
// 	} catch (err) {
// 		console.error("Build failed:", err);
// 		res.status(500).json({
// 			error: "Unexpected build failure",
// 			details: err.message,
// 		});
// 	}
// });

// app.post("/api/upload-chunk", upload.single("chunk"), async (req, res) => {
// 	try {
// 		const { fileKey, chunkIndex, chunkCount, projectId } = req.body;
// 		const chunk = req.file.buffer;

// 		// Initialize file assembly if first chunk
// 		if (!fileAssemblyCache.has(fileKey)) {
// 			fileAssemblyCache.set(fileKey, {
// 				chunks: [],
// 				received: 0,
// 				projectId,
// 			});
// 		}

// 		const fileAssembly = fileAssemblyCache.get(fileKey);
// 		fileAssembly.chunks[chunkIndex] = chunk;
// 		fileAssembly.received++;

// 		// Check if all chunks received
// 		if (fileAssembly.received === parseInt(chunkCount)) {
// 			const filePath = path.join(BASE_STORAGE_DIR, fileKey);
// 			await fs.mkdir(path.dirname(filePath), { recursive: true });

// 			const writeStream = fsSync.createWriteStream(filePath);
// 			for (const chunk of fileAssembly.chunks) {
// 				writeStream.write(chunk);
// 			}
// 			writeStream.end();

// 			fileAssemblyCache.delete(fileKey);
// 		}

// 		res.json({ success: true });
// 	} catch (error) {
// 		console.error("Chunk upload failed:", error);
// 		res.status(500).json({ error: "Chunk processing failed" });
// 	}
// });

// app.post("/api/finalize-file", async (req, res) => {
// 	try {
// 		const { fileKey, projectId } = req.body;
// 		// Additional validation if needed
// 		res.json({ success: true });
// 	} catch (error) {
// 		res.status(500).json({ error: "Finalization failed" });
// 	}
// });

// Start server
initializeStorage()
	.then(() => {
		app.listen(PORT, () => {
			console.log(`Server running on http://localhost:${PORT}`);
		});
	})
	.catch((err) => {
		console.error("Failed to initialize storage:", err);
		process.exit(1);
	});

app.use((err, _req, res, _next) => {
	console.error("Unhandled error:", err);
	res.status(500).json({ error: "Internal Server Error" });
});
