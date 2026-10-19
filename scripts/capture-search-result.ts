
import "dotenv/config";
import { UNIFIED_SEARCH_TOOLS } from "../server/domain/tools/v1/capabilities/search";
import * as fs from 'fs';

const { search_unified_knowledge } = UNIFIED_SEARCH_TOOLS;

async function testSearch() {
    const context = {
        organizationId: null, // Global search
        userId: "admin",
        userRole: "super_admin"
    };

    const params = {
        query: "Head Uni Messaging",
        filter_source: "documentation",
        limit: 5
    };

    const result = await (search_unified_knowledge as any).execute(params, context);
    fs.writeFileSync('search_result_full.txt', result);
    console.log("Result saved to search_result_full.txt");
    process.exit(0);
}

testSearch();
