import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgContextOptional } from '@domain-ui/core/ui/hooks/use-org-context';
import { apiRequest, resolveActiveOrgId } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';

export function QuickBooksConnectionOptions({ projectKey, onConnectionChange }: { projectKey?: string; onConnectionChange?: () => void | Promise<void> }) {
    const orgContext = useOrgContextOptional();
    const orgId = orgContext?.selectedOrgId ?? resolveActiveOrgId();
    const queryClient = useQueryClient();
    const query = new URLSearchParams({ ...(orgId ? { orgId: String(orgId) } : {}), ...(projectKey ? { projectKey } : {}) });
    const suffix = `?${query}`;
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const status = useQuery<{ configured: boolean; environment: string; callbackUri: string; canManage?: boolean; connection: { status: string; realmId?: string; inherited: boolean } | null }>({
        queryKey: ['/api/saas/connectors/quickbooks/oauth/status', orgId, projectKey],
        queryFn: async () => (await apiRequest('GET', `/api/saas/connectors/quickbooks/oauth/status${suffix}`)).json(), staleTime: 30_000,
    });
    async function action(name: 'test' | 'disconnect') {
        setBusy(true); setMessage('');
        try {
            const result = await (await apiRequest('POST', `/api/saas/connectors/quickbooks/${name}${suffix}`, {})).json();
            setMessage(name === 'test' ? `Verified connection to ${result.companyName ?? 'your QuickBooks company'}.` : 'QuickBooks disconnected.');
            if (name === 'disconnect') {
                await queryClient.invalidateQueries({ queryKey: ['/api/saas/connectors'] });
                await onConnectionChange?.();
            }
            await status.refetch();
        } catch (e) { setMessage(e instanceof Error ? e.message : 'QuickBooks request failed.'); }
        finally { setBusy(false); }
    }
    const connected = status.data?.connection?.status === 'connected';
    // Connecting, reconnecting and disconnecting are org-admin actions; the server enforces it.
    const canManage = status.data?.canManage === true;
    const returnTo = projectKey ? `${window.location.pathname}${window.location.search}` : '/admin/integrations';
    const initiate = new URLSearchParams(query); initiate.set('returnTo', returnTo);
    return <section aria-label="Connect QuickBooks" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">QuickBooks Online</h2>
        <p className="text-sm text-muted-foreground">Connect a company to read accounting records and reports. CREW can prepare invoices for your approval; it does not email invoices or collect payments.</p>
        <p className="text-xs text-muted-foreground">{projectKey ? 'Connection belongs to this project; company permissions cover the company you authorize.' : 'Connection is shared across your organization’s projects.'} Environment: {status.data?.environment ?? 'Checking…'}.</p>
        {status.isError && <p role="alert">Could not check QuickBooks setup. <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>Retry</Button></p>}
        {status.data && !status.data.configured && <div className="space-y-2 text-sm">
            <p>An administrator must configure an Intuit app with the accounting scope and register this callback URL.</p>
            <div className="flex items-center gap-2"><code className="break-all text-xs">{status.data.callbackUri}</code><CopyButton value={status.data.callbackUri} /></div>
            <p className="text-xs text-muted-foreground">Server settings: QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT (sandbox or production).</p>
            <a href="https://developer.intuit.com/" target="_blank" rel="noopener noreferrer" className="text-primary underline">Open Intuit Developer</a>
        </div>}
        {connected && <p className="text-sm">Connected company: {status.data?.connection?.realmId}. {status.data?.connection?.inherited && 'Inherited from your organization.'}</p>}
        <div className="flex flex-wrap gap-2">
            {status.data?.configured && canManage ? <Button asChild variant="outline"><a href={`/api/saas/connectors/quickbooks/oauth/initiate?${initiate}`}>{connected ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}</a></Button>
                : !connected && <Button disabled>Connect QuickBooks</Button>}
            {connected && <Button type="button" variant="outline" disabled={busy} onClick={() => void action('test')}>Test connection</Button>}
            {connected && canManage && !status.data?.connection?.inherited && <Button type="button" variant="ghost" disabled={busy} onClick={() => void action('disconnect')}>{busy ? 'Working…' : 'Disconnect'}</Button>}
        </div>
        {status.data && !canManage && <p className="text-xs text-muted-foreground">Only an organization admin can {connected ? 'reconnect or disconnect' : 'connect'} QuickBooks.</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
    </section>;
}
