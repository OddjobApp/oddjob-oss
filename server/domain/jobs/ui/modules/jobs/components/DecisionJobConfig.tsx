
import React, { useEffect } from 'react';
import { useForm, FormProvider } from "react-hook-form";
import { DecisionNodeBuilder, type DecisionNodeConfig } from "@domain-ui/pipeline/ui/modules/pipelines/components/DecisionNodeBuilder";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";

interface DecisionJobConfigProps {
    config: any;
    onChange: (config: any) => void;
    availableVariables?: any[];
    availableSteps?: any[];
    currentStepOrder?: number;
}

export default function DecisionJobConfig({ 
    config, 
    onChange, 
    availableVariables = [], 
    availableSteps = [], 
    currentStepOrder 
}: DecisionJobConfigProps) {
    
    // The DecisionNodeBuilder uses react-hook-form internally but we need to bridge it
    // to the controlled 'config' and 'onChange' pattern of the UniversalJobEditor.
    
    const handleValueChange = (newConfig: DecisionNodeConfig) => {
        // Only trigger onChange if data actually changed to avoid infinite loops
        if (JSON.stringify(newConfig) !== JSON.stringify(config)) {
            onChange(newConfig);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-primary/10 rounded-lg">
                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div>
                    <h3 className="text-lg font-bold tracking-tight">Logical Decision Matrix</h3>
                    <p className="text-xs text-muted-foreground">Configure branching logic using CEL (Common Expression Language).</p>
                </div>
            </div>

            <DecisionNodeBuilder 
                value={config} 
                onChange={handleValueChange}
                availableSteps={availableSteps}
                currentStepOrder={currentStepOrder}
            />
            
            <Card className="border-dashed bg-muted/30">
                <CardContent className="p-4">
                    <p className="text-[10px] text-muted-foreground leading-relaxed uppercase font-bold tracking-widest text-center">
                        Decision Engine: CEL-V3 Active
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
