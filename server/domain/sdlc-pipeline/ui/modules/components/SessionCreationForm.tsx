import { useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { useCreateSession } from "../hooks/useCreateSession.js";
import type { CreateSessionInput, GenerationSession, VerificationLevel } from "../types/index.js";

const VERIFICATION_LEVELS: { value: VerificationLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "lint_only", label: "Lint only" },
  { value: "type_check", label: "Type check" },
  { value: "full_test", label: "Full test" },
];

export interface SessionCreationFormProps {
  templates?: { id: string; name: string }[];
  onCreated?: (session: GenerationSession) => void;
}

export function SessionCreationForm({ templates, onCreated }: SessionCreationFormProps) {
  const createSession = useCreateSession();
  const [templateId, setTemplateId] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [objective, setObjective] = useState("");
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>("full_test");
  const [budgetLimitUsd, setBudgetLimitUsd] = useState("");
  const [ttlHours, setTtlHours] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: CreateSessionInput = {
      templateId,
      inputParams: { objective, repository, branch },
      budgetLimitUsd: budgetLimitUsd ? Number(budgetLimitUsd) : undefined,
      ttlHours: ttlHours ? Number(ttlHours) : undefined,
      autonomousConfig: {
        verificationLevel,
        maxFixAttempts: 5,
        maxFileCount: 50,
        contextTokenBudget: 100_000,
        dependencyTraceDepth: 3,
        repository: {
          url: repository.startsWith("http") ? repository : undefined,
          workspacePath: repository.startsWith("http") ? undefined : repository,
          branch,
        },
      },
    };
    try {
      const session = await createSession.mutateAsync(input);
      onCreated?.(session);
    } catch {
      // Error toast handled by the hook; keep the form open for correction.
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="session-creation-form">
      <div className="space-y-1">
        <Label htmlFor="template">Template</Label>
        {templates && templates.length > 0 ? (
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="template"><SelectValue placeholder="Select a template" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input id="template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Template ID" required />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="repository">Repository (URL or workspace path)</Label>
          <Input id="repository" value={repository} onChange={(e) => setRepository(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="branch">Branch</Label>
          <Input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="objective">Objective / spec</Label>
        <Textarea id="objective" value={objective} onChange={(e) => setObjective(e.target.value)} rows={3} required />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Verification</Label>
          <Select value={verificationLevel} onValueChange={(v) => setVerificationLevel(v as VerificationLevel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VERIFICATION_LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="budget">Budget ($)</Label>
          <Input id="budget" type="number" min="0" step="0.01" value={budgetLimitUsd} onChange={(e) => setBudgetLimitUsd(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ttl">TTL (hours)</Label>
          <Input id="ttl" type="number" min="0" value={ttlHours} onChange={(e) => setTtlHours(e.target.value)} />
        </div>
      </div>

      <Button type="submit" disabled={createSession.isPending} data-testid="create-session-submit">
        {createSession.isPending ? "Creating…" : "Create Session"}
      </Button>
    </form>
  );
}
