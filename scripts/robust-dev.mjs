import { spawn, execSync } from 'child_process';
import chokidar from 'chokidar';
import os from 'os';

const PORT = process.env.PORT || 5000;
const isWindows = os.platform() === 'win32';

let child = null;
let restarting = false;
let debounceTimer = null;

/**
 * Kill the child's ENTIRE process tree. On Windows, killing the npm/shell wrapper
 * does NOT terminate the grandchild `node` server (no process-group semantics), so
 * we must use `taskkill /T`. Without this the server orphans and keeps holding the
 * port, causing EADDRINUSE on the next restart (the classic zombie-on-:5000 bug).
 */
function killTree(pid) {
  if (!pid) return;
  try {
    if (isWindows) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL'); // negative pid => kill the process group (spawned detached)
  } catch {
    /* already dead */
  }
}

/** Belt-and-suspenders: free the dev port in case the tree kill missed the listener. */
function freePort() {
  try {
    // --keep-pid exempts THIS watcher from kill-dev's sweep. kill-dev now matches
    // `robust-dev.mjs` (to reap duplicate watchers that dodged the path filter and
    // fought over the port), so without this it would kill the very process that
    // just invoked it. Its server children carry the path marker and are still swept.
    execSync(`node scripts/kill-dev.mjs ${PORT} --keep-pid=${process.pid}`, { stdio: 'inherit' });
  } catch {
    /* kill-dev is best-effort */
  }
}

async function start() {
  if (restarting) return; // guard against overlapping restarts from bursty saves
  restarting = true;
  try {
    if (child) {
      console.log('--- Restarting Robust Dev Build ---');
      killTree(child.pid);
      child = null;
      await new Promise((r) => setTimeout(r, 500)); // let the OS release the port
    } else {
      console.log('--- Starting Robust Dev Build ---');
    }
    freePort();

    // dev:server = tsx server/index.ts — runs TypeScript directly. tsx has no
    // hot-reload, so robust-dev supplies the watch+restart. We deliberately avoid
    // the compiled dev:build path: several workspace packages declare
    // `main: src/index.ts`, which plain `node dist/...` can't resolve — only
    // tsx's resolver loads their .ts source.
    child = spawn('npm', ['run', 'dev:server'], {
      stdio: 'inherit',
      shell: true,
      ...(isWindows ? {} : { detached: true }), // own process group on posix so killTree works
    });

    child.on('error', (err) => console.error('Failed to start child process:', err));
    child.on('exit', (code, signal) => {
      if (code !== null && code !== 0) console.log(`--- Dev build exited with code ${code} ---`);
      if (signal) console.log(`--- Dev build terminated by ${signal} ---`);
    });
  } finally {
    restarting = false;
  }
}

function scheduleRestart(path) {
  console.log(`File ${path} changed, rebuilding...`);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => start(), 300); // debounce bursty saves
}

const watcher = chokidar.watch(['server', 'shared'], {
  ignored: /(^|[/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true,
});

watcher.on('change', scheduleRestart);
watcher.on('add', scheduleRestart);

// Clean shutdown: tear down the child tree when robust-dev itself is terminated,
// so Ctrl+C never leaves an orphaned server holding the port.
function shutdown() {
  clearTimeout(debounceTimer);
  killTree(child?.pid);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
