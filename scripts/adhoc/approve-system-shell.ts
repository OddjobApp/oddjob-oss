import { db } from '../../server/database_service.js';
import { approvalRequests } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';
import { decisionRouter } from '../../server/domain/governor/core/decision-router.js';

const SAFE_COMMANDS = new Set([
    'ps', 'uptime', 'whoami', 'pwd', 'date', 'hostname', 'uname',
    'free', 'df', 'top', 'netstat', 'ping', 'env', 'printenv', 'ls', 'lsof', 'wc',
]);
const SENSITIVE_PATH = /(?:\/etc\/|\/proc\/|\/sys\/|\/root\/|\/shadow|\/passwd|\.ssh)/i;

function isSafeDiagnosticCommand(command: string): boolean {
    if (command.includes('>') || command.includes('<')) return false;
    if (command.includes('$(') || command.includes('`')) return false;
    const segments = command.split(/[|&;]/);
    for (let segment of segments) {
        segment = segment.trim();
        if (!segment) continue;
        const parts = segment.split(/\s+/);
        if (!SAFE_COMMANDS.has(parts[0].toLowerCase())) return false;
        if (parts.slice(1).some(arg => SENSITIVE_PATH.test(arg))) return false;
    }
    return true;
}

async function approveSystemShells() {
    const pendings = await db.select().from(approvalRequests).where(eq(approvalRequests.status, 'pending'));
    console.log(`Found ${pendings.length} total pending requests.`);

    let approvedCount = 0;
    let skippedCount = 0;
    for (const p of pendings) {
        const modifiedOutput = p.modifiedOutput as any;
        if (!modifiedOutput || modifiedOutput.tool !== 'shell') continue;

        const command = modifiedOutput.params?.command ?? modifiedOutput.params?.CommandLine ?? modifiedOutput.params?.cmd;
        if (typeof command !== 'string' || !isSafeDiagnosticCommand(command)) {
            console.log(`Skipping request ID: ${p.id} — command not in safe-diagnostic list: ${String(command).slice(0, 80)}`);
            skippedCount++;
            continue;
        }

        console.log(`Approving request ID: ${p.id}, ExecutionID: ${p.executionId}, command: ${command}`);
        await db.update(approvalRequests)
            .set({
                status: 'approved',
                comments: 'Auto-approved safe diagnostic shell command',
                decisionAt: new Date()
            })
            .where(eq(approvalRequests.id, p.id));

        await decisionRouter.notifyDecision(p.id);
        approvedCount++;
    }
    console.log(`Approved: ${approvedCount}, Skipped (not safe-diagnostic): ${skippedCount}`);
}

approveSystemShells()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
