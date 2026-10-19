import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import type { StudioDefinition } from "@shared/form-studio";
import { FORM_SESSION_HEADER } from "@shared/form-studio-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StudioRenderer, type StudioRendererSubmit } from "./StudioRenderer";

/**
 * A published form, filled in by anyone with its link: on its own page, or inside
 * a published agent's conversation.
 *
 * Nobody signs in. When the form asks for it, the respondent first confirms an
 * email address with a code; the session that earns is kept for this browser tab
 * only. What they get back after submitting is the result blocks marked for
 * respondents, never the reviewer's scores or the form's rules.
 */

interface PublishedForm {
  name: string;
  revision: number;
  releaseNumber: number;
  requireOtp: boolean;
  schema: StudioDefinition;
}

type State =
  | { kind: "loading" }
  | { kind: "code"; name: string; step: "email" | "code"; membersOnly?: boolean }
  | { kind: "ready"; form: PublishedForm }
  | { kind: "gone"; message: string };

const sessionKey = (token: string) => `form-session:${token}`;

function readSession(token: string): string | null {
  try { return window.sessionStorage.getItem(sessionKey(token)); } catch { return null; }
}
function writeSession(token: string, session: string | null) {
  try {
    if (session) window.sessionStorage.setItem(sessionKey(token), session);
    else window.sessionStorage.removeItem(sessionKey(token));
  } catch { /* A tab that cannot store the session asks for a code again. */ }
}

async function bodyOf(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export interface PublicFormProps {
  token: string;
  /** Inside a conversation: a smaller heading and no page-level framing. */
  compact?: boolean;
  className?: string;
}

export function PublicForm({ token, compact = false, className }: PublicFormProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const session = readSession(token);
    return { "Content-Type": "application/json", ...(session ? { [FORM_SESSION_HEADER]: session } : {}) };
  }, [token]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/form-studio/public/${encodeURIComponent(token)}`, { headers: headers() });
    if (res.status === 401) {
      writeSession(token, null);
      const body = await res.json().catch(() => ({}));
      setState({ kind: "code", name: body?.name ?? "This form", step: "email", membersOnly: Boolean(body?.membersOnly) });
      return;
    }
    if (res.status === 403) {
      writeSession(token, null);
      return setState({ kind: "gone", message: await messageOf(res, "This form is only for members of its project.") });
    }
    if (res.status === 404) return setState({ kind: "gone", message: "This form link does not exist, or the form is no longer shared." });
    if (!res.ok) return setState({ kind: "gone", message: await messageOf(res, "This form could not be loaded. Try again in a moment.") });
    setState({ kind: "ready", form: await res.json() });
  }, [headers, token]);

  useEffect(() => { void load(); }, [load]);

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/form-studio/public/${encodeURIComponent(token)}/code`, { method: "POST", headers: headers(), body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(await messageOf(res, "The code could not be sent."));
      const sent = await bodyOf(res);
      // A members-only link answers the same for every email, so who the members are is not given away.
      setNotice(sent?.membersOnly
        ? `If ${email} belongs to a member of this project, we sent it a 6-digit code. It works for 10 minutes.`
        : `We sent a 6-digit code to ${email}. It works for 10 minutes.`);
      setState((s) => (s.kind === "code" ? { ...s, step: "code" } : s));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/form-studio/public/${encodeURIComponent(token)}/code/verify`, { method: "POST", headers: headers(), body: JSON.stringify({ email, code }) });
      if (!res.ok) throw new Error(await messageOf(res, "That code could not be checked."));
      const { session } = await res.json();
      writeSession(token, session);
      setNotice(null);
      setState({ kind: "loading" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const submit = async (form: PublishedForm, inputs: Record<string, unknown>): Promise<StudioRendererSubmit> => {
    const res = await fetch(`/api/form-studio/public/${encodeURIComponent(token)}`, { method: "POST", headers: headers(), body: JSON.stringify({ revision: form.revision, inputs }) });
    if (res.status === 401) {
      writeSession(token, null);
      throw new Error("Your email confirmation ran out. Reload the page and confirm your email again; your answers are still here until you do.");
    }
    if (res.status === 403) throw new Error(await messageOf(res, "Only members of this project can answer this form."));
    if (res.status === 409) throw new Error("A new version of this form was published. Reload the page to answer the current version.");
    if (!res.ok) throw new Error(await messageOf(res, "Your answers could not be submitted. Try again."));
    const body = await res.json();
    return { results: body.results ?? [] };
  };

  const Heading = compact ? "h3" : "h1";
  const headingClass = compact ? "text-base font-semibold" : "text-lg font-semibold";

  if (state.kind === "loading") {
    return (
      <p className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground", compact ? "py-6" : "py-24", className)} role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the form…
      </p>
    );
  }

  if (state.kind === "gone") {
    return (
      <div className={cn("rounded-xl border bg-card p-6 text-center shadow-sm", className)} role="alert">
        <Heading className={headingClass}>This form is not available</Heading>
        <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "code") {
    return (
      <div className={cn("rounded-xl border bg-card p-6 shadow-sm", className)}>
        <Heading className={headingClass}>{state.name}</Heading>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.membersOnly ? "This form is for members of its project. Confirm your email address to open it." : "Confirm your email address to open this form."}
        </p>
        {state.step === "email" ? (
          <form className="mt-5 grid gap-3" onSubmit={requestCode}>
            <label className="grid gap-1 text-sm font-medium" htmlFor={`public-form-email-${token}`}>
              Email address
              <Input id={`public-form-email-${token}`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <Button type="submit" disabled={working || !email.trim()}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send code
            </Button>
          </form>
        ) : (
          <form className="mt-5 grid gap-3" onSubmit={verifyCode}>
            {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
            <label className="grid gap-1 text-sm font-medium" htmlFor={`public-form-code-${token}`}>
              Code
              <Input id={`public-form-code-${token}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={working || code.length !== 6}>
                {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Open the form
              </Button>
              <Button type="button" variant="ghost" disabled={working} onClick={() => { setCode(""); setState((s) => (s.kind === "code" ? { ...s, step: "email" } : s)); }}>
                Use a different email
              </Button>
            </div>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border bg-card p-6 shadow-sm", className)} data-testid="public-form">
      <Heading className={cn(headingClass, "mb-4", !compact && "text-xl")}>{state.form.name}</Heading>
      <StudioRenderer definition={state.form.schema} audience="respondent" onSubmit={(inputs) => submit(state.form, inputs)} />
    </div>
  );
}

export default PublicForm;
