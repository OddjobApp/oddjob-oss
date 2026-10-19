
import 'dotenv/config';
import { adminService } from "../../server/domain/admin/admin.service.js";

async function checkOrg() {
    try {
        const settings = await adminService.getOrgSettings(5);
        console.log("Org 5 Settings:", JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

checkOrg();
