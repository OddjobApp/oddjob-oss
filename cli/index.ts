#!/usr/bin/env node

import { Command } from 'commander';
import { deployCommand } from './commands/deploy';
import { runCommand } from './commands/run';
import { logsCommand } from './commands/logs';
import { credsCommand } from './commands/creds';
import { configCommand } from './commands/config';
import { chatCommand } from './commands/chat';
import { registerMissionCommands } from './commands/mission';
import { version } from '../package.json';

const program = new Command();

program
    .name('oddjob')
    .description('Oddjob CLI - Manage pipelines, jobs, and workflows from the command line')
    .version(version);

// Deploy command
program
    .command('deploy')
    .description('Deploy a pipeline from a YAML or JSON file')
    .argument('<file>', 'Path to pipeline definition file')
    .option('-o, --org <orgId>', 'Organization ID')
    .option('--dry-run', 'Validate without deploying')
    .action(deployCommand);

// Run command
program
    .command('run')
    .description('Execute a pipeline')
    .argument('<pipeline>', 'Pipeline ID or name')
    .option('-i, --input <json>', 'Input data as JSON string')
    .option('-f, --input-file <file>', 'Input data from file')
    .option('-w, --wait', 'Wait for execution to complete')
    .option('--timeout <seconds>', 'Timeout in seconds', '300')
    .action(runCommand);

// Chat command
program
    .command('chat')
    .description('Start an interactive conversational session with agents')
    .action(chatCommand);

// Logs command
program
    .command('logs')
    .description('View execution logs')
    .argument('<execution>', 'Execution ID')
    .option('-f, --follow', 'Follow log output')
    .option('-s, --step <stepId>', 'Show logs for specific step')
    .option('--json', 'Output as JSON')
    .action(logsCommand);

// Credentials command
program
    .command('creds')
    .description('Manage credentials')
    .addCommand(
        new Command('add')
            .description('Add a new credential')
            .argument('<name>', 'Credential name')
            .option('-t, --type <type>', 'Credential type')
            .option('-k, --key <key>', 'API key or secret')
            .option('--env <var>', 'Environment variable name')
    )
    .addCommand(
        new Command('list')
            .description('List all credentials')
            .option('-o, --org <orgId>', 'Filter by organization')
    )
    .addCommand(
        new Command('delete')
            .description('Delete a credential')
            .argument('<id>', 'Credential ID')
    );

// Config command
program
    .command('config')
    .description('Configure CLI settings')
    .addCommand(
        new Command('set')
            .description('Set a configuration value')
            .argument('<key>', 'Configuration key')
            .argument('<value>', 'Configuration value')
    )
    .addCommand(
        new Command('get')
            .description('Get a configuration value')
            .argument('<key>', 'Configuration key')
    )
    .addCommand(
        new Command('list')
            .description('List all configuration')
    );

// Mission command group (create/list/get/launch/pause/resume/cancel/status/…)
registerMissionCommands(program);

program.parse();
