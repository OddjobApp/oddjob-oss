/**
 * Confluence utilities — URL parsing, page URL construction, approval packet HTML builder.
 */

// ── URL Parsing ───────────────────────────────────────────────────────────────

const CONFLUENCE_URL_PATTERNS = [
  /\/pages\/(\d+)\//,                          // /pages/{pageId}/{title}
  /\/spaces\/[^/]+\/pages\/(\d+)/,             // /spaces/{space}/pages/{pageId}/{title}
  /\/wiki\/spaces\/[^/]+\/pages\/(\d+)/,       // /wiki/spaces/{space}/pages/{pageId}
  /[?&]pageId=(\d+)/,                          // ?pageId={pageId} query param
];

/**
 * Extract a Confluence page ID from a URL. Returns null if no pattern matches.
 */
export function extractConfluencePageId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  for (const pattern of CONFLUENCE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Build a full Confluence page URL from a base URL and page ID.
 */
export function buildConfluencePageUrl(baseUrl: string, pageId: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return `${clean}/pages/${pageId}`;
}

// ── Approval Packet HTML Builder ──────────────────────────────────────────────

export interface ApprovalPacketData {
  jiraKey: string;
  ticketSummary: string;
  prdContent: string;           // first 500 chars used as summary
  prdPageId: string | null;
  sourcePageId: string | null;
  confluenceBaseUrl: string;
  signoffData: {
    prdStatus: string;
    uxMockupStatus: string;
    designSystemCompliance: string;
    scopingComments: string;
    reviewedStoryPoints: number;
  };
  approvedAt: string;
}

/**
 * Build Confluence storage format HTML for the approval packet page.
 */
export function buildApprovalPacketHtml(data: ApprovalPacketData): string {
  const prdSummary = (data.prdContent || "").slice(0, 500).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sourceLink = data.sourcePageId
    ? `<a href="${buildConfluencePageUrl(data.confluenceBaseUrl, data.sourcePageId)}">Source Document</a>`
    : "N/A";
  const prdLink = data.prdPageId
    ? `<a href="${buildConfluencePageUrl(data.confluenceBaseUrl, data.prdPageId)}">Generated PRD</a>`
    : "N/A";

  return `
<h1>Requirements Approved: ${data.jiraKey} — ${escapeHtml(data.ticketSummary)}</h1>

<h2>Approval Decision</h2>
<table>
  <tr><td><strong>PRD Status</strong></td><td>${escapeHtml(data.signoffData.prdStatus)}</td></tr>
  <tr><td><strong>UX Mockup Status</strong></td><td>${escapeHtml(data.signoffData.uxMockupStatus)}</td></tr>
  <tr><td><strong>Design System Compliance</strong></td><td>${escapeHtml(data.signoffData.designSystemCompliance)}</td></tr>
  <tr><td><strong>Reviewed Story Points</strong></td><td>${data.signoffData.reviewedStoryPoints}</td></tr>
  <tr><td><strong>Approved At</strong></td><td>${data.approvedAt}</td></tr>
</table>

${data.signoffData.scopingComments ? `<h2>Scoping Comments</h2><p>${escapeHtml(data.signoffData.scopingComments)}</p>` : ""}

<h2>PRD Summary</h2>
<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${prdSummary}]]></ac:plain-text-body></ac:structured-macro>

<h2>Related Documents</h2>
<ul>
  <li><strong>Source Document:</strong> ${sourceLink}</li>
  <li><strong>Generated PRD:</strong> ${prdLink}</li>
  <li><strong>Jira Ticket:</strong> ${data.jiraKey}</li>
</ul>
`.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
