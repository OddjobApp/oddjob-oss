
import fs from 'fs';
import path from 'path';

// Config
const CLIENT_ROOT = path.join(__dirname, '../client/src');
const OUTPUT_FILE = path.join(__dirname, 'discovered_intents.json');

interface DiscoveredRoute {
    path: string;
    componentName: string;
    componentPath?: string;
    elements: DiscoveredElement[];
}

interface DiscoveredElement {
    id: string;
    tag: string;
    context: string; // The text content or surrounding code
}

// Regex Patterns
const ROUTE_REGEX = /<Route\s+(?:path="([^"]+)")?\s+component={([^}]+)}/g;
const IMPORT_REGEX = /import\s+(?:{\s*([^}]+)\s*}|([^\s,]+))\s+from\s+['"]([^'"]+)['"]/g;
// Matches elements with IDs: <Button id="btn-save" ...> or <div id="container" ...>
const ELEMENT_ID_REGEX = /<([A-Z][a-zA-Z0-9]*|[a-z]+)[^>]*\s(?:id|data-intent-id)="([^"]+)"[^>]*>/g;

// State
const routes: DiscoveredRoute[] = [];
const componentMap: Record<string, string> = {}; // ComponentName -> FilePath

function scanAppRoutes() {
    const appPath = path.join(CLIENT_ROOT, 'App.tsx');
    if (!fs.existsSync(appPath)) {
        console.error("App.tsx not found!");
        return;
    }

    const content = fs.readFileSync(appPath, 'utf-8');

    // 1. Build Import Map to resolve Component Names to Files
    let match;
    while ((match = IMPORT_REGEX.exec(content)) !== null) {
        const [_, namedImports, defaultImport, importPath] = match;
        const resolvedPath = resolveImportPath(appPath, importPath);

        if (defaultImport) {
            componentMap[defaultImport] = resolvedPath;
        }
        if (namedImports) {
            namedImports.split(',').forEach(ni => {
                componentMap[ni.trim()] = resolvedPath;
            });
        }
    }

    // 2. Find Routes
    while ((match = ROUTE_REGEX.exec(content)) !== null) {
        const [_, routePath, componentName] = match;
        // Ignore 404 or catch-alls for now
        if (routePath) {
            routes.push({
                path: routePath,
                componentName: componentName,
                componentPath: componentMap[componentName],
                elements: []
            });
        }
    }
}

function resolveImportPath(sourceFile: string, importPath: string): string {
    // Basic resolution: handle @/ alias and relative paths
    let target = importPath;
    if (importPath.startsWith('@/')) {
        target = path.join(CLIENT_ROOT, importPath.substring(2));
    } else {
        target = path.resolve(path.dirname(sourceFile), importPath);
    }

    // Try extensions
    const extensions = ['.tsx', '.ts', '.jsx', '.js'];
    for (const ext of extensions) {
        if (fs.existsSync(target + ext)) return target + ext;
        if (fs.existsSync(path.join(target, 'index' + ext))) return path.join(target, 'index' + ext);
    }
    return target; // Fallback
}

function scanComponentForElements(route: DiscoveredRoute) {
    if (!route.componentPath || !fs.existsSync(route.componentPath)) {
        console.log(`[Warn] Could not resolve component for route ${route.path} (${route.componentName})`);
        return;
    }

    const content = fs.readFileSync(route.componentPath, 'utf-8');
    let match;
    while ((match = ELEMENT_ID_REGEX.exec(content)) !== null) {
        const [fullTag, tagName, id] = match;

        // Simple context extraction: get next 50 chars of text content
        const index = match.index + fullTag.length;
        const context = content.substring(index, index + 50).replace(/\s+/g, ' ').trim();

        route.elements.push({
            id: id,
            tag: tagName,
            context: context
        });
    }

    // Also scan recursively? (Omitted for MVP, assuming flattened components or primary actions in page)
}

function run() {
    console.log("🔍 Starting Intent Discovery Crawler...");

    scanAppRoutes();
    console.log(`✅ Found ${routes.length} routes.`);

    routes.forEach(route => {
        scanComponentForElements(route);
    });

    const output = {
        timestamp: new Date().toISOString(),
        routes: routes
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`💾 Scanned Data saved to ${OUTPUT_FILE}`);
}

run();
