/**
 * GovernancePage
 *
 * Admin page that houses:
 *  - Tab 1: Violation Log (GovernanceDashboard)
 *  - Tab 2: Policy Editor (CapabilityPolicyEditor)
 *
 * Route: /admin/governance  (register in client Router.tsx)
 */

import React, { useState } from 'react';
import { ShieldAlert, FileCode } from 'lucide-react';
import GovernanceDashboard from '../components/governance/GovernanceDashboard.js';
import CapabilityPolicyEditor from '../components/governance/CapabilityPolicyEditor.js';

type Tab = 'violations' | 'policy';

interface GovernancePageProps {
    /** Organization ID — typically sourced from the auth session context */
    orgId: number;
}

export default function GovernancePage({ orgId }: GovernancePageProps) {
    const [activeTab, setActiveTab] = useState<Tab>('violations');

    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'violations', label: 'Violation Log',   icon: ShieldAlert },
        { id: 'policy',     label: 'Policy Editor',   icon: FileCode    },
    ];

    return (
        <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
            {/* Page title */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Governance</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Monitor capability policy violations and manage per-org agent policies
                </p>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 rounded-lg border border-border/40 bg-muted/30 p-1 w-fit">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            id={`governance-tab-${tab.id}`}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                'flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                                active
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            ].join(' ')}
                        >
                            <Icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Panel content */}
            <div>
                {activeTab === 'violations' && (
                    <GovernanceDashboard pollInterval={30_000} />
                )}
                {activeTab === 'policy' && (
                    <CapabilityPolicyEditor
                        orgId={orgId}
                        onSaved={() => {/* could toast here */}}
                    />
                )}
            </div>
        </div>
    );
}
