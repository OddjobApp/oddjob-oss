import { getConfig, setConfig, getAllConfig, deleteConfig } from '../utils/config';
import chalk from 'chalk';

export async function configCommand(action: string, args: any) {
    try {
        switch (action) {
            case 'set':
                setConfigValue(args);
                break;
            case 'get':
                getConfigValue(args);
                break;
            case 'list':
                listConfig();
                break;
            default:
                console.error(chalk.red(`❌ Unknown action: ${action}`));
                process.exit(1);
        }
    } catch (error: any) {
        console.error(chalk.red('❌ Config operation failed:'), error.message);
        process.exit(1);
    }
}

function setConfigValue(args: any) {
    const [key, value] = args;

    if (!key || value === undefined) {
        console.error(chalk.red('❌ Both key and value are required'));
        process.exit(1);
    }

    setConfig(key, value);
    console.log(chalk.green(`✅ Config updated: ${key} = ${value}`));
}

function getConfigValue(args: any) {
    const key = args[0];

    if (!key) {
        console.error(chalk.red('❌ Key is required'));
        process.exit(1);
    }

    const config = getConfig();
    const value = config[key as keyof typeof config];

    if (value === undefined) {
        console.log(chalk.yellow(`⚠️  Config key not found: ${key}`));
    } else {
        console.log(chalk.cyan(`${key}: ${value}`));
    }
}

function listConfig() {
    const config = getAllConfig();

    if (Object.keys(config).length === 0) {
        console.log(chalk.yellow('No configuration found'));
        console.log(chalk.gray('\n💡 Set config with: oddjob config set <key> <value>'));
        return;
    }

    console.log(chalk.blue('⚙️  Configuration'));
    console.log('');

    for (const [key, value] of Object.entries(config)) {
        console.log(chalk.cyan(`${key}: ${value}`));
    }
}
