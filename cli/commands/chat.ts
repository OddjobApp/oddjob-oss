import readline from 'readline';
import { apiClient } from '../utils/api-client';
import chalk from 'chalk';

export async function chatCommand() {
    console.log(chalk.bold.cyan("\n=== Oddjob Interactive Agent Chat Shell ==="));
    console.log(chalk.gray("Type your goal or request below. Type 'exit' to quit.\n"));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const promptUser = () => {
        rl.question(chalk.green('oddjob-chat> '), async (input) => {
            const cleanInput = input.trim();
            if (cleanInput.toLowerCase() === 'exit') {
                rl.close();
                process.exit(0);
            }

            if (!cleanInput) {
                promptUser();
                return;
            }

            try {
                console.log(chalk.blue('⏳ Architecting mission plan...'));
                const plan = await apiClient.planMission(cleanInput);

                console.log(chalk.green('\n📋 Planned Mission Details:'));
                console.log(chalk.white(`   Name:      ${plan.name}`));
                console.log(chalk.white(`   Objective: ${plan.objective}`));
                console.log(chalk.white(`   Strategy:  ${plan.executionStrategy}`));
                
                // Create the mission
                console.log(chalk.blue('\n🚀 Instantiating workgroup...'));
                const mission = await apiClient.createMission({
                    name: plan.name,
                    objective: plan.objective,
                    executionStrategy: plan.executionStrategy,
                    members: plan.members
                });

                console.log(chalk.green(`✅ Workgroup created successfully (ID: ${mission.id})`));
                
                // Launch the mission
                console.log(chalk.blue('⚡ Launching mission agents...'));
                const runResult = await apiClient.launchMission(mission.id);
                const runId = runResult.missionRunId || runResult.executionId;
                
                console.log(chalk.green(`🚀 Mission launched! Run ID: ${runId}\n`));
                console.log(chalk.cyan('=== Live Agent Output ==='));

                // Enter polling loop for logs and approvals
                await runPollingLoop(mission.id, runId, rl);

            } catch (err: any) {
                console.error(chalk.red('\n❌ Error:'), err.message);
                promptUser();
            }
        });
    };

    promptUser();
}

async function runPollingLoop(missionId: number, runId: any, rl: readline.Interface) {
    const seenEventIds = new Set<string>();
    let isComplete = false;

    while (!isComplete) {
        try {
            const activity = await apiClient.getMissionActivity(missionId);
            // Sort by timestamp ascending
            const sortedEvents = [...activity].sort((a: any, b: any) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            for (const event of sortedEvents) {
                const eventId = event.id || `${event.timestamp}-${event.message}`;
                if (seenEventIds.has(eventId)) continue;
                seenEventIds.add(eventId);

                // Print event based on type
                if (event.type === 'error') {
                    console.log(chalk.red(`[ERROR] ${event.message}`));
                } else if (event.type === 'mission_completed') {
                    console.log(chalk.green.bold(`\n🎉 ${event.message}`));
                    isComplete = true;
                } else if (event.type === 'decision') {
                    console.log(chalk.yellow(`[DECISION] ${event.message}`));
                } else if (event.type === 'knowledge') {
                    console.log(chalk.magenta(`[KNOWLEDGE] ${event.message}`));
                } else {
                    console.log(chalk.gray(`[AGENT] ${event.message}`));
                }

                // If details has content/thoughts, print it
                if (event.details?.content) {
                    console.log(chalk.white(`        ${event.details.content}`));
                }
            }

            // Check if run status requires human approval
            if (!isComplete) {
                const pendingData = await apiClient.getPendingDecision(runId.toString());
                if (pendingData && pendingData.pending) {
                    const proposal = pendingData.pending;
                    console.log(chalk.yellow.bold(`\n⚠️  APPROVAL REQUIRED`));
                    console.log(chalk.white(`   Tool:   ${proposal.toolName || proposal.action}`));
                    console.log(chalk.white(`   Args:   ${JSON.stringify(proposal.toolArgs || proposal.params, null, 2)}`));

                    const approval: boolean = await new Promise((resolve) => {
                        rl.question(chalk.yellow('Approve execution? (y/n): '), (ans) => {
                            resolve(ans.trim().toLowerCase() === 'y');
                        });
                    });

                    console.log(chalk.blue(`Sending decision...`));
                    await apiClient.submitDecision(
                        runId.toString(),
                        approval,
                        approval ? "Approved via CLI" : "Rejected via CLI",
                        proposal.proposalId || proposal.id?.toString()
                    );
                    console.log(chalk.green(`Decision submitted successfully! Resuming agent...\n`));
                }
            }

        } catch (pollErr: any) {
            console.error(chalk.red(`[Poll Error] ${pollErr.message}`));
        }

        if (!isComplete) {
            await new Promise(resolve => setTimeout(resolve, 2500));
        }
    }

    console.log(chalk.cyan('\n=== Live Agent Session Completed ===\n'));
    // Restart prompt loop
    chatCommand();
}
