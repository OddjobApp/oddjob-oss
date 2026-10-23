import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyButton } from '@/components/ui/copy-button';

export function OrgOAuthAppSettings({ provider, orgId, onSaved }: {
  provider: 'google' | 'quickbooks'; orgId: number | null; onSaved: () => void;
}) {
  // Remount per org so neither an unsaved secret nor feedback follows an org switch.
  return <OrgOAuthAppForm key={`${provider}:${orgId}`} provider={provider} orgId={orgId} onSaved={onSaved} />;
}
function OrgOAuthAppForm({ provider, orgId, onSaved }: {
  provider: 'google' | 'quickbooks'; orgId: number | null; onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [environment, setEnvironment] = useState('sandbox');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const path = `/api/saas/connectors/${provider}/oauth/app?organizationId=${orgId}`;
  const status = useQuery<{ organizationId: number; configured: boolean; source: string; canManage: boolean; callbackUri: string }>({
    queryKey: ['organization-oauth-app', provider, orgId], enabled: orgId != null,
    queryFn: async () => (await apiRequest('GET', path)).json(),
  });
  async function save() {
    setBusy(true); setMessage('');
    try {
      await apiRequest('PUT', path, { clientId, clientSecret: secret, ...(provider === 'quickbooks' ? { environment } : {}) });
      setSecret(''); setClientId(''); setMessage('Organization OAuth app saved. Reconnect existing accounts if you changed the app credentials.');
      await status.refetch(); onSaved();
    } catch { setMessage('Could not save OAuth app settings. Check your organization permissions and try again.'); }
    finally { setBusy(false); }
  }
  if (status.isError) return <p role="alert">Could not load organization OAuth settings. <Button variant="ghost" onClick={() => void status.refetch()}>Retry</Button></p>;
  if (!status.data) return null;
  return <div className="space-y-2 text-sm">
    <p>Organization {status.data.organizationId} · {status.data.configured ? (status.data.source === 'organization' ? 'Using this organization’s OAuth app.' : 'Using Oddjob’s shared OAuth app; account connections stay isolated by organization.') : 'OAuth app setup required.'}</p>
    {status.data.canManage ? <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer font-medium">Configure organization OAuth app</summary>
      <div className="mt-3 space-y-3">
        {provider === 'google' && <GoogleOAuthSetupGuide />}
        <p>Create a {provider === 'google' ? 'Google OAuth web client and enable the APIs you need' : 'QuickBooks Intuit app with the accounting scope'}. Register this exact callback URL:</p>
        <div className="flex items-center gap-2"><code className="break-all text-xs">{status.data.callbackUri}</code><CopyButton value={status.data.callbackUri} /></div>
        <Label htmlFor={`${provider}-client-id`}>Client ID</Label>
        <Input id={`${provider}-client-id`} value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" disabled={busy} />
        <Label htmlFor={`${provider}-client-secret`}>Client secret</Label>
        <Input id={`${provider}-client-secret`} type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="new-password" disabled={busy} />
        {provider === 'quickbooks' && <><Label htmlFor="quickbooks-environment">Environment</Label><select id="quickbooks-environment" value={environment} onChange={e => setEnvironment(e.target.value)} disabled={busy} className="rounded-md border border-input bg-background p-2"><option value="sandbox">Sandbox</option><option value="production">Production</option></select></>}
        <p className="text-xs text-muted-foreground">Credentials are encrypted and never displayed after saving. This configures the active organization, including when opened from a project.</p>
        <Button type="button" disabled={busy || !clientId.trim() || !secret.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save organization OAuth app'}</Button>
      </div>
    </details> : <p className="text-xs text-muted-foreground">An organization admin must configure or connect this service.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}

function GoogleOAuthSetupGuide() {
  const linkClass = 'text-primary underline underline-offset-4';
  return <div className="space-y-3">
    <p className="font-medium">Set up Google for your organization</p>
    <p>You need permission to manage a Google Cloud project and to administer this Oddjob organization. Set up the app once per organization, then connect the Google account you want CREW to use.</p>
    <ol className="list-decimal space-y-2 pl-5">
      <li>Open the <a className={linkClass} href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud console</a>. Create or select a project owned by your organization. Keep that same project selected throughout setup.</li>
      <li>Open <strong>Google Auth platform → Branding</strong> and choose <strong>Get started</strong> if prompted. Enter an app name, support email, and contact email. In <strong>Audience</strong>, choose Internal for accounts in your Google Workspace organization, if available, or External for other Google accounts. For an External app in Testing, add the account you will connect under <strong>Test users</strong>.</li>
      <li>Open <a className={linkClass} href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer">APIs &amp; Services → Library</a> and enable the APIs for your connection: Gmail API for Gmail; Google Drive API and Google Docs API for Drive and document editing; Google Calendar API for Calendar; YouTube Data API v3 for YouTube. The combined connection needs Gmail, Drive, Docs, and Calendar.</li>
      <li>Open <strong>Google Auth platform → Clients → Create client</strong>. Choose <strong>Web application</strong> and give it a name such as “Oddjob organization connection”. Under <strong>Authorized redirect URIs</strong>, add the exact callback URL shown below. This server callback belongs in redirect URIs, not JavaScript origins.</li>
      <li>Create the client and securely copy its <strong>Client ID</strong> and <strong>Client secret</strong> into the fields below. Save the secret when Google shows it; you may need to create a replacement if you lose it. These are OAuth credentials, not an API key or service-account JSON file.</li>
      <li>Select <strong>Save organization OAuth app</strong>, then select the desired <strong>Connect</strong> button below. Sign in to Google and review the requested permissions. Saving credentials alone does not connect an account.</li>
    </ol>
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer font-medium">Testing, permissions, and troubleshooting</summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        <p><strong>redirect_uri_mismatch:</strong> Check that the redirect URI in Google exactly matches the callback below, including https, hostname, and path. Use the same Cloud project as the client ID you saved.</p>
        <p><strong>Access blocked:</strong> For External apps in Testing, add the signing-in account as a test user. A Google Workspace administrator may also need to allow the app. Follow Google’s verification requirements before making an External app broadly available; sensitive or restricted permissions can require review.</p>
        <p><strong>API disabled or missing permission:</strong> Enable the matching API in the client’s Cloud project. Review Google Auth platform → Data Access for the permissions your chosen connection requests, then reconnect and grant the required access.</p>
        <p><strong>Connection expires or credentials change:</strong> Google limits refresh-token lifetime for External apps in Testing. Reconnect when needed; reconnect existing accounts after replacing the organization’s OAuth app credentials.</p>
        <p>Follow Google’s <a className={linkClass} href="https://developers.google.com/workspace/guides/configure-oauth-consent" target="_blank" rel="noopener noreferrer">consent screen guide</a> and <a className={linkClass} href="https://developers.google.com/identity/protocols/oauth2/web-server" target="_blank" rel="noopener noreferrer">web-server OAuth guide</a> for permission, publishing, and verification requirements.</p>
      </div>
    </details>
    <p className="text-xs text-muted-foreground">Keep the client secret private. Enter it only in the password field below; do not post it in chat or support messages. App settings belong to the selected organization; the connected account’s access follows the organization or project connection you create.</p>
  </div>;
}
