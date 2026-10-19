/**
 * Helper to identify ordinal sequence names
 */
export const idxToOrd = (i: number): string => {
    const ords = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
    return ords[i] || `Sequence ${i + 1}`;
};

/**
 * Helper to format deliverable content intelligently for both standard and pre-planned missions
 */
export const formatDeliverable = (content: any): string | null => {
    if (!content) return null;
    
    // If it's already a string, try to parse it if it looks like JSON
    let parsed = content;
    if (typeof content === 'string' && (content.trim().startsWith('{') || content.trim().startsWith('['))) {
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            // Not valid JSON, keep as string
            return content;
        }
    }

    // If it's an object, try to extract recognized keys
    if (typeof parsed === 'object' && parsed !== null) {
        // PRIORITY 1: Direct response content
        if (parsed.result && typeof parsed.result === 'string') return parsed.result;
        if (parsed.output && typeof parsed.output === 'string') return parsed.output;
        if (parsed.deliverable && typeof parsed.deliverable === 'string') return parsed.deliverable;
        if (parsed.response && typeof parsed.response === 'string') return parsed.response;
        
        // PRIORITY 2: Intelligent Task Output Extraction (Search for the "Detailed Document")
        const tasks = parsed.tasks || parsed.mission_tasks || (parsed.plan?.tasks);
        if (Array.isArray(tasks)) {
            // Look for tasks that likely contain the main deliverable
            // Criteria: Success status + substantial result + matching keywords
            const highValueKeywords = ["report", "analysis", "specification", "document", "summari", "research", "paper", "plan", "deliverable"];
            
            let bestTask = null;
            let maxResultLength = 0;

            for (const task of tasks) {
                const result = task.result || (task.output && typeof task.output === 'string' ? task.output : (task.output?.result));
                if (result && typeof result === 'string') {
                    const name = (task.name || task.title || "").toLowerCase();
                    const isHighValue = highValueKeywords.some(kw => name.includes(kw));
                    
                    if (isHighValue || result.length > maxResultLength) {
                        bestTask = task;
                        maxResultLength = result.length;
                    }
                }
            }

            if (bestTask) {
                const result = bestTask.result || (bestTask.output && typeof bestTask.output === 'string' ? bestTask.output : (bestTask.output?.result));
                if (result && typeof result === 'string') return result;
            }

            // Fallback to Plan Summary if no single high-value output found
            const intent = parsed.intent || parsed.mission_intent || parsed.plan?.intent;
            let summary = intent ? `## Strategic Intent: ${intent}\n\n` : "";
            tasks.forEach((t: any, i: number) => {
                summary += `### Phase ${idxToOrd(i)}: ${t.name || t.title}\n`;
                summary += `**Status**: ${t.status || 'pending'} ${t.assignedAgent ? `(Assigned: ${t.assignedAgent})` : ''}\n\n`;
                summary += `${t.description || t.summary || ''}\n\n`;
            });
            return summary;
        }

        // Fallback: pretty print JSON
        return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    }

    return String(content);
};
