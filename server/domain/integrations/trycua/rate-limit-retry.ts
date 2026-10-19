/**
 * The session rate limiter compares Node's clock with the database's now(), so with a
 * little clock skew (the dev database runs in Docker) spacing actions is not enough and it
 * still answers "retry in N ms". Honour that, twice at most, instead of handing the model
 * a failure it can only retry blindly. A live run lost a `type` action this way.
 */
export async function executeRespectingRateLimit<T>(run: () => Promise<T>, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await run();
        } catch (error: any) {
            const wait = /rate limit exceeded; retry in (\d+)ms/i.exec(String(error?.message ?? ""));
            if (!wait || attempt >= 2) throw error;
            await sleep(Math.min(Number(wait[1]) + 50, 5000));
        }
    }
}
