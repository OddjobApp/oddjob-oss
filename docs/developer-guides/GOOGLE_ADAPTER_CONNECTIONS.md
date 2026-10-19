# Google adapter connections

The existing Integrations page now offers Gmail, Google Drive, and a combined
Gmail + Drive consent flow. Project Integrations offers the same choices scoped
to that project. CREW's existing `connect_platform` tool can request `gmail`,
`google_drive`, or `google_workspace`; it only displays a connection card.
The person chooses their account and approves permissions in Google's screen.

## One-time deployment setup

Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for a Google OAuth web
client. Existing `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` are also accepted by
the adapter. Register the exact callback shown in the connection panel:
`/api/saas/connectors/google/oauth/callback` on the externally reachable host.
Enable the Gmail API, Drive API, and Docs API when using Docs authoring tools.
Configure the OAuth consent screen and any required test users or app verification.
Regular users then connect with Google sign-in; they do not paste access tokens.

## Permissions and scope

Gmail requests `gmail.readonly` and `gmail.send`. Drive retains the existing
`drive` scope so CREW can read existing files and create documents. Combined
consent requests both sets plus identity scopes. These are Google account
permissions; a project-scoped adapter limits which Oddjob projects can use the
connection, but does not confine Google's permission to one folder.

Google supports incremental consent through the existing adapter. Reconnecting
can grant missing permissions. The existing generic Google connector remains
the stored connection for a given org/project; these choices are permission
profiles, not three independent mailboxes. An organization-wide connection is
matched only against a null project ID, preventing it from overwriting a
project's connection.

## Tool execution

Gmail and generic Drive tools now resolve connected OAuth adapter records in
the authenticated organization and requested project (or inherited organization
scope), inspect encrypted granted scopes, and refresh via the existing Google
adapter. A missing permission throws a tool failure with connection guidance,
instead of becoming a successful turn claiming Google work happened. Gmail
send remains subject to the existing CREW send approval gate. The legacy HIL
notification Gmail service is unchanged.

No external email was sent and no Google account was connected during automated
tests. Live consent and provider API behavior require a configured OAuth client.

## Calendar and provider routing

Google Calendar reading uses `gcal_list_calendars` and `gcal_list_events`; the
older `calendar_list_events` / `calendar_create_event` tools target Microsoft.
Google Calendar requires Calendar API enablement in the Google Cloud project
and the `calendar.readonly` grant. Existing Gmail/Drive connections need renewed
consent through the Calendar choice (or combined connection) before Calendar
can be read. No Calendar write or event invitation tool is added here.

Gmail mailbox lookups identify the connected account with `gmail_get_profile`.
`gmail_search` validates a requested mailbox before fetching messages. Named
Gmail reads exclude AgentMail inbox tools from that turn. Explicit Google
Calendar requests exclude Microsoft Calendar tools. Drive folder searches join
the folder and query predicates with `and`.

References: [Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes),
[Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
