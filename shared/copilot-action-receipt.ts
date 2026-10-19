export interface CopilotToolReceipt {
    tool: string;
    status: 'succeeded' | 'failed' | 'blocked' | 'simulated' | 'unverified';
    verified: boolean;
    href?: string;
}
export interface CopilotActionReceipt {
    status: 'completed' | 'partial' | 'failed' | 'unverified';
    tools: CopilotToolReceipt[];
    timestamp: number;
}
export function safeReceiptHref(value: unknown): string | undefined {
    return typeof value === 'string' && /^\/(?!\/)[^\\\s]*$/.test(value) ? value : undefined;
}
/** Only explicit tool results establish success; prose and the selected mode do not. */
export function toolReceipt(tool: string, observation: unknown, verification?: boolean): CopilotToolReceipt {
    let value: any = observation;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Plain output stays unverified. */ } }
    const text = typeof observation === 'string' ? observation : '';
    const status: CopilotToolReceipt['status'] = /\[Simulation Mode\]/i.test(text) ? 'simulated'
        : /^(Human denied|Error:.*(?:requires approval|denied|blocked))/i.test(text) ? 'blocked'
        : verification === false || /^Error[: ]/i.test(text) || value?.success === false || value?.error || value?.status === 'failed' ? 'failed'
        : verification === true || value?.success === true || value?.status === 'success' || value?.status === 'completed' ? 'succeeded'
        : 'unverified';
    return { tool, status, verified: verification === true, href: safeReceiptHref(value?.href ?? value?.url) };
}
export function actionReceipt(tools: CopilotToolReceipt[], failed = false): CopilotActionReceipt {
    const successes = tools.filter(tool => tool.status === 'succeeded').length;
    const failures = tools.some(tool => tool.status === 'failed' || tool.status === 'blocked');
    return {
        status: failed || failures ? successes ? 'partial' : 'failed'
            : tools.length > 0 && successes === tools.length ? 'completed' : 'unverified',
        tools, timestamp: Date.now(),
    };
}
