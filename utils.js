import { spawn } from "child_process";

export async function initializeStorage() {
	await fs.mkdir(BASE_STORAGE_DIR, { recursive: true });
	await fs.mkdir(TEMP_DIR, { recursive: true });
}

export function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/");
}

export async function getProjectPath(projectId, folderName) {
	const projectPath = path.join(BASE_STORAGE_DIR, projectId, folderName);
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

async function listProjectFiles(projectId) {
	const projectPath = await getProjectPath(projectId);

	return readDirRecursive(projectPath);
}

const readDirRecursive = async (dir) => {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await readDirRecursive(fullPath)));
		} else {
			const relativePath = path.relative(projectPath, fullPath);
			files.push(normalizePath(relativePath));
		}
	}

	return files;
};

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

async function readProjectFile(projectId, filePath) {
	const projectPath = await getProjectPath(projectId);
	const absolutePath = path.join(projectPath, normalizePath(filePath));
	return fs.readFile(absolutePath, "utf8");
}

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
