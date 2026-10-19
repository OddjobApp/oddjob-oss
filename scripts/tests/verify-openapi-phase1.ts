import { apiRequest } from "../../client/src/lib/queryClient"; // Can't easily import client code in script runner? 
// Scripts usually run with tsx.
// I'll just use native fetch.

async function main() {
    const baseUrl = "http://127.0.0.1:5000";

    // 0. Login
    console.log("0. Logging in as super admin...");
    const loginRes = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin_openapi', password: 'password123' })
    });

    if (!loginRes.ok) {
        console.error("Login failed:", await loginRes.text());
        process.exit(1);
    }

    // Get cookie
    const cookie = loginRes.headers.get('set-cookie');
    if (!cookie) {
        console.error("No cookie returned!");
        process.exit(1);
    }

    // Get CSRF Token
    const userRes = await fetch(`${baseUrl}/api/user`, {
        headers: { 'Cookie': cookie }
    });
    const userData = await userRes.json();
    const csrfToken = userData.csrfToken;
    console.log("✅ Logged in. CSRF Token:", csrfToken);

    // Helper for requests
    const authHeaders = {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'x-csrf-token': csrfToken
    };

    console.log("1. Creating Spec...");
    const specPayload = {
        name: "Test JIRA API",
        description: "A test spec",
        content: {
            openapi: "3.0.0",
            info: { title: "Jira", version: "1.0" },
            paths: {}
        },
        status: "draft"
    };

    const createRes = await fetch(`${baseUrl}/api/admin/specs`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(specPayload)
    });

    if (!createRes.ok) {
        console.error("Failed to create spec:", await createRes.text());
        process.exit(1);
    }

    const spec = await createRes.json();
    console.log("✅ Created Spec ID:", spec.id);

    console.log("2. Listing Specs...");
    const listRes = await fetch(`${baseUrl}/api/admin/specs`, { headers: authHeaders });
    const specs = await listRes.json();
    console.log("✅ Specs found:", specs.length);

    // Get Valid Org
    const orgsRes = await fetch(`${baseUrl}/api/admin/organizations`, { headers: authHeaders });
    if (!orgsRes.ok) {
        console.error("Failed to list orgs:", await orgsRes.text());
        process.exit(1);
    }
    const orgsData = await orgsRes.json();
    const orgs = orgsData.organizations;

    if (!orgs || orgs.length === 0) {
        console.log("⚠️ No organizations found. Creating one...");
        // Try to create? Or just fail?
        // Super admin can usually create orgs.
        // Assuming /api/organizations POST exists?
        // For now, let's just log and see.
        console.error("No orgs to test with.");
        process.exit(1);
    }
    const testOrgId = orgs[0].id;
    console.log(`Using Org ID: ${testOrgId}`);

    console.log(`3. Publishing / Granting Access to Org ${testOrgId}...`);
    // Assuming Org exists.
    const accessRes = await fetch(`${baseUrl}/api/admin/specs/${spec.id}/access`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ orgIds: [testOrgId] })
    });

    if (!accessRes.ok) {
        console.error("Failed to grant access:", await accessRes.text());
    } else {
        console.log("✅ Access granted.");
    }

    // Update status to published so it shows up
    await fetch(`${baseUrl}/api/admin/specs/${spec.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ status: 'published' })
    });
    console.log("✅ Spec published.");

    console.log(`4. Checking Org Availability for Org ${testOrgId}...`);
    const orgRes = await fetch(`${baseUrl}/api/orgs/${testOrgId}/available-specs`, { headers: authHeaders });
    const available = await orgRes.json();
    console.log("✅ Available Specs for Org 1:", available.map((s: any) => s.name));

    if (available.find((s: any) => s.id === spec.id)) {
        console.log("🎉 SUCCESS: Spec is available to Org!");
    } else {
        console.error("❌ FAILURE: Spec not found in org list.");
        process.exit(1);
    }
}

main().catch(console.error);
