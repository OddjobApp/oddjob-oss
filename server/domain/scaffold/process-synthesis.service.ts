import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ProcessSynthesis");

/**
 * A process graph becomes an assembly draft.
 *
 * The mapping is close to one-to-one because BPMN's primitives and Oddjob's
 * assembly primitives describe the same things: work in an order, with branches,
 * over some data. What makes this a synthesis rather than a rename is the
 * ORDER — steps are laid out by walking the sequence flows, which is precisely
 * what the old parser threw away when it collected only task names.
 *
 * Provenance is carried through untouched. A graph read from a picture is an
 * inference, and the draft says so, because a misread arrow becomes a wrong
 * branch in a deployed application.
 */

export interface ProcessGraphInput {
    processId?: string | null;
    processName?: string | null;
    tasks?: Array<{ id: string; name?: string | null; kind?: string; lane?: string | null }>;
    gateways?: Array<{ id: string; name?: string | null; kind?: string; default?: string | null }>;
    flows?: Array<{ id: string; from: string; to: string; name?: string | null; condition?: string | null }>;
    dataObjects?: Array<{ id: string; name?: string | null }>;
    lanes?: Array<{ id: string; name?: string | null }>;
    events?: Array<{ id: string; name?: string | null; kind?: string }>;
    entryPoints?: string[];
    danglingFlows?: Array<{ id: string; from: string; to: string }>;
    provenance?: "parsed" | "inferred";
    uncertainties?: string[];
}

export interface AssemblyDraft {
    appName: string;
    displayName: string;
    uiFields: Array<{ name: string; label: string; type: string; source: string }>;
    steps: Array<{
        name: string;
        type: string;
        agent?: string | null;
        celCondition?: string | null;
        sourceId: string;
    }>;
    datasetFields: Array<{ name: string; type: string; label: string }>;
    tableName: string;
    provenance: "parsed" | "inferred";
    /**
     * Everything the draft could NOT determine. Surfaced rather than silently
     * completed — a reported gap is worth more than an invented step.
     */
    warnings: string[];
}

/**
 * Human work becomes input; automated work becomes a pipeline step.
 *
 * A userTask is someone supplying information, so it contributes a form field
 * rather than a step the pipeline runs unattended.
 */
const HUMAN_TASK_KINDS = new Set(["userTask", "manualTask"]);

/** BPMN task kinds mapped onto the job types the pipeline actually has. */
const JOB_TYPE_BY_KIND: Record<string, string> = {
    serviceTask: "action_dispatch",
    sendTask: "action_dispatch",
    scriptTask: "transform",
    businessRuleTask: "ai_inference",
    receiveTask: "data_extract",
    callActivity: "action_dispatch",
    subProcess: "transform",
    task: "transform",
};

/** DNS- and directory-safe, because the app name becomes both. */
function toAppName(value: string): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return slug || "process-app";
}

function toFieldName(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "field";
}

export const processSynthesisService = {
    /**
     * Orders the graph's work and shapes it as an assembly draft.
     */
    synthesize(graph: ProcessGraphInput): AssemblyDraft {
        const warnings: string[] = [...(graph.uncertainties ?? [])];
        const tasks = graph.tasks ?? [];
        const flows = graph.flows ?? [];
        const gateways = graph.gateways ?? [];
        const gatewayIds = new Set(gateways.map((g) => g.id));

        if ((graph.danglingFlows ?? []).length > 0) {
            // Reported, never repaired. Inferring the missing nodes would build a
            // process the author never drew.
            warnings.push(
                `${graph.danglingFlows!.length} flow(s) point at a node that is not in this process; ` +
                `the diagram is incomplete and those paths were not built.`,
            );
        }

        const ordered = this.orderNodes(graph, warnings);

        const humanTasks = tasks.filter((t) => HUMAN_TASK_KINDS.has(t.kind ?? ""));
        const automatedTasks = ordered
            .map((id) => tasks.find((t) => t.id === id))
            .filter((t): t is NonNullable<typeof t> => !!t && !HUMAN_TASK_KINDS.has(t.kind ?? ""));

        // A step inherits the condition on the flow that REACHES it. That is
        // where BPMN puts a branch's rule, and it is what makes the generated
        // step conditional rather than unconditional.
        const conditionInto = new Map<string, string>();
        for (const flow of flows) {
            if (!flow.condition) continue;
            // Only conditions leaving a gateway are branch rules; a condition on
            // a plain sequence flow is unusual but still meaningful.
            conditionInto.set(flow.to, flow.condition);
        }

        const steps = automatedTasks.map((task) => ({
            name: task.name || task.id,
            type: JOB_TYPE_BY_KIND[task.kind ?? ""] ?? "transform",
            agent: task.lane ?? null,
            celCondition: conditionInto.get(task.id) ?? null,
            sourceId: task.id,
        }));

        const uiFields = humanTasks.map((task) => ({
            name: toFieldName(task.name || task.id),
            label: task.name || task.id,
            type: "text",
            source: task.id,
        }));

        const datasetFields = (graph.dataObjects ?? []).map((data) => ({
            name: toFieldName(data.name || data.id),
            type: "text",
            label: data.name || data.id,
        }));

        if (steps.length === 0) {
            warnings.push(
                "No automated tasks were found, so the pipeline is empty. The process may be entirely manual.",
            );
        }
        if (datasetFields.length === 0) {
            // Honest rather than invented: guessing a schema from task names is
            // how a draft acquires columns nobody asked for.
            warnings.push(
                "The process declares no data objects, so no dataset schema could be derived from it.",
            );
        }
        for (const gateway of gateways) {
            const outgoing = flows.filter((f) => f.from === gateway.id);
            const unconditioned = outgoing.filter((f) => !f.condition && f.id !== gateway.default);
            if (outgoing.length > 1 && unconditioned.length > 0) {
                warnings.push(
                    `Gateway "${gateway.name || gateway.id}" has ${unconditioned.length} outgoing path(s) with no condition, ` +
                    `so the branch cannot be fully expressed as a rule.`,
                );
            }
        }

        const displayName = graph.processName || "Process App";
        const draft: AssemblyDraft = {
            appName: toAppName(displayName),
            displayName,
            uiFields,
            steps,
            datasetFields,
            tableName: `${toFieldName(displayName)}_records`,
            provenance: graph.provenance ?? "parsed",
            warnings,
        };

        logger.info(
            `Synthesised "${draft.displayName}": ${steps.length} steps, ${uiFields.length} inputs, ` +
            `${datasetFields.length} dataset fields, ${warnings.length} warning(s), provenance ${draft.provenance}`,
        );
        return draft;
    },

    /**
     * Node ids in execution order, following the sequence flows.
     *
     * Kahn's algorithm, with two deliberate concessions to real diagrams: a
     * cycle (a rework loop is normal BPMN) does not abort the ordering, and any
     * node the traversal never reaches is still appended rather than dropped —
     * losing a task silently would be worse than ordering it imperfectly.
     */
    orderNodes(graph: ProcessGraphInput, warnings: string[]): string[] {
        const nodeIds = [
            ...(graph.tasks ?? []).map((t) => t.id),
            ...(graph.gateways ?? []).map((g) => g.id),
            ...(graph.events ?? []).map((e) => e.id),
        ].filter(Boolean);
        const known = new Set(nodeIds);

        const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
        const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
        for (const flow of graph.flows ?? []) {
            if (!known.has(flow.from) || !known.has(flow.to)) continue;
            outgoing.get(flow.from)!.push(flow.to);
            inDegree.set(flow.to, (inDegree.get(flow.to) ?? 0) + 1);
        }

        const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
        const ordered: string[] = [];
        const seen = new Set<string>();

        while (queue.length > 0) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            ordered.push(id);
            for (const next of outgoing.get(id) ?? []) {
                inDegree.set(next, (inDegree.get(next) ?? 1) - 1);
                if ((inDegree.get(next) ?? 0) <= 0 && !seen.has(next)) queue.push(next);
            }
        }

        const unreached = nodeIds.filter((id) => !seen.has(id));
        if (unreached.length > 0) {
            // A loop, or a disconnected fragment. Both are real in drawn
            // processes; neither justifies discarding the work.
            warnings.push(
                `${unreached.length} node(s) could not be placed in a strict order — the process contains a loop ` +
                `or a disconnected branch. They were appended in declaration order.`,
            );
            ordered.push(...unreached);
        }

        return ordered;
    },
};
