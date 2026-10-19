// Runs electron-builder with its output outside the repo on Windows. This tree
// lives in OneDrive, which locks the freshly extracted win-unpacked.tmp and makes
// electron-builder's rename fail with EPERM (the same reason Vite's cacheDir
// lives in %LOCALAPPDATA%).
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const output = process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "oddjob-desktop-dist")
    : path.join(__dirname, "..", "dist");

const cli = path.join(__dirname, "..", "node_modules", "electron-builder", "cli.js");
const result = spawnSync(process.execPath, [cli, `--config.directories.output=${output}`, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
});
if (result.status === 0) console.log(`\nInstaller written to ${output}`);
process.exit(result.status ?? 1);
