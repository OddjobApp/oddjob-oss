/**
 * Work-type classification for crew turns.
 *
 * A turn is what it executed, not what it claimed: tools_used is the signal,
 * so a turn that says "I researched competitors" but only ran send_email is
 * classified as inbox work. Tool names classify most turns deterministically;
 * intent is the tiebreaker for turns that ran nothing.
 *
 * Buckets follow the work taxonomy used for bot analytics elsewhere:
 *   inbox_briefings | calendar_meetings | sales_pipeline | customer_support
 *   marketing_content | finance_backoffice | people_recruiting
 *   engineering_product | research_documents | errands_purchases
 *   setup_exploration | other
 */

export const WORK_TYPES = [
    "inbox_briefings",
    "calendar_meetings",
    "sales_pipeline",
    "customer_support",
    "marketing_content",
    "finance_backoffice",
    "people_recruiting",
    "engineering_product",
    "research_documents",
    "errands_purchases",
    "setup_exploration",
    "other",
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/** First match wins — order is the priority when a turn mixed categories. */
const TOOL_RULES: Array<{ type: WorkType; re: RegExp }> = [
    { type: "calendar_meetings", re: /calendar|calendly|meeting|schedule_event/i },
    // Outbound proposals classify by channel, not by the word "propose".
    { type: "inbox_briefings", re: /agentmail|send_email|gmail|reply_|inbox|mailbox|ews|omnichannel|sms_|twilio|messaging|slack/i },
    { type: "sales_pipeline", re: /hubspot|salesforce|lead_|pipeline_|deal_|opportunit|crm_/i },
    { type: "customer_support", re: /zendesk|intercom|freshdesk|support_|ticket|helpdesk/i },
    { type: "people_recruiting", re: /recruit|candidate|greenhouse|lever_|hris|onboard|offboard/i },
    { type: "finance_backoffice", re: /stripe|invoice|billing|expense|accounting|quickbooks|revenue|procurement|vendor/i },
    { type: "marketing_content", re: /media_studio|marketing|campaign|social_|seo_|content_|copy|brand|newsletter/i },
    { type: "engineering_product", re: /github|gitlab|jira|linear|confluence|git_|selenium|playwright|workspace_|run_|pipeline|deploy|ci_|docker|kubernetes|trycua_|computer_use|code_|debug|test_|sql_query|dataset/i },
    { type: "research_documents", re: /search|browse|attach_url|research|knowledge|scribe|generate_|render_|document|pdf|report|summar|analy|signal_|graph_|ontology|dataset_analytics|knowledge_pack/i },
    { type: "errands_purchases", re: /shop|order|purchase|book_|reserve|travel|errand/i },
    { type: "setup_exploration", re: /mount_|studio|configure|setup|connect|integration|pairing|onboard_tour/i },
];

const INTENT_RULES: Array<{ type: WorkType; re: RegExp }> = [
    { type: "calendar_meetings", re: /calendar|meeting/i },
    { type: "inbox_briefings", re: /mail|inbox|message/i },
    { type: "sales_pipeline", re: /sales|pipeline|deal|lead/i },
    { type: "customer_support", re: /support|ticket|helpdesk/i },
    { type: "marketing_content", re: /marketing|campaign|content/i },
    { type: "finance_backoffice", re: /finance|invoice|billing/i },
    { type: "engineering_product", re: /code|bug|deploy|test|build/i },
    { type: "research_documents", re: /research|document|report|analy|summar/i },
];

export function classifyWorkType(
    toolsUsed: Array<{ name: string; ok?: boolean }> | null | undefined,
    intent?: string | null,
): WorkType {
    // A proposal's channel matters more than its verb — "propose_outbound_message"
    // on slack is messaging work, on email is inbox work.
    for (const call of toolsUsed ?? []) {
        const name = String(call?.name ?? "");
        if (!name) continue;
        if (name === "propose_outbound_message") return "inbox_briefings";
        for (const rule of TOOL_RULES) {
            if (rule.re.test(name)) return rule.type;
        }
    }
    const text = String(intent ?? "");
    for (const rule of INTENT_RULES) {
        if (rule.re.test(text)) return rule.type;
    }
    return "other";
}
