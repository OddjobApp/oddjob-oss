async function triggerForge() {
    const apps = [
        {
            blueprint: 'spa',
            name: 'Test SPA App',
            slug: 'test-spa-app-' + Math.floor(Math.random() * 100000),
            description: 'A simple SPA for testing.'
        },
        {
            blueprint: 'analytics-dashboard',
            name: 'Test Analytics App',
            slug: 'test-analytics-app-' + Math.floor(Math.random() * 100000),
            description: 'A simple Analytics app for testing.'
        }
    ];

    for (const app of apps) {
        console.log(`Triggering forge for ${app.name}...`);
        try {
            const res = await fetch('http://localhost:3000/api/apps/forge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blueprintSlug: app.blueprint,
                    options: {
                        name: app.name,
                        slug: app.slug,
                        description: app.description,
                        organizationId: 1,
                        oddjobMissionId: 0
                    }
                })
            });
            const data = await res.json();
            console.log(`Response:`, data);
        } catch (err) {
            console.error(`Failed to trigger forge for ${app.name}:`, err.message);
        }
    }
}

triggerForge();
