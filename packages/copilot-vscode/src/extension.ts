import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

// ── Configuration ───────────────────────────────────────────────────────────

interface OddjobConfig {
    apiEndpoint: string;
    apiKey: string;
    organizationId: string;
}

function getConfig(): OddjobConfig {
    const cfg = vscode.workspace.getConfiguration('oddjob');
    return {
        apiEndpoint: (cfg.get<string>('apiEndpoint') || 'http://localhost:5000').replace(/\/+$/, ''),
        apiKey: cfg.get<string>('apiKey') || '',
        organizationId: cfg.get<string>('organizationId') || '',
    };
}

/**
 * Centralized, authenticated HTTP client. Adds the x-api-key header and ?orgId
 * from settings, parses JSON, and throws a descriptive Error on network failure
 * or non-2xx status so callers can surface it to the user instead of swallowing it.
 */
function apiFetch<T = any>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
    const { apiEndpoint, apiKey, organizationId } = getConfig();
    const url = new URL(path.startsWith('http') ? path : `${apiEndpoint}${path}`);
    if (organizationId && !url.searchParams.has('orgId')) {
        url.searchParams.set('orgId', organizationId);
    }

    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));
    if (apiKey) headers['x-api-key'] = apiKey;

    const transport = url.protocol === 'https:' ? https : http;

    return new Promise<T>((resolve, reject) => {
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers,
                timeout: 30000,
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => (raw += chunk));
                res.on('end', () => {
                    const status = res.statusCode || 0;
                    if (status < 200 || status >= 300) {
                        let msg = `HTTP ${status}`;
                        if (status === 401 || status === 403) {
                            msg = `Not authorized (HTTP ${status}). Set "oddjob.apiKey" in Settings.`;
                        } else {
                            try { msg = JSON.parse(raw)?.error || msg; } catch { /* keep default */ }
                        }
                        return reject(new Error(msg));
                    }
                    try {
                        resolve(raw ? JSON.parse(raw) : (undefined as any));
                    } catch {
                        resolve(raw as any);
                    }
                });
            }
        );
        req.on('error', (e) => reject(new Error(`Cannot reach ${url.origin}: ${e.message}`)));
        req.on('timeout', () => req.destroy(new Error(`Request to ${url.origin} timed out`)));
        if (payload) req.write(payload);
        req.end();
    });
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Oddjob Co-pilot extension activated!');

    // Register Webview Sidebar Provider
    const provider = new OddjobSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('oddjob.sidebar', provider)
    );

    // Trigger a new cycle from an input box.
    context.subscriptions.push(
        vscode.commands.registerCommand('oddjob.triggerCycle', async () => {
            const goal = await vscode.window.showInputBox({
                prompt: 'Enter the goal for your Oddjob agent cycle',
                placeHolder: 'e.g., Run regression tests and clean up unused database records',
            });
            if (!goal) return;
            try {
                vscode.window.showInformationMessage(`Initiating Oddjob Cycle: "${goal}"`);
                await triggerBackendCycle(goal);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Oddjob: failed to start cycle — ${e.message}`);
            }
        })
    );

    // Reveal the Oddjob console (previously declared but unregistered → "command not found").
    context.subscriptions.push(
        vscode.commands.registerCommand('oddjob.viewStatus', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.oddjob-sidebar-container');
        })
    );

    // Open the console focused for steering the active agent.
    context.subscriptions.push(
        vscode.commands.registerCommand('oddjob.steerMission', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.oddjob-sidebar-container');
            vscode.window.showInformationMessage('Oddjob: use the Active Agent Console to steer or approve the running agent.');
        })
    );
}

class OddjobSidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        const post = (msg: any) => webviewView.webview.postMessage(msg);

        // Listen for messages from the Webview (e.g. action approvals, plan triggers)
        webviewView.webview.onDidReceiveMessage(async (data: any) => {
            switch (data.type) {
                case 'submitGoal':
                    try {
                        const mission = await triggerBackendCycle(data.goal);
                        post({ type: 'log', level: 'success', text: `[System] Mission #${mission.id} launched.` });
                    } catch (e: any) {
                        post({ type: 'log', level: 'error', text: `[Error] Cycle failed: ${e.message}` });
                        vscode.window.showErrorMessage(`Oddjob: ${e.message}`);
                    }
                    break;
                case 'submitDecision':
                    try {
                        await submitDecision(data.runId, data.approved, data.reason, data.proposalId);
                        post({ type: 'log', level: 'info', text: `[System] Decision submitted: ${data.approved ? 'approved' : 'rejected'}.` });
                    } catch (e: any) {
                        post({ type: 'log', level: 'error', text: `[Error] Decision failed: ${e.message}` });
                        vscode.window.showErrorMessage(`Oddjob: ${e.message}`);
                    }
                    break;
            }
        });
    }

    private _getHtmlForWebview() {
        // Config injected so the webview's polling targets the configured server with
        // auth, instead of a hardcoded localhost with no credentials. JSON is
        // <-escaped to avoid breaking out of the <script> block.
        const { apiEndpoint, apiKey, organizationId } = getConfig();
        const configJson = JSON.stringify({ endpoint: apiEndpoint, apiKey, orgId: organizationId }).replace(/</g, '\\u003c');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Oddjob Agent Console</title>
    <style>
        body {
            font-family: var(--vscode-font-family, sans-serif);
            padding: 10px;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-sideBar-background);
        }
        h2 {
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 5px;
        }
        .form-group {
            margin-bottom: 15px;
        }
        textarea {
            width: 100%;
            height: 60px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            box-sizing: border-box;
            resize: vertical;
        }
        button {
            width: 100%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .console {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            height: 250px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            padding: 8px;
            margin-top: 15px;
        }
        .log-entry {
            margin-bottom: 6px;
            line-height: 1.4;
        }
        .log-error { color: #f48771; }
        .log-success { color: #89d185; }
        .log-info { color: #3794ff; }
        .log-warn { color: #cca700; }
        .approval-card {
            background: rgba(204, 167, 0, 0.15);
            border-left: 3px solid #cca700;
            padding: 10px;
            border-radius: 4px;
            margin-top: 15px;
        }
        .btn-group {
            display: flex;
            gap: 10px;
            margin-top: 8px;
        }
        .btn-approve { background: #388e3c; color: white; }
        .btn-reject { background: #d32f2f; color: white; }
    </style>
</head>
<body>
    <h2>🚀 Agent Launcher</h2>
    <div class="form-group">
        <textarea id="goalInput" placeholder="Enter objective for new cycle..."></textarea>
        <button onclick="launchCycle()">Trigger Cycle</button>
    </div>

    <h2>💻 Active Run Logs <span id="connDot" title="Connection status" style="float:right;font-size:10px;color:#cca700;">● connecting…</span></h2>
    <div class="console" id="consoleLogs">
        <div class="log-entry log-info">[System] Standing by for agent cycles...</div>
    </div>

    <div id="approvalSection" style="display:none;" class="approval-card">
        <strong>⚠️ Verification/Approval Needed</strong>
        <div id="approvalDetails" style="font-size: 11px; margin-top: 5px;"></div>
        <div class="btn-group">
            <button class="btn-approve" onclick="submitDecision(true)">Approve</button>
            <button class="btn-reject" onclick="submitDecision(false)">Reject</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const ODDJOB_CONFIG = ${configJson};
        let activeRunId = null;
        let activeMissionId = null;
        let seenLogIds = new Set();

        function apiUrl(path) {
            var base = ODDJOB_CONFIG.endpoint || 'http://localhost:5000';
            var url = base + path;
            if (ODDJOB_CONFIG.orgId) { url += (url.indexOf('?') >= 0 ? '&' : '?') + 'orgId=' + encodeURIComponent(ODDJOB_CONFIG.orgId); }
            return url;
        }
        function authHeaders() {
            var h = {};
            if (ODDJOB_CONFIG.apiKey) { h['x-api-key'] = ODDJOB_CONFIG.apiKey; }
            return h;
        }
        async function apiGet(path) {
            var res = await fetch(apiUrl(path), { headers: authHeaders() });
            if (!res.ok) { throw new Error('HTTP ' + res.status); }
            return res.json();
        }

        function setConn(ok, label) {
            var dot = document.getElementById('connDot');
            dot.style.color = ok ? '#89d185' : '#f48771';
            dot.innerText = '● ' + label;
        }

        function launchCycle() {
            const goal = document.getElementById('goalInput').value.trim();
            if (goal) {
                document.getElementById('goalInput').value = '';
                addLog('[System] Initiating plan and creating workspace...', 'info');
                vscode.postMessage({ type: 'submitGoal', goal });
            }
        }

        function addLog(text, type) {
            const container = document.getElementById('consoleLogs');
            const entry = document.createElement('div');
            entry.className = 'log-entry log-' + (type || 'info');
            entry.innerText = text;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        // Host → webview messages (e.g. cycle launch / decision outcomes and errors).
        window.addEventListener('message', function(ev) {
            var msg = ev.data || {};
            if (msg.type === 'log') { addLog(msg.text, msg.level || 'info'); }
        });

        // Poll API for run logs and approvals. Errors now update the connection
        // indicator and log once, instead of being silently swallowed.
        var lastPollError = null;
        setInterval(async () => {
            try {
                if (!activeRunId) {
                    const data = await apiGet('/api/missions');
                    const activeRun = data.find(m => m.status === 'active' || m.status === 'paused' || m.status === 'waiting_on_human');
                    if (activeRun) {
                        activeRunId = activeRun.id;
                        activeMissionId = activeRun.missionId;
                        addLog('[System] Linked to active run: ' + activeRunId, 'info');
                    }
                    setConn(true, 'connected');
                    lastPollError = null;
                    return;
                }

                const activity = await apiGet('/api/missions/' + activeMissionId + '/activity');
                const sorted = activity.slice().sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                for (const event of sorted) {
                    const id = event.id || (event.timestamp + event.message);
                    if (seenLogIds.has(id)) continue;
                    seenLogIds.add(id);
                    let type = 'info';
                    if (event.type === 'error') type = 'error';
                    else if (event.type === 'mission_completed') type = 'success';
                    else if (event.type === 'decision') type = 'warn';
                    addLog(event.message, type);
                    if (event.details && event.details.content) { addLog('   ' + event.details.content, 'info'); }
                }

                const dec = await apiGet('/api/agent/' + activeRunId + '/decision');
                if (dec.pending) {
                    document.getElementById('approvalSection').style.display = 'block';
                    document.getElementById('approvalDetails').innerText =
                        'Tool: ' + dec.pending.toolName + '\\nArgs: ' + JSON.stringify(dec.pending.toolArgs);
                } else {
                    document.getElementById('approvalSection').style.display = 'none';
                }
                setConn(true, 'connected');
                lastPollError = null;
            } catch (e) {
                setConn(false, 'disconnected');
                if (lastPollError !== e.message) {
                    addLog('[Warn] Cannot reach server (' + e.message + '). Check oddjob.apiEndpoint / oddjob.apiKey.', 'warn');
                    lastPollError = e.message;
                }
            }
        }, 3000);

        function submitDecision(approved) {
            document.getElementById('approvalSection').style.display = 'none';
            vscode.postMessage({
                type: 'submitDecision',
                runId: activeRunId,
                approved,
                reason: approved ? 'Approved via VS Code Copilot' : 'Rejected via VS Code Copilot'
            });
        }
    </script>
</body>
</html>`;
    }
}

async function triggerBackendCycle(goal: string): Promise<any> {
    // 1. Plan → 2. instantiate mission → 3. launch. Errors propagate to the caller,
    // which surfaces them to the user (no more silent failures).
    const plan = await apiFetch('/api/missions/plan', { method: 'POST', body: { prompt: goal } });
    const mission = await apiFetch('/api/missions', {
        method: 'POST',
        body: {
            name: plan.name,
            objective: plan.objective,
            executionStrategy: plan.executionStrategy,
            members: plan.members,
        },
    });
    await apiFetch(`/api/missions/${mission.id}/launch-mission`, { method: 'POST' });
    return mission;
}

async function submitDecision(sessionId: string, approved: boolean, reason: string, proposalId?: string): Promise<any> {
    return apiFetch(`/api/agent/${sessionId}/decision`, {
        method: 'POST',
        body: { approved, reason, proposalId },
    });
}
