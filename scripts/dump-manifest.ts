
import { db } from "../server/db/index.js";
import { agentDeployments } from "../shared/schema/index";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Dumping form manifest for agent-9...");
    const deployment = await db.query.agentDeployments.findFirst({
        where: eq(agentDeployments.slug, "agent-9")
    });

    if (!deployment) {
        console.log("Agent deployment not found");
        process.exit(1);
    }

    console.log(JSON.stringify(deployment.formManifest, null, 2));
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
