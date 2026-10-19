import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Sparkles, Search as SearchIcon } from 'lucide-react';
import { SemanticSearch } from "@domain-ui/knowledge/ui/components/search/SemanticSearch";

export default function KnowledgeSearchPage() {
    const [activeTab, setActiveTab] = useState('semantic');

    return (
        <div className="container mx-auto py-8 max-w-6xl">
            <div className="text-center mb-8">
                <h1 className="text-3xl font-bold flex items-center justify-center gap-2 mb-2">
                    <Sparkles className="h-8 w-8 text-purple-600" />
                    Knowledge Search
                </h1>
                <p className="text-muted-foreground">
                    Search your knowledge graph using semantic, keyword, or hybrid search modes.
                </p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="semantic" className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Semantic Search
                    </TabsTrigger>
                    <TabsTrigger value="basic" className="flex items-center gap-2">
                        <SearchIcon className="h-4 w-4" />
                        Basic Search
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="semantic">
                    <SemanticSearch defaultMode="semantic" defaultThreshold={0.7} />
                </TabsContent>

                <TabsContent value="basic">
                    <Card>
                        <CardHeader>
                            <CardTitle>Basic Keyword Search</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                                Use the Universal Search (⌘K) for basic keyword search across all content.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Tip: Switch to Semantic Search tab for AI-powered similarity search with adjustable thresholds.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
