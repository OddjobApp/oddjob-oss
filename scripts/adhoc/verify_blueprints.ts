import { blueprintRegistryService } from "../../server/domain/apps/blueprint-registry.service.js";

async function listBlueprints() {
    try {
        const blueprints = await blueprintRegistryService.listAll();
        console.log(JSON.stringify(blueprints, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

listBlueprints();
