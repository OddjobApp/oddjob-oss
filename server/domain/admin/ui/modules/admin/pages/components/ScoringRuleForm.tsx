
import React, { useState, useEffect } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { Save, FolderPlus } from "lucide-react";
import { TriggeredActionConfig } from './TriggeredActionConfig.js';
import { RuleTemplateSelector, RuleTemplate } from './RuleTemplates.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@domain-ui/core/ui/components/ui/dialog";
import {
    PAGES, PAGE_STATES, AVAILABLE_CARDS, AVAILABLE_PAGE_STATES, ELEMENT_TYPES,
    ACTIVITIES
} from "@/lib/ui-constants";

export const VECTORS = [
    { id: 'S', name: 'Symptom', color: 'bg-red-500', desc: 'Negative feeling or confusion' },
    { id: 'C', name: 'Cause', color: 'bg-orange-500', desc: 'Root source of the issue' },
    { id: 'O', name: 'Outcome', color: 'bg-green-500', desc: 'Positive result or goal' },
    { id: 'R', name: 'Resource', color: 'bg-blue-500', desc: 'Tool or documentation used' },
    { id: 'E', name: 'Effect', color: 'bg-purple-500', desc: 'Side effect or consequence' },
];

const ALL_ACTIVITIES = [
    ...ACTIVITIES.page.map(a => ({ ...a, category: 'Page' })),
    ...ACTIVITIES.pageState.map(a => ({ ...a, category: 'Page State' })),
    ...ACTIVITIES.card.map(a => ({ ...a, category: 'Card' })),
    ...ACTIVITIES.element.map(a => ({ ...a, category: 'Element' })),
];

interface ScoringRuleFormProps {
    initialData?: any;
    defaultVector?: string;
    onSave: (rule: any) => void;
    onCancel?: () => void;
    isSubmitting?: boolean;
}

export function ScoringRuleForm({ initialData, defaultVector, onSave, onCancel, isSubmitting = false }: ScoringRuleFormProps) {
    const [rule, setRule] = useState({
        name: "",
        description: "",
        ruleType: "ui_interaction", // 'ui_interaction' | 'agent_evaluation'
        evaluationConfig: { method: "regex", criteria: "", model: "gemini-1.5-flash" } as any,
        page: "",
        pageState: "",
        card: "",
        elementType: "",
        elementId: "",
        activity: "",
        vector: defaultVector || "S",
        weight: 1.0,
        activityModifier: 1.0,
        priority: "low",
        triggeredAction: null as any,
    });

    const [showRuleActionConfig, setShowRuleActionConfig] = useState(false);
    const [showTemplateDialog, setShowTemplateDialog] = useState(false);

    const handleTemplateSelect = (template: RuleTemplate) => {
        setRule(prev => ({
            ...prev,
            name: template.name + " (Copy)",
            description: template.description,
            activity: template.config.activity,
            vector: template.config.vector,
            weight: template.config.weight,
            priority: template.config.priority as any,
            activityModifier: template.config.activityModifier || 1.0,
            elementType: template.config.elementType || prev.elementType,
            pageState: template.config.pageState || prev.pageState,
            triggeredAction: template.config.triggeredAction || null
        }));
        if (template.config.triggeredAction) {
            setShowRuleActionConfig(true); // Show config if template has one
        }
        setShowTemplateDialog(false);
    };

    useEffect(() => {
        if (initialData) {
            setRule({
                name: initialData.name || "",
                description: initialData.description || "",
                ruleType: initialData.ruleType || "ui_interaction",
                evaluationConfig: initialData.evaluationConfig || { method: "regex", criteria: "", model: "gemini-1.5-flash" },
                page: initialData.page || "",
                pageState: initialData.pageState || "",
                card: initialData.card || "",
                elementType: initialData.elementType || "",
                elementId: initialData.elementId || "",
                activity: initialData.activity || "",
                vector: initialData.vector || defaultVector || "S",
                weight: initialData.weight || 1.0,
                activityModifier: initialData.activityModifier || 1.0,
                priority: initialData.priority || "low",
                triggeredAction: initialData.triggeredAction || null,
            });
            if (initialData.triggeredAction) setShowRuleActionConfig(false); // Let user expand if needed
        } else if (defaultVector) {
            setRule(prev => ({ ...prev, vector: defaultVector }));
        }
    }, [initialData, defaultVector]);

    // Helpers
    const getCardsForPage = () => {
        if (!rule.page) return Object.values(AVAILABLE_CARDS).flat();
        const pageLabel = PAGES.find(p => p.value === rule.page)?.label;
        if (pageLabel && AVAILABLE_CARDS[pageLabel]) {
            return AVAILABLE_CARDS[pageLabel];
        }
        return Object.values(AVAILABLE_CARDS).flat();
    };

    const getPageStatesForPage = () => {
        if (!rule.page) return PAGE_STATES;
        const pageLabel = PAGES.find(p => p.value === rule.page)?.label;
        if (pageLabel && AVAILABLE_PAGE_STATES[pageLabel]) {
            return PAGE_STATES.filter(ps =>
                AVAILABLE_PAGE_STATES[pageLabel].includes(ps.value) || ps.value === 'error'
            );
        }
        if (rule.page.includes(":id")) {
            return PAGE_STATES.filter(ps => ["detail", "edit", "config", "summary", "error"].includes(ps.value));
        }
        return PAGE_STATES;
    };

    const getRelevantActivities = () => {
        let activities = [...ALL_ACTIVITIES];
        if (rule.elementType || rule.elementId) {
            return ACTIVITIES.element.map(a => ({ ...a, category: 'Element' }));
        }
        if (rule.card) {
            return [...ACTIVITIES.card.map(a => ({ ...a, category: 'Card' })),
            ...ACTIVITIES.element.map(a => ({ ...a, category: 'Element' }))];
        }
        if (rule.pageState) {
            return [...ACTIVITIES.pageState.map(a => ({ ...a, category: 'Page State' })),
            ...ACTIVITIES.card.map(a => ({ ...a, category: 'Card' })),
            ...ACTIVITIES.element.map(a => ({ ...a, category: 'Element' }))];
        }
        return activities;
    };

    return (
        <div className="space-y-6">
            {/* General Info */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Rule Name *</Label>
                    <Input
                        value={rule.name}
                        onChange={(e) => setRule({ ...rule, name: e.target.value })}
                        placeholder={rule.ruleType === 'agent_evaluation' ? "e.g. No Apologies" : "e.g. Rage Click"}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                        value={rule.description}
                        onChange={(e) => setRule({ ...rule, description: e.target.value })}
                        placeholder="Why this rule triggers..."
                    />
                </div>
            </div>

            {/* Rule Type Selector */}
            <div className="p-4 border rounded-lg bg-muted dark:bg-card space-y-4">
                <div className="flex gap-4 items-center">
                    <Label className="w-24 font-bold">Rule Type:</Label>
                    <div className="flex gap-2">
                        <Button
                            variant={rule.ruleType === 'ui_interaction' ? 'default' : 'outline'}
                            onClick={() => setRule({ ...rule, ruleType: 'ui_interaction' })}
                            size="sm"
                        >
                            UI Interaction (User)
                        </Button>
                        <Button
                            variant={rule.ruleType === 'agent_evaluation' ? 'default' : 'outline'}
                            onClick={() => setRule({ ...rule, ruleType: 'agent_evaluation' })}
                            size="sm"
                        >
                            Agent Evaluation (AI)
                        </Button>
                    </div>
                </div>

                {/* --- AGENT EVALUATION MODE --- */}
                {rule.ruleType === 'agent_evaluation' && (
                    <div className="space-y-4 pt-2 border-t mt-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Evaluation Method</Label>
                                <Select value={rule.evaluationConfig.method} onValueChange={(v) => setRule({ ...rule, evaluationConfig: { ...rule.evaluationConfig, method: v } })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="regex">Regex Match</SelectItem>
                                        <SelectItem value="keyword">Keyword List</SelectItem>
                                        <SelectItem value="llm_judge">LLM as a Judge</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {rule.evaluationConfig.method === 'llm_judge' && (
                                <div className="space-y-2">
                                    <Label>Judge Model</Label>
                                    <Select value={rule.evaluationConfig.model} onValueChange={(v) => setRule({ ...rule, evaluationConfig: { ...rule.evaluationConfig, model: v } })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash (Fast)</SelectItem>
                                            <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro (Better)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label>
                                {rule.evaluationConfig.method === 'regex' ? 'Regular Expression (Pattern)' :
                                    rule.evaluationConfig.method === 'keyword' ? 'Keywords (comma separated)' :
                                        'Evaluation Prompt / Criteria (Yes/No Question)'}
                            </Label>
                            {rule.evaluationConfig.method === 'llm_judge' ? (
                                <textarea
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={rule.evaluationConfig.criteria}
                                    onChange={(e) => setRule({ ...rule, evaluationConfig: { ...rule.evaluationConfig, criteria: e.target.value } })}
                                    placeholder="e.g. Does this response contain an apology? Respond only YES or NO."
                                />
                            ) : (
                                <Input
                                    value={rule.evaluationConfig.criteria}
                                    onChange={(e) => setRule({ ...rule, evaluationConfig: { ...rule.evaluationConfig, criteria: e.target.value } })}
                                    placeholder={rule.evaluationConfig.method === 'regex' ? "e.g. /error|fail/i" : "e.g. sorry, apologize, regret"}
                                />
                            )}
                            <p className="text-xs text-muted-foreground">
                                {rule.evaluationConfig.method === 'regex' ? 'Standard JS Regex. Use "i" flag for case-insensitive.' :
                                    rule.evaluationConfig.method === 'keyword' ? 'Triggers if ANY keyword is found.' :
                                        'The AI will evaluate the response against this criteria. It triggers if the answer is YES.'}
                            </p>
                        </div>
                    </div>
                )}

                {/* --- UI INTERACTION MODE (Legacy) --- */}
                {rule.ruleType === 'ui_interaction' && (
                    <div className="space-y-4 pt-2 border-t mt-2">
                        <div className="flex justify-between items-center">
                            <h3 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
                                Context Hierarchy
                            </h3>
                            <Button variant="outline" size="sm" onClick={() => setShowTemplateDialog(true)} className="gap-2 h-7 text-xs">
                                <FolderPlus className="w-3 h-3" /> Load Template
                            </Button>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>Page</Label>
                                <Select value={rule.page} onValueChange={(v) => setRule({ ...rule, page: v === "__any__" ? "" : v })}>
                                    <SelectTrigger><SelectValue placeholder="Any Page" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__any__">Any Page</SelectItem>
                                        {PAGES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Page State</Label>
                                <Select value={rule.pageState} onValueChange={(v) => setRule({ ...rule, pageState: v === "__any__" ? "" : v })}>
                                    <SelectTrigger><SelectValue placeholder="Any State" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__any__">Any State</SelectItem>
                                        {getPageStatesForPage().map(ps => <SelectItem key={ps.value} value={ps.value}>{ps.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Card / Component</Label>
                                <Select value={rule.card} onValueChange={(v) => setRule({ ...rule, card: v === "__any__" ? "" : v })}>
                                    <SelectTrigger><SelectValue placeholder="Any Card" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__any__">Any Card</SelectItem>
                                        {getCardsForPage().map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>Element Type</Label>
                                <Select value={rule.elementType} onValueChange={(v) => setRule({ ...rule, elementType: v === "__any__" ? "" : v })}>
                                    <SelectTrigger><SelectValue placeholder="Any Type" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__any__">Any Type</SelectItem>
                                        {ELEMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Element ID (Optional)</Label>
                                <Input
                                    value={rule.elementId}
                                    onChange={(e) => setRule({ ...rule, elementId: e.target.value })}
                                    placeholder="Specific HTML ID"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-primary font-bold">Activity *</Label>
                                <Select value={rule.activity} onValueChange={(v) => setRule({ ...rule, activity: v })}>
                                    <SelectTrigger><SelectValue placeholder="Select Activity" /></SelectTrigger>
                                    <SelectContent>
                                        {getRelevantActivities().map((a, i) => (
                                            <SelectItem key={i} value={a.value}>
                                                <span className="text-muted-foreground mr-2">[{a.category}]</span>
                                                {a.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Scoring config - SHARED */}
            <div className="grid grid-cols-3 gap-6 p-4 border rounded-lg bg-muted dark:bg-card">
                <div className="space-y-2">
                    <Label className="font-semibold">Cognitive Vector</Label>
                    <Select value={rule.vector} onValueChange={(v) => setRule({ ...rule, vector: v })} disabled={!!defaultVector}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {VECTORS.map(v => (
                                <SelectItem key={v.id} value={v.id}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-3 h-3 rounded-full ${v.color}`} />
                                        {v.name} ({v.id})
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {VECTORS.find(v => v.id === rule.vector)?.desc}
                    </p>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label className="font-semibold">Base Weight</Label>
                        <span className="text-sm font-mono bg-muted px-2 rounded">{rule.weight.toFixed(1)}</span>
                    </div>
                    <Slider
                        min={0.1} max={5.0} step={0.1}
                        value={[rule.weight]}
                        onValueChange={(val) => setRule({ ...rule, weight: val[0] })}
                        className="py-4"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="font-semibold">Priority</Label>
                    <Select value={rule.priority} onValueChange={(v) => setRule({ ...rule, priority: v } as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Triggered Action - SHARED */}
            <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                    <Label className="text-base font-semibold">Triggered Action (Optional)</Label>
                    <Button variant="outline" size="sm" onClick={() => setShowRuleActionConfig(!showRuleActionConfig)}>
                        {showRuleActionConfig ? 'Hide' : 'Configure Action'}
                    </Button>
                </div>

                {showRuleActionConfig && (
                    <TriggeredActionConfig
                        value={rule.triggeredAction}
                        onChange={(action: any) => setRule({ ...rule, triggeredAction: action })}
                    />
                )}

                {rule.triggeredAction && !showRuleActionConfig && (
                    <div className="p-2 bg-muted rounded text-sm flex items-center gap-2">
                        <Badge variant="outline">{rule.triggeredAction.type}</Badge>
                        <span className="text-muted-foreground text-xs">
                            {JSON.stringify(rule.triggeredAction.config).slice(0, 60)}...
                        </span>
                        <Button
                            variant="ghost" size="sm" className="ml-auto h-6"
                            onClick={() => setRule({ ...rule, triggeredAction: null })}
                        >
                            Clear
                        </Button>
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
                {onCancel && (
                    <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
                        Cancel
                    </Button>
                )}
                <Button onClick={() => onSave(rule)} disabled={!rule.name || (rule.ruleType === 'ui_interaction' && !rule.activity) || (rule.ruleType === 'agent_evaluation' && !rule.evaluationConfig.criteria) || isSubmitting}>
                    {isSubmitting ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save Rule</>}
                </Button>
            </div>
            <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Select a Scoring Rule Template</DialogTitle>
                        <DialogDescription>
                            Choose a template to pre-fill the rule configuration. You can customize it afterwards.
                        </DialogDescription>
                    </DialogHeader>
                    <RuleTemplateSelector onSelect={handleTemplateSelect} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
