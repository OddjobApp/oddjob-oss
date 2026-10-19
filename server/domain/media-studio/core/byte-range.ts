/**
 * HTTP byte ranges for served media.
 *
 * A <video> element seeks by asking for byte ranges, and will not let anyone scrub a
 * file that is served whole without Accept-Ranges.
 */

export interface ByteRange {
    start: number;
    end: number;
}

/**
 * The single range a Range header asks for. Null means send the whole file: no
 * header, another unit, or several ranges. "unsatisfiable" means answer 416.
 */
export function parseByteRange(header: string | undefined | null, size: number): ByteRange | "unsatisfiable" | null {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;
    const [, first, last] = match;
    if (first === "" && last === "") return null;
    if (size <= 0) return "unsatisfiable";

    if (first === "") {
        // A suffix: the last N bytes.
        const suffix = Number(last);
        if (suffix === 0) return "unsatisfiable";
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(first);
    const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
    if (start >= size || start > end) return "unsatisfiable";
    return { start, end };
}

/** The parts of an Express response this writes to. */
export interface ByteResponse {
    status(code: number): ByteResponse;
    setHeader(name: string, value: string): unknown;
    end(chunk?: Buffer): unknown;
}

/** Answers with the file, or the part of it the Range header asks for. */
export function sendBytes(res: ByteResponse, rangeHeader: string | undefined, mimeType: string, content: Buffer): void {
    const size = content.length;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=3600");

    const range = parseByteRange(rangeHeader, size);
    if (range === "unsatisfiable") {
        res.setHeader("Content-Range", `bytes */${size}`);
        res.status(416).end();
        return;
    }
    if (!range) {
        res.setHeader("Content-Length", String(size));
        res.status(200).end(content);
        return;
    }
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    res.status(206).end(content.subarray(range.start, range.end + 1));
}
