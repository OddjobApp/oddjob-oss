import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { skillDefinitionSchema, type SkillInput, type SkillStep } from "@shared/computer-use-skill";

const base = "/api/integrations/trycua";
export interface LearnedSkill {
  id: string; name: string; description: string | null; procedure: string;
  status: string; inputs: SkillInput[]; steps: SkillStep[];
}
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  return (await apiRequest(method, `${base}${url}`, body)).json();
}

/** One teaching surface in both the standalone studio and the studio embedded in chat. */
export function TeachTaskPanel({ sessionId, organizationId, canRecord, busy, onRecording, onTest, onClose }: {
  sessionId: string; organizationId?: number; canRecord: boolean; busy: boolean;
  onRecording: (recording: boolean) => void; onTest: (taskId: string) => void; onClose: () => void;
}) {
  const cache = useQueryClient();
  const key = [base, organizationId, "teaching"];
  const [goal, setGoal] = useState("");
  const [skill, setSkill] = useState<LearnedSkill>();
  const [repairAt, setRepairAt] = useState<number>();
  const [revision, setRevision] = useState(0);
  const recordings = useQuery({ queryKey: [...key, "recordings"],
    queryFn: () => request<{ recordings: Array<{ id: string; status: string; stepCount: number }>; activeRecordingId: string | null }>("GET", "/desktop/recordings"),
    refetchInterval: 3000,
  });
  const skills = useQuery({ queryKey: [...key, "skills"], queryFn: () => request<{ skills: LearnedSkill[] }>("GET", "/skills") });
  const active = recordings.data?.activeRecordingId;
  useEffect(() => { if (recordings.isSuccess) onRecording(!!active); }, [active, recordings.isSuccess]);
  const refresh = () => cache.invalidateQueries({ queryKey: key });
  const record = useMutation({ mutationFn: () => request("POST", "/desktop/recordings", {}), onSuccess: () => { onRecording(true); refresh(); } });
  const stop = useMutation({ mutationFn: () => request("POST", `/desktop/recordings/${active}/stop`, {}), onSuccess: () => { onRecording(false); refresh(); } });
  const synthesize = useMutation({ mutationFn: (id: string) => repairAt !== undefined && skill
    ? request<{ skill: LearnedSkill }>("POST", `/skills/${skill.id}/repair`, { recordingId: id, stepIndex: repairAt })
    : request<{ skill: LearnedSkill }>("POST", `/desktop/recordings/${id}/skill`, { goal }),
    onSuccess: data => { setSkill(data.skill); setRepairAt(undefined); setRevision(v => v + 1); refresh(); },
  });
  const error = recordings.error || skills.error || record.error || stop.error || synthesize.error;
  return <aside className="w-[26rem] max-w-full shrink-0 overflow-y-auto border-l border-border p-4" aria-label="Teach a task">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Teach a task</h3><Button variant="ghost" size="sm" onClick={onClose}>Back to task</Button></div>
    <p className="my-3 text-sm text-muted-foreground">Log in on the desktop, record your workflow, then review and test it. Approved skills are shared with your organization.</p>
    <label className="grid gap-1 text-sm">What are you teaching?<Input value={goal} onChange={e => setGoal(e.target.value)} placeholder="Download an account's monthly invoice" /></label>
    <div className="my-3 flex gap-2">
      {active ? <Button variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>Stop recording</Button>
        : <Button onClick={() => record.mutate()} disabled={!canRecord || busy || record.isPending || recordings.isPending || !!recordings.error}>Start recording</Button>}
    </div>
    {active ? <p role="status" className="text-sm">Recording browser actions. Password and one-time-code values are excluded.</p>
      : !canRecord && <p className="text-sm text-muted-foreground">Connect the live desktop and wait for running tasks to stop before recording.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p>}
    {repairAt !== undefined && <p className="text-sm">Record the replacement for step {repairAt + 1}, then stop and apply the recording. <Button size="sm" variant="ghost" onClick={() => setRepairAt(undefined)}>Cancel repair</Button></p>}
    <div className="my-3 space-y-2">
      {recordings.data?.recordings.filter(r => r.status === "stopped" && r.stepCount > 0).map(r => <div key={r.id} className="flex items-center justify-between rounded border border-border p-2 text-sm">
        <span>{r.stepCount} recorded steps</span><Button size="sm" variant="outline" disabled={synthesize.isPending || !!active} onClick={() => synthesize.mutate(r.id)}>{repairAt !== undefined ? "Apply replacement" : "Make skill"}</Button>
      </div>)}
    </div>
    <label className="grid gap-1 text-sm">Organization skills
      <select className="rounded border border-input bg-background p-2" value={skill?.id ?? ""} onChange={e => setSkill(skills.data?.skills.find(s => s.id === e.target.value))}>
        <option value="">Choose a skill to review</option>
        {skills.data?.skills.filter(s => s.status !== "archived").map(s => <option key={s.id} value={s.id}>{s.name} · {s.status}</option>)}
      </select>
    </label>
    {skill && <SkillEditor key={`${skill.id}:${revision}`} skill={skill} sessionId={sessionId} busy={busy || !!active} onSaved={s => { setSkill(s); refresh(); }} onTest={onTest} onRepair={setRepairAt} />}
  </aside>;
}

export function SkillEditor({ skill, sessionId, busy, onSaved, onTest, onRepair }: {
  skill: LearnedSkill; sessionId: string; busy: boolean; onSaved: (s: LearnedSkill) => void; onTest: (id: string) => void;
  onRepair?: (index: number) => void;
}) {
  const [name, setName] = useState(skill.name);
  const [procedure, setProcedure] = useState(skill.procedure);
  const [steps, setSteps] = useState<SkillStep[]>(skill.steps);
  const [inputs, setInputs] = useState<SkillInput[]>(skill.inputs);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [testId, setTestId] = useState<string>();
  const [validation, setValidation] = useState("");
  const changed = () => { setDirty(true); setTestId(undefined); };
  const patchStep = (index: number, patch: Partial<SkillStep>) => { changed(); setSteps(old => old.map((s, i) => i === index ? { ...s, ...patch } : s)); };
  const save = useMutation({ mutationFn: async () => {
    const parsed = skillDefinitionSchema.safeParse({ inputs, steps });
    if (!name.trim()) throw new Error("Give the skill a name");
    if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join("; "));
    return request<{ skill: LearnedSkill }>("PATCH", `/skills/${skill.id}`, { name, procedure, inputs: parsed.data.inputs, steps: parsed.data.steps });
  }, onSuccess: data => { setDirty(false); onSaved(data.skill); } });
  const test = useMutation({ mutationFn: async () => {
    const created = await request<{ task: { id: string } }>("POST", `/skills/${skill.id}/test`, { sessionId, skillInputs: values });
    setTestId(created.task.id); onTest(created.task.id);
    return request("POST", `/computer-use/tasks/${created.task.id}/run`, {});
  } });
  const result = useQuery({ queryKey: [base, "skill-test", testId], enabled: !!testId,
    queryFn: () => request<{ task: { status: string; error?: string }; steps: Array<{ result?: { outputs?: Record<string, unknown>; stoppedAt?: { reason: string } }; error?: string }> }>("GET", `/computer-use/tasks/${testId}`),
    refetchInterval: query => ["succeeded", "failed", "cancelled", "blocked"].includes(query.state.data?.task.status ?? "") ? false : 2000,
  });
  const approve = useMutation({ mutationFn: () => request<{ skill: LearnedSkill }>("POST", `/skills/${skill.id}/approve`, {}), onSuccess: data => onSaved(data.skill) });
  const parameterize = (index: number, variable: string) => {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(variable)) { setValidation("Use a lowercase variable name with underscores"); return; }
    setValidation("");
    if (!inputs.some(i => i.name === variable)) setInputs(old => [...old, { name: variable, type: "string", required: true, example: steps[index].value }]);
    patchStep(index, { value: `{{${variable}}}` });
  };
  const add = (kind: "wait" | "extract") => { changed(); setSteps(old => [...old, { kind, url: old.at(-1)?.url ?? "", at: 0, target: { tag: "div", css: "body" }, ...(kind === "extract" ? { output: `result_${old.length}`, extractMode: "text" as const } : {}) }]); };
  const error = save.error || test.error || approve.error || result.error;
  return <div className="mt-4 space-y-4" aria-label="Skill editor">
    <label className="grid gap-1 text-sm">Skill name<Input value={name} onChange={e => { changed(); setName(e.target.value); }} /></label>
    <label className="grid gap-1 text-sm">Procedure<Textarea value={procedure} onChange={e => { changed(); setProcedure(e.target.value); }} /></label>
    <h4 className="text-sm font-semibold">Steps and outputs</h4>
    {steps.map((step, index) => <fieldset key={index} className="space-y-2 rounded border border-border p-2">
      <legend className="px-1 text-xs">{index + 1}. {step.kind}{step.secret ? " · human input" : ""}</legend>
      {step.kind === "navigate" && <label className="grid gap-1 text-xs">URL<Input value={step.url} onChange={e => patchStep(index, { url: e.target.value })} /></label>}
      {step.target && <label className="grid gap-1 text-xs">Target selector<Input value={step.target.css} onChange={e => patchStep(index, { target: { tag: step.target!.tag, css: e.target.value } })} /></label>}
      {["fill", "select"].includes(step.kind) && !step.secret && <>
        <label className="grid gap-1 text-xs">Value or template<Input value={step.value ?? ""} onChange={e => patchStep(index, { value: e.target.value })} /></label>
        <label className="grid gap-1 text-xs">Make this value a variable<Input placeholder="company_name (press Enter)" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); parameterize(index, e.currentTarget.value); e.currentTarget.value = ""; } }} /></label>
      </>}
      {step.kind === "extract" && <label className="grid gap-1 text-xs">Return
        <select className="rounded border border-input bg-background p-2" value={step.extractMode ?? "text"} onChange={e => patchStep(index, { extractMode: e.target.value as SkillStep["extractMode"] })}>
          <option value="text">Text</option><option value="table">Table rows</option><option value="structured_json">Structured elements</option><option value="attribute">Attribute</option><option value="url">Page URL</option>
        </select>
      </label>}
      {step.extractMode === "attribute" && <label className="grid gap-1 text-xs">Attribute<Input value={step.attribute ?? ""} onChange={e => patchStep(index, { attribute: e.target.value })} /></label>}
      {["click", "extract"].includes(step.kind) && <label className="grid gap-1 text-xs">{step.kind === "click" ? "Downloaded file output (optional)" : "Output name"}<Input value={step.output ?? ""} onChange={e => patchStep(index, { output: e.target.value || undefined })} /></label>}
      <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={index === 0} onClick={() => { changed(); const copy = [...steps]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; setSteps(copy); }}>Move up</Button><Button size="sm" variant="ghost" onClick={() => { changed(); setSteps(steps.filter((_, i) => i !== index)); }}>Remove step</Button></div>
      {onRepair && <Button size="sm" variant="outline" disabled={dirty || busy} onClick={() => onRepair(index)}>Re-teach this step</Button>}
    </fieldset>)}
    <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => add("wait")}>Add wait</Button><Button size="sm" variant="outline" onClick={() => add("extract")}>Add output</Button></div>
    <h4 className="text-sm font-semibold">Inputs and test values</h4>
    {inputs.map((input, index) => <div key={input.name} className="grid gap-2 rounded border border-border p-2">
      <label className="grid gap-1 text-xs">{input.name}<Input aria-label={`Test value for ${input.name}`} placeholder={input.example ?? "Test value"} value={values[input.name] ?? ""} onChange={e => setValues({ ...values, [input.name]: e.target.value })} /></label>
      <label className="grid gap-1 text-xs">Type<select className="rounded border border-input bg-background p-2" value={input.type ?? "string"} onChange={e => { changed(); setInputs(inputs.map((v, i) => i === index ? { ...v, type: e.target.value as SkillInput["type"] } : v)); }}><option value="string">Text</option><option value="date">Date (YYYY-MM-DD)</option><option value="number">Number</option></select></label>
      <Button size="sm" variant="ghost" onClick={() => { changed(); setInputs(inputs.filter((_, i) => i !== index)); }}>Remove input</Button>
    </div>)}
    {(error || validation) && <p role="alert" className="text-sm text-destructive">{validation || (error as Error)?.message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending || test.isPending}>Save draft</Button>
      <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={dirty || busy || !sessionId || test.isPending}>Test on desktop</Button>
      {skill.status !== "active" && <Button size="sm" variant="outline" onClick={() => approve.mutate()} disabled={dirty || approve.isPending || busy}>Approve skill</Button>}
    </div>
    <p className="text-xs text-muted-foreground">Tests perform the actual recorded actions and retain governance checks. Approval requires an organization admin. Saving behavior changes returns an active skill to draft.</p>
    {result.data && <div className="space-y-2 text-sm" role="status"><p>Test: {result.data.task.status}</p>
      {result.data.task.status === "needs_confirmation" && <p>Review the pending approval in the task panel, then start the task.</p>}
      {result.data.steps.map((s, i) => <div key={i}>{s.error || s.result?.stoppedAt?.reason}<SkillOutputs outputs={s.result?.outputs} /></div>)}
    </div>}
  </div>;
}

export function SkillOutputs({ outputs }: { outputs?: Record<string, unknown> }) {
  if (!outputs || !Object.keys(outputs).length) return null;
  return <div className="space-y-2">{Object.entries(outputs).map(([name, value]) => <div key={name}>
    <strong className="text-xs">{name}</strong>
    {value && typeof value === "object" && "url" in value && typeof value.url === "string" && value.url.startsWith(`${base}/skill-artifacts/`)
      ? <a className="ml-2 text-primary underline" href={value.url}>Download file</a>
      : <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>}
  </div>)}</div>;
}
