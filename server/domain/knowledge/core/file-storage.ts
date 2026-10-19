import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import AdmZip from 'adm-zip';
import { AppError, ErrorCode, ValidationError, NotFoundError, InternalServerError } from "@server/utils/errors.js";
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('FileStorage');

// Define root storage path
// Ensure this path is available and writable
const STORAGE_ROOT = process.env.ODDJOB_STORAGE_ROOT || path.join(process.cwd(), 'storage', 'org_data');

export interface FileInfo {
    name: string;
    path: string; // Relative path
    size: number;
    createdAt: Date;
    isDirectory: boolean;
}

export class FileStorageService {
    constructor() {
        this.initializeRoot();
    }

    private initializeRoot() {
        if (!fs.existsSync(STORAGE_ROOT)) {
            try {
                fs.mkdirSync(STORAGE_ROOT, { recursive: true });
                logger.info(`Initialized storage root at ${STORAGE_ROOT}`);
            } catch (err: any) {
                logger.error(`Failed to initialize storage root: ${err.message}`);
            }
        }
    }

    /**
     * Resolves a relative path to a safe absolute path within the org's sandbox.
     * Throws error if path attempts to traverse outside sandbox.
     */
    public resolvePath(orgId: number | string | null, relativePath: string = ''): string {
        const orgFolder = orgId === null ? 'global' : String(orgId);
        const sandboxRoot = path.join(STORAGE_ROOT, orgFolder);

        // Normalize relative path
        const safeRelative = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
        const resolvedPath = path.join(sandboxRoot, safeRelative);

        // Security Check: Ensure resolved path starts with sandbox root
        if (!resolvedPath.startsWith(sandboxRoot)) {
            throw new ValidationError('Access denied: Path traversal detected.', { path: relativePath });
        }

        return resolvedPath;
    }

    /**
     * Ensures the organization's root directory exists.
     */
    async ensureOrgRoot(orgId: number | string | null): Promise<void> {
        const root = this.resolvePath(orgId);
        try {
            await fsPromises.mkdir(root, { recursive: true });
            // specific subfolders
            await fsPromises.mkdir(path.join(root, 'incoming'), { recursive: true });
            await fsPromises.mkdir(path.join(root, 'processed'), { recursive: true });
            await fsPromises.mkdir(path.join(root, 'error'), { recursive: true });
            await fsPromises.mkdir(path.join(root, 'temp'), { recursive: true });
        } catch (error: any) {
            logger.error(`Failed to ensure org root for ${orgId}`, { error });
            throw new InternalServerError(`Storage initialization failed: ${error.message}`);
        }
    }

    /**
     * Lists files matching a pattern in the given folder.
     */
    async listFiles(orgId: number | string | null, folderPath: string, pattern: string = '**/*', recursive: boolean = false): Promise<FileInfo[]> {
        const root = this.resolvePath(orgId, folderPath);

        if (!fs.existsSync(root)) {
            return []; // Folder doesn't exist yet, return empty list
        }

        try {
            // Use glob to find files
            const files = await glob(pattern, {
                cwd: root,
                nodir: false,
                dot: false,
                absolute: false,
                maxDepth: recursive ? 10 : 1
            });

            const results: FileInfo[] = [];

            for (const file of files) {
                const absPath = path.join(root, file);
                const stats = await fsPromises.stat(absPath);

                results.push({
                    name: path.basename(file),
                    path: file, // Relative to folderPath
                    size: stats.size,
                    createdAt: stats.birthtime,
                    isDirectory: stats.isDirectory()
                });
            }

            return results;

        } catch (error: any) {
            logger.error('List files failed', { error, orgId, folderPath });
            throw new InternalServerError(`Failed to list files: ${error.message}`);
        }
    }

    /**
     * Reads file content.
     */
    async readFile(orgId: number | string | null, filePath: string, encoding: 'utf8' | 'base64' = 'utf8'): Promise<string> {
        const buffer = await this.readBuffer(orgId, filePath);
        return buffer.toString(encoding);
    }

    /**
     * Reads file content as a Buffer.
     */
    async readBuffer(orgId: number | string | null, filePath: string): Promise<Buffer> {
        const absPath = this.resolvePath(orgId, filePath);
        try {
            if (!fs.existsSync(absPath)) {
                throw new NotFoundError('File not found', ErrorCode.NOT_FOUND, { path: filePath });
            }
            return await fsPromises.readFile(absPath);
        } catch (error: any) {
            if (error instanceof AppError) throw error;
            throw new InternalServerError(`Failed to read file: ${error.message}`);
        }
    }

    /**
     * Saves a file from a buffer or string.
     */
    async saveFile(orgId: number | string | null, filePath: string, content: Buffer | string): Promise<void> {
        const absPath = this.resolvePath(orgId, filePath);

        try {
            // Ensure directory exists
            await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
            await fsPromises.writeFile(absPath, content);
        } catch (error: any) {
            throw new InternalServerError(`Failed to save file: ${error.message}`);
        }
    }

    /**
     * Saves a file with conflict resolution strategies.
     */
    async saveFileWithMode(
        orgId: number | string | null,
        filePath: string,
        content: Buffer | string,
        mode: 'overwrite' | 'append' | 'fail' | 'rename' = 'overwrite'
    ): Promise<string> {
        return this.writeFile(orgId, filePath, content, mode);
    }

    async writeFile(
        orgId: number | string | null,
        filePath: string,
        content: Buffer | string,
        mode: 'overwrite' | 'append' | 'fail' | 'rename' = 'overwrite'
    ): Promise<string> {
        let absPath = this.resolvePath(orgId, filePath);

        try {
            await fsPromises.mkdir(path.dirname(absPath), { recursive: true });

            // Check existence
            let exists = false;
            try {
                await fsPromises.access(absPath);
                exists = true;
            } catch {
                exists = false;
            }

            if (exists) {
                if (mode === 'fail') {
                    throw new AppError(`File ${path.basename(filePath)} already exists`, 409, ErrorCode.CONFLICT);
                }
                if (mode === 'append') {
                    await fsPromises.appendFile(absPath, content);
                    return absPath;
                }
                if (mode === 'rename') {
                    // Find a new name: file.txt -> file(1).txt
                    const ext = path.extname(absPath);
                    const base = path.basename(absPath, ext);
                    const dir = path.dirname(absPath);
                    let counter = 1;

                    let newPath = path.join(dir, `${base}(${counter})${ext}`);
                    while (true) {
                        try {
                            await fsPromises.access(newPath);
                            counter++;
                            newPath = path.join(dir, `${base}(${counter})${ext}`);
                        } catch {
                            // Not found, so use this
                            absPath = newPath;
                            break;
                        }
                    }
                }
                // If 'overwrite', proceed to writeFile below
            }

            await fsPromises.writeFile(absPath, content);
            return absPath;
        } catch (error: any) {
            if (error instanceof AppError) throw error;
            throw new InternalServerError(`Failed to save file: ${error.message}`);
        }
    }

    /**
     * Creates a folder.
     */
    async createFolder(orgId: number | string | null, folderPath: string): Promise<void> {
        const absPath = this.resolvePath(orgId, folderPath);

        try {
            await fsPromises.mkdir(absPath, { recursive: true });
        } catch (error: any) {
            throw new InternalServerError(`Failed to create folder: ${error.message}`);
        }
    }

    /**
     * Moves a file.
     */
    async moveFile(orgId: number | string | null, sourcePath: string, destPath: string): Promise<void> {
        const absSource = this.resolvePath(orgId, sourcePath);
        const absDest = this.resolvePath(orgId, destPath);

        try {
            if (!fs.existsSync(absSource)) {
                throw new NotFoundError('Source file not found');
            }

            // Ensure directory exists
            await fsPromises.mkdir(path.dirname(absDest), { recursive: true });

            await fsPromises.rename(absSource, absDest);
        } catch (error: any) {
            throw new InternalServerError(`Failed to move file: ${error.message}`);
        }
    }

    /**
     * Deletes a file.
     */
    async deleteFile(orgId: number | string | null, filePath: string): Promise<void> {
        const absPath = this.resolvePath(orgId, filePath);

        try {
            if (fs.existsSync(absPath)) {
                await fsPromises.unlink(absPath);
            }
        } catch (error: any) {
            throw new InternalServerError(`Failed to delete file: ${error.message}`);
        }
    }

    /**
     * Extracts an archive (zip/tar) to a target directory.
     * Returns list of extracted filenames.
     */
    async extractArchive(orgId: number | string | null, filePath: string, destFolder: string): Promise<string[]> {
        const absSource = this.resolvePath(orgId, filePath);
        const absDest = this.resolvePath(orgId, destFolder);

        if (!fs.existsSync(absSource)) {
            throw new NotFoundError('Archive file not found');
        }

        // Only supporting ZIP for first pass via adm-zip
        if (!absSource.toLowerCase().endsWith('.zip')) {
            throw new ValidationError('Only .zip extraction is currently supported');
        }

        try {
            await fsPromises.mkdir(absDest, { recursive: true });

            const zip = new AdmZip(absSource);
            zip.extractAllTo(absDest, true); // overwrite = true

            const entries = zip.getEntries();
            return entries
                .filter(entry => !entry.isDirectory)
                .map(entry => entry.entryName);

        } catch (error: any) {
            logger.error('Extraction failed', { error });
            throw new InternalServerError(`Failed to extract archive: ${error.message}`);
        }
    }

    /**
     * Unsafely reads an absolute path from the system.
     * WARNING: This bypasses sandbox checks. Caller MUST ensure permission (e.g. Admin only).
     */
    async unsafeReadAbsolute(absolutePath: string): Promise<string> {
        try {
            if (!fs.existsSync(absolutePath)) {
                return `Error: File not found at ${absolutePath}`;
            }
            const stat = await fsPromises.stat(absolutePath);
            if (stat.isDirectory()) {
                return `Error: Path is a directory, not a file: ${absolutePath}`;
            }
            // Limit size to prevent memory issues with huge logs
            if (stat.size > 10 * 1024 * 1024) { // 10MB limit
                return `Error: File is too large (${(stat.size / 1024 / 1024).toFixed(2)} MB). Limit is 10MB.`;
            }
            const buffer = await fsPromises.readFile(absolutePath);
            return buffer.toString('utf8');
        } catch (error: any) {
            return `Error reading system file: ${error.message}`;
        }
    }

    /**
     * Unsafely lists files at an absolute path.
     * WARNING: This bypasses sandbox checks. Caller MUST ensure permission.
     */
    async unsafeListAbsolute(absolutePath: string): Promise<string[]> {
        try {
            if (!fs.existsSync(absolutePath)) {
                return [`Error: Path not found: ${absolutePath}`];
            }
            const stat = await fsPromises.stat(absolutePath);
            if (!stat.isDirectory()) {
                return [`Error: Path is not a directory: ${absolutePath}`];
            }

            const files = await fsPromises.readdir(absolutePath);
            const results: string[] = [];

            for (const file of files.slice(0, 100)) { // Limit to 100 items
                try {
                    const fullPath = path.join(absolutePath, file);
                    const fileStat = await fsPromises.stat(fullPath);
                    const type = fileStat.isDirectory() ? '[DIR]' : '[FILE]';
                    results.push(`${type} ${file} (${fileStat.size} bytes)`);
                } catch {
                    results.push(`[?] ${file}`);
                }
            }

            if (files.length > 100) {
                results.push(`... (and ${files.length - 100} more)`);
            }

            return results;
        } catch (error: any) {
            return [`Error listing directory: ${error.message}`];
        }
    }
}

export const fileStorage = new FileStorageService();
export const fileStorageSuccess = fileStorage;


