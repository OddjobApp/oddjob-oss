import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xrayIntelligenceService } from './xray-intelligence.service.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Mock fs and @ast-grep/napi
vi.mock('node:fs/promises');

const { mockFindAll } = vi.hoisted(() => ({ mockFindAll: vi.fn() }));

vi.mock('@ast-grep/napi', () => ({
    js: {
        parse: vi.fn(() => ({
            root: () => ({ findAll: (...args: any[]) => mockFindAll(...args) })
        }))
    }
}));

describe('XRayIntelligenceService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('collectFiles', () => {
        it('should recursively find source files and ignore node_modules', async () => {
            const mockEntries = [
                { name: 'file1.ts', isDirectory: () => false },
                { name: 'node_modules', isDirectory: () => true },
                { name: 'src', isDirectory: () => true }
            ];
            
            (fs.readdir as any) = vi.fn((path: string) => {
                 if (path.includes('src')) return Promise.resolve([{ name: 'file2.js', isDirectory: () => false }] as any);
                 return Promise.resolve(mockEntries as any);
            });

            // This is a simplified test for the recursive logic
            const files = await xrayIntelligenceService.collectFiles('/root');
            expect(files.some(f => f.includes('node_modules'))).toBe(false);
        });
    });

    describe('symbolExtraction', () => {
        it('should correctly identify and format symbols from source code', async () => {
            (fs.readFile as any) = vi.fn().mockResolvedValue("function testFn() {}");
            mockFindAll.mockReturnValue([]); // No ast-grep matches for function source

            // Mock extractAllSymbols dependencies
            vi.spyOn(xrayIntelligenceService, 'collectFiles').mockResolvedValue(['/root/test.ts']);

            const symbols = await xrayIntelligenceService.extractAllSymbols('/root');
            
            expect(symbols.length).toBeGreaterThan(0);
            expect(symbols[0].name).toBe('testFn');
            expect(symbols[0].kind).toBe('function');
            expect(symbols[0].filePath).toBe('test.ts');
        });
    });

    describe('findSymbols', () => {
        it('should perform fuzzy search on extracted symbols', async () => {
            const mockSymbols = [
                { name: 'authenticateUser', kind: 'function' },
                { name: 'fetchData', kind: 'function' },
                { name: 'AuthService', kind: 'class' }
            ];

            vi.spyOn(xrayIntelligenceService, 'extractAllSymbols').mockResolvedValue(mockSymbols as any);

            const results = await xrayIntelligenceService.findSymbols('/root', 'auth');
            
            expect(results.length).toBe(2);
            expect(results[0].name.toLowerCase()).toContain('auth');
        });
    });

    describe('traceImpact', () => {
        it('should identify call sites and imports for a given symbol', async () => {
            (fs.readFile as any) = vi.fn().mockResolvedValue('import { testFn } from "./test"; testFn();');
            vi.spyOn(xrayIntelligenceService, 'collectFiles').mockResolvedValue(['/root/caller.ts']);
            // Return call site matches for any pattern, import match for import pattern
            mockFindAll.mockImplementation((pattern: string) => {
                if (pattern.includes('import')) {
                    return [{ text: () => 'import { testFn } from "./test"' }];
                }
                // Call site patterns return a match with ancestors
                return [{
                    text: () => 'testFn()',
                    range: () => ({ start: { line: 5, column: 0 }, end: { line: 5, column: 8 } }),
                    getMatch: () => null,
                    ancestors: () => [{ kind: () => 'function_declaration', getMatch: () => null, child: () => ({ text: () => 'callerFn' }), text: () => 'function callerFn() {}' }]
                }];
            });

            const symbol = { name: 'testFn', kind: 'function', filePath: 'test.ts' } as any;
            const impact = await xrayIntelligenceService.traceImpact('/root', symbol);

            expect(impact.length).toBeGreaterThan(0);
            expect(impact.some(i => i.reason.includes('Direct call'))).toBe(true);
            expect(impact.some(i => i.reason.includes('Import'))).toBe(true);
        });
    });
});
