import path from "node:path";

export interface XrayE2ETest {
  id: string;
  title: string;
  behaviorId: string;
  filePath: string;
  startLine: number;
  routes: string[];
  assertions: string[];
  functionalDescription: string;
  steps: string[];
}

export interface XrayE2ESpec {
  scope: string;
  scopeAliases: string[];
  specificationPath?: string;
  filePath: string;
  tests: XrayE2ETest[];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseXrayE2ESpec(filePath: string, content: string): XrayE2ESpec | null {
  const scope = content.match(/@xray-scope\s+([a-z0-9._-]+)/i)?.[1];
  if (!scope) return null;
  const scopeAliases = [...content.matchAll(/@xray-alias\s+([a-z0-9._-]+)/gi)].map(match => match[1]);

  const specificationPath = content.match(/@xray-spec\s+([^\s*]+)/i)?.[1];
  const tests: XrayE2ETest[] = [];
  const testPattern = /test\s*\(\s*(['"`])(.+?)\1\s*,\s*async\s*\([^)]*\)\s*=>\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = testPattern.exec(content)) !== null) {
    const blockStart = match.index + match[0].length;
    let cursor = blockStart;
    let depth = 1;
    while (cursor < content.length && depth > 0) {
      if (content[cursor] === "{") depth++;
      if (content[cursor] === "}") depth--;
      cursor++;
    }

    const code = content.slice(blockStart, cursor - 1);
    const behaviorId = code.match(/@behavior\s+([a-z0-9._:-]+)/i)?.[1];
    if (!behaviorId) continue;
    const functionalDescription =
      code.match(/@functional-description\s+([^\r\n]+)/i)?.[1].trim()
      ?? match[2];
    const steps = [...code.matchAll(/^\s*\/\/\s*(?:\d+\.\s*)?([^@\r\n][^\r\n]*)/gm)]
      .map(step => step[1].trim())
      .filter(step => step.length > 3 && !step.startsWith("@"));

    const routes = [...code.matchAll(/(?:goto|request\.(?:get|post|put|patch|delete))\(\s*(['"`])([^'"`]+)\1/gi)]
      .map(routeMatch => routeMatch[2])
      .filter((value, index, values) => values.indexOf(value) === index);
    const assertions = [...code.matchAll(/await\s+expect(?:\.poll)?\(([\s\S]*?)\)\s*\.(to[A-Za-z]+)\(([\s\S]*?)\);/g)]
      .map(assertion => `${assertion[2]}(${assertion[3].trim().replace(/\s+/g, " ").slice(0, 180)})`)
      .slice(0, 20);
    const startLine = content.slice(0, match.index).split("\n").length;
    const basename = path.basename(filePath).replace(/\.spec\.[^.]+$/, "");

    tests.push({
      id: `${basename}:${slug(match[2])}`,
      title: match[2],
      behaviorId,
      filePath: filePath.replace(/\\/g, "/"),
      startLine,
      routes,
      assertions,
      functionalDescription,
      steps,
    });
  }

  return { scope, scopeAliases, specificationPath, filePath: filePath.replace(/\\/g, "/"), tests };
}
