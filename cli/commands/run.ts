import fs from 'fs';
import { apiClient } from '../utils/api-client';
import chalk from 'chalk';

export async function runCommand(pipeline: string, options: any) {
    try {
        console.log(chalk.blue(`🚀 Executing pipeline: ${pipeline}`));

        // Determine if pipeline is ID or name
        const pipelineId = parseInt(pipeline);
        let targetPipeline: any;

        if (isNaN(pipelineId)) {
            // Search by name
            const pipelines = await apiClient.getPipelines();
            targetPipeline = pipelines.find((p: any) => p.name === pipeline);

            if (!targetPipeline) {
                console.error(chalk.red(`❌ Pipeline not found: ${pipeline}`));
                process.exit(1);
            }
        } else {
            targetPipeline = await apiClient.getPipeline(pipelineId);
        }

        // Parse input
        let input: any = undefined;
        if (options.input) {
            try {
                input = JSON.parse(options.input);
            } catch (error) {
                console.error(chalk.red('❌ Invalid JSON input'));
                process.exit(1);
            }
        } else if (options.inputFile) {
            if (!fs.existsSync(options.inputFile)) {
                console.error(chalk.red(`❌ Input file not found: ${options.inputFile}`));
                process.exit(1);
            }
            const content = fs.readFileSync(options.inputFile, 'utf-8');
            input = JSON.parse(content);
        }

        // Execute pipeline
        const execution = await apiClient.executePipeline(targetPipeline.id, input);

        console.log(chalk.green(`✅ Pipeline execution started`));
        console.log(chalk.gray(`   Execution ID: ${execution.id}`));
        console.log(chalk.gray(`   Status: ${execution.status}`));

        // Wait for completion if requested
        if (options.wait) {
            console.log(chalk.blue('⏳ Waiting for execution to complete...'));
            await waitForCompletion(execution.id, parseInt(options.timeout));
        } else {
            console.log(chalk.gray(`\n💡 Use 'oddjob logs ${execution.id}' to view progress`));
        }

    } catch (error: any) {
        console.error(chalk.red('❌ Execution failed:'), error.message);
        if (error.response?.data) {
            console.error(chalk.gray(JSON.stringify(error.response.data, null, 2)));
        }
        process.exit(1);
    }
}

async function waitForCompletion(executionId: number, timeoutSeconds: number) {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;

    while (true) {
        const execution = await apiClient.getExecution(executionId);

        if (execution.status === 'completed') {
            console.log(chalk.green('✅ Execution completed successfully'));
            break;
        } else if (execution.status === 'failed') {
            console.log(chalk.red('❌ Execution failed'));
            console.log(chalk.gray(`   Error: ${execution.error || 'Unknown error'}`));
            process.exit(1);
        } else if (execution.status === 'cancelled') {
            console.log(chalk.yellow('⚠️  Execution was cancelled'));
            process.exit(1);
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
            console.log(chalk.yellow(`⚠️  Timeout reached (${timeoutSeconds}s)`));
            console.log(chalk.gray(`   Execution is still running with ID: ${executionId}`));
            break;
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
