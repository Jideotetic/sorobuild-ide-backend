import { spawn } from "child_process";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import unzipper from "unzipper";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const BASE_STORAGE_DIR = path.join(__dirname, "projects");
const TEMP_DIR = path.join(__dirname, "temps");
const execAsync = promisify(exec);

export async function initializeStorage() {
	await fsp.mkdir(BASE_STORAGE_DIR, { recursive: true });
	await fsp.mkdir(TEMP_DIR, { recursive: true });
}

export async function getProjectPath(projectId) {
	const projectPath = path.join(BASE_STORAGE_DIR, projectId);
	return projectPath;
}

export async function formatRustCode(code) {
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

export async function runTests(projectId) {
	try {
		const projectDir = await getProjectPath(projectId);

		const items = await fsp.readdir(projectDir);
		const [rootFolderName] = items;

		const targetDir = path.join(projectDir, rootFolderName);
		try {
			await fsp.access(path.join(targetDir, "Cargo.toml"));
		} catch {
			return {
				output:
					"Not a valid Rust project: Cargo.toml not found in the directory.",
			};
		}

		const { stdout, stderr } = await execAsync("cargo test -- --nocapture", {
			cwd: targetDir,
			timeout: 1_200_000,
		});

		return { output: stdout };
	} catch (error) {
		return {
			output: (error.stdout ?? "") + (error.stderr ?? "") || String(error),
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
						new Error(`Blocked zip path traversal attempt: ${relativePath}`)
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
