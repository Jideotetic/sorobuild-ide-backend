import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import unzipper from "unzipper";
import { Project } from "./models/project.js";
import { bucket, connectToMongoDB } from "./models/db.js";
import crypto from "crypto";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const BASE_STORAGE_DIR = path.join(__dirname, "projects");
const TEMP_DIR = path.join(__dirname, "temps");
const execAsync = promisify(exec);

export async function initializeStorage() {
	await connectToMongoDB();
	await fsp.mkdir(BASE_STORAGE_DIR, { recursive: true });
	await fsp.mkdir(TEMP_DIR, { recursive: true });
}

export async function getProjectPath(projectId) {
	const projectPath = path.join(BASE_STORAGE_DIR, projectId);
	return projectPath;
}

export async function formatRustCode(projectId) {
	try {
		const projectDir = await getProjectPath(projectId);

		const items = await fsp.readdir(projectDir);
		const [rootFolderName] = items;

		const targetDir = path.join(projectDir, rootFolderName);

		console.log({ projectDir, items, rootFolderName, targetDir });

		const { stdout, stderr } = await execAsync("cargo fmt", {
			cwd: targetDir,
			timeout: 1_200_000,
			maxBuffer: 100 * 1024 * 1024,
		});

		return {
			success: true,
			output: stdout + stderr,
		};
	} catch (error) {
		console.log("Format failed", error);
		const output = error.stdout + error.stderr;
		return {
			success: false,
			output,
		};
	}
}

export async function runTests(projectId) {
	try {
		const projectDir = await getProjectPath(projectId);

		const items = await fsp.readdir(projectDir);
		const [rootFolderName] = items;

		const targetDir = path.join(projectDir, rootFolderName);

		console.log({ projectDir, items, rootFolderName, targetDir });

		const { stdout, stderr } = await execAsync("cargo test -- --nocapture", {
			cwd: targetDir,
			timeout: 1_200_000,
			maxBuffer: 100 * 1024 * 1024,
		});

		return {
			success: true,
			output: stdout + stderr,
		};
	} catch (error) {
		console.log("Test failed", error);
		const output = error.stdout + error.stderr;
		return {
			success: false,
			output,
		};
	}
}

export async function buildSorobanContract(projectId) {
	try {
		const projectDir = await getProjectPath(projectId);

		const items = await fsp.readdir(projectDir);
		const [rootFolderName] = items;

		const targetDir = path.join(projectDir, rootFolderName);

		console.log({ projectDir, items, rootFolderName, targetDir });

		const { stdout, stderr } = await execAsync("soroban contract build", {
			cwd: targetDir,
			timeout: 1_200_000,
			maxBuffer: 100 * 1024 * 1024,
		});

		const wasmPath = path.join(targetDir, "target", "wasm32v1-none", "release");

		const files = await fsp.readdir(wasmPath);
		const wasmFile = files.find((f) => f.endsWith(".wasm"));

		if (!wasmFile) {
			throw new Error("WASM file not found after build");
		}

		const fullPath = path.join(wasmPath, wasmFile);

		const wasmBuffer = fs.readFileSync(fullPath);
		const hex = wasmBuffer.toString("hex");

		const wasmHash = crypto
			.createHash("sha256")
			.update(wasmBuffer)
			.digest("hex");

		// const output = stdout + stderr;

		// // Extract wasm hash
		// const hashMatch = output.match(/Wasm Hash:\s*([a-fA-F0-9]+)/);
		// const wasmHash = hashMatch ? hashMatch[1] : null;

		// if (!wasmHash) {
		// 	console.warn("Wasm hash not found in build output");
		// }

		console.dir({ stderr, targetDir, fullPath, hex, wasmHash });

		const existingProject = await Project.findOne({ projectId });
		if (!existingProject) {
			throw new Error(`Project ${projectId} not found`);
		}

		await Project.findOneAndUpdate(
			{ projectId },
			{
				hex,
				wasmHash,
			},
		);

		return {
			success: true,
			output: stdout + stderr,
		};
	} catch (error) {
		console.log("Build failed", error);
		const output = error.stdout + error.stderr;
		return {
			success: false,
			output,
		};
	}
}

export async function unzipProject(filePath, projectDir) {
	return new Promise((resolve, reject) => {
		fs.createReadStream(filePath)
			.pipe(unzipper.Parse())
			.on("entry", async (entry) => {
				const relativePath = entry.path;
				const absolutePath = path.resolve(projectDir, relativePath);

				// Prevent zip slip attack
				if (!absolutePath.startsWith(path.resolve(projectDir))) {
					entry.autodrain();
					return reject(
						new Error(`Blocked zip path traversal attempt: ${relativePath}`),
					);
				}

				try {
					if (entry.type === "Directory") {
						await fsp.mkdir(absolutePath, { recursive: true });
						entry.autodrain();
					} else {
						await fsp.mkdir(path.dirname(absolutePath), {
							recursive: true,
						});
						entry.pipe(fs.createWriteStream(absolutePath));
					}
				} catch (err) {
					entry.autodrain();
					reject(err);
				}
			})
			.on("close", async () => {
				try {
					await fsp.unlink(filePath);
					resolve();
				} catch (err) {
					reject(err);
				}
			})
			.on("error", reject);
	});
}

export async function updateDBCopy(req) {
	const projectId = req.params.projectId;
	const filePath = req.file.path;

	console.log({ projectId, filePath, req: req.url });

	const project = await Project.findOne({ projectId });

	if (project.zipFileId) {
		try {
			await bucket.delete(project.zipFileId);
			console.log("✅ Deleted old zip file");
		} catch (err) {
			console.log("❌ Failed to delete old zip file:", err);
		}
	}

	const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
	const fileReadStream = fs.createReadStream(filePath);
	fileReadStream.pipe(uploadStream);

	await new Promise((resolve, reject) => {
		uploadStream.on("finish", async () => {
			const stats = await fs.promises.stat(filePath);
			project.zipFileId = uploadStream.id;
			project.size = stats.size;
			await project.save();
			console.log("✅ DB updated with new zip file");
			resolve();
		});
		uploadStream.on("error", reject);
	});
}

export async function saveToDB(req, projectId) {
	const filePath = req.file.path;

	console.log({ projectId, filePath, req: req.url });

	const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
	const fileReadStream = fs.createReadStream(filePath);
	fileReadStream.pipe(uploadStream);

	await new Promise((resolve, reject) => {
		uploadStream.on("finish", async () => {
			const stats = await fs.promises.stat(filePath);
			await Project.create({
				projectId,
				zipFileId: uploadStream.id,
				size: stats.size,
			});
			console.log("✅ Added new zip file to DB");
			resolve();
		});
		uploadStream.on("error", reject);
	});
}

export async function updateInDB(req, projectId) {
	const filePath = req.file.path;

	console.log({ projectId, filePath, req: req.url });

	// Find the existing project
	const existingProject = await Project.findOne({ projectId });
	if (!existingProject) {
		throw new Error(`Project ${projectId} not found`);
	}

	// Delete the old zip file from GridFS
	if (existingProject.zipFileId) {
		await bucket.delete(existingProject.zipFileId);
		console.log("🗑️ Deleted old zip file from GridFS");
	}

	// Upload the new zip file
	const uploadStream = bucket.openUploadStream(`${projectId}.zip`);
	const fileReadStream = fs.createReadStream(filePath);
	fileReadStream.pipe(uploadStream);

	await new Promise((resolve, reject) => {
		uploadStream.on("finish", async () => {
			const stats = await fs.promises.stat(filePath);
			await Project.findOneAndUpdate(
				{ projectId },
				{
					zipFileId: uploadStream.id,
					size: stats.size,
				},
			);
			console.log("✅ Updated zip file in DB");
			resolve();
		});
		uploadStream.on("error", reject);
	});
}
