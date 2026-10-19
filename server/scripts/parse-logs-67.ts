
import fs from 'fs';
import path from 'path';

const logFile = 'logs/2026-03-19.log';
const lines = fs.readFileSync(logFile, 'utf8').split('\n');
const matches = lines.filter(line => line.includes('"missionId":45') || line.includes('"id":67') || line.includes('MissionRun 67'));

console.log(`Found ${matches.length} matches:`);
matches.forEach(match => console.log(match));

