import { apiClient } from '../utils/api-client';
import chalk from 'chalk';

export async function logsCommand(execution: string, options: any) {
    try {
        const executionId = parseInt(execution);

        if (isNaN(executionId)) {
            console.error(chalk.red('❌ Invalid execution ID'));
            process.exit(1);
        }

        // Get execution details
        const executionData = await apiClient.getExecution(executionId);
        const steps = await apiClient.getExecutionSteps(executionId);

        if (options.json) {
            // Output as JSON
            console.log(JSON.stringify({ execution: executionData, steps }, null, 2));
            return;
        }

        // Display formatted logs
        console.log(chalk.blue(`📋 Execution Logs - ID: ${executionId}`));
        console.log(chalk.gray(`   Pipeline: ${executionData.pipelineId}`));
        console.log(chalk.gray(`   Status: ${getStatusColor(executionData.status)}`));
        console.log(chalk.gray(`   Started: ${new Date(executionData.createdAt).toLocaleString()}`));
        console.log('');

        // Filter by step if specified
        const filteredSteps = options.step
            ? steps.filter((s: any) => s.id === parseInt(options.step))
            : steps;

        // Display step logs
        for (const step of filteredSteps) {
            console.log(chalk.cyan(`[Step ${step.stepOrder}] ${step.jobName || 'Unknown Job'}`));
            console.log(chalk.gray(`  Status: ${getStatusColor(step.status)}`));

            if (step.output) {
                try {
                    const output = typeof step.output === 'string' ? JSON.parse(step.output) : step.output;
                    console.log(chalk.white(`  Output: ${JSON.stringify(output, null, 2)}`));
                } catch {
                    console.log(chalk.white(`  Output: ${step.output}`));
                }
            }

            if (step.error) {
                console.log(chalk.red(`  Error: ${step.error}`));
            }

            console.log('');
        }

        // Follow mode
        if (options.follow && executionData.status === 'running') {
            console.log(chalk.blue('👀 Following logs... (Ctrl+C to exit)'));
            await followLogs(executionId);
        }

    } catch (error: any) {
        console.error(chalk.red('❌ Failed to fetch logs:'), error.message);
        process.exit(1);
    }
}

function getStatusColor(status: string): string {
    switch (status) {
        case 'completed':
            return chalk.green(status);
        case 'failed':
            return chalk.red(status);
        case 'running':
            return chalk.yellow(status);
        case 'cancelled':
            return chalk.gray(status);
        default:
            return chalk.white(status);
    }
}

async function followLogs(executionId: number) {
    let lastStepCount = 0;

    while (true) {
        const execution = await apiClient.getExecution(executionId);
        const steps = await apiClient.getExecutionSteps(executionId);

        // Show new steps
        if (steps.length > lastStepCount) {
            const newSteps = steps.slice(lastStepCount);
            for (const step of newSteps) {
                console.log(chalk.cyan(`[Step ${step.stepOrder}] ${step.jobName || 'Unknown Job'}`));
                console.log(chalk.gray(`  Status: ${getStatusColor(step.status)}`));
                if (step.output) {
                    console.log(chalk.white(`  Output: ${step.output}`));
                }
                console.log('');
            }
            lastStepCount = steps.length;
        }

        // Exit if execution is complete
        if (execution.status !== 'running') {
            console.log(chalk.blue(`\n📊 Execution ${execution.status}`));
            break;
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
