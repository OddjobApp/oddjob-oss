/**
 * Links that open the assistant on one of its views.
 *
 * The assistant is a sheet over whatever page is showing, opened by an in-page
 * event, so a link from outside the app (a Slack or Teams HIL notification) or
 * across a full page load has no event to send. It carries the view as a query
 * parameter on /dashboard instead, and Layout opens the assistant from it.
 */

export const ASSISTANT_VIEWS = ["chat", "approvals", "updates", "inbox", "missions"] as const;
export type AssistantView = (typeof ASSISTANT_VIEWS)[number];

export const ASSISTANT_LINK_PARAM = "assistant";

export function assistantLinkPath(view: AssistantView): string {
  return `/dashboard?${ASSISTANT_LINK_PARAM}=${view}`;
}

/**
 * The view a query string asks the assistant to open, and the query string without
 * that parameter. Null when it asks for none, or names a view that does not exist.
 */
export function readAssistantLink(search: string): { view: AssistantView; search: string } | null {
  const params = new URLSearchParams(search);
  const view = params.get(ASSISTANT_LINK_PARAM);
  if (!view || !(ASSISTANT_VIEWS as readonly string[]).includes(view)) return null;
  params.delete(ASSISTANT_LINK_PARAM);
  const rest = params.toString();
  return { view: view as AssistantView, search: rest ? `?${rest}` : "" };
}
