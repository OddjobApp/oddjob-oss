
import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { OutcomeMasterDetail } from './components/OutcomeMasterDetail.js';
import { VECTORS } from './components/ScoringRuleForm.js';

export function ScoringOutcomeView() {
    const [activeTab, setActiveTab] = useState("S");

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Scoring Outcomes</h2>
                <p className="text-sm text-muted-foreground">
                    Define the desired outcomes for each S.C.O.R.E. vector, and the behavioral rules that contribute to them.
                </p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-5 h-auto p-1">
                    {VECTORS.map(v => (
                        <TabsTrigger key={v.id} value={v.id} className="flex flex-col py-2 gap-1 h-full">
                            <div className="flex items-center gap-2 font-bold text-base">
                                <span className={`w-3 h-3 rounded-full ${v.color}`} />
                                {v.id} - {v.name}
                            </div>
                            <span className="text-xs text-muted-foreground font-normal line-clamp-1">{v.desc}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>

                {VECTORS.map(v => (
                    <TabsContent key={v.id} value={v.id} className="mt-6 animate-in fade-in-50 duration-300">
                        <OutcomeMasterDetail
                            vector={v.id}
                            vectorLabel={v.name}
                            vectorDescription={v.desc}
                        />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}
