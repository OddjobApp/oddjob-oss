import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
    attachmentCardItems,
    attachmentTurnText,
    isThumbnailable,
    snapWidth,
    thumbnail,
} from "../crew-attachment-preview.service.js";

describe("thumbnails", () => {
    it("shrink a large photo to a small WebP that fits the width, keeping its aspect", async () => {
        const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#4477aa" } }).jpeg().toBuffer();
        const out = await thumbnail("test:1", photo, 320);
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe("webp");
        expect(meta.width).toBe(320);
        expect(meta.height).toBe(240);
        expect(out.length).toBeLessThan(photo.length / 10);
    });

    it("never enlarge a small image and drop its metadata", async () => {
        const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: "#000" } })
            .withMetadata({ exif: { IFD0: { Copyright: "secret-location" } } })
            .png()
            .toBuffer();
        const out = await thumbnail("test:2", small, 640);
        const meta = await sharp(out).metadata();
        expect(meta.width).toBe(100);
        expect(meta.exif).toBeUndefined();
    });

    it("serve a repeat request from the cache", async () => {
        const img = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#fff" } }).png().toBuffer();
        const a = await thumbnail("test:3", img, 160);
        const b = await thumbnail("test:3", Buffer.from("not an image"), 160);
        expect(b).toBe(a);
    });

    it("snap requested widths to a few sizes", () => {
        expect(snapWidth("300")).toBe(320);
        expect(snapWidth(1)).toBe(160);
        expect(snapWidth(5000)).toBe(960);
        expect(snapWidth("x")).toBe(320);
    });

    it("only read raster images", () => {
        expect(isThumbnailable("image/jpeg")).toBe(true);
        expect(isThumbnailable("IMAGE/PNG")).toBe(true);
        expect(isThumbnailable("image/svg+xml")).toBe(false);
        expect(isThumbnailable("application/pdf")).toBe(false);
        expect(isThumbnailable(null)).toBe(false);
    });
});

describe("the upload's chat card", () => {
    const summaries = [
        { id: 9, displayName: "old.pdf", mimeType: "application/pdf", byteSize: 10, parseStatus: "parsed", parseType: "text", preview: "old" },
        { id: 12, displayName: "site.jpg", mimeType: "image/jpeg", byteSize: 62_000, parseStatus: "parsed", parseType: "image", preview: "A building" },
        { id: 11, displayName: "rfp.pdf", mimeType: "application/pdf", byteSize: 300_000, parseStatus: "parsed", parseType: "text", preview: "x".repeat(400) },
    ];

    it("lists only the files just uploaded, in upload order, as images or documents", () => {
        const items = attachmentCardItems(summaries, [11, 12]);
        expect(items.map((i) => [i.id, i.kind])).toEqual([[11, "document"], [12, "image"]]);
        expect(items[0].preview).toHaveLength(280);
    });

    it("names the files for the agents", () => {
        expect(attachmentTurnText(attachmentCardItems(summaries, [12]))).toBe("📎 Shared 1 file: site.jpg");
        expect(attachmentTurnText(attachmentCardItems(summaries, [11, 12]))).toBe("📎 Shared 2 files: rfp.pdf, site.jpg");
    });
});
