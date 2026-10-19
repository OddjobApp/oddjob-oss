const fs = require('fs');
const path = require('path');

function processDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.next') {
                processDir(fullPath);
            }
        } else if (entry.name === 'next.config.js') {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('webpack: (config) => {') && content.includes('config.resolve.alias[\'react\']')) {
                console.log('Fixing', fullPath);
                // Remove the webpack block
                content = content.replace(/\s*webpack:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?return\s*config;\s*\},/g, '');
                fs.writeFileSync(fullPath, content);
            }
        }
    }
}

const root = path.join(__dirname, '..');
processDir(path.join(root, 'server', 'blueprints', 'apps'));
processDir(path.join(root, 'storage', 'forge-workspace'));
console.log('Done');
