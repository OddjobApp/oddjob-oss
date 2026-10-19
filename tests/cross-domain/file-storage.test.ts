/**
 * File Storage Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileStorageSuccess } from "@domain/knowledge/core/file-storage.js";

// Mock fs and fs/promises
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: vi.fn(),
            mkdirSync: vi.fn(),
        },
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});

vi.mock("fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs/promises')>();
    return {
        ...actual,
        default: {
            ...actual,
            mkdir: vi.fn(),
            readFile: vi.fn(),
            writeFile: vi.fn(),
            stat: vi.fn(),
            access: vi.fn(),
            unlink: vi.fn(),
            appendFile: vi.fn(),
            rename: vi.fn(),
        },
        mkdir: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        stat: vi.fn(),
        access: vi.fn(),
        unlink: vi.fn(),
        appendFile: vi.fn(),
        rename: vi.fn(),
    };
});

// Mock glob
vi.mock("glob", () => ({
    glob: vi.fn().mockResolvedValue(["file1.txt", "file2.txt"]),
}));

describe("FileStorageService", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe("resolvePath", () => {
        it("should resolve relative path within sandbox", () => {
            const resolved = fileStorageSuccess.resolvePath(1, "test.txt");
            expect(resolved).toContain(path.join("1", "test.txt"));
        });

        it("should handle null orgId as global", () => {
            const resolved = fileStorageSuccess.resolvePath(null, "global.txt");
            expect(resolved).toContain(path.join("global", "global.txt"));
        });

        it("should prevent path traversal", () => {
            // resolvePath implementation has a regex to stop ..
            const resolved = fileStorageSuccess.resolvePath(1, "../../../etc/passwd");
            // The leading ../ segments are stripped, so the path stays inside org 1's sandbox.
            // (This used to assert not.toContain("etc/passwd"), which contradicts the line
            // below and only held on Windows, where the separator is a backslash.)
            expect(resolved.startsWith(fileStorageSuccess.resolvePath(1) + path.sep)).toBe(true);
            expect(resolved).toContain(path.join("1", "etc", "passwd"));
        });
    });

    describe("File Operations", () => {
        it("should read a file", async () => {
            (fs.existsSync as Mock).mockReturnValue(true);
            (fsPromises.readFile as Mock).mockResolvedValue(Buffer.from("hello world"));

            const result = await fileStorageSuccess.readFile(1, "test.txt");
            expect(result).toBe("hello world");
        });

        it("should throw NotFoundError if file does not exist", async () => {
            (fs.existsSync as Mock).mockReturnValue(false);
            await expect(fileStorageSuccess.readFile(1, "missing.txt")).rejects.toThrow("File not found");
        });

        it("should write a file in overwrite mode", async () => {
            (fsPromises.access as Mock).mockRejectedValue(new Error("File not found"));

            await fileStorageSuccess.writeFile(1, "new.txt", "data");
            expect(fsPromises.writeFile).toHaveBeenCalled();
        });

        it("should handle append mode", async () => {
            (fsPromises.access as Mock).mockResolvedValue(true);

            await fileStorageSuccess.writeFile(1, "existing.txt", "more data", "append");
            expect(fsPromises.appendFile).toHaveBeenCalled();
        });

        it("should delete a file", async () => {
            (fs.existsSync as Mock).mockReturnValue(true);
            await fileStorageSuccess.deleteFile(1, "delete-me.txt");
            expect(fsPromises.unlink).toHaveBeenCalled();
        });
    });

    describe("Folder Operations", () => {
        it("should ensure org root exists", async () => {
            await fileStorageSuccess.ensureOrgRoot(1);
            expect(fsPromises.mkdir).toHaveBeenCalled();
        });

        it("should create a folder", async () => {
            await fileStorageSuccess.createFolder(1, "new-folder");
            expect(fsPromises.mkdir).toHaveBeenCalled();
        });
    });
});
