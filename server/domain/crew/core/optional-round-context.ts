/** Optional read-only context must not hold the room's execution lock indefinitely. */
export async function optionalRoundContext<T>(read: Promise<T>, fallback: T, onUnavailable: () => void, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read.catch(() => { onUnavailable(); return fallback; }),
      new Promise<T>(resolve => { timer = setTimeout(() => { onUnavailable(); resolve(fallback); }, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
