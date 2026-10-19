import type { WorkspaceResultKind } from '@shared/crew-workspace-results';

/** Inline brand marks stay sharp and do not load assets from another site. */
export function GoogleWorkspaceIcon({ kind, platform, className = 'h-5 w-5' }: { kind: WorkspaceResultKind; platform?: string; className?: string }) {
  if (platform === 'granola') return <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Granola"><rect x="1" y="1" width="22" height="22" rx="6" fill="#B7D43B" /><path d="M17.5 8.2c-1.1-2.4-4.5-3.2-7.1-1.9-2.8 1.4-4 4.8-2.4 7.4 1.4 2.3 4.5 3.2 6.8 1.8 1.8-1.1 2.5-3.3 1.4-4.9-.9-1.3-2.8-1.8-4.1-.8-1 .7-1.3 2-.6 2.9.5.7 1.5.9 2.1.4" fill="none" stroke="#17210D" strokeWidth="2" strokeLinecap="round" /></svg>;
  if (platform === 'quickbooks') return <svg viewBox="0 0 24 24" className={className} role="img" aria-label="QuickBooks"><circle cx="12" cy="12" r="11" fill="#2CA01C" /><text x="12" y="16" textAnchor="middle" fill="white" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="12">QB</text></svg>;
  if (platform === 'youtube') return <svg viewBox="0 0 24 24" className={className} role="img" aria-label="YouTube"><rect x="1" y="4" width="22" height="16" rx="5" fill="#FF0000" /><path d="m10 8 6 4-6 4z" fill="white" /></svg>;
  if (platform === 'amazon') return <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Amazon"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF9900" /><text x="12" y="14" textAnchor="middle" fill="white" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="11">a</text><path d="M5 15.5c4 3.5 10 3.5 14 0" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>;
  if (platform === 'flighthub') return <svg viewBox="0 0 24 24" className={className} role="img" aria-label="FlightHub"><rect x="1" y="1" width="22" height="22" rx="5" fill="#003D7C" /><path fill="white" d="M21 15.9v-1.9l-7.5-4.7V4.1a1.4 1.4 0 0 0-2.8 0v5.2L3 14v1.9l7.6-2.4v4.9l-2.1 1.6v1.5l3.6-1 3.6 1v-1.5l-2.1-1.6v-4.9z" /></svg>;
  if (platform === 'microsoft365') return <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Microsoft Word"><path fill="#185ABD" d="M8 2h13v20H8z" /><path fill="#41A5EE" d="M8 2h13v6H8z" /><path fill="#2B7CD3" d="M8 8h13v7H8z" /><path fill="#103F91" d="M1 5h13v14H1z" /><text x="7.5" y="15" textAnchor="middle" fill="white" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="9">W</text></svg>;
  if (kind === 'email') return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#4285F4" d="M2 6.5 6 9.5V20H3a1 1 0 0 1-1-1z" />
    <path fill="#34A853" d="m18 9.5 4-3V19a1 1 0 0 1-1 1h-3z" />
    <path fill="#EA4335" d="M6 5 12 9.5 18 5v4.5L12 14 6 9.5z" />
    <path fill="#C5221F" d="M2 6.5V5a2 2 0 0 1 3.2-1.6L6 4v5.5z" />
    <path fill="#FBBC04" d="M18 4l.8-.6A2 2 0 0 1 22 5v1.5l-4 3z" />
  </svg>;
  if (kind === 'calendar') return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#4285F4" d="M3 3h18v4H7v14H3z" />
    <path fill="#34A853" d="M17 7h4v10h-4z" />
    <path fill="#FBBC04" d="M7 17h10v4H7z" />
    <path fill="#EA4335" d="M17 17h4l-4 4z" />
    <path fill="#FFF" d="M7 7h10v10H7z" />
    <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="Arial,sans-serif" fill="#4285F4">31</text>
  </svg>;
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#4285F4" d="M5 2h9l5 5v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    <path fill="#A1C2FA" d="M14 2v5h5z" />
    <path stroke="#FFF" strokeWidth="1.4" d="M7 11h9M7 14h9M7 17h7" />
  </svg>;
}
