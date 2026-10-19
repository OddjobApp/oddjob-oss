import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { definitionIssues, legacyConsumerWarnings, runStudioTests } from "@shared/form-studio";
import { linkExpiresAt, linkSecurityOf, MAX_LINK_HOURS, type FormLinkAudience } from "@shared/form-studio-link";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatValue } from "../ResultBlocks";
import { Section, type StudioTabProps } from "./editor-controls";
import { describeUse, type FormStudioView, type FormUse } from "./types";

interface PublishTabProps extends StudioTabProps {
  view: FormStudioView;
  busy: boolean;
  onPublish: () => Promise<{ releaseNumber: number; warnings: string[] }>;
  /** Reload the form after its link changed. */
  onLinkChanged?: () => Promise<void>;
}

/**
 * The published form's public link: copy or open it, whether it asks for an emailed
 * code, how long it works, and a new link when the old one has spread too far.
 */
export function LinkSection({ view, onLinkChanged }: { view: FormStudioView; onLinkChanged?: () => Promise<void> }) {
  const security = linkSecurityOf(view.securityConfig);
  const [requireOtp, setRequireOtp] = useState(security.requireOtp);
  const [hours, setHours] = useState(security.tokenExpirationHours ? String(security.tokenExpirationHours) : "");
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<FormLinkAudience | null>(null);
  const access = useQuery<{ project: { key: string; name: string; visibility: string } | null; chosen: FormLinkAudience | null; audience: FormLinkAudience }>({
    queryKey: ["/api/form-studio", view.id, "link", view.published?.releaseNumber ?? 0],
    queryFn: async () => (await apiRequest("GET", `/api/form-studio/${view.id}/link`)).json(),
    enabled: Boolean(view.published),
  });

  if (!view.published) {
    return <p className="text-xs text-muted-foreground">Publish the form to get a link people can fill it in at.</p>;
  }

  const url = typeof window === "undefined" ? view.published.href : `${window.location.origin}${view.published.href}`;
  const expiresAt = linkExpiresAt(view.published.at, security);
  const hoursValue = hours.trim() ? Number(hours) : null;
  const hoursValid = hoursValue === null || (Number.isInteger(hoursValue) && hoursValue >= 1 && hoursValue <= MAX_LINK_HOURS);
  // A form in a private Project Space picks who its link is for; anywhere else a link is for anyone.
  const project = access.data?.project ?? null;
  const inPrivateProject = project?.visibility === "private";
  const savedAudience: FormLinkAudience = access.data?.audience ?? "anyone";
  const selectedAudience: FormLinkAudience = inPrivateProject ? audience ?? savedAudience : "anyone";
  const membersOnlySaved = savedAudience === "project_members";
  const membersOnlySelected = selectedAudience === "project_members";
  const changed = requireOtp !== security.requireOtp || hoursValue !== security.tokenExpirationHours || selectedAudience !== savedAudience;

  const run = async (work: () => Promise<unknown>, done: string, setBusy: (busy: boolean) => void) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await onLinkChanged?.();
      setNotice(done);
    } catch (err) {
      setError((err as Error).message || "The link could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setError("Copying was blocked by the browser. Select the link and copy it instead.");
    }
  };

  return (
    <div className="grid gap-3 rounded-md border p-3" data-testid="form-link-section">
      <div className="grid gap-1">
        <p className="text-sm font-medium">{membersOnlySaved ? "Members-only link" : "Public link"}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs" title={url}>{url}</code>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}><Copy className="mr-1 h-3.5 w-3.5" />Copy</Button>
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={view.published.href} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {expiresAt ? (expiresAt.getTime() <= Date.now() ? "This link has expired." : `Works until ${expiresAt.toLocaleString()}.`) : "This link does not expire."}
        </p>
      </div>

      {inPrivateProject && project && (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Who can open this link</legend>
          <label className="flex items-center gap-2 text-sm" htmlFor="form-link-audience-members">
            <input
              type="radio" id="form-link-audience-members" name="form-link-audience"
              checked={membersOnlySelected} onChange={() => setAudience("project_members")}
            />
            Members of {project.name}, after confirming their email with a code
          </label>
          <label className="flex items-center gap-2 text-sm" htmlFor="form-link-audience-anyone">
            <input
              type="radio" id="form-link-audience-anyone" name="form-link-audience"
              checked={!membersOnlySelected} onChange={() => setAudience("anyone")}
            />
            Anyone with the link
          </label>
          {!membersOnlySelected && (
            <p className="text-xs text-muted-foreground">{project.name} is a private project. Anyone with this link can open the form and answer it.</p>
          )}
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm" htmlFor="form-link-require-otp">
        <Checkbox
          id="form-link-require-otp" checked={requireOtp || membersOnlySelected} disabled={membersOnlySelected}
          onCheckedChange={(checked) => setRequireOtp(checked === true)}
        />
        {membersOnlySelected ? "A members-only link always asks for an email code" : "Ask respondents to confirm their email with a code first"}
      </label>
      <label className="grid gap-1 text-sm" htmlFor="form-link-hours">
        Link works for this many hours after publishing (leave empty for no limit)
        <Input id="form-link-hours" inputMode="numeric" className="max-w-40" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))} />
      </label>
      {!hoursValid && <p className="text-xs text-destructive">Enter a whole number of hours from 1 to {MAX_LINK_HOURS}.</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!changed || !hoursValid || saving}
          onClick={() => void run(async () => {
            await apiRequest("PUT", `/api/form-studio/${view.id}/link`, { requireOtp, tokenExpirationHours: hoursValue, ...(inPrivateProject ? { audience: selectedAudience } : {}) });
            setAudience(null);
            await access.refetch();
          }, "Link settings saved. They apply to the link now.", setSaving)}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save link settings
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={rotating} onClick={() => setConfirmRotate(true)}>
          {rotating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Replace link
        </Button>
      </div>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the public link?</AlertDialogTitle>
            <AlertDialogDescription>
              The current link stops working straight away, including for anyone part-way through the form. Share the new link with the people who should still answer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(() => apiRequest("POST", `/api/form-studio/${view.id}/link/rotate`), "The old link no longer works. Copy the new one above.", setRotating)}>
              Replace link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface ReleaseRow { releaseNumber: number; formRevision: number; name: string; summary: string; createdAt: string }
interface ResponseRow { id: number; submittedAt: string | null; data: Record<string, unknown> | null; config: any }

/** What blocks publishing, what a release affects, the releases so far, and responses. */
export function PublishTab({ draft, view, busy, onPublish, onLinkChanged }: PublishTabProps) {
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [outcome, setOutcome] = useState<{ releaseNumber: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problems = useMemo(() => {
    const failing = runStudioTests(draft.schema).filter((t) => !t.passed).map((t) => `Test “${t.name}” fails.`);
    return [...definitionIssues(draft.schema), ...draft.schema.studio.issues.map((issue) => `Open issue: ${issue}`), ...failing];
  }, [draft.schema]);
  const warnings = useMemo(() => legacyConsumerWarnings(draft.schema), [draft.schema]);

  const usage = useQuery<{ usedBy: FormUse[]; waitingRequests: number }>({
    queryKey: ["/api/form-studio", view.id, "usage"],
    queryFn: async () => (await apiRequest("GET", `/api/form-studio/${view.id}/usage`)).json(),
  });
  const releases = useQuery<ReleaseRow[]>({
    queryKey: ["/api/form-studio", view.id, "releases", view.published?.releaseNumber ?? 0],
    queryFn: async () => (await apiRequest("GET", `/api/form-studio/${view.id}/releases`)).json(),
  });
  const responses = useQuery<ResponseRow[]>({
    queryKey: ["/api/form-studio", view.id, "responses"],
    queryFn: async () => (await apiRequest("GET", `/api/form-studio/${view.id}/responses`)).json(),
  });

  const publish = async () => {
    setConfirming(false);
    setPublishing(true);
    setError(null);
    try {
      setOutcome(await onPublish());
    } catch (err) {
      setError((err as Error).message || "The form could not be published.");
    } finally {
      setPublishing(false);
    }
  };

  const status = view.published
    ? view.published.draftAhead ? `v${view.published.releaseNumber} is published; this draft has changes since.` : `v${view.published.releaseNumber} is published and matches this draft.`
    : "Not published yet.";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-6">
        <Section title="Publish" description={status}>
          {problems.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Checks pass and tests pass.</p>
          ) : (
            <div>
              <p className="text-sm font-medium">{problems.length === 1 ? "1 problem blocks publishing" : `${problems.length} problems block publishing`}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {outcome && (
            <div role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              Published v{outcome.releaseNumber}. Responses in progress keep the release they started on.
            </div>
          )}
          <div>
            <Button type="button" onClick={() => setConfirming(true)} disabled={busy || publishing || problems.length > 0 || Boolean(view.published && !view.published.draftAhead)}>
              {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {view.published && !view.published.draftAhead ? `v${view.published.releaseNumber} is current` : `Publish v${(view.published?.releaseNumber ?? 0) + 1}`}
            </Button>
            {busy && <p className="mt-1 text-xs text-muted-foreground">Waiting for your changes to save.</p>}
          </div>
          <LinkSection view={view} onLinkChanged={onLinkChanged} />
        </Section>

        <Section title="What this affects">
          {usage.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : usage.error ? <p className="text-sm text-destructive">{(usage.error as Error).message}</p> : (
            <div className="grid gap-2 text-sm">
              {usage.data?.usedBy.length ? (
                <ul className="grid gap-1">
                  {usage.data.usedBy.map((use, i) => (
                    <li key={i}>
                      {describeUse(use)}
                      {use.via === "name" && <span className="text-xs text-muted-foreground"> · finds this form by name</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-muted-foreground">Nothing uses this form yet.</p>}
              {Boolean(usage.data?.waitingRequests) && <p>{usage.data!.waitingRequests} {usage.data!.waitingRequests === 1 ? "request is" : "requests are"} waiting on someone.</p>}
              {warnings.length > 0 && (
                <div>
                  <p className="font-medium">Older form screens will not show everything</p>
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Releases">
          {releases.data?.length ? (
            <ul className="grid gap-1 text-sm">
              {releases.data.map((release) => (
                <li key={release.releaseNumber} className="flex justify-between gap-2 rounded-md border px-3 py-2">
                  <span className="font-medium">v{release.releaseNumber} · {release.name}</span>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(release.createdAt), { addSuffix: true })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No releases yet.</p>}
        </Section>
      </div>

      <Section title="Responses" description="Submissions to published releases.">
        {responses.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : responses.data?.length ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Submitted</th><th className="px-3 py-2 font-medium">Release</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Answers</th></tr>
              </thead>
              <tbody className="divide-y">
                {responses.data.map((row) => {
                  const meta = row.config?.formStudioResponse ?? {};
                  const values = Object.entries(row.data ?? {}).slice(0, 3);
                  return (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-3 py-2">{row.submittedAt ? formatDistanceToNow(new Date(row.submittedAt), { addSuffix: true }) : "—"}</td>
                      <td className="px-3 py-2">{meta.releaseNumber ? `v${meta.releaseNumber}` : "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {meta.decision?.state === "decided" ? meta.decision.status : "—"}
                        {Object.values(meta.runtime?.actions ?? {}).map((action: any, i) => (
                          <span key={i} className="block font-sans text-muted-foreground">{action.label}: {String(action.status).replace(/_/g, " ")}</span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{values.map(([k, v]) => `${k}: ${formatValue(v)}`).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">No responses yet.</p>}
      </Section>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish v{(view.published?.releaseNumber ?? 0) + 1}?</AlertDialogTitle>
            <AlertDialogDescription>
              New responses use this release. Responses already under way keep the release they started on.
              {usage.data?.usedBy.length ? ` It is used by ${usage.data.usedBy.map(describeUse).join("; ")}.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish()}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
