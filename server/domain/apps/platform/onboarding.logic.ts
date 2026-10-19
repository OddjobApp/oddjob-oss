/**
 * Onboarding Scaffold — pure logic (Act IV, the Onboarding Scaffold).
 *
 * When a deal is moved to CLOSED_WON, the workbench hands it to Oddjob's onboarding
 * factory ("The Forge"): a grounded onboarding PACKET (account, primary contact,
 * signed terms) plus the PROVISIONING STAGES that spin up the client's isolated
 * environment. DB/AI-free so it unit-tests in isolation and never fabricates —
 * every field comes from the won deal's own rows.
 */

export interface OnboardingPacket {
    opportunity_id: string;
    deal_name: string;
    account: {
        account_id: string;
        name: string;
        domain: string | null;
        industry: string | null;
        segment: string | null;
        owner_rep: string | null;
    };
    primary_contact: {
        name: string | null;
        email: string | null;
    };
    terms: {
        amount: number;
        currency: string;
        stage: string;
        closed_at: string | null;
    };
}

export type StageStatus = "pending" | "provisioning" | "done";
export interface ProvisioningStage {
    key: string;
    name: string;
    status: StageStatus;
}

export function buildOnboardingPacket(
    opp: Record<string, any>,
    account: Record<string, any> | null,
    lead: Record<string, any> | null,
): OnboardingPacket {
    return {
        opportunity_id: String(opp.opportunity_id ?? ""),
        deal_name: String(opp.name ?? opp.opportunity_id ?? "Won opportunity"),
        account: {
            account_id: String(opp.account_id ?? account?.account_id ?? ""),
            name: String(account?.name ?? opp.account_id ?? "Client account"),
            domain: account?.domain ? String(account.domain) : null,
            industry: account?.industry ? String(account.industry) : null,
            segment: account?.segment ? String(account.segment) : null,
            owner_rep: opp.owner_rep ? String(opp.owner_rep) : account?.owner_rep ? String(account.owner_rep) : null,
        },
        primary_contact: {
            name: lead?.name ? String(lead.name) : null,
            email: lead?.email ? String(lead.email) : null,
        },
        terms: {
            amount: Number(opp.amount) || 0,
            currency: String(opp.currency ?? "USD"),
            stage: String(opp.stage ?? "CLOSED_WON"),
            closed_at: opp.closed_at ? String(opp.closed_at) : null,
        },
    };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * The provisioning checklist. A leading Forge stage represents the isolated-
 * environment scaffold; the remaining stages mirror the follow-up cycle's own
 * blueprints (from the cycle.yaml) so the workbench never re-declares them.
 */
export function provisioningStages(followUpBlueprintNames: string[]): ProvisioningStage[] {
    const forge: ProvisioningStage = {
        key: "forge_scaffold",
        name: "Provision isolated environment (The Forge)",
        status: "provisioning",
    };
    const rest: ProvisioningStage[] = (followUpBlueprintNames.length ? followUpBlueprintNames : ["Onboarding Kickoff"]).map(
        (name) => ({ key: slug(name) || "stage", name, status: "pending" as StageStatus }),
    );
    return [forge, ...rest];
}

/**
 * Once the onboarding cycle is handed off, complete the Forge scaffold stage and
 * advance the first remaining stage to `provisioning` (the onboarding cycle now
 * owns it, pending its human approval gate).
 */
export function markHandedOff(stages: ProvisioningStage[]): ProvisioningStage[] {
    const firstPendingIdx = stages.findIndex((s) => s.key !== "forge_scaffold" && s.status === "pending");
    return stages.map((s, i) => {
        if (s.key === "forge_scaffold") return { ...s, status: "done" };
        if (i === firstPendingIdx) return { ...s, status: "provisioning" };
        return s;
    });
}
