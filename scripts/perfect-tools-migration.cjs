const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const serverRoot = path.resolve('server');

// Define original vs new locations
const renames = {
    'server/services/agent-tools.ts': 'server/domain/tools/v1/tool-registry.service.ts',
    'server/services/agent/tool-executor.ts': 'server/domain/tools/v1/tool-executor.service.ts'
};

const oldToNewPaths = {};

// 1. Map standalone files
for (const [oldGit, newRel] of Object.entries(renames)) {
    const oldBase = path.resolve(oldGit.replace(/\.ts$/, ''));
    const newBase = path.resolve(newRel.replace(/\.ts$/, ''));
    oldToNewPaths[oldBase] = newBase;
}

// Map massive cross-domain refactors from this session
const externalRefactors = {
    'server/services/app-registry-service': 'server/domain/apps/app-registry.service',
    'server/services/app-deployment-service': 'server/domain/apps/app-deployment.service',
    'server/services/mission-service': 'server/domain/missions/mission.service',
    'server/services/mission-run-service': 'server/domain/missions/mission-run.service',
    'server/services/mission-analyst-service': 'server/domain/missions/mission-analyst.service',
    'server/services/mission-dependency-resolver-service': 'server/domain/missions/mission-dependency-resolver.service',
    'server/services/job-service': 'server/domain/jobs/job.service',
    'server/services/job-test-service': 'server/domain/jobs/job-test.service',
    'server/services/job-synthesis-service': 'server/domain/jobs/job-synthesis.service',
    'server/services/skill-import-service': 'server/domain/jobs/skill-import.service',
    'server/services/skill-export-service': 'server/domain/jobs/skill-export.service',
};
for (const [oldGit, newRel] of Object.entries(externalRefactors)) {
    oldToNewPaths[path.resolve(oldGit)] = path.resolve(newRel);
}

// 2. Map capabilities directory
const capabilityFiles = execSync('git ls-files server/services/tools/*.ts').toString().trim().split('\n');
const capNewDir = 'server/domain/tools/v1/capabilities';

for (const f of capabilityFiles) {
    if (!f) continue;
    const baseName = path.basename(f, '.ts');

    renames[f] = `${capNewDir}/${path.basename(f)}`;
    oldToNewPaths[path.resolve('server/services/tools', baseName)] = path.resolve(capNewDir, baseName);
}

// Ensure the target v1 directories exist
fs.mkdirSync(path.resolve('server/domain/tools/v1/capabilities'), { recursive: true });

function processFile(oldGitPath, newAbsPath) {
    const oldDir = path.dirname(path.resolve(oldGitPath));
    const newDir = path.dirname(newAbsPath);

    const originalContent = execSync(`git show HEAD:${oldGitPath}`).toString();
    const lines = originalContent.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Match standard ES6 imports or dynamic imports
        line = line.replace(/((?:from|import)\s*\(?\s*['"])([\.\/]+.*?)((?:\.js)?['"]\s*\)?)/g, (match, prefix, specifier, suffix) => {
            if (!specifier.startsWith('.')) return match;

            // Reconstruct absolute path based on OLD location
            let oldAbsPath = path.resolve(oldDir, specifier);

            // Check if this dependency was ALSO moved
            if (oldToNewPaths[oldAbsPath]) {
                oldAbsPath = oldToNewPaths[oldAbsPath];
            }

            // Calculate new relative path based on NEW location
            let newSpec = path.relative(newDir, oldAbsPath).replace(/\\/g, '/');
            if (!newSpec.startsWith('.')) newSpec = './' + newSpec;

            // Enforce .js extension for Node16 module resolution
            const fsPathIndexTs = path.join(oldAbsPath, 'index.ts');
            if (fs.existsSync(fsPathIndexTs)) {
                if (!newSpec.endsWith('/index')) {
                    newSpec = newSpec + '/index';
                }
            }
            if (!suffix.includes('.js') && !newSpec.endsWith('.json')) {
                suffix = '.js' + suffix.replace(/['"]$/, '"');
            }

            return prefix + newSpec + suffix;
        });

        if (lines[i] !== line) {
            lines[i] = line;
            modified = true;
        }
    }

    fs.writeFileSync(newAbsPath, lines.join('\n'), 'utf8');
    console.log(`Rewrote dependencies for ${path.basename(newAbsPath)}`);
}

// Execute mesh rewrites
for (const [oldGitPath, newRelPath] of Object.entries(renames)) {
    processFile(oldGitPath, path.resolve(newRelPath));
}

console.log('Complete AST + FS deterministic migration finished.');
