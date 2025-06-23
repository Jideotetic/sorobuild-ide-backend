import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { promisify } from "util";
import { exec } from "child_process";
import fs from "fs/promises";
import path, { resolve } from "path";
import os from "os";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import archiver from "archiver";
import fsSync from "fs";
import { spawn } from "child_process";
import PQueue from "p-queue";
import multer from "multer";
import JSZip from "jszip";
import unzipper from "unzipper";

// const upload = multer({
// 	dest: "temps/",
// });

// const storage = multer.memoryStorage();
// const upload = multer({ storage });

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, "temps/");
	},
	filename: (req, file, cb) => {
		cb(null, file.originalname);
	},
});
const upload = multer({ storage });

// Track file assembly in memory (for Render's stateless environment)
// const fileAssemblyCache = new Map();

// const upload = multer({
// storage: multer.diskStorage({
// 	destination: (req, file, cb) => {
// 		cb(null, os.tmpdir()); // Use system temp directory
// 	},
// 	filename: (req, file, cb) => {
// 		cb(null, `upload-${Date.now()}-${file.originalname}`);
// 	},
// }),
// limits: {
// 	fileSize: 50 * 1024 * 1024, // 50MB per file
// 	files: MAX_BATCH_SIZE,
// },
// });

// const buildQueue = new PQueue({ concurrency: 1 });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 4000;
const BASE_STORAGE_DIR = path.join(__dirname, "projects");
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
// app.use(cors({ origin: "http://localhost:5173" }));
// app.use(bodyParser.text({ type: "*/*", limit: "10mb" }));
// app.use(bodyParser.json({ limit: "10mb" }));
// app.use(
//     rateLimit({
//         windowMs: 15 * 60 * 1000,
//         max: 100,
//     })
// );

app.use(express.json({ limit: "500mb" }));

// Ensure directories exist
async function initializeStorage() {
	await fs.mkdir(BASE_STORAGE_DIR, { recursive: true });
	// await fs.mkdir(TEMP_DIR, { recursive: true });
}

function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/");
}

// Storage Functions
async function getProjectPath(projectId) {
	const projectPath = path.join(BASE_STORAGE_DIR, projectId);
	await fs.mkdir(projectPath, { recursive: true });
	return projectPath;
}

async function saveProjectFile(projectId, filePath, content) {
	const normalizedPath = normalizePath(filePath);
	const absolutePath = path.join(
		await getProjectPath(projectId),
		normalizedPath
	);

	await fs.mkdir(path.dirname(absolutePath), { recursive: true });
	await fs.writeFile(absolutePath, content);
}

async function readProjectFile(projectId, filePath) {
	const projectPath = await getProjectPath(projectId);
	const absolutePath = path.join(projectPath, normalizePath(filePath));
	return fs.readFile(absolutePath, "utf8");
}

// async function listProjectFiles(projectId) {
// 	const projectPath = await getProjectPath(projectId);

// 	const readDirRecursive = async (dir) => {
// 		const entries = await fs.readdir(dir, { withFileTypes: true });
// 		const files = [];

// 		for (const entry of entries) {
// 			const fullPath = path.join(dir, entry.name);
// 			if (entry.isDirectory()) {
// 				files.push(...(await readDirRecursive(fullPath)));
// 			} else {
// 				const relativePath = path.relative(projectPath, fullPath);
// 				files.push(normalizePath(relativePath));
// 			}
// 		}

// 		return files;
// 	};

// 	return readDirRecursive(projectPath);
// }

// Rust Operations

// async function formatRustCode(projectId, filePath, code) {
// 	try {
// 		const projectDir = await getProjectPath(projectId);
// 		const cargoTomlPath = path.join(projectDir, "Cargo.toml");
// 		await fs.access(cargoTomlPath);

// 		console.log({ code });

// 		// await saveProjectFile(projectId, filePath, code);

// 		const { stdout } = await execAsync("cargo fmt", {
// 			cwd: projectDir,
// 			timeout: 600_000,
// 		});

// 		console.log({ code });
// 		const formattedContent = await readProjectFile(projectId, filePath);
// 		console.log({ formattedContent });
// 		return formattedContent;
// 	} catch (error) {
// 		console.error("Formatting error:", error);
// 		return code;
// 	}
// }

async function formatRustCode(code) {
	return new Promise((resolve) => {
		const child = spawn("rustfmt", ["--emit", "stdout", "--edition", "2021"]);

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("error", (err) => {
			console.error("rustfmt error:", err);
			resolve(code); // Return original code
		});

		child.on("close", (codeExit, signal) => {
			if (codeExit === 0 && !stderr.trim()) {
				resolve(stdout);
			} else {
				console.error("rustfmt failed:", { codeExit, signal, stderr });
				resolve(code); // Return original if formatting fails
			}
		});

		// Write code to rustfmt's stdin
		child.stdin.write(code);
		child.stdin.end();
	});
}

async function runRustTests(projectId) {
	try {
		const projectDir = await getProjectPath(projectId);
		try {
			await fs.access(path.join(projectDir, "Cargo.toml"));
		} catch {
			return {
				output:
					"Not a valid Rust project: Cargo.toml not found in the directory.",
			};
		}

		const { stdout, stderr } = await execAsync("cargo test -- --nocapture", {
			cwd: projectDir,
			timeout: 1_200_000,
		});

		return { output: stdout };
	} catch (error) {
		return {
			output: (error.stdout ?? "") + (error.stderr ?? "") || String(error),
		};
	}
}

async function compileSorobanContract(projectId) {
	try {
		const projectDir = await getProjectPath(projectId);

		const { stdout, stderr } = await execAsync("soroban contract build", {
			cwd: projectDir,
			timeout: 1_200_000,
		});

		return {
			success: true,
			output: stdout + stderr,
			wasmPath: path.join(projectDir, "target/wasm32v1-none/release"),
		};
	} catch (error) {
		console.log(error);
		return {
			success: false,
			error: error.message,
			output: (error.stdout || "") + (error.stderr || ""),
			code: error.code,
			signal: error.signal,
		};
	}
}

// API Endpoints
app.post("/api/projects/create", async (req, res) => {
	try {
		const projectId = uuidv4();

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
		try {
			const projectId = req.params.projectId;
			const projectDir = path.join(BASE_STORAGE_DIR, projectId);

			// const actualPath = path.join("temps", path.basename(req.file.path, ".zip"));

			// console.log(actualPath);

			// try {
			// 	await fsSync
			// 		.createReadStream(req.file.path)
			// 		.pipe(unzipper.Extract({ path: projectDir }))
			// 		.promise();

			// 	fsSync.unlinkSync(req.file.path);

			// 	res.status(200).json({
			// 		message: "Files uploaded and extracted successfully",
			// 		actualPath,
			// 	});
			// } catch (err) {
			// 	console.error(`Unzip Error: ${err.message}`);
			// 	res.status(500).json({
			// 		message: "Unzip failed",
			// 		error: err.message,
			// 	});
			// }

			// Read and extract zip
			const zip = new JSZip();
			const content = await fs.readFile(req.file.path);
			const zipData = await zip.loadAsync(content);

			await Promise.all(
				Object.keys(zipData.files).map(async (relativePath) => {
					const file = zipData.files[relativePath];
					if (zipData.files[relativePath].dir) return;

					// const fileContent = await zipData.files[relativePath].async("text");
					// const absolutePath = path.join(projectDir, relativePath);

					// await fs.mkdir(path.dirname(absolutePath), { recursive: true });
					// await fs.writeFile(absolutePath, fileContent);
					const fileContent = await file.async("nodebuffer");
					const absolutePath = path.join(projectDir, relativePath);

					// Ensure parent directory exists
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

// app.get("/api/projects/:projectId/download", async (req, res) => {
// 	try {
// 		const projectId = req.params.projectId;
// 		const projectDir = await getProjectPath(projectId);

// 		res.setHeader("Content-Type", "application/zip");
// 		res.setHeader(
// 			"Content-Disposition",
// 			`attachment; filename="${projectId}.zip"`
// 		);

// 		const archive = archiver("zip", { zlib: { level: 9 } });

// 		archive.on("error", (err) => {
// 			console.error("Archive error:", err);
// 			res.status(500).end("Failed to create archive");
// 		});

// 		// Pipe archive directly to response
// 		archive.pipe(res);

// 		archive.directory(projectDir, false);
// 		await archive.finalize(); // Wait until archive is finished
// 	} catch (error) {
// 		console.error("Download failed:", error);
// 		res.status(500).json({ error: "Download failed", details: error.message });
// 	}
// });

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

app.use((err, req, res, next) => {
	console.error("Unhandled error:", err);
	res.status(500).json({ error: "Internal Server Error" });
});
