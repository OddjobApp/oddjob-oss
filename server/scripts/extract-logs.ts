
import fs from 'fs';

const logFile = 'logs/2026-03-19.log';
const content = fs.readFileSync(logFile, 'utf8');
const lines = content.split('\n');

const output: string[] = [];
for (let i = 0; i < lines.length; i++) {
    try {
        const entry = JSON.parse(lines[i]);
        if (entry.timestamp && entry.timestamp >= '2026-03-19T06:38:10.000Z' && entry.timestamp <= '2026-03-19T06:38:15.000Z') {
            output.push(`Line ${i + 1} [${entry.timestamp}]: ${entry.level} - [${entry.component || 'N/A'}] ${entry.message}`);
            if (entry.error) output.push(`  ERROR: ${entry.error.message}\n  STACK: ${entry.error.stack}`);
        }
    } catch (e) {
        // Not JSON
    }
}
fs.writeFileSync('mission_67_trace.txt', output.join('\n'));
console.log(`Wrote ${output.length} lines to mission_67_trace.txt`);

