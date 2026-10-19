import { useState, useMemo } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { 
    Plus, 
    Globe, 
    Sparkles, 
    Database, 
    Disc, 
    Monitor, 
    Zap, 
    Cpu, 
    Settings2, 
    Camera, 
    Activity, 
    Layers, 
    ArrowRight, 
    Trash2, 
    GripVertical,
    ChevronRight,
    Search,
    Fingerprint,
    Timer,
    Maximize
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import SeleniumLiveRecorder from './selenium/SeleniumLiveRecorder.js';
import SeleniumAutoPilot from './selenium/SeleniumAutoPilot.js';
import { SeleniumStepItem } from './selenium/SeleniumStepItem.js';
import type { SeleniumStep } from "@shared/schema";
import { cn } from '@/lib/utils';
import './jobs-components.css';

interface SeleniumConfig {
    mode: 'local' | 'grid';
    gridUrl?: string;
    browserType: 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';
    headless: boolean;
    viewport?: { width: number; height: number };
    timeout: number;
    screenshotOnComplete?: boolean;
    screenshotOnError?: boolean;
    saveScreenshotsToFile?: boolean;
    saveExtractionsToFile?: boolean;
    screenshotDirectory?: string;
    exportCookies?: boolean;
    importCookiesFromStep?: number;
    steps: SeleniumStep[];
    healingEnabled?: boolean;
    datasetId?: number;
}

interface SeleniumJobConfigProps {
    config: SeleniumConfig;
    onChange: (config: SeleniumConfig) => void;
    jobId?: number;
    disabled?: boolean;
}

const DEFAULT_CONFIG: SeleniumConfig = {
    mode: 'local',
    browserType: 'chromium',
    headless: true,
    timeout: 30000,
    screenshotOnError: true,
    saveScreenshotsToFile: false,
    saveExtractionsToFile: false,
    steps: []
};

export default function SeleniumJobConfig({ config, onChange, jobId, disabled }: SeleniumJobConfigProps) {
    const [expandedStep, setExpandedStep] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState("studio");

    // Merge with defaults
    const currentConfig: SeleniumConfig = {
        ...DEFAULT_CONFIG,
        ...config,
        steps: config?.steps || []
    };

    const updateConfig = (updates: Partial<SeleniumConfig>) => {
        onChange({ ...currentConfig, ...updates });
    };

    const addStep = () => {
        const newStep: SeleniumStep = { action: 'goto', value: '', optional: false };
        const updatedSteps = [...currentConfig.steps, newStep];
        updateConfig({ steps: updatedSteps });
        setExpandedStep(updatedSteps.length - 1);
    };

    const updateStep = (index: number, updates: Partial<SeleniumStep>) => {
        const newSteps = [...currentConfig.steps];
        newSteps[index] = { ...newSteps[index], ...updates };
        updateConfig({ steps: newSteps });
    };

    const removeStep = (index: number) => {
        const newSteps = currentConfig.steps.filter((_, i) => i !== index);
        updateConfig({ steps: newSteps });
        if (expandedStep === index) setExpandedStep(null);
    };

    const moveStep = (index: number, direction: 'up' | 'down') => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= currentConfig.steps.length) return;
        const newSteps = [...currentConfig.steps];
        [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
        updateConfig({ steps: newSteps });
        setExpandedStep(newIndex);
    };

    const [isAutoPilotOpen, setIsAutoPilotOpen] = useState(false);
    const [isCaptureOpen, setIsCaptureOpen] = useState(false);

    const { data: datasets } = useQuery({
        queryKey: ['/api/datasets'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/datasets');
            if (!res.ok) throw new Error('Failed to fetch datasets');
            return res.json() as Promise<{ id: number; name: string }[]>;
        }
    });

    const getActionIcon = (action: string) => {
        switch(action) {
            case 'goto': return <Globe className="w-3.5 h-3.5" />;
            case 'click': return <Zap className="w-3.5 h-3.5" />;
            case 'fill': return <Activity className="w-3.5 h-3.5" />;
            case 'extract': return <Database className="w-3.5 h-3.5" />;
            case 'wait': return <Timer className="w-3.5 h-3.5" />;
            default: return <ChevronRight className="w-3.5 h-3.5" />;
        }
    };

    return (
        <div className="flex bg-background/40 backdrop-blur-2xl h-full min-h-[750px] rounded-2xl overflow-hidden border border-foreground/5 divide-x divide-white/5 animate-in fade-in zoom-in duration-700">
            {/* Left Column: Automation Workspace */}
            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">Automation Workflow Designer</span>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            className="h-7 text-[9px] uppercase font-black tracking-widest gap-2 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 transition-all shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]"
                            onClick={() => setIsCaptureOpen(true)}
                        >
                            <Disc className={cn("w-3 h-3", isCaptureOpen && "animate-pulse")} /> Live Recorder
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            className="h-7 text-[9px] uppercase font-black tracking-widest gap-2 bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 transition-all shadow-[0_0_15px_-5px_rgba(59,130,246,0.3)]"
                            onClick={() => setIsAutoPilotOpen(true)}
                        >
                            <Sparkles className="w-3 h-3" /> Auto-Pilot
                        </Button>
                    </div>
                </div>

                <div className="flex-1">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
                        <div className="px-6 pt-6">
                            <TabsList className="bg-background/40 border border-foreground/5 h-11 p-1 flex gap-1 rounded-xl">
                                <TabsTrigger value="studio" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Activity className="w-3.5 h-3.5" /> Pipeline
                                </TabsTrigger>
                                <TabsTrigger value="intelligence" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Cpu className="w-3.5 h-3.5" /> Intelligence
                                </TabsTrigger>
                                <TabsTrigger value="connection" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Monitor className="w-3.5 h-3.5" /> Engine
                                </TabsTrigger>
                                <TabsTrigger value="reporting" className="flex-1 flex items-center gap-2 text-[10px] uppercase font-black tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all duration-300 rounded-lg">
                                    <Camera className="w-3.5 h-3.5" /> Forensics
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8">
                            <TabsContent value="studio" className="m-0 space-y-6 focus-visible:ring-0">
                                {currentConfig.steps.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-foreground/5 rounded-3xl bg-foreground/[0.02] text-center space-y-4">
                                        <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20">
                                            <Globe className="w-8 h-8 text-primary/40" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-black uppercase tracking-widest text-foreground/60">No automated steps found</p>
                                            <p className="text-[10px] text-muted-foreground/40 italic">Initialize your automation matrix or use the Live Recorder.</p>
                                        </div>
                                        <Button onClick={addStep} variant="outline" className="h-9 text-[10px] uppercase font-black tracking-widest border-primary/20 hover:bg-primary/10 transition-all rounded-xl">
                                            <Plus className="w-4 h-4 mr-2" /> Add Initial Step
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {currentConfig.steps.map((step, index) => (
                                            <div key={index} className="group relative">
                                                <div className="absolute -left-1.5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                                <SeleniumStepItem
                                                    step={step}
                                                    index={index}
                                                    totalSteps={currentConfig.steps.length}
                                                    isExpanded={expandedStep === index}
                                                    disabled={disabled}
                                                    onExpand={setExpandedStep}
                                                    onUpdate={(updates: any) => updateStep(index, updates)}
                                                    onRemove={() => removeStep(index)}
                                                    onMove={(dir: 'up' | 'down') => moveStep(index, dir)}
                                                />
                                            </div>
                                        ))}
                                        <Button 
                                            variant="ghost" 
                                            onClick={addStep} 
                                            className="w-full h-12 border border-dashed border-foreground/5 rounded-2xl hover:bg-foreground/[0.03] group transition-all"
                                        >
                                            <Plus className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                                        </Button>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="intelligence" className="m-0 space-y-8 animate-in slide-in-from-right-4 duration-500">
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between p-5 rounded-2xl border border-foreground/5 bg-foreground/[0.03] hover:bg-foreground/[0.06] transition-all group">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <Sparkles className="w-4 h-4 text-emerald-400" />
                                                <Label className="text-[11px] font-black uppercase tracking-widest">Self-Healing Protocols</Label>
                                                <Badge variant="outline" className="text-[8px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400">Beta</Badge>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground italic">Automatically repair selector drift using AI-driven DOM analysis.</p>
                                        </div>
                                        <Switch 
                                            checked={currentConfig.healingEnabled || false}
                                            onCheckedChange={(v) => updateConfig({ healingEnabled: v })}
                                            disabled={disabled}
                                            className="data-[state=checked]:bg-emerald-500"
                                        />
                                    </div>

                                    <div className="p-6 rounded-2xl border border-foreground/5 bg-background/20 space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 px-1">
                                            <Database className="w-3.5 h-3.5" /> Intelligence Silo Streaming
                                        </Label>
                                        <div className="space-y-3">
                                            <Select
                                                value={currentConfig.datasetId?.toString()}
                                                onValueChange={(v) => updateConfig({ datasetId: v === "none" ? undefined : parseInt(v) })}
                                            >
                                                <SelectTrigger className="h-10 bg-background/40 border-foreground/5 text-xs font-bold">
                                                    <SelectValue placeholder="Select target Dataset (Optional)" />
                                                </SelectTrigger>
                                                <SelectContent className="bg-background/90 border-foreground/10">
                                                    <SelectItem value="none">Did not save to Dataset</SelectItem>
                                                    {datasets?.map((ds) => (
                                                        <SelectItem key={ds.id} value={ds.id.toString()}>{ds.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <div className="p-3 bg-primary/5 rounded-xl border border-primary/10">
                                                <p className="text-[9px] text-primary/70 font-medium italic text-center">Extraction variables will be automatically synchronized with dataset columns.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="connection" className="m-0 space-y-8 animate-in zoom-in-95 duration-500">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                            <Activity className="w-3 h-3" /> Execution Mode
                                        </Label>
                                        <Select
                                            value={currentConfig.mode}
                                            onValueChange={(v) => updateConfig({ mode: v as 'local' | 'grid' })}
                                        >
                                            <SelectTrigger className="h-10 bg-background/40 border-foreground/5 text-xs font-bold">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background/90 border-foreground/10">
                                                <SelectItem value="local">Local Instance (Playwright)</SelectItem>
                                                <SelectItem value="grid">Distributed Grid (Hub)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                            <GripVertical className="w-3 h-3" /> Virtual Engine
                                        </Label>
                                        <Select
                                            value={currentConfig.browserType}
                                            onValueChange={(v) => updateConfig({ browserType: v as any })}
                                        >
                                            <SelectTrigger className="h-10 bg-background/40 border-foreground/5 text-xs font-bold">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background/90 border-foreground/10">
                                                <SelectItem value="chromium">Chromium Engine</SelectItem>
                                                <SelectItem value="chrome">Google Chrome</SelectItem>
                                                <SelectItem value="firefox">Mozilla Firefox</SelectItem>
                                                <SelectItem value="webkit">Safari WebKit</SelectItem>
                                                <SelectItem value="edge">Microsoft Edge</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {currentConfig.mode === 'grid' && (
                                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-blue-400 flex items-center gap-2 px-1">
                                            <ArrowRight className="w-3 h-3" /> Remote Grid Access
                                        </Label>
                                        <Input
                                            value={currentConfig.gridUrl || ''}
                                            onChange={(e) => updateConfig({ gridUrl: e.target.value })}
                                            placeholder="http://selenium-hub:4444/wd/hub"
                                            className="h-10 bg-background/40 border-foreground/5 text-xs font-mono"
                                        />
                                    </div>
                                )}

                                <Separator className="bg-foreground/5" />

                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <Label className="text-[11px] font-black uppercase tracking-widest">Headless Decoupling</Label>
                                            <p className="text-[9px] text-muted-foreground italic">Execute without visual rendering payload.</p>
                                        </div>
                                        <Switch
                                            checked={currentConfig.headless}
                                            onCheckedChange={(v) => updateConfig({ headless: v })}
                                            className="data-[state=checked]:bg-primary"
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center px-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">Command Latency (Timeout ms)</Label>
                                            <span className="text-xs font-black text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20">
                                                {currentConfig.timeout}ms
                                            </span>
                                        </div>
                                        <Slider 
                                            min={5000} max={60000} step={5000}
                                            value={[currentConfig.timeout]}
                                            onValueChange={([v]) => updateConfig({ timeout: v })}
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 px-1">
                                            <Maximize className="w-3 h-3" /> Viewport Dimensioning
                                        </Label>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-[8px] font-black uppercase text-muted-foreground/40">W</span>
                                                <Input
                                                    type="number"
                                                    value={currentConfig.viewport?.width || 1280}
                                                    onChange={(e) => updateConfig({
                                                        viewport: {
                                                            width: parseInt(e.target.value) || 1280,
                                                            height: currentConfig.viewport?.height || 720
                                                        }
                                                    })}
                                                    className="pl-8 h-10 bg-background/40 border-foreground/5 text-xs font-bold"
                                                />
                                            </div>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-[8px] font-black uppercase text-muted-foreground/40">H</span>
                                                <Input
                                                    type="number"
                                                    value={currentConfig.viewport?.height || 720}
                                                    onChange={(e) => updateConfig({
                                                        viewport: {
                                                            width: currentConfig.viewport?.width || 1280,
                                                            height: parseInt(e.target.value) || 720
                                                        }
                                                    })}
                                                    className="pl-8 h-10 bg-background/40 border-foreground/5 text-xs font-bold"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="reporting" className="m-0 space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                                <div className="space-y-6">
                                    <div className="p-6 rounded-3xl border border-foreground/5 bg-background/20 space-y-6">
                                        <div className="flex items-center gap-4 text-primary opacity-60">
                                            <Camera className="w-5 h-5" />
                                            <span className="text-[10px] font-black uppercase tracking-widest">Forensic Capture Settings</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4">
                                            <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.02] border border-foreground/5">
                                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-80">Screenshot on Success</Label>
                                                <Switch
                                                    checked={currentConfig.screenshotOnComplete || false}
                                                    onCheckedChange={(v) => updateConfig({ screenshotOnComplete: v })}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.02] border border-foreground/5">
                                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-80 text-rose-400">Screenshot on Failure</Label>
                                                <Switch
                                                    checked={currentConfig.screenshotOnError !== false}
                                                    onCheckedChange={(v) => updateConfig({ screenshotOnError: v })}
                                                    className="data-[state=checked]:bg-rose-500"
                                                />
                                            </div>
                                            <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.02] border border-foreground/5">
                                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-80">Persistence (Save to Dist)</Label>
                                                <Switch
                                                    checked={currentConfig.saveScreenshotsToFile || false}
                                                    onCheckedChange={(v) => updateConfig({ saveScreenshotsToFile: v })}
                                                />
                                            </div>
                                        </div>

                                        {(currentConfig.saveScreenshotsToFile) && (
                                            <div className="space-y-3 animate-in slide-in-from-top-2">
                                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 px-1 italic">Storage Namespace</Label>
                                                <Input
                                                    placeholder="e.g. screenshots/auth-v3"
                                                    value={currentConfig.screenshotDirectory || ''}
                                                    onChange={(e) => updateConfig({ screenshotDirectory: e.target.value })}
                                                    className="h-9 bg-background/60 border-foreground/5 text-xs font-mono"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="p-6 rounded-3xl border border-foreground/5 bg-background/20 flex items-center justify-between">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                                <Fingerprint className="w-3.5 h-3.5" /> Session Cookie Export
                                            </Label>
                                            <p className="text-[9px] text-muted-foreground italic">Export active session tokens for decoupled API authentication.</p>
                                        </div>
                                        <Switch
                                            checked={currentConfig.exportCookies || false}
                                            onCheckedChange={(v) => updateConfig({ exportCookies: v })}
                                        />
                                    </div>
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            </div>

            {/* Right Column: Automation Manifestation */}
            <div className="w-[42%] bg-background/60 flex flex-col h-full sticky top-0 relative">
                <div className="p-4 border-b border-foreground/5 bg-foreground/5 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">Automation Manifestation</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(var(--primary),0.04),transparent)] pointer-events-none" />
                    
                    <div className="p-8 space-y-0 relative z-10 animate-in fade-in duration-1000">
                        {currentConfig.steps.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-12 text-center opacity-20 grayscale grayscale-100">
                                <Globe className="w-16 h-16 mb-4" />
                                <p className="text-[10px] font-black uppercase tracking-[0.3em]">Matrix Offline</p>
                            </div>
                        ) : (
                            <div className="relative">
                                {/* Connection Line */}
                                <div className="absolute left-[17px] top-4 bottom-4 w-px bg-gradient-to-b from-primary/30 via-primary/10 to-transparent" />
                                
                                <div className="space-y-10">
                                    {currentConfig.steps.map((step, index) => (
                                        <div key={index} className="flex gap-6 items-start relative group">
                                            <div className="relative z-10">
                                                <div className="w-9 h-9 rounded-xl bg-background border border-foreground/5 flex items-center justify-center shadow-2xl group-hover:border-primary/40 transition-all duration-500">
                                                    <div className="text-primary opacity-60 group-hover:opacity-100 transition-opacity">
                                                        {getActionIcon(step.action)}
                                                    </div>
                                                </div>
                                                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-background border border-foreground/10 flex items-center justify-center">
                                                    <span className="text-[7px] font-black text-muted-foreground">{index + 1}</span>
                                                </div>
                                            </div>
                                            
                                            <div className="flex-1 pt-1 space-y-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-foreground/80 group-hover:text-primary transition-colors">{step.action}</span>
                                                    {currentConfig.healingEnabled && (
                                                        <Badge variant="outline" className="text-[7px] h-3 px-1 border-emerald-500/20 text-emerald-500/60 bg-emerald-500/5">Beta-Protected</Badge>
                                                    )}
                                                </div>
                                                <div className="p-3 bg-foreground/[0.02] border border-foreground/5 rounded-xl group-hover:bg-foreground/[0.04] transition-all">
                                                    <p className="text-[9px] font-mono text-muted-foreground/60 break-all leading-relaxed">
                                                        {step.value || <span className="opacity-30 italic">No parameter defined</span>}
                                                    </p>
                                                </div>
                                                {index < currentConfig.steps.length - 1 && (
                                                    <div className="flex justify-start px-2">
                                                        <div className="w-px h-4 bg-primary/20" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    
                                    <div className="flex gap-6 items-center opacity-30">
                                        <div className="w-9 h-9 rounded-full border border-dashed border-foreground/20 flex items-center justify-center">
                                            <Plus className="w-4 h-4" />
                                        </div>
                                        <span className="text-[8px] font-black uppercase tracking-widest italic">Matrix End</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Status Bar */}
                <div className="mt-auto p-4 border-t border-foreground/5 bg-background/40 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-primary opacity-60">
                            <Monitor className="w-3 h-3" /> {currentConfig.browserType} Matrix Active
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Latency: Optimised</span>
                    </div>
                </div>
            </div>

            {/* Dialogs */}
            <SeleniumLiveRecorder
                open={isCaptureOpen}
                onOpenChange={setIsCaptureOpen}
                jobId={jobId || 0}
            />
            <SeleniumAutoPilot
                open={isAutoPilotOpen}
                onOpenChange={setIsAutoPilotOpen}
                jobId={jobId || 0}
            />

        </div>
    );
}
