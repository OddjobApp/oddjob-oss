/** A mailbox lookup must never become a send instruction. */
export function isEmailSendRequest(message: string): boolean {
  if (/\b(?:list|read|search|find|show|summarize|summarise|review|check)\b[^.!?\n]*\b(?:emails?|inbox|mailbox|messages?)\b/i.test(message)) return false;
  return /\b(?:send|forward|reply)\b[^.!?\n]*\b(?:email|mail|message)\b/i.test(message)
    || /\bemail\s+(?:to\s+)?[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(message)
    || /\b(?:send|forward|reply)\b[^.!?\n]*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(message);
}

export function emailReadDirective(message: string): string {
  if (isEmailSendRequest(message) || !/\b(?:emails?|inbox|mailbox|gmail)\b/i.test(message)) return '';
  return '\n\nMAILBOX READING: Use gmail_get_profile to identify the connected Google mailbox, then gmail_list_messages or gmail_search for Gmail or a named Google mailbox. Pass the requested account address as mailbox to gmail_search. If the connected account differs, report the mismatch and ask for the correct connection. AgentMail is a separate mailbox: use list_agentmail_threads only when the user specifically requests AgentMail or an @agentmail.to account. Never substitute AgentMail for Gmail. Honor date filters such as today in the Gmail query; do not label unfiltered results as today. When the request already states its scope — a date, a sender, a mailbox — run the search now instead of asking for criteria. Show the results with render_table or render_list (subject, sender, date, snippet) rather than reciting message IDs in prose; fetch bodies with gmail_get_message only when the user asked to read them. Reading mail is not permission to send mail.';
}

export function isNamedGmailRead(message: string): boolean {
  return !isEmailSendRequest(message)
    && /\b(?:emails?|inbox|mailbox|gmail)\b/i.test(message)
    && (/\bgmail\b/i.test(message) || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(message))
    && !/\bagentmail\b|@agentmail\.to\b/i.test(message);
}

export function googleWorkspaceDirective(message: string): string {
  if (!/\b(?:google|gmail|gdrive|drive|docs|calendar)\b/i.test(message)) return '';
  return 'Current UTC time: ' + new Date().toISOString() + '\n\nGOOGLE WORKSPACE: For Google Drive use gdrive_list_files and gdrive_read_file; for Google Docs reading use gdocs_read_text with next_offset pagination; for native structure and editing use gdocs_get_document to read all tabs and revisionId, then gdocs_create_document/update_document/copy_document/trash_document to propose changes. Preserve document formatting and tabs; native updates require the live revisionId. For Gmail use gmail_get_message/get_thread for full bodies, gmail_get_attachment for attachments, gmail_list_drafts/get_draft and create/update/delete/send_draft, gmail_reply for threaded replies, gmail_modify_message/thread for archiving, read status, stars and labels. Gmail writes require approval. query live files before claiming the connection is missing. For Google Calendar use gcal_list_calendars and gcal_list_events, not Microsoft calendar_list_events. Missing Calendar consent is separate from Gmail or Drive connectivity: use connect_platform with google_calendar to request it. For today/this week/next week use gcal_list_events time_range so the server resolves dates in the calendar time zone. For changes use gcal_create_event/update_event/delete_event/respond_event/move_event; read existing event IDs and etags first. Writes return a pending approval, never a completed change. Use calendar timeZone for local event times and clarify missing duration. Never substitute AgentMail, Microsoft, or knowledge-search results for a requested Google account. Report tool failures or missing permission accurately. Render the listings a person asked to see — render_table for Gmail results and Drive files, render_timeline for calendar events — rather than reciting IDs in prose.';
}
