import { Command } from 'commander';
import fs from 'fs';
import chalk from 'chalk';
import { apiClient } from '../utils/api-client';

// Wraps a handler so every subcommand surfaces API errors consistently
// (mirrors the pattern in run.ts) instead of dumping an axios stack trace.
async function guard(fn: () => Promise<void>) {
    try {
        await fn();
    } catch (error: any) {
        console.error(chalk.red('❌ Error:'), error.message);
        if (error.response?.data) {
            console.error(chalk.gray(JSON.stringify(error.response.data, null, 2)));
        }
        process.exit(1);
    }
}

// Pad first (on the plain string, so width is correct), then colorize — the
// ANSI codes are zero-width so table columns stay aligned.
function colorStatus(status: string, width = 0): string {
    const s = String(status || 'unknown');
    const padded = width ? s.padEnd(width) : s;
    if (/active|running|complete|success|ready/i.test(s)) return chalk.green(padded);
    if (/fail|error|cancel|terminat|abort/i.test(s)) return chalk.red(padded);
    if (/paus|wait|pending|planning|debat|audit/i.test(s)) return chalk.yellow(padded);
    return chalk.gray(padded);
}

// Server list endpoints vary in envelope shape; normalize to an array.
function asList(data: any): any[] {
    if (Array.isArray(data)) return data;
    return data?.missions || data?.data || data?.items || [];
}

function idNum(id: string): number {
    const n = parseInt(id, 10);
    if (isNaN(n)) {
        console.error(chalk.red(`❌ Invalid mission id: ${id}`));
        process.exit(1);
    }
    return n;
}

async function listMissions(options: any) {
    await guard(async () => {
        const params: Record<string, any> = {};
        if (options.status) params.status = options.status;
        if (options.org) params.organizationId = Number(options.org);
        if (options.limit) params.limit = Number(options.limit);

        const missions = asList(await apiClient.getMissions(params));

        if (options.json) {
            console.log(JSON.stringify(missions, null, 2));
            return;
        }
        if (!missions.length) {
            console.log(chalk.gray('No missions found.'));
            return;
        }
        console.log(chalk.bold('\n  ID     STATUS        NAME'));
        console.log(chalk.gray('  ─────  ────────────  ───────────────────────────'));
        for (const m of missions) {
            const id = String(m.id ?? '?').padEnd(5);
            const status = colorStatus(m.status, 12);
            const name = m.name || m.title || m.objective || '';
            console.log(`  ${id}  ${status}  ${name}`);
        }
        console.log(chalk.gray(`\n  ${missions.length} mission(s)\n`));
    });
}

async function getMission(id: string, options: any) {
    await guard(async () => {
        const mission = await apiClient.getMission(idNum(id));
        if (options.json) {
            console.log(JSON.stringify(mission, null, 2));
            return;
        }
        console.log(chalk.bold(`\n  Mission #${mission.id}`));
        console.log(`  Name:    ${mission.name || mission.title || '(unnamed)'}`);
        console.log(`  Status:  ${colorStatus(mission.status)}`);
        if (mission.objective) console.log(`  Goal:    ${mission.objective}`);
        if (mission.organizationId != null) console.log(chalk.gray(`  Org:     ${mission.organizationId}`));
        if (mission.createdAt) console.log(chalk.gray(`  Created: ${mission.createdAt}`));
        console.log('');
    });
}

async function createMission(options: any) {
    await guard(async () => {
        let prompt = options.prompt;
        if (!prompt && options.file) {
            if (!fs.existsSync(options.file)) {
                console.error(chalk.red(`❌ File not found: ${options.file}`));
                process.exit(1);
            }
            prompt = fs.readFileSync(options.file, 'utf-8').trim();
        }
        if (!prompt) {
            console.error(chalk.red('❌ Provide --prompt <text> or --file <path>'));
            process.exit(1);
        }

        // --plan produces a plan without persisting a runnable mission.
        if (options.plan) {
            console.log(chalk.blue('🧭 Planning mission...'));
            const plan = await apiClient.planMission(prompt);
            console.log(JSON.stringify(plan, null, 2));
            return;
        }

        console.log(chalk.blue('✨ Creating mission...'));
        const mission = await apiClient.createMission({ prompt, ...(options.org ? { organizationId: Number(options.org) } : {}) });
        const id = mission.id ?? mission.missionId;
        console.log(chalk.green(`✅ Mission created`));
        console.log(chalk.gray(`   ID: ${id}`));

        if (options.launch && id != null) {
            console.log(chalk.blue('🚀 Launching...'));
            await apiClient.launchMission(Number(id));
            console.log(chalk.green('✅ Mission launched'));
        } else if (id != null) {
            console.log(chalk.gray(`\n💡 Launch it with: oddjob mission launch ${id}`));
        }
    });
}

async function launchMission(id: string) {
    await guard(async () => {
        await apiClient.launchMission(idNum(id));
        console.log(chalk.green(`✅ Mission ${id} launched`));
    });
}

async function pauseMission(id: string) {
    await guard(async () => {
        await apiClient.pauseMission(idNum(id));
        console.log(chalk.yellow(`⏸️  Mission ${id} paused`));
    });
}

async function resumeMission(id: string) {
    await guard(async () => {
        await apiClient.resumeMission(idNum(id));
        console.log(chalk.green(`▶️  Mission ${id} resumed`));
    });
}

async function cancelMission(id: string, options: any) {
    await guard(async () => {
        await apiClient.cancelMission(idNum(id), options.reason);
        console.log(chalk.red(`🛑 Mission ${id} cancelled`));
    });
}

async function missionStatus(id: string, options: any) {
    await guard(async () => {
        const status = await apiClient.getMissionStatus(idNum(id));
        if (options.json) {
            console.log(JSON.stringify(status, null, 2));
            return;
        }
        const s = status.status || status.state || status.health || 'unknown';
        console.log(`  Mission ${id}: ${colorStatus(s)}`);
        if (status.phase) console.log(chalk.gray(`  Phase: ${status.phase}`));
        if (status.progress != null) console.log(chalk.gray(`  Progress: ${status.progress}`));
    });
}

async function missionActivity(id: string, options: any) {
    await guard(async () => {
        const activity = await apiClient.getMissionActivity(idNum(id));
        console.log(JSON.stringify(activity, null, 2));
        void options;
    });
}

async function missionHistory(id: string, options: any) {
    await guard(async () => {
        const history = await apiClient.getMissionHistory(idNum(id));
        console.log(JSON.stringify(history, null, 2));
        void options;
    });
}

// Assembles the `oddjob mission` command group and attaches it to the program.
export function registerMissionCommands(program: Command): void {
    const mission = new Command('mission').description('Create, control, and inspect missions');

    mission
        .command('list')
        .description('List missions')
        .option('-s, --status <status>', 'Filter by status')
        .option('-o, --org <orgId>', 'Filter by organization')
        .option('-l, --limit <n>', 'Max results')
        .option('--json', 'Output as JSON')
        .action(listMissions);

    mission
        .command('get')
        .description('Show a mission')
        .argument('<id>', 'Mission ID')
        .option('--json', 'Output as JSON')
        .action(getMission);

    mission
        .command('create')
        .description('Create a mission from a prompt')
        .option('-p, --prompt <text>', 'Mission prompt')
        .option('-f, --file <path>', 'Read prompt from a file')
        .option('-o, --org <orgId>', 'Organization ID')
        .option('--plan', 'Plan only — do not create a runnable mission')
        .option('--launch', 'Launch immediately after creating')
        .action(createMission);

    mission
        .command('launch')
        .description('Launch a mission')
        .argument('<id>', 'Mission ID')
        .action(launchMission);

    mission
        .command('pause')
        .description('Pause a running mission')
        .argument('<id>', 'Mission ID')
        .action(pauseMission);

    mission
        .command('resume')
        .description('Resume a paused mission')
        .argument('<id>', 'Mission ID')
        .action(resumeMission);

    mission
        .command('cancel')
        .description('Cancel (terminate) a mission')
        .argument('<id>', 'Mission ID')
        .option('-r, --reason <text>', 'Reason for cancellation')
        .action(cancelMission);

    mission
        .command('status')
        .description('Show a mission’s current status')
        .argument('<id>', 'Mission ID')
        .option('--json', 'Output as JSON')
        .action(missionStatus);

    mission
        .command('activity')
        .description('Show a mission’s activity feed')
        .argument('<id>', 'Mission ID')
        .option('--json', 'Output as JSON')
        .action(missionActivity);

    mission
        .command('history')
        .description('Show a mission’s run history')
        .argument('<id>', 'Mission ID')
        .option('--json', 'Output as JSON')
        .action(missionHistory);

    program.addCommand(mission);
}
