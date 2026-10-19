import React, { useState } from "react";
import { useRoute } from "wouter";
import { 
    Card, CardHeader, CardTitle, CardContent, CardDescription 
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Database, PenTool, UploadCloud, FileText } from "lucide-react";

export default function UniversalStudio() {
    const [, params] = useRoute("/operations/workbenches/universal-studio/:cycleId");
    const cycleId = params?.cycleId;

    const [activeTab, setActiveTab] = useState("ingestion");

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight">Universal Studio</h1>
                    <p className="text-muted-foreground mt-1">
                        Generic Workspace for Cycle {cycleId}
                    </p>
                </div>
                <Badge variant="outline" className="px-3 py-1 bg-primary/10 text-primary border-primary/20">
                    SCHEMA DRIVEN
                </Badge>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-8">
                    <TabsTrigger value="ingestion" className="font-semibold tracking-wider">
                        <Database className="w-4 h-4 mr-2" />
                        Dynamic Ingestion Grid
                    </TabsTrigger>
                    <TabsTrigger value="synthesis" className="font-semibold tracking-wider">
                        <PenTool className="w-4 h-4 mr-2" />
                        Synthesis Canvas
                    </TabsTrigger>
                    <TabsTrigger value="indexer" className="font-semibold tracking-wider">
                        <UploadCloud className="w-4 h-4 mr-2" />
                        Knowledge Indexer
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="ingestion" className="mt-4">
                    <Card className="bg-black/20 border-white/10">
                        <CardHeader>
                            <CardTitle>Dynamic Ingestion Grid</CardTitle>
                            <CardDescription>
                                Displays ingested data records (e.g. arXiv papers, competitor profiles) mapped to the cycle schema.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64 border border-white/5 rounded-xl bg-black/40 flex items-center justify-center text-muted-foreground">
                                <div className="text-center space-y-2">
                                    <Database className="w-8 h-8 mx-auto opacity-50" />
                                    <p>Awaiting Schema Definition...</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="synthesis" className="mt-4">
                    <Card className="bg-black/20 border-white/10">
                        <CardHeader>
                            <CardTitle>Synthesis Canvas</CardTitle>
                            <CardDescription>
                                Workspace where agents assemble raw facts into formal artifacts (RFCs, Briefs).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-4 h-[500px]">
                                <div className="border border-white/5 rounded-xl bg-black/40 p-4">
                                    <h3 className="font-bold text-sm text-muted-foreground mb-4">Raw Facts Dump</h3>
                                    {/* Placeholder for dropped facts */}
                                </div>
                                <div className="border border-white/5 rounded-xl bg-black/40 p-4">
                                    <h3 className="font-bold text-sm text-muted-foreground mb-4">Artifact Draft</h3>
                                    {/* Placeholder for draft editor */}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="indexer" className="mt-4">
                    <Card className="bg-black/20 border-white/10">
                        <CardHeader>
                            <CardTitle>Knowledge Indexer</CardTitle>
                            <CardDescription>
                                Publish the synthesized artifact to the Organization Knowledge Graph.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 border border-white/10 rounded-xl bg-foreground/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <FileText className="w-5 h-5 text-primary" />
                                    <div>
                                        <p className="font-bold text-sm">Draft Ready</p>
                                        <p className="text-xs text-muted-foreground">Awaiting publication</p>
                                    </div>
                                </div>
                                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-full">
                                    Publish to Graph
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
