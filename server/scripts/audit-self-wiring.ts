import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const DIR = path.join(process.cwd(), "server", "domain", "core", "ui", "components", "packaged");

function extractPropSchema(content: string, fileName: string, componentName: string): Record<string, string> {
    const schema: Record<string, string> = {};
    const sf = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    ts.forEachChild(sf, (node) => {
        if (ts.isInterfaceDeclaration(node) && (node.name.text.includes(componentName) || node.name.text.includes("Props"))) {
            node.members.forEach((m) => {
                if (ts.isPropertySignature(m) && m.name) {
                    schema[m.name.getText(sf) + (m.questionToken ? "?" : "")] = m.type ? m.type.getText(sf) : "any";
                }
            });
        }
    });
    return schema;
}
function fetchesOwnData(c: string) { return /\buseQuery\b|\buseMutation\b|apiRequest\(|fetch\(/.test(c); }
function findDefaultedProps(content: string, fileName: string): Set<string> {
    const out = new Set<string>();
    const sf = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
        if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters.length) {
            const p = node.parameters[0];
            if (p.name && ts.isObjectBindingPattern(p.name)) for (const el of p.name.elements) if (el.initializer) out.add((el.propertyName ?? el.name).getText(sf));
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}
function requiredProps(schema: Record<string, string>, defaulted: Set<string>) {
    return Object.keys(schema).filter((k) => !k.endsWith("?")).map((k) => k.replace(/\?$/, "")).filter((k) => !defaulted.has(k));
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".tsx") && /^[A-Z]/.test(f));
const rows = files.map((f) => {
    const base = f.replace(/\.tsx$/, "");
    const content = fs.readFileSync(path.join(DIR, f), "utf-8");
    const schema = extractPropSchema(content, f, base);
    const req = requiredProps(schema, findDefaultedProps(content, f));
    const fetches = fetchesOwnData(content);
    const selfWiring = fetches && req.length === 0;
    return { base, fetches, req, selfWiring };
});
console.log("SELF-WIRING (fetch + no required props):");
for (const r of rows.filter((r) => r.selfWiring)) console.log(`  ✓ ${r.base}`);
console.log("\nNOT self-wiring (fetches but REQUIRES props → mislabel risk):");
for (const r of rows.filter((r) => r.fetches && !r.selfWiring)) console.log(`  ✗ ${r.base}  requires: [${r.req.join(", ")}]`);
console.log("\nStatic (no fetch):");
for (const r of rows.filter((r) => !r.fetches)) console.log(`  · ${r.base}${r.req.length ? "  requires: [" + r.req.join(", ") + "]" : ""}`);
process.exit(0);
