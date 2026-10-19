/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { shouldCompress } from "../compression-filter";

function call(contentType: string | undefined, accept?: string) {
    const req = { headers: { accept, "accept-encoding": "gzip, deflate, br" } } as unknown as Request;
    const res = { getHeader: (name: string) => (name.toLowerCase() === "content-type" ? contentType : undefined) } as unknown as Response;
    return shouldCompress(req, res);
}

describe("shouldCompress", () => {
    it("never encodes an event stream, whatever the browser accepts", () => {
        expect(call("text/event-stream")).toBe(false);
        expect(call("text/event-stream; charset=utf-8")).toBe(false);
    });

    it("never encodes a request that asked for an event stream", () => {
        expect(call(undefined, "text/event-stream")).toBe(false);
    });

    it("still encodes JSON and ordinary compressible bodies", () => {
        expect(call("application/json; charset=utf-8")).toBe(true);
        expect(call("text/html")).toBe(true);
    });
});
