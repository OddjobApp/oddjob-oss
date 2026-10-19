#!/usr/bin/env node
/**
 * Start the Python sidecar (backend/main.py) from its virtual environment.
 *
 * The npm script used to be `cd backend && .venv\Scripts\python -u main.py`,
 * which only resolves on Windows, so `npm run dev` failed outright on macOS and
 * Linux. A venv puts its interpreter in Scripts\python.exe on Windows and
 * bin/python everywhere else; this picks whichever exists.
 *
 * Without a venv it says how to make one rather than falling back to a system
 * Python, whose packages are not the ones in backend/requirements.txt.
 *
 * Run from `npm run backend`, and as the sidecar in `npm run dev`.
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "backend");

const interpreter = [
    path.join(backendDir, ".venv", "Scripts", "python.exe"),
    path.join(backendDir, ".venv", "bin", "python"),
].find((candidate) => existsSync(candidate));

if (!interpreter) {
    const pip = process.platform === "win32" ? ".venv\\Scripts\\pip" : ".venv/bin/pip";
    console.error(
        "backend/.venv not found, so the Python sidecar cannot start.\n" +
            "Create it once:\n" +
            "  cd backend\n" +
            "  python3 -m venv .venv\n" +
            `  ${pip} install -r requirements.txt\n` +
            "Or run without the sidecar: npm run dev:no-sidecar",
    );
    process.exit(1);
}

const child = spawn(interpreter, ["-u", "main.py"], { cwd: backendDir, stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
