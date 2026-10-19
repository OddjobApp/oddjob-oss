import React, { useState } from "react";
import { useRoute } from "wouter";
import { 
    Card, CardHeader, CardTitle, CardContent, CardDescription 
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Inbox, FileDiff, Network } from "lucide-react";
import { DecisionInbox } from "@domain-ui/admin/ui/modules/admin/pages/DecisionInbox";

export default function DecisionControlPanel() {
    const [, params] = useRoute("/operations/workbenches/decision-control/:cycleId");
    const cycleId = params?.cycleId;
    // The route param is a string; approvals carry a numeric cycle id. Passing
    // null when it won't parse leaves the queue unscoped, which shows more than
    // this cycle rather than silently showing nothing.
    const parsedCycleId = Number(cycleId);
    const numericCycleId = Number.isFinite(parsedCycleId) ? parsedCycleId : null;

    const [activeTab, setActiveTab] = useState("inbox");

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight">Decision Control Panel</h1>
                    <p className="text-muted-foreground mt-1">
                        HIL interventions & sandboxes for Cycle {cycleId}
                    </p>
                </div>
                <Badge variant="outline" className="px-3 py-1 bg-amber-500/10 text-amber-500 border-amber-500/20">
                    HUMAN-IN-THE-LOOP
                </Badge>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-8">
                    <TabsTrigger value="inbox" className="font-semibold tracking-wider">
                        <Inbox className="w-4 h-4 mr-2" />
                        Universal HIL Inbox
                    </TabsTrigger>
                    <TabsTrigger value="sandbox" className="font-semibold tracking-wider">
                        <FileDiff className="w-4 h-4 mr-2" />
                        Draft/Review Sandbox
                    </TabsTrigger>
                    <TabsTrigger value="provisioner" className="font-semibold tracking-wider">
                        <Network className="w-4 h-4 mr-2" />
                        Backlog Provisioner
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="inbox" className="mt-4">
                    {/*
                     * The real approvals queue, scoped to this cycle. It was built
                     * against /api/approvals but had never been routed anywhere, so
                     * this tab used to render a hardcoded "no pending approvals"
                     * notice that was true no matter how many were waiting.
                     */}
                    <DecisionInbox embedded cycleId={numericCycleId} />
                </TabsContent>

                <TabsContent value="sandbox" className="mt-4">
                    <Card className="bg-black/20 border-white/10">
                        <CardHeader>
                            <CardTitle>Draft/Review Sandbox</CardTitle>
                            <CardDescription>
                                Split-screen diff viewer comparing AI proposals vs current state.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64 border border-white/5 rounded-xl bg-black/40 flex items-center justify-center text-muted-foreground">
                                <div className="text-center space-y-2">
                                    <FileDiff className="w-8 h-8 mx-auto opacity-50" />
                                    <p>Select a draft to review changes...</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="provisioner" className="mt-4">
                    <Card className="bg-black/20 border-white/10">
                        <CardHeader>
                            <CardTitle>Backlog Provisioner</CardTitle>
                            <CardDescription>
                                Export cycle outcomes to external systems (Jira, Trello, Linear).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-48 border border-white/5 rounded-xl bg-black/40 flex items-center justify-center text-muted-foreground">
                                <p>Webhook templates mapping to be configured.</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
