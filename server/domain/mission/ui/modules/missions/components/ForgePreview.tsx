
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Globe, RefreshCw, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { useState } from "react";

interface ForgePreviewProps {
    slug: string;
    missionId: number;
}

export function ForgePreview({ slug, missionId }: ForgePreviewProps) {
    const [refreshKey, setRefreshKey] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    const previewUrl = `/forged/${slug}/`;

    return (
        <Card className="bg-background/40 backdrop-blur-md border-primary/20 h-full flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 border-b border-border/50 bg-background/20">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Globe className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-sm font-bold tracking-tight uppercase">Live Preview Artifact</CardTitle>
                            <CardDescription className="text-[10px] uppercase tracking-widest font-mono">
                                slug: {slug}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 px-2 text-muted-foreground hover:text-primary transition-colors"
                            onClick={() => setRefreshKey(prev => prev + 1)}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
                            Reload
                        </Button>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 px-2 border-primary/20 hover:bg-primary/10"
                            asChild
                        >
                            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                Detach
                            </a>
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative bg-foreground/5">
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                        <RefreshCw className="w-8 h-8 text-primary animate-spin mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest text-primary animate-pulse">Syncing Forge Workspace...</p>
                    </div>
                )}
                
                {hasError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-500/5 backdrop-blur-sm z-10 p-8 text-center">
                        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                        <h3 className="text-lg font-bold text-red-500 uppercase tracking-tighter mb-2">Preview Offline</h3>
                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                            The app container is either building or failed to start. Check the activity log for errors.
                        </p>
                        <Button 
                            variant="outline" 
                            className="mt-6 border-red-500/20 text-red-500 hover:bg-red-500/10"
                            onClick={() => { setHasError(false); setIsLoading(true); setRefreshKey(prev => prev + 1); }}
                        >
                            Retry Connection
                        </Button>
                    </div>
                )}

                <iframe 
                    key={refreshKey}
                    src={previewUrl}
                    title="App Arsenal Live Preview"
                    className="w-full h-full border-0"
                    onLoad={() => setIsLoading(false)}
                    onError={() => { setIsLoading(false); setHasError(true); }}
                />
            </CardContent>
            <div className="p-2 border-t border-border/50 bg-background/40 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                    Preview Tunnel Active
                </div>
                <div>
                    Localhost Tunnel: 127.0.0.1
                </div>
            </div>
        </Card>
    );
}
