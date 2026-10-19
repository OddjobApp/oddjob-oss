import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  Target, Cpu, Sparkles, AlertTriangle, RotateCcw, Save, Trash2,
  Send, MessageSquare, Bot, ChevronDown, ChevronRight, Network 
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";

export function HypothesisExplorer({ contextId = "mission-sim" }: { contextId?: string }) {
    const [complexity, setComplexity] = useState(5);
    const [tokenAllocation, setTokenAllocation] = useState(500);
    const [contextRichness, setContextRichness] = useState(70);
    const [scenarios, setScenarios] = useState<any[]>([]);
    const [thinkingMessages, setThinkingMessages] = useState<string[]>([]);
    const [isSimpleMode, setIsSimpleMode] = useState(false);

    // Conversational AI (Logic Copilot) States
    const [chatInput, setChatInput] = useState("");
    const [chatDomain, setChatDomain] = useState("general");
    const [messages, setMessages] = useState<any[]>([
        {
            id: "welcome",
            role: "assistant",
            content: "Hello! I am your Logic Copilot. Ask me any complex operational questions about this cycle or mission. I will run symbolic reasoning and show my work using interactive dependency graphs."
        }
    ]);
    const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
    const [expandedGraphs, setExpandedGraphs] = useState<Record<string, boolean>>({});

    const toggleSteps = (msgId: string) => {
        setExpandedSteps(prev => ({ ...prev, [msgId]: !prev[msgId] }));
    };

    const toggleGraph = (msgId: string) => {
        setExpandedGraphs(prev => ({ ...prev, [msgId]: !prev[msgId] }));
    };

    const chatMutation = useMutation({
        mutationFn: async (question: string) => {
            const res = await apiRequest("POST", "/api/prediction/neuro-symbolic/query", {
                naturalLanguage: question,
                domain: chatDomain
            });
            return res.json();
        },
        onSuccess: (data) => {
            setMessages(prev => [
                ...prev,
                {
                    id: `ai-${Date.now()}`,
                    role: "assistant",
                    content: data.naturalAnswer,
                    response: data
                }
            ]);
        },
        onError: (error: any) => {
            setMessages(prev => [
                ...prev,
                {
                    id: `ai-err-${Date.now()}`,
                    role: "assistant",
                    content: `Error running verification query: ${error.message || "Unknown error"}`
                }
            ]);
        }
    });

    const handleSendQuestion = (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || chatMutation.isPending) return;
        
        const question = chatInput.trim();
        setMessages(prev => [
            ...prev,
            {
                id: `user-${Date.now()}`,
                role: "user",
                content: question
            }
        ]);
        setChatInput("");
        chatMutation.mutate(question);
    };
    
    const handleReset = () => {
        setComplexity(5);
        setTokenAllocation(500);
        setContextRichness(70);
    };

    const handleSaveScenario = () => {
        if (!mutation.data) return;
        setScenarios([...scenarios, {
            id: Date.now(),
            complexity,
            tokenAllocation,
            contextRichness,
            prediction: mutation.data.prediction,
            hiddenState: mutation.data.hiddenState
        }]);
    };

    const mutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/prediction/evaluate", {
                contextId,
                features: [
                    { label: "complexity", value: complexity / 10, confidence: 1.0 },
                    { label: "token_allocation", value: tokenAllocation / 1000, confidence: 1.0 },
                    { label: "context_richness", value: contextRichness / 100, confidence: 1.0 }
                ]
            });
            return res.json();
        }
    });

    const causalMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/prediction/causal/analyze", {
                graph: {
                    id: "mission-graph",
                    name: "Mission Success Graph",
                    variables: [
                        { id: "complexity", name: "Complexity", type: "continuous", description: "Mission complexity", observable: true, intervenable: true },
                        { id: "token_allocation", name: "Token Allocation", type: "continuous", description: "Token limit", observable: true, intervenable: true },
                        { id: "context_richness", name: "Context Richness", type: "continuous", description: "Context size", observable: true, intervenable: true },
                        { id: "outcome", name: "Outcome", type: "binary", description: "Mission success", observable: true, intervenable: false }
                    ],
                    edges: [
                        { source: "complexity", target: "outcome", strength: 0.7, type: "direct", bidirectional: false, confidence: 1.0, discoveryMethod: "expert" },
                        { source: "token_allocation", target: "outcome", strength: 0.5, type: "direct", bidirectional: false, confidence: 1.0, discoveryMethod: "expert" },
                        { source: "context_richness", target: "outcome", strength: 0.4, type: "direct", bidirectional: false, confidence: 1.0, discoveryMethod: "expert" }
                    ],
                    confounders: [],
                    backdoorPaths: [],
                    frontdoorPaths: [],
                    source: "expert",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                outcome: { variable: "outcome", value: 1, expectedValue: 0.5 },
                context: { complexity: complexity / 10, token_allocation: tokenAllocation / 1000, context_richness: contextRichness / 100 }
            });
            return res.json();
        }
    });

    const handleEvaluate = () => {
        mutation.mutate();
    };

    const handleCausalAnalyze = () => {
        causalMutation.mutate();
    };

    const nsMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/prediction/neuro-symbolic/query", {
                naturalLanguage: `Verify if a mission with complexity ${complexity}, token allocation ${tokenAllocation}, and context richness ${contextRichness} is valid and safe.`,
                domain: 'general'
            });
            return res.json();
        }
    });

    const handleNeuroSymbolicQuery = () => {
        nsMutation.mutate();
    };

    const ebmMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/prediction/ebm/optimize", {
                complexity: complexity / 10,
                contextRichness: contextRichness / 100
            });
            return res.json();
        },
        onSuccess: (data) => {
            // Update token allocation with optimal value (scaled back to slider range 1-1000)
            setTokenAllocation(Math.round(data.optimalTokens * 1000));
        }
    });

    const handleEBMOptimize = () => {
        ebmMutation.mutate();
    };

    useEffect(() => {
        if (mutation.isPending) {
            setThinkingMessages([]);
            const messages = [
                "Initializing Oracle connection...",
                "Loading context graph...",
                "Analyzing mission complexity...",
                "Fetching historical success rates...",
                "Intervening on token allocation...",
                "Calculating edge probabilities...",
                "Synthesizing counterfactuals...",
                "Finalizing prediction surface..."
            ];
            let i = 0;
            const interval = setInterval(() => {
                if (i < messages.length) {
                    setThinkingMessages(prev => [...prev, messages[i]]);
                    i++;
                } else {
                    clearInterval(interval);
                }
            }, 400);
            return () => clearInterval(interval);
        }
    }, [mutation.isPending]);

    const hoverGlowStyle = (
        <style>{`
            .hover-glow {
                transition: box-shadow 0.3s ease, border-color 0.3s ease;
            }
            .hover-glow:hover {
                box-shadow: 0 0 20px rgba(168, 85, 247, 0.15);
                border-color: rgba(168, 85, 247, 0.3);
            }
        `}</style>
    );

    return (
        <>
            {hoverGlowStyle}
            <Card className="border-white/10 bg-black/20 backdrop-blur-xl hover-glow">
            <Tabs defaultValue="simulator" className="w-full">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
                <div>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Sparkles className="w-5 h-5 text-purple-400" />
                        Bicameral Hypothesis Explorer (Expanded)
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Advanced What-If Simulator and Logic Verification Copilot.
                    </CardDescription>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <TabsList className="bg-black/40 border border-white/5">
                        <TabsTrigger value="simulator" className="text-xs">Simulator</TabsTrigger>
                        <TabsTrigger value="copilot" className="text-xs">Logic Copilot</TabsTrigger>
                    </TabsList>
                    
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Simple Mode</span>
                        <button
                            onClick={() => setIsSimpleMode(!isSimpleMode)}
                            className={`w-10 h-5 rounded-full p-0.5 transition-colors focus:outline-none ${isSimpleMode ? 'bg-purple-600' : 'bg-gray-600'}`}
                            title="Toggle Simple Mode"
                        >
                            <div className={`w-4 h-4 bg-card rounded-full transition-transform ${isSimpleMode ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-2">
                <TabsContent value="simulator" className="space-y-6 mt-0">
                    {/* Inputs */}
                    {isSimpleMode ? (
                        <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm text-foreground">Mission Preset</label>
                            <select
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === "safe") {
                                        setComplexity(3);
                                        setTokenAllocation(800);
                                        setContextRichness(90);
                                    } else if (val === "balanced") {
                                        setComplexity(5);
                                        setTokenAllocation(500);
                                        setContextRichness(70);
                                    } else if (val === "aggressive") {
                                        setComplexity(8);
                                        setTokenAllocation(300);
                                        setContextRichness(50);
                                    }
                                }}
                                defaultValue="balanced"
                            >
                                <option value="safe">Safe (Low Risk, High Resource)</option>
                                <option value="balanced">Balanced (Recommended)</option>
                                <option value="aggressive">Aggressive (High Risk, Low Resource)</option>
                            </select>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm text-foreground">
                                <span>Mission Complexity</span>
                                <span className="text-purple-400">{complexity}/10</span>
                            </div>
                            <input 
                                type="range" 
                                min="1" 
                                max="10" 
                                title="Complexity"
                                value={complexity} 
                                onChange={(e) => setComplexity(parseInt(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm text-foreground">
                                <span>Token Allocation Limit</span>
                                <span className="text-purple-400">{tokenAllocation}k</span>
                            </div>
                            <input 
                                type="range" 
                                min="100" 
                                max="1000" 
                                step="100"
                                title="Token Allocation"
                                value={tokenAllocation} 
                                onChange={(e) => setTokenAllocation(parseInt(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between text-sm text-foreground">
                                <span>Context Richness</span>
                                <span className="text-purple-400">{contextRichness}%</span>
                            </div>
                            <input 
                                type="range" 
                                min="1" 
                                max="100" 
                                title="Context Richness"
                                value={contextRichness} 
                                onChange={(e) => setContextRichness(parseInt(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                    </div>
                )}
                
                <div className="flex gap-2">
                    <Button 
                        onClick={handleEvaluate} 
                        disabled={mutation.isPending}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-foreground"
                    >
                        {mutation.isPending ? "Consulting Oracle..." : "Run Simulation"}
                    </Button>
                    <Button
                        onClick={handleReset}
                        variant="outline"
                        className="border-white/10 text-foreground hover:bg-foreground/5"
                        title="Reset to Defaults"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </Button>
                </div>

                {/* Thinking Trace */}
                {thinkingMessages.length > 0 && mutation.isPending && (
                    <div className="mt-4 p-3 bg-black/40 rounded-lg border border-purple-500/20 font-mono text-xs text-purple-400 space-y-1">
                        {thinkingMessages.slice(-4).map((msg, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                <span className="text-purple-600">{'>'}</span>
                                <span className={idx === thinkingMessages.slice(-4).length - 1 ? "animate-pulse" : ""}>{msg}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Results */}
                {mutation.data && (
                    <div className="mt-6 space-y-6 border-t border-white/5 pt-6">
                        <div className="flex justify-between items-center mb-2">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Summary</p>
                            <Button
                                size="sm"
                                variant="outline"
                                className="border-white/10 text-foreground hover:bg-foreground/5"
                                onClick={handleSaveScenario}
                            >
                                <Save className="w-4 h-4 mr-2" />
                                Save Scenario
                            </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-black/30 p-4 rounded-xl border border-white/5" title="Confidence score derived from neuro-symbolic reasoning.">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Top Prediction</p>
                                <p className="text-lg font-bold text-foreground">{mutation.data.prediction?.topPredicate ?? "—"}</p>
                                <p className="text-sm text-emerald-400">{((mutation.data.prediction?.confidence ?? 0) * 100).toFixed(0)}% Confidence</p>
                            </div>
                            <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Hidden State</p>
                                <p className="text-lg font-bold text-foreground uppercase">{mutation.data.hiddenState?.topLabel ?? "—"}</p>
                                <p className="text-sm text-purple-400">Entropy: {(mutation.data.hiddenState?.entropy ?? 0).toFixed(2)}</p>
                            </div>
                        </div>

                        {/* Hidden State Warning if Entropy is high */}
                        {(mutation.data.hiddenState?.entropy ?? 0) > 0.5 && (
                            <div className="flex items-center gap-2 bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 text-yellow-400 text-sm">
                                <AlertTriangle className="w-4 h-4" />
                                <span>High system entropy detected. Outcome may be unpredictable.</span>
                            </div>
                        )}

                        <Button 
                            onClick={handleCausalAnalyze} 
                            disabled={causalMutation.isPending}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-foreground"
                        >
                            {causalMutation.isPending ? "Analyzing Root Cause..." : "Run Causal Root Cause Analysis"}
                        </Button>

                        <Button 
                            onClick={handleNeuroSymbolicQuery} 
                            disabled={nsMutation.isPending}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-foreground"
                        >
                            {nsMutation.isPending ? "Verifying Logic..." : "Verify Logic (Neuro-Symbolic)"}
                        </Button>

                        <Button 
                            onClick={handleEBMOptimize} 
                            disabled={ebmMutation.isPending}
                            className="w-full bg-orange-600 hover:bg-orange-700 text-foreground"
                        >
                            {ebmMutation.isPending ? "Optimizing..." : "Optimize Tokens via EBM"}
                        </Button>

                        {ebmMutation.data && (
                            <div className="text-xs text-orange-400 mt-1">
                                EBM optimized tokens to {Math.round(ebmMutation.data.optimalTokens * 1000)} (Energy: {ebmMutation.data.energy.toFixed(2)})
                            </div>
                        )}

                        {nsMutation.data && (
                            <div className="space-y-3 bg-black/40 p-4 rounded-xl border border-white/5">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Neuro-Symbolic Verification</p>
                                <p className="text-sm text-foreground">{nsMutation.data.naturalAnswer}</p>
                                {nsMutation.data.explanation?.steps?.map((step: any) => (
                                    <div key={step.step} className="text-xs text-muted-foreground mt-1">
                                        <span className="text-emerald-400">Step {step.step}:</span> {step.text}
                                    </div>
                                ))}
                                <p className="text-xs text-purple-400 mt-1">Confidence: {(nsMutation.data.confidence * 100).toFixed(0)}%</p>
                            </div>
                        )}

                        {causalMutation.data && (
                            <div className="space-y-3 bg-black/40 p-4 rounded-xl border border-white/5">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Causal Root Causes</p>
                                {causalMutation.data.rootCauses?.map((cause: any) => (
                                    <div key={cause.variable} className="space-y-1">
                                        <div className="flex justify-between text-sm">
                                            <span className="font-bold text-foreground">{cause.variable}</span>
                                            <span className="text-purple-400">{(cause.contribution * 100).toFixed(0)}%</span>
                                        </div>
                                        <p className="text-xs text-foreground">{cause.evidence}</p>
                                        <p className="text-xs text-muted-foreground italic">{cause.counterfactual}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Predicted Branches</p>
                        
                        {/* SVG Graph Visualization */}
                        <div className="w-full h-[200px] bg-black/40 rounded-xl border border-white/5 overflow-hidden">
                            <svg width="100%" height="100%" viewBox="0 0 400 200">
                                <defs>
                                    <linearGradient id="branch-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.1" />
                                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
                                    </linearGradient>
                                    <filter id="node-glow">
                                        <feGaussianBlur stdDeviation="3" result="blur" />
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>
                                
                                {/* Edges */}
                                {(mutation.data.branches ?? []).map((branch: any, idx: number) => {
                                    const y = (idx + 1) * (200 / ((mutation.data.branches?.length ?? 0) + 1));
                                    const d = `M 50 100 C 175 100 175 ${y} 250 ${y}`;
                                    const strokeWidth = 1 + branch.probability * 6;
                                    const opacity = 0.2 + branch.probability * 0.8;
                                    
                                    return (
                                        <path 
                                            key={`edge-${branch.id}`} 
                                            d={d} 
                                            fill="none" 
                                            stroke="url(#branch-grad)" 
                                            strokeWidth={strokeWidth} 
                                            opacity={opacity}
                                        />
                                    );
                                })}
                                
                                {/* Root Node */}
                                <circle cx="50" cy="100" r="8" fill="#7c3aed" filter="url(#node-glow)" />
                                <circle cx="50" cy="100" r="4" fill="#a78bfa" />
                                <text x="50" y="80" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="900" letterSpacing="0.05em">START</text>
                                
                                {/* Branch Nodes and Labels */}
                                {(mutation.data.branches ?? []).map((branch: any, idx: number) => {
                                    const y = (idx + 1) * (200 / ((mutation.data.branches?.length ?? 0) + 1));
                                    const isHighProb = branch.probability > 0.5;
                                    
                                    return (
                                        <g key={`node-${branch.id}`}>
                                            <circle 
                                                cx="250" 
                                                cy={y} 
                                                r={6} 
                                                fill={isHighProb ? "#059669" : "#8b5cf6"} 
                                                filter="url(#node-glow)"
                                                opacity={0.8}
                                            />
                                            <circle cx="250" cy={y} r="3" fill="white" />
                                            <text 
                                                x="265" 
                                                y={y + 4} 
                                                fill="white" 
                                                fontSize="11" 
                                                fontWeight="bold"
                                            >
                                                {branch.predicate}
                                            </text>
                                            <text 
                                                x="265" 
                                                y={y + 16} 
                                                fill={isHighProb ? "#34d399" : "#a78bfa"} 
                                                fontSize="10" 
                                                fontWeight="bold"
                                            >
                                                {(branch.probability * 100).toFixed(0)}%
                                            </text>
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>

                        <div className="space-y-3">
                            <style>{(mutation.data.branches ?? []).map((branch: any) => `
                                .progress-bar-${branch.id} {
                                    width: ${branch.probability * 100}%;
                                }
                            `).join('')}</style>
                            {(mutation.data.branches ?? []).map((branch: any) => (
                                <div key={branch.id} className="space-y-1">
                                    <div className="flex justify-between text-xs text-foreground">
                                        <span>{branch.predicate}</span>
                                        <span className="text-purple-400">{(branch.probability * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="w-full bg-foreground/5 h-1.5 rounded-full overflow-hidden">
                                        <div 
                                            className={`bg-purple-500 h-full progress-bar-${branch.id}`} 
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Saved Scenarios */}
                {scenarios.length > 0 && (
                    <div className="mt-6 space-y-3 border-t border-white/5 pt-6">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Saved Scenarios</p>
                        <div className="grid grid-cols-1 gap-2">
                            {scenarios.map((s) => (
                                <div key={s.id} className="bg-foreground/5 p-3 rounded-lg flex justify-between items-center text-sm">
                                    <div>
                                        <p className="text-foreground font-medium">{s.prediction?.topPredicate ?? "—"}</p>
                                        <p className="text-xs text-muted-foreground">C:{s.complexity} | T:{s.tokenAllocation}k | R:{s.contextRichness}%</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-purple-400 hover:text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
                                            onClick={() => {
                                                setComplexity(s.complexity);
                                                setTokenAllocation(s.tokenAllocation);
                                                setContextRichness(s.contextRichness);
                                            }}
                                            title="Load Scenario Settings"
                                        >
                                            Load
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-red-400 hover:text-red-700 dark:text-red-300 hover:bg-red-500/10"
                                            onClick={() => setScenarios(scenarios.filter(x => x.id !== s.id))}
                                            title="Delete Scenario"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                </TabsContent>
                
                <TabsContent value="copilot" className="space-y-4 mt-0">
                    {/* Domain selector */}
                    <div className="flex items-center justify-between bg-black/30 p-3 rounded-lg border border-white/5">
                        <span className="text-xs font-medium text-foreground">Target Reasoning Domain</span>
                        <select
                            value={chatDomain}
                            onChange={(e) => setChatDomain(e.target.value)}
                            className="bg-card border border-white/10 rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                        >
                            <option value="general">General Domain</option>
                            <option value="finance">Finance (AML/KYC)</option>
                            <option value="healthcare">Healthcare (Clinical Rules)</option>
                            <option value="legal">Legal (GDPR Compliance)</option>
                        </select>
                    </div>

                    {/* Chat Panel */}
                    <div className="flex flex-col h-[400px] border border-white/5 bg-black/40 rounded-xl overflow-hidden">
                        {/* Message History */}
                        <div className="flex-1 p-4 overflow-y-auto space-y-4 flex flex-col">
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex flex-col max-w-[85%] ${
                                        msg.role === "user" ? "self-end" : "self-start"
                                    }`}
                                >
                                    <div
                                        className={`p-3 rounded-xl text-xs ${
                                            msg.role === "user"
                                                ? "bg-purple-600 text-foreground rounded-br-none"
                                                : "bg-muted text-foreground border border-white/5 rounded-bl-none"
                                        }`}
                                    >
                                        <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                        
                                        {/* Verification Details */}
                                        {msg.response && (
                                            <div className="mt-3 border-t border-white/10 pt-2.5 space-y-2">
                                                {/* Reasoning Steps Toggle */}
                                                <button
                                                    onClick={() => toggleSteps(msg.id)}
                                                    className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-700 dark:text-purple-300 font-medium transition-colors focus:outline-none"
                                                >
                                                    {expandedSteps[msg.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                                    <span>Reasoning Steps ({msg.response.explanation?.steps?.length ?? 0})</span>
                                                </button>
                                                
                                                {expandedSteps[msg.id] && msg.response.explanation?.steps && (
                                                    <div className="space-y-1.5 pl-3 border-l border-purple-500/20 py-1 bg-black/20 rounded p-2">
                                                        {msg.response.explanation.steps.map((step: any) => (
                                                            <div key={step.step} className="text-[10px] text-muted-foreground leading-normal">
                                                                <span className="text-purple-400 font-semibold font-mono">Step {step.step}:</span> {step.text}
                                                                {step.formal && <span className="block font-mono text-[9px] text-emerald-500 mt-0.5">{step.formal}</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Interactive Dependency Graph Toggle */}
                                                {msg.response.explanation?.proofTree && (
                                                    <>
                                                        <button
                                                            onClick={() => toggleGraph(msg.id)}
                                                            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-700 dark:text-emerald-300 font-medium transition-colors focus:outline-none"
                                                        >
                                                            {expandedGraphs[msg.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                                            <Network className="w-3 h-3" />
                                                            <span>Interactive Dependency Graph ("Shows Work")</span>
                                                        </button>
                                                        
                                                        {expandedGraphs[msg.id] && (
                                                            <div className="pl-1.5 py-2 bg-black/30 border border-white/5 rounded-lg max-h-[250px] overflow-y-auto">
                                                                <ProofNodeView node={msg.response.explanation.proofTree} />
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                                
                                                {/* Confidence indicator */}
                                                <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-white/5 pt-1.5">
                                                    <span>Logic Confidence:</span>
                                                    <span className="font-bold text-emerald-400">{(msg.response.confidence * 100).toFixed(0)}%</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-[9px] text-muted-foreground mt-1 px-1">
                                        {msg.role === "user" ? "You" : "Logic Copilot"}
                                    </span>
                                </div>
                            ))}
                            {chatMutation.isPending && (
                                <div className="self-start max-w-[85%] flex flex-col">
                                    <div className="bg-muted text-muted-foreground border border-white/5 rounded-xl rounded-bl-none p-3 text-xs flex items-center gap-2 font-mono">
                                        <Bot className="w-4 h-4 animate-bounce text-purple-400" />
                                        <span className="animate-pulse">Thinking: Analyzing query logic...</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Input Area */}
                        <form onSubmit={handleSendQuestion} className="p-3 border-t border-white/5 bg-card/50 flex gap-2">
                            <Input
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Ask about transaction status, safety metrics..."
                                className="flex-1 bg-black/40 border-white/10 text-foreground text-xs h-8 focus:ring-purple-500"
                                disabled={chatMutation.isPending}
                            />
                            <Button
                                type="submit"
                                size="sm"
                                disabled={chatMutation.isPending || !chatInput.trim()}
                                className="bg-purple-600 hover:bg-purple-700 text-foreground text-xs h-8 px-3"
                            >
                                <Send className="w-3 h-3 mr-1.5" />
                                Ask
                            </Button>
                        </form>
                    </div>
                </TabsContent>
            </CardContent>
            </Tabs>
        </Card>
        </>
    );
}

// Collapsible Recursive Node Component for Interactive Dependency Graph
function ProofNodeView({ node, depth = 0 }: { node: any; depth?: number }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    if (!node) return null;

    const hasPremises = node.premises && node.premises.length > 0;
    
    const formatAtom = (atom: any) => {
        if (!atom) return "";
        const argsStr = atom.arguments.map((arg: any) => arg.value).join(", ");
        return `${atom.negated ? "¬" : ""}${atom.predicate}(${argsStr})`;
    };

    return (
        <div className="flex flex-col space-y-2 p-1.5">
            {/* The Node Card */}
            <div 
                onClick={() => hasPremises && setIsCollapsed(!isCollapsed)}
                className={`p-2.5 rounded-lg border text-[11px] cursor-pointer transition-all ${
                    node.isLeaf 
                        ? "bg-blue-950/15 border-blue-500/20 hover:bg-blue-950/25" 
                        : "bg-purple-950/15 border-purple-500/20 hover:bg-purple-950/25"
                }`}
            >
                <div className="flex justify-between items-center gap-4">
                    <span className="font-mono font-semibold text-foreground truncate">
                        {formatAtom(node.conclusion)}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        {node.isLeaf ? (
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono text-[8px] uppercase font-bold tracking-wider">Fact</span>
                        ) : (
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono text-[8px] uppercase font-bold tracking-wider">Inferred</span>
                        )}
                        {hasPremises && (
                            <span className="text-muted-foreground text-[10px] font-mono leading-none">
                                {isCollapsed ? "[+]" : "[-]"}
                            </span>
                        )}
                    </div>
                </div>
                
                {/* Rule details */}
                {node.rule && (
                    <div className="mt-1 text-[9px] text-muted-foreground border-t border-white/5 pt-1 flex flex-col gap-0.5">
                        <span className="font-semibold text-purple-400/80 font-mono text-[8px]">{node.rule.name}</span>
                        <span className="italic">"{node.rule.explanationTemplate}"</span>
                    </div>
                )}
            </div>

            {/* Premises (children) */}
            {hasPremises && !isCollapsed && (
                <div className="relative pl-4 ml-3 border-l border-dashed border-purple-500/20 space-y-2 pt-0.5">
                    <div className="absolute top-0 left-[-3px] w-[5px] h-[5px] rounded-full bg-purple-500/40" />
                    
                    {node.premises.map((premise: any, index: number) => (
                        <ProofNodeView key={index} node={premise} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}
