/**
 * The constructor behind a CommonJS class export, under either module resolution.
 *
 * This repository type-checks the same server files with two configs:
 * tsconfig.json uses moduleResolution "bundler", where a CJS default import is
 * typed as the class itself; tsconfig.server.json — which compiles the MCP
 * servers via `npm run dev:compile` — uses "Node16", where the default is the
 * whole `module.exports` object and the class sits under `.default`. A cast
 * written for one config breaks the other, so express it as a conditional and
 * let each resolution pick its own branch. The runtime value is the
 * constructor either way; this is types only.
 */
export type CjsDefault<T> = T extends { default: infer D } ? D : T;
