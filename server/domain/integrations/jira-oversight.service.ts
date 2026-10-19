
import { getJiraClient, JiraIssue } from "./jira-service.js";
import { createLogger } from "@server/utils/logger.js";
import { subDays, format } from "date-fns";

const logger = createLogger("JiraOversightService");

export interface JiraOversightStats {
    totalRecent: number;
    criticalCount: number;
    issuesByFeature: Record<string, JiraIssue[]>;
    issuesByComponent: Record<string, JiraIssue[]>;
}

export const jiraOversightService = {
    /**
     * Fetches issues from the last N days and groups them for oversight.
     */
    async getRecentIssues(credentialId: number, orgId: number, days = 7): Promise<JiraOversightStats> {
        logger.info(`Fetching Jira oversight data for credential ${credentialId} (last ${days} days)`);
        
        const client = await getJiraClient(credentialId, orgId);
        
        // JQL for issues created in the last N days
        const dateStr = format(subDays(new Date(), days), "yyyy-MM-dd");
        const jql = `created >= "${dateStr}" ORDER BY priority DESC, created DESC`;
        
        const result = await client.searchIssues(jql, 100, 0, ["components", "priority", "status", "created", "labels"]);
        const issues = result.issues;

        const stats: JiraOversightStats = {
            totalRecent: issues.length,
            criticalCount: issues.filter(i => (i.fields.priority as any)?.name === "Highest" || (i.fields.priority as any)?.name === "Critical").length,
            issuesByFeature: {},
            issuesByComponent: {}
        };

        issues.forEach(issue => {
            // Group by Component
            const components = (issue.fields.components as any[]) || [];
            if (components.length === 0) {
                this.addToGroup(stats.issuesByComponent, "Unassigned", issue);
            } else {
                components.forEach(c => this.addToGroup(stats.issuesByComponent, c.name, issue));
            }

            // Group by Feature (Mocked logic: use first Label as feature, or 'Unknown')
            const labels = (issue.fields.labels as string[]) || [];
            const feature = labels.find(l => l.startsWith("feature:"))?.replace("feature:", "") || "General";
            this.addToGroup(stats.issuesByFeature, feature, issue);
        });

        return stats;
    },

    addToGroup(obj: Record<string, JiraIssue[]>, key: string, issue: JiraIssue) {
        if (!obj[key]) obj[key] = [];
        obj[key].push(issue);
    }
};
