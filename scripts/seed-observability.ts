
import { db } from "../server/db/index.js";
import { aiUsageLogs, users } from "@shared/schema/index.js";
import { sql, eq } from 'drizzle-orm';

async function seedObservability() {
    console.log("🌱 Seeding sample observability data...");
    const orgId = 1;

    try {
        // 1. Get a valid user
        const [user] = await db.select().from(users).where(eq(users.username, 'admin2')).limit(1);
        if (!user) {
            console.error("❌ User 'admin2' not found! Cannot seed usage logs.");
            return;
        }

        // 2. Clear existing logs if any (optional)
        // await db.delete(aiUsageLogs).where(eq(aiUsageLogs.organizationId, orgId));

        // 3. Seed AI Usage Logs
        const models = [
            { model: 'gemini-2.0-flash', provider: 'google' },
            { model: 'gpt-4o', provider: 'openai' },
            { model: 'claude-3-5-sonnet', provider: 'anthropic' }
        ];

        const usageData = [];
        for (let i = 0; i < 50; i++) {
            const m = models[Math.floor(Math.random() * models.length)];
            const promptTokens = Math.floor(Math.random() * 2000) + 100;
            const completionTokens = Math.floor(Math.random() * 1000) + 50;

            usageData.push({
                organizationId: orgId,
                userId: user.id,
                model: m.model,
                provider: m.provider,
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
                costUsd: "0.01",
                createdAt: new Date(Date.now() - Math.random() * 86400000 * 7) // Last 7 days
            });
        }

        await db.insert(aiUsageLogs).values(usageData);
        console.log(`✅ Seeded 50 AI usage logs for user ${user.username} (${user.id}).`);

        // 2. Refresh KPI Views
        console.log("🔄 Refreshing KPI views...");
        await db.execute(sql`SELECT reporting.refresh_kpi_views()`);
        console.log("✅ KPI views refreshed.");

    } catch (e) {
        console.error("❌ Seeding Failed:", e);
    }
}

seedObservability().catch(console.error);
