
console.log("1. Importing dotenv");
import "dotenv/config";

console.log("2. Importing runAgentLoop");
import { runAgentLoop } from "@domain/agents/agent-runner.js";

console.log("3. Importing db");
import { db } from "@server/database_service.js";

console.log("4. Importing schema");
import * as schema from "@shared/schema/index.js";
console.log("Schema keys:", Object.keys(schema));

console.log("5. Importing pendingDecisions");
import { pendingDecisions } from "@server/routes/agent-decision.js";

console.log("6. Importing MoltProducer");
import { MoltProducer } from "@domain/governor/index.js";

console.log("7. Importing GoogleClient");
import { GoogleClient } from "@domain/ai/core/providers/google-client.js";
console.log("Instantiating GoogleClient");
const client = new GoogleClient();
console.log("Client instantiated");

console.log("All imports successful");

