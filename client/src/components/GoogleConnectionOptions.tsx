import { useQuery } from '@tanstack/react-query';
import { apiRequest, resolveActiveOrgId } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { GOOGLE_CONNECTION_PROFILES, googleConnectionUrl, type GoogleConnectionProfile } from '@shared/google-connection';

export function GoogleConnectionOptions({ projectKey }: { projectKey?: string }) {
  const status = useQuery<{ configured: boolean; callbackUri: string }>({
    queryKey: ['/api/saas/connectors/google/oauth/status', projectKey],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/saas/connectors/google/oauth/status');
      if (!response.ok) throw new Error('Could not check Google sign-in.');
      return response.json();
    },
    staleTime: 30_000,
  });
  const returnTo = projectKey ? `${window.location.pathname}${window.location.search}` : '/admin/integrations?status=google_connected';
  return <section aria-label="Connect Google" className="space-y-3 rounded-lg border border-border bg-card p-4">
    <div><h2 className="font-semibold">Connect Google</h2><p className="text-sm text-muted-foreground">Choose what CREW can access. Sign in with Google; tokens are stored securely and refreshed automatically.</p></div>
    <p className="text-xs text-muted-foreground">{projectKey ? 'This connection belongs to this project.' : 'This connection is shared across your organization’s projects.'} Google permissions apply to the account you select, not only to a project folder.</p>
    {status.isError && <div role="alert" className="text-sm">Could not check Google sign-in. <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>Try again</Button></div>}
    {status.data && !status.data.configured && <div role="status" className="space-y-2 text-sm">
      <p>Your administrator needs to enable Google sign-in once. Configure a Google OAuth web client and register this callback URL.</p>
      <div className="flex items-center gap-2"><code className="break-all text-xs">{status.data.callbackUri}</code><CopyButton value={status.data.callbackUri} /></div>
      <p className="text-xs text-muted-foreground">Administrator settings: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Enable the APIs for your chosen services, including YouTube Data API v3 for YouTube.</p>
    </div>}
    <div className="grid gap-3 sm:grid-cols-3">{(Object.keys(GOOGLE_CONNECTION_PROFILES) as GoogleConnectionProfile[]).map(profile => {
      const spec = GOOGLE_CONNECTION_PROFILES[profile];
      return <div key={profile} className="flex flex-col gap-2 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">{spec.label}</h3><p className="flex-1 text-xs text-muted-foreground">{spec.description}</p>
        {status.data?.configured ? <Button size="sm" variant="outline" asChild><a href={googleConnectionUrl(profile, { organizationId: resolveActiveOrgId() ?? undefined, projectKey, returnTo })}>Connect {spec.label}</a></Button>
          : <Button size="sm" variant="outline" disabled>{status.isLoading ? 'Checking sign-in…' : `Connect ${spec.label}`}</Button>}
      </div>;
    })}</div>
    <p className="text-xs text-muted-foreground">Already connected? Choose a connection above to grant missing permissions or reconnect. Sending email continues through CREW’s approval flow.</p>
  </section>;
}
