
import { spawn } from 'child_process';

const child = spawn('npx', ['drizzle-kit', 'push', '--config', 'drizzle.config.ts'], {
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);

    // Check for common prompts and send 'Enter' or 'Down + Enter'
    if (output.includes('Is mission_suggestions table created')) {
        child.stdin.write('\n');
    }
    if (output.includes('Is mcp_servers table created')) {
        child.stdin.write('\n');
    }
    // ... many others

    // For the data-loss prompt
    if (output.includes('Do you want to truncate apps table')) {
        child.stdin.write('\x1b[B\n'); // Down + Enter? Or just 'y'?
    }

    // If it's a "Yes/No" toggle with arrows, \x1b[B should move down.
    // But many CLIs also accept 'y' or similar.

    if (output.includes('You\'re about to delete workgroups table')) {
        child.stdin.write('y\n');
    }
});

child.stderr.on('data', (data) => {
    console.error(data.toString());
});

child.on('close', (code) => {
    console.log(`Child process exited with code ${code}`);
});
