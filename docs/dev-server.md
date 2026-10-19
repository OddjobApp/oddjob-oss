# Local dev server & restart tooling

The Oddjob server serves the client on **port 5000** (Express with Vite embedded
as middleware). This doc covers how the dev server (re)starts and the tooling that
keeps port 5000 clean — useful when you hit `EADDRINUSE`, duplicate Slack replies,
or `Failed to fetch dynamically imported module` errors.

## Two ways to run the stack

| Command | What it runs | Hot reload |
| --- | --- | --- |
| `npm run dev` | `concurrently` → server + worker + sidecar (`dev:server`, `start:worker`, `backend`) | Server code: no auto-restart (tsx has no watch). |
| `npm run dev:robust` | `scripts/robust-dev.mjs` → watches `server/` + `shared/`, restarts `dev:server` on change | Yes — chokidar restarts the server on every save. |

`dev:server` is `tsx server/index.ts` — it runs TypeScript directly but has **no
hot reload**, so `dev:robust` supplies the watch-and-restart loop. The worker fleet
(`start:worker` → `tsx server/worker-entrypoint.ts`) is a **separate, long-lived
process** and is intentionally *not* managed by robust-dev.

## `scripts/kill-dev.mjs` — freeing the port

Windows does not propagate termination to grandchild processes, so `Ctrl+C` on
`npm run dev` (npm → concurrently → npm → tsx → node) routinely orphans the
tsx/node server, which keeps **LISTENING on :5000**. The next start then dies with
`EADDRINUSE` and you end up serving a stale zombie. `kill-dev` fixes this and is
wired as the `predev` hook (runs automatically before `npm run dev`).

It does two things, both surgical — it **never blanket-kills node**, so your editor,
Claude Code, Playwright, and MCP servers are safe:

1. **Port-based kill.** Finds whoever is LISTENING on the target port(s) and kills
   that process tree. Defaults to `5000`; pass more: `node scripts/kill-dev.mjs 5000 10001`.
2. **Dev-runner sweep.** Kills the project's own lingering dev runners that the
   port kill misses — the robust-dev watcher and the `concurrently` / `dev:server` /
   `tsx index.ts` server processes. Two things are **always excluded**:
   - the **worker fleet** (`worker-entrypoint` / `start:worker`), and
   - any pid passed via **`--keep-pid=<pid>`**.

### Why `--keep-pid` exists

`robust-dev` calls `kill-dev` (via `freePort()`) on **every** restart, and the sweep
matches `robust-dev.mjs` by script name (its cmdline is a relative path, so a
project-dir filter can't catch it — this is what let duplicate watchers survive and
fight over :5000). Matching the script name means a running watcher would kill
*itself*, so robust-dev passes `--keep-pid=<its own pid>` to stay exempt. A **second**
watcher, however, is not exempt — so starting a new `dev:robust` cleanly **reaps any
stale duplicate watcher**, leaving exactly one.

```bash
node scripts/kill-dev.mjs 5000                  # free :5000 + sweep all dev runners
node scripts/kill-dev.mjs 5000 --keep-pid=1234  # ...but never touch pid 1234
```

> **A reaped/killed robust-dev watcher exits 127.** A background `npm run dev:robust`
> reporting *"failed exit 127"* is usually a successful reap or a `kill-dev` sweep,
> **not a crash**.

## Troubleshooting checklist

Diagnose in this order — **don't** start by clearing the Vite cache:

1. `dev.log` for `EADDRINUSE` / `SERVER EXITED` / exit code `3221225477` (0xC0000005).
2. Find the listener: `Get-NetTCPConnection -LocalPort 5000 -State Listen` → `OwningProcess`.
3. Free it: `node scripts/kill-dev.mjs` (or `taskkill /PID <pid> /T /F` for a one-off).
4. Only if a `Cannot read properties of null (reading 'useEffect')` error persists:
   stop the server → `rm -rf node_modules/.vite` → restart → fresh tab.

Duplicate Slack replies mean multiple worker processes are alive (each holds a Slack
Socket Mode connection); `kill-dev` does **not** sweep workers, so stop them with
`npm run` teardown or by killing the `start:worker` tree directly.

## Tests

The pure decision logic in `kill-dev.mjs` — argument parsing (`parseKillDevArgs`) and
the sweep predicate (`isDevSweepTarget`) — is unit-tested in
[`tests/kill-dev.test.ts`](../tests/kill-dev.test.ts) (`npx vitest run tests/kill-dev.test.ts`).
The OS-command execution only runs when the script is invoked directly, so importing
it in a test is side-effect free.
