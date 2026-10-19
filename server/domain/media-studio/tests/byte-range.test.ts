/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { parseByteRange, sendBytes, type ByteResponse } from "../core/byte-range.js";

function fakeResponse() {
    const sent = { status: 0, headers: {} as Record<string, string>, body: undefined as Buffer | undefined };
    const res: ByteResponse = {
        status(code) { sent.status = code; return res; },
        setHeader(name, value) { sent.headers[name] = value; },
        end(chunk) { sent.body = chunk; },
    };
    return { res, sent };
}

describe("byte ranges", () => {
    it("reads the one range a video element asks for", () => {
        expect(parseByteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
        expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
        expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
        expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
        expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    });

    it("sends the whole file when there is no single byte range", () => {
        expect(parseByteRange(undefined, 1000)).toBeNull();
        expect(parseByteRange("items=0-10", 1000)).toBeNull();
        expect(parseByteRange("bytes=0-10,20-30", 1000)).toBeNull();
        expect(parseByteRange("bytes=-", 1000)).toBeNull();
    });

    it("refuses a range outside the file", () => {
        expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
        expect(parseByteRange("bytes=500-100", 1000)).toBe("unsatisfiable");
        expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
        expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
    });

    it("answers 200 with the file, 206 with the part asked for, and 416 for neither", () => {
        const content = Buffer.from("0123456789");

        const whole = fakeResponse();
        sendBytes(whole.res, undefined, "video/mp4", content);
        expect(whole.sent).toMatchObject({ status: 200, headers: { "Accept-Ranges": "bytes", "Content-Type": "video/mp4", "Content-Length": "10", "X-Content-Type-Options": "nosniff" } });
        expect(whole.sent.body?.toString()).toBe("0123456789");

        const part = fakeResponse();
        sendBytes(part.res, "bytes=2-5", "video/mp4", content);
        expect(part.sent).toMatchObject({ status: 206, headers: { "Content-Range": "bytes 2-5/10", "Content-Length": "4" } });
        expect(part.sent.body?.toString()).toBe("2345");

        const none = fakeResponse();
        sendBytes(none.res, "bytes=10-", "video/mp4", content);
        expect(none.sent).toMatchObject({ status: 416, headers: { "Content-Range": "bytes */10" } });
        expect(none.sent.body).toBeUndefined();
    });
});
