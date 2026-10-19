/**
 * Code Parser Service
 *
 * Uses the TypeScript Compiler API to parse .ts, .tsx, and .js files
 * into structured node/edge records suitable for the knowledge graph.
 * No native compilation required — uses the typescript package already installed.
 */

import ts from "typescript";
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CodeParser");

// @ast-grep/napi loads a native binding at require-time which fails on
// machines where the .node binary is blocked (Windows Application Control,
// missing optional dep, etc.). Defer the load until structural parsing is
// actually called so the boot path doesn't depend on the binding.
let _astGrep: typeof import("@ast-grep/napi") | null = null;
async function getAstGrep() {
    if (_astGrep) return _astGrep;
    try {
        _astGrep = await import("@ast-grep/napi");
        return _astGrep;
    } catch (err: any) {
        logger.warn(`[CodeParser] @ast-grep/napi unavailable — structural parsing disabled: ${err.message}`);
        return null;
    }
}

// ─── Output types ────────────────────────────────────────────────────────────

export type CodeNodeKind = "code_file" | "code_function" | "code_class" | "code_method" | "code_interface";

export interface ParsedCodeNode {
    kind: CodeNodeKind;
    name: string;
    filePath: string;        // relative to workspace root
    startLine: number;
    endLine: number;
    isExported: boolean;
    data: Record<string, any>;
}

export interface ParsedCodeEdge {
    sourceName: string;      // name of calling/importing node
    sourceFile: string;
    targetName: string;      // name of called/imported node
    targetFile: string | null; // null = external package
    relation: "CALLS" | "IMPORTS" | "PART_OF" | "IMPLEMENTS";
}

export interface ParseResult {
    nodes: ParsedCodeNode[];
    edges: ParsedCodeEdge[];
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export const codeParserService = {

    /**
     * Parse all .ts/.tsx/.js files in a directory (non-recursive limit: 500 files).
     */
    async parseWorkspace(workspacePath: string, fileLimit: number = DEFAULT_FILE_LIMIT): Promise<ParseResult> {
        const { files } = await collectSourceFilesChecked(workspacePath, fileLimit);
        const allNodes: ParsedCodeNode[] = [];
        const allEdges: ParsedCodeEdge[] = [];

        for (const filePath of files) {
            try {
                const source = await fs.readFile(filePath, "utf-8");
                const rel = path.relative(workspacePath, filePath).replace(/\\/g, "/");
                const result = parseFile(source, rel);
                allNodes.push(...result.nodes);
                allEdges.push(...result.edges);
            } catch (err: any) {
                logger.warn(`Skipping ${filePath}: ${err.message}`);
            }
        }

        return { nodes: allNodes, edges: allEdges };
    },

    /**
     * Parse a single file from its source string.
     */
    parseSource(source: string, relativeFilePath: string): ParseResult {
        return parseFile(source, relativeFilePath);
    },

    /**
     * Perform structural analysis using ast-grep for high-level logic tracing.
     * Identifies API routes and database calls.
     */
    async parseWorkspaceStructural(workspacePath: string, fileLimit: number = DEFAULT_FILE_LIMIT): Promise<ParseResult> {
        const astGrep = await getAstGrep();
        if (!astGrep) {
            // Binding unavailable on this host — return empty result so callers
            // degrade gracefully instead of crashing.
            return { nodes: [], edges: [] };
        }
        const { js } = astGrep;
        const { files } = await collectSourceFilesChecked(workspacePath, fileLimit);
        const nodes: ParsedCodeNode[] = [];
        const edges: ParsedCodeEdge[] = [];

        for (const filePath of files) {
            try {
                const source = await fs.readFile(filePath, "utf-8");
                const rel = path.relative(workspacePath, filePath).replace(/\\/g, "/");

                // 1. Parse into ast-grep
                const ast = js.parse(source);
                const root = ast.root();

                // 2. Identify API Routes (e.g., router.get("/path", ...))
                const routeMatches = root.findAll({
                    rule: {
                        pattern: "$ROUTER.$METHOD($PATH, $$$ARGS)",
                    }
                } as any);

                for (const match of routeMatches) {
                    const method = (match as any).getMatch("METHOD")?.text()?.replace(/['"]/g, "").toUpperCase();
                    const rawPath = (match as any).getMatch("PATH")?.text()?.replace(/['"]/g, "");
                    const router = (match as any).getMatch("ROUTER")?.text();
                    
                    if (method && rawPath && (router === "router" || router === "app")) {
                        const start = match.range().start;
                        const end = match.range().end;

                        nodes.push({
                            kind: "code_function", // repurposed for now
                            name: `${method} ${rawPath}`,
                            filePath: rel,
                            startLine: start.line + 1,
                            endLine: end.line + 1,
                            isExported: false,
                            data: { type: "api_route", method, path: rawPath }
                        });
                    }
                }

                // 3. Identify Database Calls (e.g., db.select().from(table))
                const dbMatches = root.findAll('db.$OP($$$ARGS)');
                for (const match of dbMatches) {
                    const op = (match as any).getMatch("OP")?.text();
                    const start = match.range().start;
                    
                    nodes.push({
                        kind: "code_function",
                        name: `DB ${op}`,
                        filePath: rel,
                        startLine: start.line + 1,
                        endLine: match.range().end.line + 1,
                        isExported: false,
                        data: { type: "db_call", operation: op }
                    });
                }

                // 4. Fallback to standard parser for symbols
                const std = parseFile(source, rel);
                nodes.push(...std.nodes);
                edges.push(...std.edges);

            } catch (err: any) {
                logger.warn(`Structural parse failed for ${filePath}: ${err.message}`);
            }
        }

        return { nodes, edges };
    }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Default cap on files collected per parse. Sized for a single forged app;
 * indexing a whole repository must raise it explicitly (see DEFAULT_FILE_LIMIT
 * callers) or the graph silently covers only a fraction of the tree.
 */
export const DEFAULT_FILE_LIMIT = 500;

async function collectSourceFiles(
    dir: string,
    collected: string[] = [],
    limit: number = DEFAULT_FILE_LIMIT,
): Promise<string[]> {
    if (collected.length >= limit) return collected;
    let entries: any[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return collected;
    }

    for (const entry of entries) {
        if (collected.length >= limit) break;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) continue;
            await collectSourceFiles(fullPath, collected, limit);
        } else if (isSourceFile(entry.name)) {
            collected.push(fullPath);
        }
    }
    return collected;
}

/**
 * Collect source files and report whether the limit truncated the walk, so
 * callers can surface a partial index instead of treating it as complete.
 */
async function collectSourceFilesChecked(
    dir: string,
    limit: number,
): Promise<{ files: string[]; truncated: boolean }> {
    const files = await collectSourceFiles(dir, [], limit);
    const truncated = files.length >= limit;
    if (truncated) {
        logger.warn(
            `[CodeParser] File limit of ${limit} reached while walking ${dir}; the resulting graph is PARTIAL.`,
        );
    }
    return { files, truncated };
}

function shouldSkipDir(name: string): boolean {
    return ["node_modules", ".next", ".git", "dist", "build", ".turbo", "coverage"].includes(name);
}

function isSourceFile(name: string): boolean {
    return /\.(ts|tsx|js|jsx)$/.test(name) && !name.endsWith(".d.ts");
}

function parseFile(source: string, relPath: string): ParseResult {
    const nodes: ParsedCodeNode[] = [];
    const edges: ParsedCodeEdge[] = [];

    const scriptKind = relPath.endsWith(".tsx") || relPath.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : relPath.endsWith(".ts")
            ? ts.ScriptKind.TS
            : ts.ScriptKind.JS;

    const sourceFile = ts.createSourceFile(
        relPath,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
    );

    // File node
    const fileNode: ParsedCodeNode = {
        kind: "code_file",
        name: relPath,
        filePath: relPath,
        startLine: 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
        isExported: true,
        data: { path: relPath },
    };
    nodes.push(fileNode);

    // Walk the AST
    function getLine(pos: number): number {
        return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
    }

    function isExported(node: ts.Node): boolean {
        return ts.getCombinedModifierFlags(node as ts.Declaration) !== 0 &&
            (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
    }

    function visitNode(node: ts.Node, parentName?: string) {
        // Function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
            const name = node.name.text;
            const fnNode: ParsedCodeNode = {
                kind: "code_function",
                name,
                filePath: relPath,
                startLine: getLine(node.getStart()),
                endLine: getLine(node.getEnd()),
                isExported: isExported(node),
                data: {
                    params: node.parameters.map(p => p.name.getText(sourceFile)),
                    async: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)),
                },
            };
            nodes.push(fnNode);
            edges.push({ sourceName: name, sourceFile: relPath, targetName: relPath, targetFile: relPath, relation: "PART_OF" });

            // Scan body for calls
            if (node.body) {
                collectCalls(node.body, name, relPath, edges, sourceFile);
            }
        }

        // Arrow function variables: const foo = () => {}
        if (
            ts.isVariableDeclaration(node) &&
            node.name &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            const name = node.name.text;
            const fn = node.initializer;
            const fnNode: ParsedCodeNode = {
                kind: "code_function",
                name,
                filePath: relPath,
                startLine: getLine(fn.getStart()),
                endLine: getLine(fn.getEnd()),
                isExported: false, // determined by parent VariableStatement
                data: {
                    params: fn.parameters.map(p => p.name.getText(sourceFile)),
                    async: !!(fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)),
                    arrow: ts.isArrowFunction(fn),
                },
            };
            nodes.push(fnNode);
            edges.push({ sourceName: name, sourceFile: relPath, targetName: relPath, targetFile: relPath, relation: "PART_OF" });
            if (fn.body && !ts.isExpression(fn.body)) {
                collectCalls(fn.body as ts.Block, name, relPath, edges, sourceFile);
            }
        }

        // Class declarations
        if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;
            const classNode: ParsedCodeNode = {
                kind: "code_class",
                name: className,
                filePath: relPath,
                startLine: getLine(node.getStart()),
                endLine: getLine(node.getEnd()),
                isExported: isExported(node),
                data: {
                    abstract: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)),
                    heritage: node.heritageClauses?.map(h => h.getText(sourceFile)) ?? [],
                },
            };
            nodes.push(classNode);
            edges.push({ sourceName: className, sourceFile: relPath, targetName: relPath, targetFile: relPath, relation: "PART_OF" });

            // Methods
            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) && member.name) {
                    const methodName = `${className}.${member.name.getText(sourceFile)}`;
                    nodes.push({
                        kind: "code_method",
                        name: methodName,
                        filePath: relPath,
                        startLine: getLine(member.getStart()),
                        endLine: getLine(member.getEnd()),
                        isExported: false,
                        data: { class: className, params: member.parameters.map(p => p.name.getText(sourceFile)) },
                    });
                    edges.push({ sourceName: methodName, sourceFile: relPath, targetName: className, targetFile: relPath, relation: "PART_OF" });
                    if (member.body) {
                        collectCalls(member.body, methodName, relPath, edges, sourceFile);
                    }
                }
            }
        }

        // Interface declarations
        if (ts.isInterfaceDeclaration(node)) {
            nodes.push({
                kind: "code_interface",
                name: node.name.text,
                filePath: relPath,
                startLine: getLine(node.getStart()),
                endLine: getLine(node.getEnd()),
                isExported: isExported(node),
                data: { members: node.members.length },
            });
            edges.push({ sourceName: node.name.text, sourceFile: relPath, targetName: relPath, targetFile: relPath, relation: "PART_OF" });
        }

        // Import declarations
        if (ts.isImportDeclaration(node)) {
            const moduleSpec = (node.moduleSpecifier as ts.StringLiteral).text;
            const isExternal = !moduleSpec.startsWith(".") && !moduleSpec.startsWith("@server") && !moduleSpec.startsWith("@domain") && !moduleSpec.startsWith("@shared");
            const importedNames: string[] = [];

            if (node.importClause) {
                if (node.importClause.name) {
                    importedNames.push(node.importClause.name.text);
                }
                const bindings = node.importClause.namedBindings;
                if (bindings && ts.isNamedImports(bindings)) {
                    for (const el of bindings.elements) {
                        importedNames.push(el.name.text);
                    }
                }
            }

            for (const name of importedNames) {
                edges.push({
                    sourceName: relPath,
                    sourceFile: relPath,
                    targetName: name,
                    targetFile: isExternal ? null : moduleSpec,
                    relation: "IMPORTS",
                });
            }
        }

        ts.forEachChild(node, child => visitNode(child, parentName));
    }

    ts.forEachChild(sourceFile, node => visitNode(node));

    return { nodes, edges };
}

function collectCalls(
    body: ts.Block,
    ownerName: string,
    ownerFile: string,
    edges: ParsedCodeEdge[],
    sourceFile: ts.SourceFile
): void {
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
            let callee = "";
            if (ts.isIdentifier(node.expression)) {
                callee = node.expression.text;
            } else if (ts.isPropertyAccessExpression(node.expression)) {
                callee = node.expression.getText(sourceFile);
            }
            if (callee && callee !== ownerName) {
                edges.push({
                    sourceName: ownerName,
                    sourceFile: ownerFile,
                    targetName: callee,
                    targetFile: null,
                    relation: "CALLS",
                });
            }
        }
        ts.forEachChild(node, visit);
    }
    ts.forEachChild(body, visit);
}
