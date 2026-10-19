/**
 * Task Classifier for LLM Router
 * Heuristics to classify task complexity and domain
 */

export interface TaskClassification {
    isCoding: boolean;
    isResearch: boolean;
    isCreative: boolean;
    isComplex: boolean;
}

export function classifyTask(messages: Array<{ role: string; content: string }>): TaskClassification {
    const fullText = messages.map(m => m.content).join(" ");
    
    // Improved Task Classification Heuristics
    const isCoding = /def |function|class |import |const |let |var |sql|typescript|javascript|python/i.test(fullText);
    const isResearch = /search|find|lookup|query|browse|investigate|research/i.test(fullText);
    const isCreative = /write a poem|story|creative|generate ideas|brainstorm/i.test(fullText);
    const isComplex = fullText.length > 2000 || 
                      /complex|analyze|reason|plan|architecture|optimize|diagnose|remediate/i.test(fullText);
                      
    return { isCoding, isResearch, isCreative, isComplex };
}
