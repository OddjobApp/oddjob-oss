
import fs from 'fs';
import path from 'path';

const INTENT_MAP_PATH = path.join(__dirname, '../services/ingestor/intent_map.json');

interface IntentMap {
    routes: Record<string, any>;
    actions: Record<string, any>;
    [key: string]: any;
}

function merge(newIntentsPath: string) {
    if (!fs.existsSync(newIntentsPath)) {
        console.error("New intents file not found.");
        process.exit(1);
    }

    const newIntents: IntentMap = JSON.parse(fs.readFileSync(newIntentsPath, 'utf-8'));

    let currentMap: IntentMap = { routes: {}, actions: {} };
    if (fs.existsSync(INTENT_MAP_PATH)) {
        currentMap = JSON.parse(fs.readFileSync(INTENT_MAP_PATH, 'utf-8'));
    }

    // 1. Merge Routes (Deep Merge would be better, but shallow for now)
    // We prioritize existing manual overrides unless forced.
    // Here we just add missing keys.
    if (newIntents.routes) {
        Object.keys(newIntents.routes).forEach(route => {
            if (!currentMap.routes[route]) {
                currentMap.routes[route] = newIntents.routes[route];
                console.log(`[+] Added Route: ${route}`);
            }
        });
    }

    // 2. Merge Actions
    if (newIntents.actions) {
        Object.keys(newIntents.actions).forEach(actionId => {
            if (!currentMap.actions[actionId]) {
                currentMap.actions[actionId] = newIntents.actions[actionId];
                console.log(`[+] Added Action: ${actionId}`);
            }
        });
    }

    // Save
    fs.writeFileSync(INTENT_MAP_PATH, JSON.stringify(currentMap, null, 2));
    console.log(`✅ Intent Map updated at ${INTENT_MAP_PATH}`);
}

const args = process.argv.slice(2);
if (args.length !== 1) {
    console.log("Usage: ts-node merge_intents.ts <path_to_llm_output.json>");
} else {
    merge(args[0]);
}
