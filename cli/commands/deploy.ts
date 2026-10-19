import fs from 'fs';
import yaml from 'js-yaml';
import { apiClient } from '../utils/api-client';
import chalk from 'chalk';

export async function deployCommand(file: string, options: any) {
    try {
        console.log(chalk.blue(`📦 Deploying pipeline from ${file}...`));

        // Read file
        if (!fs.existsSync(file)) {
            console.error(chalk.red(`❌ File not found: ${file}`));
            process.exit(1);
        }

        const content = fs.readFileSync(file, 'utf-8');
        let pipelineData: any;

        // Parse based on file extension
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            pipelineData = yaml.load(content);
        } else if (file.endsWith('.json')) {
            pipelineData = JSON.parse(content);
        } else {
            console.error(chalk.red('❌ Unsupported file format. Use .yaml, .yml, or .json'));
            process.exit(1);
        }

        // Validate pipeline data
        if (!pipelineData.name) {
            console.error(chalk.red('❌ Pipeline must have a name'));
            process.exit(1);
        }

        if (!pipelineData.steps || pipelineData.steps.length === 0) {
            console.error(chalk.red('❌ Pipeline must have at least one step'));
            process.exit(1);
        }

        // Dry run mode
        if (options.dryRun) {
            console.log(chalk.yellow('🔍 Dry run mode - validating only'));
            console.log(chalk.green('✅ Pipeline definition is valid'));
            console.log(JSON.stringify(pipelineData, null, 2));
            return;
        }

        // Add organization if specified
        if (options.org) {
            pipelineData.organizationId = parseInt(options.org);
        }

        // Deploy pipeline
        const result = await apiClient.createPipeline(pipelineData);

        console.log(chalk.green(`✅ Pipeline deployed successfully!`));
        console.log(chalk.gray(`   ID: ${result.id}`));
        console.log(chalk.gray(`   Name: ${result.name}`));
        console.log(chalk.gray(`   Steps: ${result.steps?.length || 0}`));

    } catch (error: any) {
        console.error(chalk.red('❌ Deployment failed:'), error.message);
        if (error.response?.data) {
            console.error(chalk.gray(JSON.stringify(error.response.data, null, 2)));
        }
        process.exit(1);
    }
}
