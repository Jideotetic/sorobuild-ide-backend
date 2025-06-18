import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { promisify } from "util";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 4000;
const BASE_STORAGE_DIR = path.join(__dirname, "projects");
const TEMP_DIR = path.join(os.tmpdir(), "rust-temp-projects");
const execAsync = promisify(exec);
const app = express();

app.use(helmet());
app.use(
	cors({
		origin: [
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"https://rust-ide-five.vercel.app/",
		],
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
	// const projectPath = await getProjectPath(projectId);
	// const absolutePath = path.join(projectPath, filePath);
	await fs.mkdir(path.dirname(absolutePath), { recursive: true });
	await fs.writeFile(absolutePath, content);
}

async function readProjectFile(projectId, filePath) {
	const projectPath = await getProjectPath(projectId);
	const absolutePath = path.join(projectPath, filePath);
	return fs.readFile(absolutePath, "utf8");
}

async function listProjectFiles(projectId) {
	const projectPath = await getProjectPath(projectId);

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

	return readDirRecursive(projectPath);
}

async function createTempProject(projectId, action) {
	const tempProjectDir = path.join(TEMP_DIR, `${projectId}-${action}`);
	await fs.mkdir(tempProjectDir, { recursive: true });
	const projectPath = await getProjectPath(projectId);
	await execAsync(`cp -r ${projectPath}/. ${tempProjectDir}`);
	return tempProjectDir;
}

async function cleanupTempProject(projectId, action) {
	const tempProjectDir = path.join(TEMP_DIR, `${projectId}-${action}`);
	try {
		await fs.rm(tempProjectDir, { recursive: true, force: true });
	} catch (err) {
		console.error("Cleanup failed:", err);
	}
}

// Rust Operations
async function formatRustCode(code) {
	try {
		const { stdout } = await execAsync("rustfmt --emit stdout", {
			input: code,
			timeout: 5000,
		});
		return stdout;
	} catch (error) {
		console.error("Formatting error:", error);
		return code;
	}
}

async function runRustTests(projectId) {
	const projectDir = await createTempProject(projectId, "test");

	try {
		// Ensure Cargo.toml exists
		try {
			await fs.access(path.join(projectDir, "Cargo.toml"));
		} catch {
			await execAsync(`cargo init --bin ${projectDir}`);
		}

		const { stdout, stderr } = await execAsync("cargo test", {
			cwd: projectDir,
			timeout: 30000,
		});

		return {
			passed: !stderr,
			output: stdout + stderr,
		};
	} catch (error) {
		return {
			passed: false,
			output: error.stdout + error.stderr,
		};
	} finally {
		await cleanupTempProject(projectId, "test");
	}
}

async function compileSorobanContract(projectId) {
	const projectDir = await createTempProject(projectId, "compile");

	try {
		// Initialize as Soroban contract if needed
		try {
			await fs.access(path.join(projectDir, "Cargo.toml"));
		} catch {
			await execAsync(
				`cargo generate --git https://github.com/stellar/soroban-examples --name contract`,
				{ cwd: path.dirname(projectDir) }
			);
		}

		const { stdout, stderr } = await execAsync("soroban contract build", {
			cwd: projectDir,
			timeout: 60000,
		});

		// Find the WASM file
		const wasmPath = path.join(
			projectDir,
			"target",
			"wasm32-unknown-unknown",
			"release",
			"contract.wasm"
		);

		const wasmBuffer = await fs.readFile(wasmPath);

		return {
			success: true,
			wasm: wasmBuffer.toString("base64"),
			output: stdout + stderr,
		};
	} catch (error) {
		return {
			success: false,
			error: error.message,
			output: error.stdout + error.stderr,
		};
	} finally {
		await cleanupTempProject(projectId, "compile");
	}
}

// API Endpoints
app.post("/api/projects", async (req, res) => {
	try {
		const projectId = uuidv4();

		const files = req.body.files;

		console.log(files);

		for (const [filePath, content] of Object.entries(files)) {
			await saveProjectFile(projectId, filePath, content);
		}

		res.json({ projectId });
	} catch (err) {
		console.error("Project creation failed:", err);
		res.status(500).json({ error: "Project creation failed" });
	}
});

app.get("/api/projects/:projectId/files", async (req, res) => {
	try {
		const files = await listProjectFiles(req.params.projectId);
		const contents = {};

		for (const file of files) {
			contents[file] = await fs.readFile(
				path.join(await getProjectPath(req.params.projectId), file),
				"utf8"
			);
		}

		res.json(contents);
	} catch (err) {
		console.error("Failed to get files:", err);
		res.status(500).json({ error: "Failed to get project files" });
	}
});

app.put("/api/projects/:projectId/files", async (req, res) => {
	try {
		const { path: filePath, content } = req.body;
		await saveProjectFile(req.params.projectId, filePath, content);
		res.json({ success: true });
	} catch (err) {
		console.error("Failed to update file:", err);
		res.status(500).json({ error: "Failed to update file" });
	}
});

app.post("/api/projects/:projectId/format", async (req, res) => {
	try {
		const { path: filePath } = req.body;
		const content = await readProjectFile(req.params.projectId, filePath);
		const formatted = await formatRustCode(content);

		if (formatted !== content) {
			await saveProjectFile(req.params.projectId, filePath, formatted);
		}

		res.json({ formatted });
	} catch (err) {
		console.error("Formatting failed:", err);
		res.status(500).json({ error: "Formatting failed" });
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

app.post("/api/projects/:projectId/compile", async (req, res) => {
	try {
		const compileResults = await compileSorobanContract(req.params.projectId);
		res.json(compileResults);
	} catch (err) {
		console.error("Compilation failed:", err);
		res.status(500).json({ error: "Compilation failed" });
	}
});

// Health check
app.get("/health", (req, res) => {
	res.status(200).send("OK");
});

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
