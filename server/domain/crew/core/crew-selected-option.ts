/** Carry a user's menu selection into both generation and tool execution. */
export function resolveSelectedOption(message: string, turns: Array<{ speakerType: string; content: string }>): string {
    const token = message.trim().match(/^([1-9a-cA-C])\.?$/)?.[1].toUpperCase();
    if (!token) return message;
    const lastAgent = [...turns].reverse().find(turn => turn.speakerType === 'agent');
    if (!lastAgent) return message;
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:Option\\s*)?${token}[.):]\\s+(.+?)(?=\\n\\s*(?:Option\\s*)?[1-9A-Ca-c][.):]\\s|$)`, 'si');
    const option = lastAgent.content.match(pattern)?.[1].trim().slice(0, 300);
    return option ? `${message} (Option ${token}: ${option})` : message;
}
