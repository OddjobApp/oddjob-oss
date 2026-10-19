import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@domain-ui/core/ui/components/ui/dialog';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Stepper, Step } from '@domain-ui/core/ui/components/ui/stepper/Stepper';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { X, Loader2 } from 'lucide-react';
import ReactFlow, { MiniMap, Controls, Background } from 'reactflow';
import 'reactflow/dist/style.css';
import { normalizeForgeDiagram } from './forge-wizard-diagram';

const STEPS = [
  { id: 'idea', name: 'The Idea' },
  { id: 'business-case', name: 'Business Case' },
  { id: 'toolkit', name: 'The Toolkit' },
  { id: 'blueprint', name: 'The Blueprint' },
  { id: 'theming', name: 'Theming' },
  { id: 'pre-flight', name: 'Pre-Flight Check' },
  { id: 'approval', name: 'Final Approval' },
];

interface ForgeWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: any) => void;
}

export function ForgeWizard({ isOpen, onClose, onComplete }: ForgeWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [idea, setIdea] = useState('');
  const [businessCase, setBusinessCase] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [diagram, setDiagram] = useState<any>(null);
  const [themeColor, setThemeColor] = useState('#3b82f6'); // Default to blue
  const [preFlightResults, setPreFlightResults] = useState<any>(null);

  const analysisMutation = useMutation({
    mutationFn: async (userIdea: string) => {
      const res = await apiRequest('POST', '/api/apps/forge/analyze-idea', { idea: userIdea });
      if (!res.ok) throw new Error('Failed to analyze idea');
      return res.json();
    },
    onSuccess: (data) => { setBusinessCase(data); setCurrentStep(1); },
  });

  const assetDiscoveryMutation = useMutation({
    mutationFn: async (bc: any) => {
      const res = await apiRequest('POST', '/api/apps/forge/discover-assets', { businessCase: bc });
      if (!res.ok) throw new Error('Failed to discover assets');
      return res.json();
    },
    onSuccess: (data) => { setAssets(data); setCurrentStep(2); },
  });

  const diagramGenerationMutation = useMutation({
    mutationFn: async (data: { businessCase: any; assets: any[] }) => {
      const res = await apiRequest('POST', '/api/apps/forge/generate-diagram', data);
      if (!res.ok) throw new Error('Failed to generate diagram');
      return res.json();
    },
    onSuccess: (data) => { setDiagram(normalizeForgeDiagram(data)); setCurrentStep(3); },
  });

  const preFlightMutation = useMutation({
    mutationFn: async (data: { businessCase: any; diagram: any }) => {
      const res = await apiRequest('POST', '/api/apps/forge/pre-flight-check', data);
      if (!res.ok) throw new Error('Failed to run pre-flight check');
      return res.json();
    },
    onSuccess: (data) => { setPreFlightResults(data); setCurrentStep(5); },
  });

  const handleNext = () => {
    if (currentStep === 0) analysisMutation.mutate(idea);
    else if (currentStep === 1) assetDiscoveryMutation.mutate(businessCase);
    else if (currentStep === 2) diagramGenerationMutation.mutate({ businessCase, assets });
    else if (currentStep === 3) setCurrentStep(4);
    else if (currentStep === 4) preFlightMutation.mutate({ businessCase, diagram });
    else if (currentStep < STEPS.length - 1) setCurrentStep(s => s + 1);
  };

  const isLoading =
    analysisMutation.isPending ||
    assetDiscoveryMutation.isPending ||
    diagramGenerationMutation.isPending ||
    preFlightMutation.isPending;

  const error =
    analysisMutation.error ||
    assetDiscoveryMutation.error ||
    diagramGenerationMutation.error ||
    preFlightMutation.error;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b border-border relative">
          <DialogTitle className="text-2xl font-bold">App Forge Co-Pilot</DialogTitle>
          <DialogDescription>Your intelligent partner for building applications.</DialogDescription>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar stepper */}
          <div className="w-1/4 p-6 border-r border-border">
            <Stepper orientation="vertical" currentStep={currentStep}>
              {STEPS.map((step, index) => (
                <Step key={step.id} index={index} title={step.name} isCurrent={index === currentStep} isCompleted={index < currentStep} />
              ))}
            </Stepper>
          </div>

          {/* Main content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <h2 className="text-xl font-semibold mb-4">{STEPS[currentStep].name}</h2>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {(error as Error).message}
              </div>
            )}

            <div className="min-h-[400px]">

              {/* Step 0 — Idea input */}
              {currentStep === 0 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Describe your application in plain English. The more detail you provide, the better the result.
                  </p>
                  <Textarea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="e.g., A project management tool with a dashboard showing all projects and a detail page for each one..."
                    className="h-64 text-base"
                    disabled={isLoading}
                  />
                </div>
              )}

              {/* Step 1 — Business case */}
              {currentStep === 1 && (
                <>
                  {analysisMutation.isPending ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="text-lg font-semibold">Analyzing your idea...</p>
                        <p className="text-sm text-muted-foreground">Our Business Analyst agent is crafting your business case.</p>
                      </div>
                    </div>
                  ) : businessCase ? (
                    <div className="space-y-6 animate-in fade-in">
                      <div>
                        <h3 className="text-lg font-medium">Problem Statement</h3>
                        <p className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg mt-2">{businessCase.problemStatement}</p>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Proposed Solution</h3>
                        <p className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg mt-2">{businessCase.proposedSolution}</p>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Key Features</h3>
                        <ul className="space-y-2 mt-2">
                          {(businessCase.keyFeatures ?? []).map((item: any, i: number) => (
                            <li key={i} className="p-4 bg-muted/50 rounded-lg">
                              <p className="font-semibold">{item.feature}</p>
                              <p className="text-sm text-muted-foreground italic">{item.userStory}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Success Metrics</h3>
                        <ul className="list-disc list-inside space-y-1 mt-2 text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg">
                          {(businessCase.successMetrics ?? []).map((metric: string, i: number) => (
                            <li key={i}>{metric}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {/* Step 2 — Asset discovery */}
              {currentStep === 2 && (
                <>
                  {assetDiscoveryMutation.isPending ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="text-lg font-semibold">Discovering assets...</p>
                        <p className="text-sm text-muted-foreground">Searching your organization for relevant Missions, Blueprints, and other assets.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 animate-in fade-in">
                      <p className="text-sm text-muted-foreground">
                        Based on your business case, we found the following existing assets that could accelerate development.
                      </p>
                      {assets.length > 0 ? (
                        <ul className="space-y-4">
                          {assets.map((asset, i) => (
                            <li key={i} className="p-4 bg-muted/50 rounded-lg border border-border">
                              <div className="flex items-center justify-between">
                                <p className="font-semibold text-primary">{asset.name}</p>
                                <p className="text-sm font-bold">{asset.score}% Match</p>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{asset.explanation}</p>
                              <p className="text-xs text-muted-foreground/50 mt-2">Type: {asset.type}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-lg font-semibold">No existing assets found.</p>
                          <p className="text-sm text-muted-foreground">We recommend building this application from scratch.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Step 3 — Architecture diagram */}
              {currentStep === 3 && (
                <>
                  {diagramGenerationMutation.isPending ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="text-lg font-semibold">Generating Architecture Diagram...</p>
                        <p className="text-sm text-muted-foreground">Translating your business case into a visual blueprint.</p>
                      </div>
                    </div>
                  ) : diagram ? (
                    <div className="h-[400px] w-full animate-in fade-in rounded-lg overflow-hidden border border-border">
                      <ReactFlow nodes={diagram.nodes ?? []} edges={diagram.edges ?? []} fitView>
                        <MiniMap />
                        <Controls />
                        <Background />
                      </ReactFlow>
                    </div>
                  ) : null}
                </>
              )}

              {/* Step 4 — Theming */}
              {currentStep === 4 && (
                <div className="space-y-6 animate-in fade-in">
                    <p className="text-sm text-muted-foreground">Select a primary color for your application. This will be used to style buttons, links, and other key UI elements.</p>
                    <div className="flex flex-wrap gap-4">
                        {[
                            { name: 'Blue', color: '#3b82f6' },
                            { name: 'Green', color: '#22c55e' },
                            { name: 'Red', color: '#ef4444' },
                            { name: 'Purple', color: '#8b5cf6' },
                            { name: 'Orange', color: '#f97316' },
                            { name: 'Indigo', color: '#6366f1' },
                        ].map(({ name, color }) => (
                            <div key={name} className="flex flex-col items-center gap-2">
                                <button
                                    onClick={() => setThemeColor(color)}
                                    className={`w-16 h-16 rounded-full transition-all duration-200 ${themeColor === color ? 'ring-4 ring-offset-2 ring-offset-background ring-primary' : ''}`}
                                    style={{ backgroundColor: color }}
                                    aria-label={`Select ${name} theme`}
                                />
                                <span className="text-xs font-medium text-muted-foreground">{name}</span>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50 mt-4">
                        <p className="text-sm font-semibold">Selected Color: <span className="font-mono p-1 rounded bg-background">{themeColor}</span></p>
                    </div>
                </div>
              )}

              {/* Step 5 — Pre-flight results */}
              {currentStep === 5 && (
                <>
                  {preFlightMutation.isPending ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="text-lg font-semibold">Running Pre-Flight Checks...</p>
                        <p className="text-sm text-muted-foreground">Our Forecaster and Compliance Officer agents are analysing your project.</p>
                      </div>
                    </div>
                  ) : preFlightResults ? (
                    <div className="space-y-6 animate-in fade-in">
                      <div>
                        <h3 className="text-lg font-medium">Forecaster Report</h3>
                        <div className="p-4 bg-muted/50 rounded-lg mt-2 space-y-2">
                          <p><span className="font-semibold">Estimated Time:</span> {preFlightResults.forecast?.estimatedTime}</p>
                          <p><span className="font-semibold">Estimated Cost:</span> {preFlightResults.forecast?.estimatedCost}</p>
                          <p className="text-sm text-muted-foreground pt-2 border-t border-border/50">
                            <span className="font-semibold">Reasoning:</span> {preFlightResults.forecast?.reasoning}
                          </p>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Compliance Officer Report</h3>
                        <div className="p-4 bg-muted/50 rounded-lg mt-2 space-y-2">
                          <p>
                            <span className="font-semibold">Risk Level:</span>{' '}
                            <span className={`capitalize font-bold ${
                              preFlightResults.compliance?.riskLevel === 'high' ? 'text-red-500' :
                              preFlightResults.compliance?.riskLevel === 'medium' ? 'text-yellow-500' : 'text-green-500'
                            }`}>{preFlightResults.compliance?.riskLevel}</span>
                          </p>
                          <p className="text-sm text-muted-foreground pt-2 border-t border-border/50">
                            <span className="font-semibold">Findings:</span> {preFlightResults.compliance?.findings}
                          </p>
                          {preFlightResults.compliance?.recommendations?.length > 0 && (
                            <div className="pt-2 border-t border-border/50">
                              <p className="font-semibold">Recommendations:</p>
                              <ul className="list-disc list-inside text-sm text-muted-foreground">
                                {preFlightResults.compliance.recommendations.map((rec: string, i: number) => (
                                  <li key={i}>{rec}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {/* Step 6 — Final approval */}
              {currentStep === 6 && (
                <div className="flex flex-col items-center justify-center h-full space-y-4 text-center animate-in fade-in">
                  <p className="text-lg font-semibold">Ready to build!</p>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Review your selections above. When you're satisfied, click <strong>Ignite Forge</strong> to start building your application.
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 border-t border-border">
          <div className="flex justify-between w-full items-center">
            <Button variant="outline" onClick={() => setCurrentStep(s => s - 1)} disabled={currentStep === 0 || isLoading}>
              Back
            </Button>
            {currentStep < STEPS.length - 1 ? (
              <Button onClick={handleNext} disabled={isLoading || (currentStep === 0 && !idea.trim())}>
                {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {currentStep === STEPS.length - 2 ? 'Finish & Review' : 'Next'}
              </Button>
            ) : (
              <Button
                size="lg"
                className="h-12 px-8 bg-green-600 hover:bg-green-700 text-foreground rounded-xl text-lg font-bold transition-all shadow-xl shadow-green-600/20 active:scale-95"
                onClick={() => onComplete({ idea, businessCase, assets, diagram, themeColor, preFlightResults })}
              >
                Ignite Forge
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
