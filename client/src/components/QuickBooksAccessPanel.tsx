import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Checkbox } from '@/components/ui/checkbox';
import {
    FINANCE_ROLES, FINANCE_ROLE_LABELS, QUICKBOOKS_PERMISSIONS, QUICKBOOKS_REPORT_ACCESS, permissionCell,
    type FinanceRole,
} from '@shared/finance-roles';

interface FinanceMember {
    userId: string;
    displayName: string;
    secondary: string | null;
    projectRole: string;
    financeRoles: FinanceRole[];
}

const SHORT: Record<FinanceRole, string> = { ar: 'AR', ap: 'AP', audit: 'Audit', executive: 'Executive' };

/**
 * Who may do what with this project's QuickBooks books. A project owner ticks
 * finance roles per member; access is the union of a member's roles, and a
 * member with none has no QuickBooks access. The matrix below is the same one
 * the server enforces (shared/finance-roles.ts).
 */
export function QuickBooksAccessPanel({ projectKey }: { projectKey: string }) {
    const queryClient = useQueryClient();
    const key = ['/api/projects', projectKey, 'finance-roles'];
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState('');
    const access = useQuery<{ canManage: boolean; members: FinanceMember[] }>({
        queryKey: key,
        queryFn: async () => (await apiRequest('GET', `/api/projects/${encodeURIComponent(projectKey)}/finance-roles`)).json(),
    });

    async function toggle(member: FinanceMember, role: FinanceRole, on: boolean) {
        const roles = on ? [...member.financeRoles, role] : member.financeRoles.filter(r => r !== role);
        setSaving(`${member.userId}:${role}`); setError('');
        try {
            await apiRequest('PUT', `/api/projects/${encodeURIComponent(projectKey)}/finance-roles/${encodeURIComponent(member.userId)}`, { roles });
            await queryClient.invalidateQueries({ queryKey: key });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not change finance roles.');
        } finally { setSaving(null); }
    }

    return <section aria-label="QuickBooks access" className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="quickbooks-access">
        <div>
            <h2 className="font-semibold">QuickBooks access</h2>
            <p className="text-sm text-muted-foreground">
                Members need a finance role to use QuickBooks on this project; with more than one, they get everything each allows.
                {access.data && !access.data.canManage && ' Only a project owner can change these.'}
            </p>
        </div>
        {access.isError && <p role="alert" className="text-sm">Could not load QuickBooks access.</p>}
        {access.data && (access.data.members.length === 0
            ? <p className="text-sm text-muted-foreground">Add people to the project to give them a finance role.</p>
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Member</th>
                        {FINANCE_ROLES.map(role => <th key={role} className="px-2 py-1 text-center font-medium" title={FINANCE_ROLE_LABELS[role]}>{SHORT[role]}</th>)}
                    </tr></thead>
                    <tbody>{access.data.members.map(member => <tr key={member.userId} className="border-t border-border/50">
                        <td className="py-1.5 pr-3">
                            <span className="block font-medium">{member.displayName}</span>
                            <span className="block text-xs text-muted-foreground">{member.projectRole}{member.financeRoles.length === 0 && ' · no QuickBooks access'}</span>
                        </td>
                        {FINANCE_ROLES.map(role => <td key={role} className="px-2 py-1.5 text-center">
                            <Checkbox
                                checked={member.financeRoles.includes(role)}
                                disabled={!access.data!.canManage || saving !== null}
                                onCheckedChange={value => void toggle(member, role, value === true)}
                                aria-label={`${FINANCE_ROLE_LABELS[role]} for ${member.displayName}`}
                            />
                        </td>)}
                    </tr>)}</tbody>
                </table>
            </div>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">What each role can do</summary>
            <p className="mt-2 text-xs text-muted-foreground">
                C create (an agent proposes, a person approves) · R read · U update · D void.
                † also needs an Executive’s approval, from someone other than the person who asked.
            </p>
            <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs" data-testid="quickbooks-permission-matrix">
                    <thead><tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Record</th>
                        {FINANCE_ROLES.map(role => <th key={role} className="px-2 py-1 text-center font-medium">{SHORT[role]}</th>)}
                    </tr></thead>
                    <tbody>
                        {Object.keys(QUICKBOOKS_PERMISSIONS).map(entity => <tr key={entity} className="border-t border-border/40">
                            <td className="py-1 pr-3">{entity.replace(/([a-z])([A-Z])/g, '$1 $2')}</td>
                            {FINANCE_ROLES.map(role => <td key={role} className="px-2 py-1 text-center font-mono">{permissionCell(role, entity) || '—'}</td>)}
                        </tr>)}
                        {Object.entries(QUICKBOOKS_REPORT_ACCESS).map(([report, roles]) => <tr key={report} className="border-t border-border/40">
                            <td className="py-1 pr-3">{report.replace(/([a-z])([A-Z])/g, '$1 $2')} report</td>
                            {FINANCE_ROLES.map(role => <td key={role} className="px-2 py-1 text-center">{roles.includes(role) ? '✓' : '—'}</td>)}
                        </tr>)}
                    </tbody>
                </table>
            </div>
        </details>
    </section>;
}
