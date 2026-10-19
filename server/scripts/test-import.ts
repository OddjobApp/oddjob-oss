
import { pendingDecisions } from "@server/routes/agent-decision.js";

console.log("Imported pendingDecisions:", pendingDecisions);

import { MoltProducer } from "@domain/governor/core/molt-producer.js";
console.log("Imported MoltProducer");

import { runAgentLoop } from "@domain/agents/agent-runner.js";
console.log("Imported runAgentLoop");

