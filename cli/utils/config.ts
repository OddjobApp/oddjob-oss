import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.oddjob');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface Config {
    apiUrl?: string;
    authToken?: string;
    defaultOrg?: number;
    outputFormat?: 'json' | 'table' | 'yaml';
}

export function getConfig(): Config {
    if (!fs.existsSync(CONFIG_FILE)) {
        return {};
    }

    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading config file:', error);
        return {};
    }
}

export function setConfig(key: string, value: any): void {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const config = getConfig();
    config[key as keyof Config] = value;

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getAllConfig(): Config {
    return getConfig();
}

export function deleteConfig(key: string): void {
    const config = getConfig();
    delete config[key as keyof Config];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
