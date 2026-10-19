const identity = ['openid', 'email', 'profile'];
export const GOOGLE_CONNECTION_PROFILES = {
  youtube: { label: 'YouTube', description: 'Find videos, review your channel and playlists, read comments, and prepare approved comment replies.', scopes: [...identity, 'https://www.googleapis.com/auth/youtube.force-ssl'] },
  gmail: { label: 'Gmail', description: 'Read conversations and attachments, manage drafts and labels, and send messages through CREW.', scopes: [...identity, 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'] },
  drive: { label: 'Google Drive', description: 'Find files and read, create, copy, and edit native Google Docs.', scopes: [...identity, 'https://www.googleapis.com/auth/drive'] },
  calendar: { label: 'Google Calendar', description: 'Manage events, invitations, availability, and calendars.', scopes: [...identity, 'https://www.googleapis.com/auth/calendar'] },
  workspace: { label: 'Gmail + Google Drive', description: 'Connect email, files, and Calendar management with one Google sign-in.', scopes: [...identity, 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/calendar'] },
} as const;
export type GoogleConnectionProfile = keyof typeof GOOGLE_CONNECTION_PROFILES;

export function googleConnectionUrl(profile: GoogleConnectionProfile, options: { organizationId?: number; projectKey?: string; projectId?: number; returnTo?: string } = {}) {
  const query = new URLSearchParams({ for: profile });
  if (options.organizationId != null) query.set('orgId', String(options.organizationId));
  if (options.projectKey) query.set('projectKey', options.projectKey);
  if (options.projectId != null) query.set('projectId', String(options.projectId));
  if (options.returnTo) query.set('returnTo', options.returnTo);
  return `/api/saas/connectors/google/oauth/initiate?${query}`;
}
