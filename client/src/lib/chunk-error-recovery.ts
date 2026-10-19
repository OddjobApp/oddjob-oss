/** React.lazy caches a rejected import; resetting its error boundary cannot retry it. */
export function recoverChunkLoadError(error: unknown, reload: () => void = () => window.location.reload()): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(message)) return false;
  reload();
  return true;
}
