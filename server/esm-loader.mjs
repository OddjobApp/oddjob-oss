/**
 * Custom ESM Loader for Node.js v24
 * Resolves TypeScript path aliases (@shared/*)
 */
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const projectRoot = path.join(fileURLToPath(import.meta.url), '..', '..');

// Path aliases from tsconfig.json
const aliases = {
    '@shared/': path.join(projectRoot, 'shared'),
    '@domain/': path.join(projectRoot, 'server', 'domain'),
    '@server/': path.join(projectRoot, 'server'),
};

export async function resolve(specifier, context, nextResolve) {
    // Handle aliases
    for (const [alias, aliasPath] of Object.entries(aliases)) {
        if (specifier.startsWith(alias)) {
            const relativePath = specifier.replace(alias, '');
            let resolvedPath = path.join(aliasPath, relativePath);

            // Try to resolve with .ts extension if not already present
            if (!fs.existsSync(resolvedPath)) {
                // Handle .js to .ts mapping
                const withTs = resolvedPath.replace(/\.js$/, '.ts');
                if (fs.existsSync(withTs)) {
                    resolvedPath = withTs;
                } else if (!resolvedPath.endsWith('.ts') && fs.existsSync(resolvedPath + '.ts')) {
                    resolvedPath = resolvedPath + '.ts';
                } else if (fs.existsSync(path.join(resolvedPath, 'index.ts'))) {
                    resolvedPath = path.join(resolvedPath, 'index.ts');
                }
            }

            return {
                url: pathToFileURL(resolvedPath).href,
                shortCircuit: true,
            };
        }
    }

    // For all other specifiers, use the default resolver
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    // If it's a TypeScript file, let tsx handle it
    // This loader only handles resolution, not loading
    return nextLoad(url, context);
}
