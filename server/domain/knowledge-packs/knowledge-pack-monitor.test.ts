import { describe, expect, it, vi } from "vitest";
import { assertTrustedSourceUrl, retrieveTrustedSource } from "./knowledge-pack-monitor.service.js";

describe("knowledge pack trusted source retrieval", () => {
  it("requires HTTPS and an exact allowlisted host", () => {
    expect(assertTrustedSourceUrl("https://regulator.example/rules", ["regulator.example"]).hostname).toBe("regulator.example");
    expect(() => assertTrustedSourceUrl("http://regulator.example/rules", ["regulator.example"])).toThrow(/HTTPS/);
    expect(() => assertTrustedSourceUrl("https://evil.regulator.example/rules", ["regulator.example"])).toThrow(/allowlisted/);
    expect(() => assertTrustedSourceUrl("https://user:secret@regulator.example/rules", ["regulator.example"])).toThrow(/credentials/);
  });

  it("retrieves bounded textual evidence without following redirects", async () => {
    const fetcher = vi.fn(async () => new Response("authoritative text", { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(retrieveTrustedSource("https://regulator.example/rules", ["regulator.example"], fetcher)).resolves.toBe("authoritative text");
    expect(fetcher).toHaveBeenCalledWith("https://regulator.example/rules", expect.objectContaining({ redirect: "manual" }));
  });

  it("rejects redirects and non-text payloads", async () => {
    await expect(retrieveTrustedSource("https://regulator.example/rules", ["regulator.example"], async () => new Response(null, { status: 302 }))).rejects.toThrow(/redirects/);
    await expect(retrieveTrustedSource("https://regulator.example/rules", ["regulator.example"], async () => new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } }))).rejects.toThrow(/content type/);
  });
});
