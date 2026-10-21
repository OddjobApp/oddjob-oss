export type IntegrationHealth = "healthy" | "attention" | "unavailable";
export interface IntegrationAssessment {
  id: string; name: string; category: "messaging" | "productivity" | "developer";
  health: IntegrationHealth; configured: boolean; security: "verified" | "partial" | "not-configured";
  capabilities: string[]; checks: Array<{ label: string; passed: boolean; detail: string }>;
  nextAction: { label: string; href: string };
}
const hasAny = (...keys: string[]) => keys.some((key) => Boolean(process.env[key]?.trim()));
function build(input: Omit<IntegrationAssessment, "health">): IntegrationAssessment {
  return { ...input, health: !input.configured ? "unavailable" : input.checks.every((check) => check.passed) ? "healthy" : "attention" };
}
export class IntegrationReliabilityService {
  getAssessments(agentmailConfigured = false): IntegrationAssessment[] {
    const credentialAction = { label: "Manage credentials", href: "/connections/credentials" };
    const connectorAction = { label: "Configure connector", href: "/connections/saas" };
    const slack = hasAny("SLACK_BOT_TOKEN", "SLACK_CLIENT_ID");
    const teams = hasAny("MICROSOFT_APP_ID", "TEAMS_APP_ID");
    const discord = hasAny("DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN");
    const agentmail = agentmailConfigured;
    const jira = hasAny("JIRA_API_TOKEN", "ATLASSIAN_API_TOKEN");
    const github = hasAny("GITHUB_TOKEN", "GITHUB_APP_ID");
    return [
      build({ id: "slack", name: "Slack", category: "messaging", configured: slack, security: slack && hasAny("SLACK_SIGNING_SECRET") ? "verified" : slack ? "partial" : "not-configured", capabilities: ["Commands", "Events", "Notifications", "Approvals"], checks: [
        { label: "Credentials", passed: slack, detail: slack ? "Bot or OAuth credentials detected" : "Add Slack OAuth or bot credentials" },
        { label: "Webhook verification", passed: hasAny("SLACK_SIGNING_SECRET"), detail: hasAny("SLACK_SIGNING_SECRET") ? "Signing secret configured" : "Signing secret required for verified events" },
      ], nextAction: credentialAction }),
      build({ id: "teams", name: "Microsoft Teams", category: "messaging", configured: teams, security: teams ? "partial" : "not-configured", capabilities: ["Messages", "Channel events"], checks: [
        { label: "Credentials", passed: teams, detail: teams ? "Application identity detected" : "Add a Microsoft application identity" },
        { label: "JWT verification", passed: false, detail: "Bot Framework JWKS verification is not production-ready" },
      ], nextAction: credentialAction }),
      build({ id: "discord", name: "Discord", category: "messaging", configured: discord, security: discord ? "partial" : "not-configured", capabilities: ["Interactions", "Commands"], checks: [
        { label: "Credentials", passed: discord, detail: discord ? "Application credentials detected" : "Add Discord application credentials" },
        { label: "Signature verification", passed: false, detail: "Ed25519 verification is not production-ready" },
      ], nextAction: credentialAction }),
      build({ id: "agentmail", name: "AgentMail", category: "productivity", configured: agentmail, security: agentmail ? "verified" : "not-configured", capabilities: ["Email tools", "Organization inbox polling"], checks: [
        { label: "Organization connection", passed: agentmail, detail: agentmail ? "Dedicated inbox connected with encrypted credentials" : "Connect this organization's inbox in Settings" },
      ], nextAction: { label: "Configure AgentMail", href: "/settings" } }),
      build({ id: "jira", name: "Jira", category: "productivity", configured: jira, security: jira ? "verified" : "not-configured", capabilities: ["Issues", "Projects", "Workflow actions"], checks: [
        { label: "API access", passed: jira, detail: jira ? "API credentials detected" : "Add Atlassian API credentials" },
      ], nextAction: connectorAction }),
      build({ id: "github", name: "GitHub", category: "developer", configured: github, security: github ? "verified" : "not-configured", capabilities: ["Repositories", "Issues", "Pull requests"], checks: [
        { label: "API access", passed: github, detail: github ? "Token or GitHub App detected" : "Add GitHub credentials" },
      ], nextAction: connectorAction }),
    ];
  }
}
export const integrationReliabilityService = new IntegrationReliabilityService();
