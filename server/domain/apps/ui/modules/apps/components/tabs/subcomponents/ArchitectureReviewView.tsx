import React, { useMemo, useState, useEffect } from 'react';
import {
  Paintbrush,
  Link2,
  ClipboardCheck,
  CheckCircle2,
  MessageSquare,
  Server,
  Box,
  Database,
  CircuitBoard,
  Loader2,
  Rocket,
  Info,
} from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@domain-ui/core/ui/components/ui/accordion';
import { cn } from '@/lib/utils';

const REFINE_CLARIFICATION_MAX = 2000;

interface ArchitectureProposal {
    services: {
        name: string;
        purpose: string;
        endpoints: { path: string; method: string; description: string }[];
    }[];
    components: {
        name: string;
        type: 'page' | 'shared' | 'module';
        description: string;
        dependencies: string[];
        platformBlockId?: string;
    }[];
    dataModels: {
        name: string;
        fields: { name: string; type: string; required: boolean }[];
    }[];
    capabilityMapping: {
        requirement: string;
        oddjobCapability: 'missions' | 'pipelines' | 'datasets' | 'forms' | 'agents' | 'knowledge' | 'hil' | 'custom';
        platformBlockId?: string;
        rationale: string;
    }[];
}

interface ClarifyingQuestion {
    id: string;
    question: string;
    context: string;
    suggestedAnswers?: string[];
}

interface ArchitectureReviewViewProps {
  architecture: ArchitectureProposal;
  plan?: {
    uxDescription?: string;
    integrationStrategy?: string;
    phases?: { name: string; description?: string; tasks?: string[] }[];
  } | null;
  questions: ClarifyingQuestion[];
  onApprove: (approvedArch: ArchitectureProposal, answers: Record<string, string>) => void;
  onSkipToBuild?: () => void;
  onRefine?: (clarification: string) => void;
  isApproving: boolean;
  isRefining?: boolean;
}

export function ArchitectureReviewView({ 
  architecture: initialArchitecture, 
  plan,
  questions, 
  onApprove, 
  onSkipToBuild,
  onRefine,
  isApproving,
  isRefining
}: ArchitectureReviewViewProps) {
  const [architecture, setArchitecture] = useState<ArchitectureProposal>(initialArchitecture);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [clarification, setClarification] = useState('');

  // Sync with prop updates - only if not actively modifying (though Architecture is read-only for now)
  useEffect(() => {
    if (initialArchitecture) {
      setArchitecture(initialArchitecture);
    }
  }, [initialArchitecture]);

  const handleAnswerChange = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const allAnswered = questions.every(q => answers[q.id]?.trim());
  const totalEndpoints = architecture.services.reduce((acc, service) => acc + service.endpoints.length, 0);
  const qualityReport = useMemo(() => {
    const checks = [
      {
        name: 'UI Coverage',
        passed: architecture.components.length > 0,
        detail: architecture.components.length > 0
          ? `${architecture.components.length} UI building blocks planned`
          : 'No UI components were detected',
      },
      {
        name: 'Oddjob Service Wiring',
        passed: architecture.services.length > 0,
        detail: architecture.services.length > 0
          ? `${architecture.services.length} service(s) and ${totalEndpoints} route(s) defined`
          : 'No service endpoints are defined yet',
      },
      {
        name: 'Data Model Readiness',
        passed: architecture.dataModels.length > 0,
        detail: architecture.dataModels.length > 0
          ? `${architecture.dataModels.length} data model(s) available`
          : 'No data models have been mapped',
      },
      {
        name: 'Decision Questions Cleared',
        passed: questions.length === 0 || allAnswered,
        detail: questions.length === 0
          ? 'No open decision points'
          : allAnswered
            ? 'All review questions have answers'
            : `${questions.filter(q => !answers[q.id]?.trim()).length} question(s) still need answers`,
      },
    ];
    return checks;
  }, [architecture, totalEndpoints, questions, allAnswered, answers]);

  return (
    <ScrollArea className="h-full pr-4">
      <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-6 mb-6">
        <div>
          <h2 className="text-3xl font-black text-foreground flex items-center gap-3 tracking-tight uppercase italic">
            <ClipboardCheck className="w-8 h-8 text-blue-400" />
            Final Build Review
          </h2>
          <p className="text-muted-foreground font-medium max-w-2xl">
            Confirm the product experience, how Oddjob will be wired in, and pre-build checks—before the assembler runs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onSkipToBuild && (
            <Button
              variant="outline"
              onClick={onSkipToBuild}
              title="Skip remaining reviews and build with defaults"
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/5 h-11"
            >
              <Rocket className="w-5 h-5 mr-2" />
              Auto-Pilot
            </Button>
          )}
          <Button 
            onClick={() => onApprove(architecture, answers)}
            disabled={isApproving || (questions.length > 0 && !allAnswered)}
            size="lg"
            className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold gap-3 shadow-lg shadow-blue-500/20 px-8"
          >
            {isApproving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Ignite Assembly
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Review Panels */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="ui" className="w-full">
            <TabsList className="bg-card/50 border border-border p-1 flex flex-wrap h-auto gap-1">
              <TabsTrigger value="ui" className="data-[state=active]:bg-blue-600 px-4">
                <Paintbrush className="w-4 h-4 mr-2" />
                Requirements &amp; UI
              </TabsTrigger>
              <TabsTrigger value="integration" className="data-[state=active]:bg-blue-600 px-4">
                <Link2 className="w-4 h-4 mr-2" />
                Oddjob integration
              </TabsTrigger>
              <TabsTrigger value="quality" className="data-[state=active]:bg-blue-600 px-4">
                <ClipboardCheck className="w-4 h-4 mr-2" />
                Test report
              </TabsTrigger>
              <TabsTrigger value="technical" className="data-[state=active]:bg-blue-600 px-4">
                <CircuitBoard className="w-4 h-4 mr-2" />
                Architecture
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ui" className="mt-4">
              <Card className="bg-background/50 border-border border-dashed backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-foreground text-base">What you asked for</CardTitle>
                  <CardDescription>
                    Plain-language view of the experience and main surfaces the builder will implement.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {plan?.uxDescription && (
                    <div className="p-4 rounded-lg bg-card/50 border border-border">
                      <p className="text-sm text-foreground leading-relaxed">{plan.uxDescription}</p>
                    </div>
                  )}
                  {plan?.phases && plan.phases.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Delivery shape</p>
                      <div className="grid grid-cols-1 gap-2">
                        {plan.phases.map((ph, i) => (
                          <div key={i} className="p-3 rounded-lg bg-card/40 border border-border/60">
                            <p className="text-xs font-semibold text-foreground">{ph.name}</p>
                            {ph.description && (
                              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{ph.description}</p>
                            )}
                            {ph.tasks && ph.tasks.length > 0 && (
                              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground list-disc list-inside">
                                {ph.tasks.map((t, j) => (
                                  <li key={j}>{t}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {architecture.components.map((comp, i) => (
                      <div key={i} className="p-4 rounded-lg bg-card/50 border border-border">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="font-semibold text-foreground flex items-center gap-2">
                            <Box className="w-4 h-4 text-purple-400" />
                            {comp.name}
                          </h4>
                          <Badge className="text-[10px] uppercase">{comp.type}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{comp.description}</p>
                        {comp.platformBlockId && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 text-[10px] py-0">
                              <Box className="w-3 h-3 mr-1" />
                              Platform Block: {comp.platformBlockId}
                            </Badge>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="integration" className="mt-4">
              <Card className="bg-background/50 border-border border-dashed backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-foreground text-base font-bold">How this app connects to Oddjob</CardTitle>
                  <CardDescription>
                    Strategy from planning plus the concrete capability mapping for missions, pipelines, datasets, and related features.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {plan?.integrationStrategy && (
                    <div className="p-4 rounded-lg bg-card/50 border border-border">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Integration strategy</p>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{plan.integrationStrategy}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3">
                    {architecture.capabilityMapping?.map((mapping, i) => (
                      <div key={i} className="p-4 rounded-xl bg-card/40 border border-border/50 group hover:border-blue-500/30 transition-all flex items-start gap-4">
                        <div className="p-2 bg-blue-500/10 rounded-lg shrink-0">
                          <Link2 className="w-5 h-5 text-blue-400" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-semibold text-foreground">{mapping.requirement}</p>
                            <Badge variant="secondary" className="bg-blue-600/20 text-blue-700 dark:text-blue-300 border-blue-500/30 uppercase text-[10px] px-2 py-0">
                              {mapping.oddjobCapability}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground italic font-medium leading-relaxed">
                            &ldquo;{mapping.rationale}&rdquo;
                          </p>
                          {mapping.platformBlockId && (
                            <div className="pt-2 flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Utilizing:</span>
                              <Badge variant="outline" className="text-emerald-400 border-emerald-500/20 bg-emerald-500/5 text-[10px] font-mono">
                                {mapping.platformBlockId}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="quality" className="mt-4">
              <Card className="bg-background/50 border-border border-dashed backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-foreground text-base">Pre-build validation</CardTitle>
                  <CardDescription>
                    Lightweight checks before ignition—use this like a release gate, not a formal test suite.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-card/50 border border-border">
                      <div className="text-xs text-muted-foreground font-bold uppercase mb-2">Service routes</div>
                      <div className="text-2xl font-black text-blue-400">{totalEndpoints}</div>
                    </div>
                    <div className="p-4 rounded-xl bg-card/50 border border-border">
                      <div className="text-xs text-muted-foreground font-bold uppercase mb-2">UI modules</div>
                      <div className="text-2xl font-black text-purple-400">{architecture.components.length}</div>
                    </div>
                    <div className="p-4 rounded-xl bg-card/50 border border-border">
                      <div className="text-xs text-muted-foreground font-bold uppercase mb-2">Data models</div>
                      <div className="text-2xl font-black text-emerald-400">{architecture.dataModels.length}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {qualityReport.map((check) => (
                      <div key={check.name} className="flex items-center justify-between p-3 rounded-lg bg-background/25 border border-border/50">
                        <div>
                          <p className="text-xs font-bold text-foreground">{check.name}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{check.detail}</p>
                        </div>
                        <Badge className={check.passed ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}>
                          {check.passed ? 'PASS' : 'REVIEW'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="technical" className="mt-4">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-card/50 border border-border">
                    <div className="text-xs text-muted-foreground font-bold uppercase mb-2">Service Endpoints</div>
                    <div className="text-2xl font-black text-blue-400">{architecture.services.reduce((acc, s) => acc + s.endpoints.length, 0)}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-card/50 border border-border">
                    <div className="text-xs text-muted-foreground font-bold uppercase mb-2">UI Modules</div>
                    <div className="text-2xl font-black text-purple-400">{architecture.components.length}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-card/50 border border-border">
                    <div className="text-xs text-muted-foreground font-bold uppercase mb-2">Data Models</div>
                    <div className="text-2xl font-black text-emerald-400">{architecture.dataModels.length}</div>
                  </div>
                </div>

                <Accordion type="single" collapsible className="w-full space-y-2">
                  <AccordionItem value="services" className="border border-border rounded-xl bg-background/50 overflow-hidden">
                    <AccordionTrigger className="px-4 py-3 hover:bg-foreground/5 no-underline">
                      <div className="flex items-center gap-3">
                        <Server className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-semibold text-foreground">Platform Connections & Routes</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-4 pt-2 border-t border-border">
                      {architecture.services.map((svc, i) => (
                        <div key={i} className="space-y-2">
                          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-tighter">{svc.name} — {svc.purpose}</h4>
                          <div className="grid grid-cols-1 gap-2">
                            {svc.endpoints.map((ep, j) => (
                              <div key={j} className="text-[10px] bg-background/40 p-2 rounded border border-border/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                <div className="flex items-center gap-2">
                                  <code className="text-emerald-400 font-mono">{ep.method}</code>
                                  <span className="text-muted-foreground font-mono">{ep.path}</span>
                                </div>
                                <span className="text-muted-foreground">{ep.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="models" className="border border-border rounded-xl bg-background/50 overflow-hidden">
                    <AccordionTrigger className="px-4 py-3 hover:bg-foreground/5 no-underline">
                      <div className="flex items-center gap-3">
                        <Database className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-semibold text-foreground">Data Models & Schemas</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-4 pt-2 border-t border-border">
                      <div className="grid grid-cols-2 gap-3">
                        {architecture.dataModels.map((model, i) => (
                          <div key={i} className="p-3 rounded-lg bg-background/40 border border-border/50">
                            <h4 className="text-xs font-bold text-foreground mb-2">{model.name}</h4>
                            <div className="space-y-1">
                              {model.fields.map((f, j) => (
                                <div key={j} className="flex items-center justify-between text-[10px]">
                                  <span className="text-muted-foreground">{f.name}</span>
                                  <Badge variant="outline" className="text-[9px] h-4 py-0 border-border">{f.type}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column: Review Questions */}
        <div className="space-y-6">
          <Card className="bg-background/80 border-blue-500/30 shadow-xl shadow-blue-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-blue-100">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                Approval Inputs
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Answer any open review items before continuing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {onRefine && (
                  <div className="space-y-3 p-4 rounded-xl bg-card/50 border border-border">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-blue-700 dark:text-blue-200">Refine Before Build (Optional)</Label>
                    <p className="text-xs text-muted-foreground">Share any change requests for UI, integrations, or implementation priorities.</p>
                  </div>
                  <div className="flex justify-end">
                    <span
                      className={cn(
                        'text-[10px] font-mono tabular-nums',
                        clarification.length > REFINE_CLARIFICATION_MAX ? 'text-amber-400' : 'text-muted-foreground'
                      )}
                    >
                      {clarification.length}/{REFINE_CLARIFICATION_MAX}
                    </span>
                  </div>
                  <Textarea
                    placeholder="Example: Keep the dashboard simple, prioritize dataset integration, and defer advanced charts."
                    value={clarification}
                    maxLength={REFINE_CLARIFICATION_MAX}
                    onChange={(e) => setClarification(e.target.value)}
                    className="bg-background/50 border-border text-xs min-h-[100px]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!clarification.trim() || !!isRefining}
                    onClick={() => {
                      onRefine(clarification.trim());
                      setClarification('');
                    }}
                    className="w-full"
                  >
                    {isRefining ? 'Applying clarification...' : 'Apply clarification and refresh review'}
                  </Button>
                </div>
              )}

              {questions.length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2 opacity-50" />
                  <p className="text-muted-foreground text-sm">No open review questions.</p>
                  <p className="text-muted-foreground text-xs">Ready to move into build execution.</p>
                </div>
              )}
              {questions.map((q) => (
                <div key={q.id} className="space-y-3 p-4 rounded-xl bg-card/50 border border-border">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-blue-700 dark:text-blue-200">{q.question}</Label>
                    <p className="text-xs text-muted-foreground italic">{q.context}</p>
                  </div>
                  
                  {q.suggestedAnswers && q.suggestedAnswers.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {q.suggestedAnswers.map((ans, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleAnswerChange(q.id, ans)}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded-full border transition-all",
                            answers[q.id] === ans 
                              ? "bg-blue-600 border-blue-500 text-foreground" 
                              : "bg-muted border-border text-muted-foreground hover:border-border"
                          )}
                        >
                          {ans}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input 
                      placeholder="Type your instruction..."
                      className="bg-background/50 border-border text-xs h-8"
                      value={answers[q.id] || ''}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <h5 className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1 uppercase tracking-wider">
              <Info className="w-3 h-3" />
              Reviewer Note
            </h5>
            <p className="text-[11px] text-blue-700 dark:text-blue-200/60 leading-relaxed">
              This review locks in your UI direction, Oddjob integration approach, and readiness checks before the builder starts.
            </p>
          </div>
        </div>
      </div>
      </div>
    </ScrollArea>
  );
}
