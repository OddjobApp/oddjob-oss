/**
 * CapabilityPolicyEditor
 *
 * Inline YAML editor for an org's capability policy.
 * Fetches the current YAML from GET /api/governor/capability-policy/:orgId,
 * lets the admin edit it in a textarea, then PUT to save + hot-reload.
 *
 * Usage:
 *   <CapabilityPolicyEditor orgId={42} />
 */

import React, { useState, useEffect, useCallback } from 'react';
import { FileCode, Save, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';

const POLICY_TEMPLATE = `# Capability Policy for Org {orgId}
# ------------------------------------------------------------------
# enforcement: strict | warn | log
# tools:       list of tool names, or '*' for all
# filePaths:   glob patterns, e.g. '/data/**'
# networkDestinations: hostnames or '*'
# modelCap:    haiku | sonnet | opus
# ------------------------------------------------------------------
organization: org-{orgId}
enforcement: warn

roles:
  analyst:
    tools:
      - web_search
      - data_analysis
      - report_generation
    filePaths:
      - /data/public/**
      - /reports/**
    networkDestinations:
      - api.public.com
    modelCap: sonnet
    maxDailyRequests: 500

  admin:
    tools: '*'
    filePaths:
      - /**
    networkDestinations: '*'
    modelCap: opus
`;

interface CapabilityPolicyEditorProps {
    orgId: number;
    /** Called after a successful save */
    onSaved?: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export default function CapabilityPolicyEditor({ orgId, onSaved }: CapabilityPolicyEditorProps) {
    const [yaml, setYaml]             = useState<string>('');
    const [loading, setLoading]       = useState(true);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
    const [errorMsg, setErrorMsg]     = useState<string | null>(null);

    const loadPolicy = useCallback(() => {
        setLoading(true);
        fetch(`/api/governor/capability-policy/${orgId}`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
            .then(data => {
                setYaml(data.yaml ?? POLICY_TEMPLATE.replace(/\{orgId\}/g, String(orgId)));
                setLoading(false);
            })
            .catch(err => {
                setYaml(POLICY_TEMPLATE.replace(/\{orgId\}/g, String(orgId)));
                setLoading(false);
            });
    }, [orgId]);

    useEffect(() => { loadPolicy(); }, [loadPolicy]);

    const handleSave = async () => {
        setSaveStatus('saving');
        setErrorMsg(null);
        try {
            const res = await fetch(`/api/governor/capability-policy/${orgId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            setSaveStatus('success');
            onSaved?.();
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (err: any) {
            setSaveStatus('error');
            setErrorMsg(err.message);
        }
    };

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <FileCode className="h-4 w-4 text-primary" />
                    <span>Capability Policy — Org {orgId}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadPolicy}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <RefreshCw className="h-3 w-3" />
                        Reset
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saveStatus === 'saving' || loading}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        {saveStatus === 'saving'
                            ? <RefreshCw className="h-3 w-3 animate-spin" />
                            : saveStatus === 'success'
                            ? <CheckCircle className="h-3 w-3" />
                            : <Save className="h-3 w-3" />
                        }
                        {saveStatus === 'saving'   ? 'Saving…'  :
                         saveStatus === 'success'  ? 'Saved!'   : 'Save & Reload'}
                    </button>
                </div>
            </div>

            {/* Error banner */}
            {saveStatus === 'error' && errorMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>{errorMsg}</span>
                </div>
            )}

            {/* YAML editor */}
            {loading
                ? <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />
                : (
                    <textarea
                        id="capability-policy-yaml-editor"
                        title="YAML Policy Editor"
                        placeholder="YAML Policy Configuration"
                        aria-label="YAML Policy Editor"
                        value={yaml}
                        onChange={e => setYaml(e.target.value)}
                        spellCheck={false}
                        className={[
                            'w-full min-h-[340px] rounded-lg border bg-background px-4 py-3',
                            'font-mono text-[13px] leading-relaxed text-[#e6edf3]',
                            'resize-y focus:outline-none focus:ring-2 focus:ring-primary/50',
                            saveStatus === 'error' ? 'border-red-400' : 'border-border/40',
                        ].join(' ')}
                    />
                )
            }

            <p className="text-[10px] text-muted-foreground">
                Saving will validate the YAML and hot-reload the policy immediately — no restart required.
            </p>
        </div>
    );
}
