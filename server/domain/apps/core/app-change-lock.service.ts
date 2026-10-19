/**
 * One change at a time, per app.
 *
 * Applying a change rewrites files in an app's workspace and rebuilds its
 * container. Two of those running at once against the same workspace interleave
 * writes and race the rebuild, so the second request has to be refused rather
 * than queued behind the first — the author asked for a change to code they
 * were looking at, and by the time a queued edit ran the file it targeted may
 * no longer exist.
 *
 * SET NX, the same primitive the forge concurrency guard uses, so the claim is
 * atomic and holds across processes rather than only within one. A TTL bounds
 * it: a process that dies mid-change must not leave the app permanently
 * unchangeable.
 */

/** Longer than the builder's own rebuild timeout, so a slow change is not cut loose. */
const CHANGE_LOCK_TTL_SECONDS = 600;

const keyFor = (appId: number) => `app:change:active:${appId}`;

export interface ChangeLock {
    /** Frees the app for the next change. Safe to call more than once. */
    release: () => Promise<void>;
}

/**
 * Claim the right to change an app, or null when another change holds it.
 *
 * Returning null is a normal outcome the caller must report, not an error to
 * swallow: telling the author their change is queued when it was dropped is
 * the failure this exists to prevent.
 */
export async function claimAppChange(appId: number): Promise<ChangeLock | null> {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
    const key = keyFor(appId);

    const claimed = await redis.set(key, String(Date.now()), "EX", CHANGE_LOCK_TTL_SECONDS, "NX");
    if (!claimed) return null;

    let released = false;
    return {
        release: async () => {
            if (released) return;
            released = true;
            // A failed release is not worth propagating — the TTL frees the app
            // either way, and the change it guarded has already finished.
            await redis.del(key).catch(() => {});
        },
    };
}

/** Whether a change is currently being applied to an app. */
export async function isAppChanging(appId: number): Promise<boolean> {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
    return Boolean(await redis.get(keyFor(appId)));
}
