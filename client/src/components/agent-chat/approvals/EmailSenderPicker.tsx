import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
export type EmailSenderChoice = { connectorId: number; email: string; provider: "google" | "microsoft"; remember?: boolean };
type Account = { connectorId: number; provider: "google" | "microsoft"; email: string; scope: string };
export function EmailSenderPicker({ url, onChange, disabled }: { url: string; onChange: (choice: EmailSenderChoice | null) => void; disabled: boolean }) {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selected, setSelected] = useState("");
    const [remember, setRemember] = useState(false);
    const [preferred, setPreferred] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [unavailable, setUnavailable] = useState(0);
    const [projectId, setProjectId] = useState<number | null>(null);
    const connectionUrl = (provider: "google" | "microsoft") => {
        const params = new URLSearchParams(new URL(url, window.location.origin).search);
        params.set("for", provider === "google" ? "gmail" : "email");
        if (projectId != null) params.set("projectId", String(projectId));
        params.set("returnTo", window.location.pathname + window.location.search);
        return `/api/saas/connectors/${provider}/oauth/initiate?${params}`;
    };
    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(false); setSelected(""); setRemember(false); onChange(null);
        (async () => {
            try {
                const response = await apiRequest("GET", url);
                const data = await response.json();
                if (cancelled) return;
                setAccounts(data.accounts); setProjectId(data.projectId ?? null); setUnavailable(data.unavailable ?? 0); setPreferred(data.preferredConnectorId);
                const choice = data.accounts.find((a: Account) => a.connectorId === data.preferredConnectorId);
                if (choice) { setSelected(String(choice.connectorId)); onChange({ connectorId: choice.connectorId, email: choice.email, provider: choice.provider, remember: false }); }
            } catch { if (!cancelled) setError(true); }
            finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [url]);
    const choose = (id: string, save: boolean) => {
        setSelected(id); setRemember(save);
        const account = accounts.find(a => String(a.connectorId) === id);
        onChange(account ? { connectorId: account.connectorId, email: account.email, provider: account.provider, remember: save } : null);
    };
    return <fieldset className="mb-3 space-y-2 rounded-lg border border-border p-3" disabled={disabled || loading}>
        <legend className="px-1 text-sm font-medium">Confirm email sender</legend>
        <p className="text-xs text-muted-foreground">AgentMail handles Oddjob and room notifications. Send this email through a connected Google or Microsoft account.</p>
        {loading && <p role="status">Checking connected email accounts…</p>}
        {error && <p role="alert">Could not verify email accounts. Reload this draft before sending.</p>}
        {!loading && !error && accounts.length === 0 && <p role="alert">Connect Google or Microsoft with email sending permission in Integrations, then reload this draft. AgentMail will not be used as a fallback.</p>}
        {unavailable > 0 && <p className="text-xs">Some connections need reconnection or email sending permission before they can be used.</p>}
        {!loading && !error && (accounts.length === 0 || unavailable > 0) && <p className="text-xs"><a className="underline" href={connectionUrl("google")}>Connect Google email</a> · <a className="underline" href={connectionUrl("microsoft")}>Enable Microsoft email sending</a></p>}
        {accounts.length > 0 && <>
            <label className="block text-sm">Send from<select className="mt-1 w-full rounded border border-input bg-background p-2 text-foreground" value={selected} onChange={event => choose(event.target.value, remember)}>
                <option value="">Choose an account</option>
                {accounts.map(account => <option key={account.connectorId} value={account.connectorId}>{account.provider === "google" ? "Google" : "Microsoft"} · {account.email} ({account.scope} connection)</option>)}
            </select></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={remember} onChange={event => choose(selected, event.target.checked)} />Remember this sender for my outbound email in this organization</label>
            <p className="text-xs text-muted-foreground">You still confirm each email before it is sent.</p>
            {preferred != null && <Button type="button" size="sm" variant="outline" onClick={async () => {
                try { const query = new URL(url, window.location.origin).search; await apiRequest("DELETE", `/api/approvals/email-sender/preference${query}`); setPreferred(null); choose("", false); }
                catch { setError(true); }
            }}>Forget saved sender</Button>}
        </>}
    </fieldset>;
}
