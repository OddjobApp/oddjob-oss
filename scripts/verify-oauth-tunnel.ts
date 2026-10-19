async function main() {
    const { googleOAuthAdapter } = await import(
        "../server/domain/integrations/core/oauth/google-oauth.adapter.js"
    );
    const res = await googleOAuthAdapter.getAuthorizationUrl({
        organizationId: 291,
        projectId: 1,
        scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"],
        returnTo: "/crew/test",
        customRedirectUri:
            "https://bruce-hardware-requiring-inputs.trycloudflare.com/api/saas/connectors/google/oauth/callback",
    });
    const u = new URL(res.url);
    console.log("REDIRECT_URI:", decodeURIComponent(u.searchParams.get("redirect_uri") || ""));
    console.log("STATE:", res.stateId);
    console.log("SCOPE:", u.searchParams.get("scope"));

    const { redis } = await import(
        "../server/domain/core/infrastructure/redis/redis-client.js"
    );
    const raw = await redis.get(`oauth_state:google:${res.stateId}`).catch(() => null);
    console.log("STATE STORED:", raw ? "yes (redis)" : "no — in-memory fallback or redis down");
    process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
