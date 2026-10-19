import { apiClient } from '../utils/api-client';
import { setConfig } from '../utils/config';
import chalk from 'chalk';

export async function credsCommand(action: string, args: any, options: any) {
    try {
        switch (action) {
            case 'add':
                await addCredential(args, options);
                break;
            case 'list':
                await listCredentials(options);
                break;
            case 'delete':
                await deleteCredential(args);
                break;
            default:
                console.error(chalk.red(`❌ Unknown action: ${action}`));
                process.exit(1);
        }
    } catch (error: any) {
        console.error(chalk.red('❌ Credential operation failed:'), error.message);
        process.exit(1);
    }
}

async function addCredential(args: any, options: any) {
    const name = args[0];

    if (!name) {
        console.error(chalk.red('❌ Credential name is required'));
        process.exit(1);
    }

    const credentialData: any = {
        name,
        type: options.type || 'api_key',
        envVarName: options.env || `${name.toUpperCase().replace(/\s+/g, '_')}_KEY`,
    };

    // Store the key in environment variable
    if (options.key) {
        // In a real implementation, this would securely store the key
        // For now, we'll just guide the user
        console.log(chalk.yellow(`⚠️  Please set the environment variable:`));
        console.log(chalk.gray(`   export ${credentialData.envVarName}="${options.key}"`));
        console.log('');
    }

    const result = await apiClient.createCredential(credentialData);

    console.log(chalk.green(`✅ Credential added successfully`));
    console.log(chalk.gray(`   ID: ${result.id}`));
    console.log(chalk.gray(`   Name: ${result.name}`));
    console.log(chalk.gray(`   Type: ${result.type}`));
    console.log(chalk.gray(`   Env Var: ${result.envVarName}`));
}

async function listCredentials(options: any) {
    const credentials = await apiClient.getCredentials(options.org);

    if (credentials.length === 0) {
        console.log(chalk.yellow('No credentials found'));
        return;
    }

    console.log(chalk.blue(`📋 Credentials (${credentials.length})`));
    console.log('');

    for (const cred of credentials) {
        console.log(chalk.cyan(`${cred.id}. ${cred.name}`));
        console.log(chalk.gray(`   Type: ${cred.type}`));
        console.log(chalk.gray(`   Env Var: ${cred.envVarName}`));
        console.log('');
    }
}

async function deleteCredential(args: any) {
    const id = parseInt(args[0]);

    if (isNaN(id)) {
        console.error(chalk.red('❌ Invalid credential ID'));
        process.exit(1);
    }

    await apiClient.deleteCredential(id);
    console.log(chalk.green(`✅ Credential ${id} deleted successfully`));
}
