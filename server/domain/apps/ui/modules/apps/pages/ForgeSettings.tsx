import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { 
  Settings, 
  Code2, 
  ShieldCheck, 
  Cpu, 
  Database, 
  Save, 
  Loader2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function ForgeSettings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("coding");

  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: ['/api/apps/forge/settings'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/apps/forge/settings');
      return res.json();
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (newSettings: any) => {
      const res = await apiRequest('POST', '/api/apps/forge/settings', newSettings);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Settings Saved",
        description: "App Forge configuration updated successfully.",
        variant: "default"
      });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleSave = () => {
    updateMutation.mutate(settings);
  };

  const updateNested = (category: string, key: string, value: any) => {
    const newSettings = { ...settings };
    newSettings[category][key] = value;
    // Note: React Query's data is typically read-only, but we can bypass for local state
    // In a real app we'd have a local state copy of the settings
    updateMutation.mutate(newSettings);
  };

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-5xl animate-page-in">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-lg shadow-lg">
              <Settings className="w-5 h-5 text-foreground" />
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tight italic">Forge Settings</h1>
          </div>
          <p className="text-muted-foreground text-sm font-medium">Global governance and orchestration standards for the App Forge pipeline.</p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={updateMutation.isPending}
          className="gap-2 shadow-lg shadow-primary/20"
        >
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Configuration
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-foreground/5 border border-foreground/10 p-1 rounded-xl mb-8">
          <TabsTrigger value="coding" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-foreground">
            <Code2 className="w-4 h-4" /> Coding Standards
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-foreground">
            <ShieldCheck className="w-4 h-4" /> Security
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-foreground">
            <Cpu className="w-4 h-4" /> AI Behavior
          </TabsTrigger>
          <TabsTrigger value="rag" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-foreground">
            <Database className="w-4 h-4" /> RAG & Knowledge
          </TabsTrigger>
        </TabsList>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <TabsContent value="coding">
            <Card className="glass-panel border-foreground/20 overflow-hidden">
              <CardHeader className="bg-foreground/5 border-b border-foreground/10">
                <CardTitle className="text-lg font-bold">Code Quality & Style</CardTitle>
                <CardDescription>Configure how the AI Architect writes and structures application code.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Strict TypeScript</Label>
                        <p className="text-[11px] text-muted-foreground">Force high-fidelity type safety in all generated files.</p>
                      </div>
                      <Switch 
                        checked={settings?.coding?.typescriptStrict} 
                        onCheckedChange={(v) => updateNested('coding', 'typescriptStrict', v)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ESLint Ruleset</Label>
                      <Select 
                        value={settings?.coding?.eslintRuleset} 
                        onValueChange={(v) => updateNested('coding', 'eslintRuleset', v)}
                      >
                        <SelectTrigger className="bg-foreground/5 border-foreground/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="airbnb">Airbnb (Best for React)</SelectItem>
                          <SelectItem value="google">Google</SelectItem>
                          <SelectItem value="standard">Standard JS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Require Unit Tests</Label>
                        <p className="text-[11px] text-muted-foreground">Mandate Vitest/Jest coverage for core logic.</p>
                      </div>
                      <Switch 
                        checked={settings?.coding?.requireTests} 
                        onCheckedChange={(v) => updateNested('coding', 'requireTests', v)}
                      />
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label>Coverage Threshold</Label>
                        <span className="text-xs font-bold text-primary">{settings?.coding?.coverageThreshold}%</span>
                      </div>
                      <Slider 
                        value={[settings?.coding?.coverageThreshold || 70]} 
                        max={100} 
                        step={5} 
                        onValueChange={([v]) => updateNested('coding', 'coverageThreshold', v)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-foreground/5">
                  <Label>Preferred State Management</Label>
                  <Select 
                    value={settings?.coding?.stateManagement} 
                    onValueChange={(v) => updateNested('coding', 'stateManagement', v)}
                  >
                    <SelectTrigger className="bg-foreground/5 border-foreground/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="react-query">React Query + Context (Recommended)</SelectItem>
                      <SelectItem value="zustand">Zustand (Global)</SelectItem>
                      <SelectItem value="jotai">Jotai (Atomic)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security">
            <Card className="glass-panel border-foreground/20 overflow-hidden">
              <CardHeader className="bg-foreground/5 border-b border-foreground/10">
                <CardTitle className="text-lg font-bold">Hardening & Security Policy</CardTitle>
                <CardDescription>Guardrails to ensure forged apps are resilient against common vulnerabilities.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>OWASP Compliance Level</Label>
                      <Select 
                        value={settings?.security?.owaspLevel} 
                        onValueChange={(v) => updateNested('security', 'owaspLevel', v)}
                      >
                        <SelectTrigger className="bg-foreground/5 border-foreground/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic (Standard Best Practices)</SelectItem>
                          <SelectItem value="owasp-top-10">OWASP Top 10 (Strict)</SelectItem>
                          <SelectItem value="asvs">Full ASVS (Forensic Level)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Block Hardcoded Secrets</Label>
                        <p className="text-[11px] text-muted-foreground">Always fail build if API keys are detected in code.</p>
                      </div>
                      <Switch 
                        checked={settings?.security?.blockHardcodedSecrets} 
                        disabled
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Mandatory Zod Validation</Label>
                        <p className="text-[11px] text-muted-foreground">Require schema validation for all API inputs.</p>
                      </div>
                      <Switch 
                        checked={settings?.security?.requireZodValidation} 
                        onCheckedChange={(v) => updateNested('security', 'requireZodValidation', v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Generate CSP Headers</Label>
                        <p className="text-[11px] text-muted-foreground">Inject Content-Security-Policy middleware.</p>
                      </div>
                      <Switch 
                        checked={settings?.security?.generateCSPHeaders} 
                        onCheckedChange={(v) => updateNested('security', 'generateCSPHeaders', v)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai">
            <Card className="glass-panel border-foreground/20 overflow-hidden">
              <CardHeader className="bg-foreground/5 border-b border-foreground/10">
                <CardTitle className="text-lg font-bold">AI Behavior & Governance</CardTitle>
                <CardDescription>Control the autonomy and iterative logic of the AI Architect.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Orchestration Verbosity</Label>
                      <Select 
                        value={settings?.ai?.verbosity} 
                        onValueChange={(v) => updateNested('ai', 'verbosity', v)}
                      >
                        <SelectTrigger className="bg-foreground/5 border-foreground/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="conservative">Conservative (Minimal changes)</SelectItem>
                          <SelectItem value="balanced">Balanced (Recommended)</SelectItem>
                          <SelectItem value="creative">Creative (High Divergence)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Enable Strategy Review Gate</Label>
                        <p className="text-[11px] text-muted-foreground">Pause for manual review after Discovery phase.</p>
                      </div>
                      <Switch 
                        checked={settings?.ai?.enableStrategyReview} 
                        onCheckedChange={(v) => updateNested('ai', 'enableStrategyReview', v)}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Enable Architecture Review Gate</Label>
                        <p className="text-[11px] text-muted-foreground">Pause for manual review of technical blueprints.</p>
                      </div>
                      <Switch 
                        checked={settings?.ai?.enableArchitectureReview} 
                        onCheckedChange={(v) => updateNested('ai', 'enableArchitectureReview', v)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Max 429 Retry Attempts</Label>
                      <Input 
                        type="number" 
                        value={settings?.ai?.maxRetryAttempts} 
                        onChange={(e) => updateNested('ai', 'maxRetryAttempts', parseInt(e.target.value))}
                        className="bg-foreground/5 border-foreground/10"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-foreground/5">
                  <Label>Global System Prompt Suffix</Label>
                  <Textarea 
                    placeholder="Instructions added to every forge mission..."
                    value={settings?.ai?.systemPromptSuffix}
                    onChange={(e) => updateNested('ai', 'systemPromptSuffix', e.target.value)}
                    className="bg-foreground/5 border-foreground/10 font-mono text-xs h-24"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rag">
            <Card className="glass-panel border-foreground/20 overflow-hidden">
              <CardHeader className="bg-foreground/5 border-b border-foreground/10">
                <CardTitle className="text-lg font-bold">Knowledge & RAG Ingestion</CardTitle>
                <CardDescription>Configure how forged apps consume organizational context.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Auto-Ingest Org Knowledge</Label>
                        <p className="text-[11px] text-muted-foreground">Automatically include relevant docs from Knowledge Base.</p>
                      </div>
                      <Switch 
                        checked={settings?.rag?.autoIncludeOrgKnowledge} 
                        onCheckedChange={(v) => updateNested('rag', 'autoIncludeOrgKnowledge', v)}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label>Semantic Search Threshold</Label>
                        <span className="text-xs font-bold text-primary">{settings?.rag?.semanticSearchThreshold * 100}%</span>
                      </div>
                      <Slider 
                        value={[settings?.rag?.semanticSearchThreshold * 100]} 
                        max={100} 
                        step={5} 
                        onValueChange={([v]) => updateNested('rag', 'semanticSearchThreshold', v / 100)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </motion.div>
      </Tabs>
    </div>
  );
}
