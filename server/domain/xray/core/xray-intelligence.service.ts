import ts from "typescript";
import fs from "node:fs/promises";
import path from "node:path";
import fuzzysort from "fuzzysort";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("XRayIntelligence");

// Lazy load to keep the native @ast-grep/napi binding off the boot path.
// See server/domain/xray/core/code-parser.service.ts for full rationale.
let _astGrep: typeof import("@ast-grep/napi") | null = null;
async function getAstGrep() {
    if (_astGrep) return _astGrep;
    try {
        _astGrep = await import("@ast-grep/napi");
        return _astGrep;
    } catch (err: any) {
        logger.warn(`[XRayIntelligence] @ast-grep/napi unavailable: ${err.message}`);
        return null;
    }
}

export interface XRaySymbol {
    id: string;
    name: string;
    kind: "function" | "class" | "interface" | "route" | "db_call" | "type" | "method";
    filePath: string;
    startLine: number;
    endLine: number;
    signature: string;
    docstring?: string;
}

export interface ImpactNode {
    symbol: XRaySymbol;
    reason: string; // e.g. "Calls authenticate()"
    depth: number;
}

export const xrayIntelligenceService = {
    /**
     * Traces the "Blast Radius" of a symbol.
     * Finds all functions that call this symbol or files that import it.
     */
    async traceImpact(workspacePath: string, symbol: XRaySymbol): Promise<ImpactNode[]> {
        const impact: ImpactNode[] = [];
        const files = await this.collectFiles(workspacePath);
        
        // Patterns to find call sites
        // If symbol name contains a dot (e.g. authService.login), we search for it directly.
        // Otherwise, we search for both direct calls and member calls.
        const patterns: string[] = [];
        if (symbol.name.includes('.')) {
            patterns.push(`${symbol.name}($$$)`);
        } else {
            patterns.push(`${symbol.name}($$$)`);
            patterns.push(`$.${symbol.name}($$$)`);
        }

        const astGrep = await getAstGrep();
        if (!astGrep) return [];
        const { js } = astGrep;

        for (const filePath of files) {
            try {
                const source = await fs.readFile(filePath, "utf-8");
                const rel = path.relative(workspacePath, filePath).replace(/\\/g, "/");
                const ast = js.parse(source);
                const root = ast.root();

                // 1. Check for Call Sites
                const callMatches: any[] = [];
                for (const pattern of patterns) {
                    callMatches.push(...root.findAll(pattern));
                }
                
                if (callMatches.length > 0) {
                    for (const match of callMatches) {
                        const encloser = match.ancestors().find((a: any) =>
                            a.kind() === "function_declaration" ||
                            a.kind() === "arrow_function" ||
                            a.kind() === "method_definition" ||
                            a.kind() === "variable_declarator" ||
                            a.kind() === "class_declaration"
                        );

                        let encloserName = "anonymous block";
                        if (encloser) {
                            // Try to get the most specific name
                            encloserName = encloser.getMatch("NAME")?.text() || 
                                          encloser.child(1)?.text() || 
                                          encloser.text().split('{')[0].trim() ||
                                          "enclosing scope";
                        }
                        
                        // Clean up name
                        encloserName = encloserName.replace(/['"]/g, "").split('(')[0].trim();

                        impact.push({
                            symbol: {
                                id: `${rel}:call:${match.range().start.line}`,
                                name: encloserName,
                                kind: "function",
                                filePath: rel,
                                startLine: match.range().start.line + 1,
                                endLine: match.range().end.line + 1,
                                signature: `Calls ${symbol.name}`,
                            },
                            reason: `Direct call to ${symbol.name}`,
                            depth: 1
                        });
                    }
                }

                // 2. Check for Imports
                const importPattern = `import { ${symbol.name} }`;
                const importMatches = root.findAll(importPattern);
                for (const match of importMatches) {
                    if (match.text().includes(symbol.name)) {
                        impact.push({
                            symbol: {
                                id: `${rel}:import`,
                                name: path.basename(rel),
                                kind: "type",
                                filePath: rel,
                                startLine: 1,
                                endLine: 1,
                                signature: `Imports ${symbol.name}`,
                            },
                            reason: `Imports ${symbol.name}`,
                            depth: 0
                        });
                        break; 
                    }
                }

            } catch (err) { }
        }

        return impact;
    },

    /**
     * Fuzzy search for symbols across a workspace.
     */
    async findSymbols(workspacePath: string, query: string, limit: number = 20): Promise<XRaySymbol[]> {
        const allSymbols = await this.extractAllSymbols(workspacePath);
        const results = fuzzysort.go(query, allSymbols, { key: 'name', limit, threshold: -1000 });
        return results.map(r => r.obj) as XRaySymbol[];
    },

    /**
     * Extract all symbols using Unified Parsing (TS API + Structural ast-grep)
     */
    async extractAllSymbols(workspacePath: string): Promise<XRaySymbol[]> {
        const symbols: XRaySymbol[] = [];
        const files = await this.collectFiles(workspacePath);
        const astGrep = await getAstGrep();
        if (!astGrep) return [];
        const { js } = astGrep;

        for (const filePath of files) {
            try {
                const source = await fs.readFile(filePath, "utf-8");
                const rel = path.relative(workspacePath, filePath).replace(/\\/g, "/");

                // 1. Structural Intelligence (ast-grep)
                const ast = js.parse(source);
                const root = ast.root();

                // Routes
                const routeMatches = root.findAll("$ROUTER.$METHOD($PATH, $$$)");
                for (const match of routeMatches) {
                    const method = match.getMatch("METHOD")?.text()?.toUpperCase();
                    const rawPath = match.getMatch("PATH")?.text()?.replace(/['"]/g, "");
                    const router = match.getMatch("ROUTER")?.text();
                    if (method && rawPath && (router === "router" || router === "app")) {
                        symbols.push({
                            id: `${rel}:route:${match.range().start.line}`,
                            name: `${method} ${rawPath}`,
                            kind: "route",
                            filePath: rel,
                            startLine: match.range().start.line + 1,
                            endLine: match.range().end.line + 1,
                            signature: match.text().split('\n')[0].trim(),
                        });
                    }
                }

                // DB Calls
                const dbMatches = root.findAll("db.$OP($$$)");
                for (const match of dbMatches) {
                    const op = match.getMatch("OP")?.text();
                    symbols.push({
                        id: `${rel}:db:${match.range().start.line}`,
                        name: `DB ${op}`,
                        kind: "db_call",
                        filePath: rel,
                        startLine: match.range().start.line + 1,
                        endLine: match.range().end.line + 1,
                        signature: match.text().split('\n')[0].trim(),
                    });
                }

                // 2. Deep Symbol Analysis (TS Compiler API)
                const sourceFile = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
                const getLine = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

                const visit = (node: ts.Node) => {
                    // Functions / Arrows
                    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
                        const name = node.name.getText(sourceFile);
                        symbols.push({
                            id: `${rel}:${node.getStart()}`,
                            name,
                            kind: ts.isMethodDeclaration(node) ? "method" : "function",
                            filePath: rel,
                            startLine: getLine(node.getStart()),
                            endLine: getLine(node.getEnd()),
                            signature: node.getText(sourceFile).split('\n')[0].trim(),
                        });
                    }

                    // Classes / Interfaces
                    if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
                        symbols.push({
                            id: `${rel}:${node.getStart()}`,
                            name: node.name.text,
                            kind: ts.isClassDeclaration(node) ? "class" : "interface",
                            filePath: rel,
                            startLine: getLine(node.getStart()),
                            endLine: getLine(node.getEnd()),
                            signature: node.getText(sourceFile).split('\n')[0].trim(),
                        });
                    }

                    // Object Literal Members (The fix for service objects and patterns)
                    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
                        const serviceName = node.name.getText(sourceFile);
                        symbols.push({
                            id: `${rel}:${node.getStart()}`,
                            name: serviceName,
                            kind: "class", // Treat as service class/module
                            filePath: rel,
                            startLine: getLine(node.getStart()),
                            endLine: getLine(node.getEnd()),
                            signature: `const ${serviceName} = { ... }`,
                        });

                        // Recursively find methods and properties in the object
                        node.initializer.properties.forEach(prop => {
                            if (ts.isMethodDeclaration(prop) || ts.isPropertyAssignment(prop)) {
                                const propName = prop.name.getText(sourceFile);
                                let kind: any = "method";
                                
                                // Determine if it's a function/method
                                if (ts.isPropertyAssignment(prop) && prop.initializer) {
                                    if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
                                        kind = "method";
                                    } else {
                                        kind = "type"; // Constant/Value
                                    }
                                }

                                symbols.push({
                                    id: `${rel}:${prop.getStart()}`,
                                    name: `${serviceName}.${propName}`,
                                    kind,
                                    filePath: rel,
                                    startLine: getLine(prop.getStart()),
                                    endLine: getLine(prop.getEnd()),
                                    signature: prop.getText(sourceFile).split('\n')[0].trim(),
                                });
                            }
                        });
                    }

                    // Handle Exported Constants that are functions
                    if (ts.isVariableStatement(node)) {
                        const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
                        if (isExported) {
                            node.declarationList.declarations.forEach(decl => {
                                if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
                                    const name = decl.name.getText(sourceFile);
                                    symbols.push({
                                        id: `${rel}:${decl.getStart()}`,
                                        name,
                                        kind: "function",
                                        filePath: rel,
                                        startLine: getLine(decl.getStart()),
                                        endLine: getLine(decl.getEnd()),
                                        signature: `export const ${name} = ...`,
                                    });
                                }
                            });
                        }
                    }

                    ts.forEachChild(node, visit);
                };

                ts.forEachChild(sourceFile, visit);

            } catch (err) {
                logger.warn(`Failed to extract symbols from ${filePath}: ${err}`);
            }
        }

        return symbols;
    },

    /**
     * Helper to collect relevant source files.
     */
    async collectFiles(dir: string, currentDepth: number = 0, maxDepth: number = 5): Promise<string[]> {
        if (currentDepth > maxDepth) return [];
        let entries: any[] = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch { return []; }

        const files: string[] = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (["node_modules", ".git", "dist", ".next"].includes(entry.name)) continue;
                files.push(...(await this.collectFiles(fullPath, currentDepth + 1, maxDepth)));
            } else if (/\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                files.push(fullPath);
            }
        }
        return files;
    }
};
