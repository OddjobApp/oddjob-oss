/**
 * Streaming Token Buffer
 *
 * Solves the "Streaming Token Fracture" defect across SSE / WebSocket streams.
 * When cloud models stream tokens, surrogates like `<<ODDJOB_MASK:8f2a1c9e>>` can arrive
 * split across TCP packets. This sliding window ring buffer holds back partial token
 * boundary fragments (up to 64 bytes) until complete, then emits or rehydrates them cleanly.
 */

export type TokenTransformFn = (tokenSnippet: string) => Promise<string> | string;

export class StreamingTokenBuffer {
    private buffer: string = "";
    private readonly maxHoldBytes: number;

    constructor(maxHoldBytes: number = 64) {
        this.maxHoldBytes = maxHoldBytes;
    }

    /**
     * Ingests a new incoming stream chunk and returns any ready, complete prose.
     * If a partial token boundary is detected at the tail, it is retained until closed.
     */
    async feed(chunk: string, transformFn?: TokenTransformFn): Promise<string> {
        this.buffer += chunk;

        // Check if there is an unclosed token delimiter near the tail:
        // Prioritize multi-character opening sequences so we don't slice between them
        let lastOpen = -1;
        const dAngle = this.buffer.lastIndexOf("<<");
        const sAngle = this.buffer.lastIndexOf("<");
        const dSquare = this.buffer.lastIndexOf("[[");

        if (dAngle !== -1) {
            lastOpen = dAngle;
        } else if (sAngle !== -1) {
            lastOpen = sAngle;
        }

        if (dSquare !== -1 && (lastOpen === -1 || dSquare > lastOpen)) {
            lastOpen = dSquare;
        }

        // If no open delimiter, emit the entire buffer
        if (lastOpen === -1) {
            const out = this.buffer;
            this.buffer = "";
            return transformFn ? transformFn(out) : out;
        }

        const lastClose = Math.max(
            this.buffer.lastIndexOf(">>"),
            this.buffer.lastIndexOf("]]")
        );

        // If the open delimiter is already closed
        if (lastClose > lastOpen) {
            // Check if there is ANOTHER unclosed delimiter after the close
            const subOpen = this.buffer.indexOf("<", lastClose);
            if (subOpen === -1) {
                const out = this.buffer;
                this.buffer = "";
                return transformFn ? transformFn(out) : out;
            }
        }

        // Potential open token at the tail:
        const tailLength = this.buffer.length - lastOpen;

        // If the unclosed fragment exceeds maxHoldBytes, it's not a real token — release it
        if (tailLength > this.maxHoldBytes) {
            const out = this.buffer;
            this.buffer = "";
            return transformFn ? transformFn(out) : out;
        }

        // Hold back from lastOpen onwards
        const ready = this.buffer.slice(0, lastOpen);
        this.buffer = this.buffer.slice(lastOpen);

        return transformFn ? transformFn(ready) : ready;
    }

    /**
     * Flush any remaining buffered characters at the end of the stream.
     */
    async flush(transformFn?: TokenTransformFn): Promise<string> {
        const remaining = this.buffer;
        this.buffer = "";
        return transformFn ? transformFn(remaining) : remaining;
    }

    /**
     * Current size of un-emitted buffered characters.
     */
    get pendingBytes(): number {
        return this.buffer.length;
    }
}
