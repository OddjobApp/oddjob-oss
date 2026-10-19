/**
 * "System Info" panel of the admin Settings page — version, uptime, active
 * jobs, last backup. Self-contained: it owns its own query and takes no props,
 * so it was already a separate component, just declared inside Settings.tsx
 * above the page it belongs to.
 */
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export function SystemInfoCard() {
  const { data: systemInfo, isLoading } = useQuery({
    queryKey: ['/api/system/info'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/system/info');
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute for uptime
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Version</p>
          <p className="text-base font-mono">Loading...</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Uptime</p>
          <p className="text-base">Loading...</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Active Jobs</p>
          <p className="text-base">Loading...</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Last Backup</p>
          <p className="text-base">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Version</p>
        <p className="text-base font-mono">{systemInfo?.version || 'Unknown'}</p>
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">Uptime</p>
        <p className="text-base">{systemInfo?.uptime || 'Unknown'}</p>
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">Active Jobs</p>
        <p className="text-base">{systemInfo?.activeJobs || '0 configured'}</p>
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">Last Backup</p>
        <p className="text-base">{systemInfo?.lastBackup || 'Not configured'}</p>
      </div>
    </div>
  );
}
