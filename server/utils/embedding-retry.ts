function isSpendingCapError(msg: string): boolean {
    const m = msg.toLowerCase();
    return m.includes("spending cap") || m.includes("monthly budget") || m.includes("project spend");
}

export async function withEmbeddingRetry<T>(fn: () => Promise<T>, label: string, context = 'Embedding'): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const msg: string = err.message || String(err);
            // Spending cap errors are permanent — skip remaining retries immediately.
            if (isSpendingCapError(msg)) {
                console.warn(`[${context}] ${label} hit spending cap. Aborting retries immediately.`);
                throw err;
            }
            if (attempt === maxAttempts - 1) {
                console.error(`[${context}] ${label} failed after ${maxAttempts} attempts:`, msg);
                throw new Error(`Embedding failed: ${msg}`);
            }
            const delayMs = 1000 * Math.pow(2, attempt);
            console.warn(`[${context}] ${label} attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, msg);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw new Error("unreachable");
}
