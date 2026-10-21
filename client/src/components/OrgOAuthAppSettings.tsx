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
