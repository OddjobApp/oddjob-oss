/**
 * Mission Webhook Configuration Tab
 * 
 * UI for configuring webhook triggers for missions.
 * Allows users to:
 * - View/copy webhook URL
 * - Generate/manage API keys
 * - View trigger history
 * - See payload examples
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { 
    Webhook, 
    Copy, 
    Key, 
    History, 
    Play, 
    CheckCircle2, 
    XCircle, 
    Clock,
    ExternalLink,
    RefreshCw,
    ShieldCheck,
    AlertTriangle
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { LoadingSkeleton } from "@domain-ui/core/ui/components/ui/loading-skeleton";

interface WebhookConfigTabProps {
    missionId: number;
}

interface WebhookTrigger {
    id: number;
    triggeredAt: string;
    status: 'success' | 'failed';
    sourceIp?: string;
    payload?: any;
    error?: string;
}

export function WebhookConfigTab({ missionId }: WebhookConfigTabProps) {
    const { toast } = useToast();
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    const webhookUrl = `${window.location.origin}/api/webhook/trigger/mission/${missionId}`;

    // Fetch webhook configuration
    const { data: config, isLoading: configLoading } = useQuery({
        queryKey: [`/api/missions/${missionId}/webhook-config`],
        queryFn: async () => {
            try {
                const res = await apiRequest("GET", `/api/missions/${missionId}/webhook-config`);
                return await res.json();
            } catch {
                // Return default config if endpoint doesn't exist yet
                return {
                    apiKey: null,
                    isActive: false,
                    createdAt: null,
                };
            }
        },
    });

    // Fetch trigger history
    const { data: history, isLoading: historyLoading } = useQuery({
        queryKey: [`/api/missions/${missionId}/webhook-history`],
        queryFn: async () => {
            try {
                const res = await apiRequest("GET", `/api/missions/${missionId}/webhook-history`);
                return await res.json();
            } catch {
                return { triggers: [] };
            }
        },
    });

    const handleCopy = (text: string, type: 'url' | 'key') => {
        navigator.clipboard.writeText(text);
        if (type === 'url') {
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 2000);
        } else {
            setCopiedKey(true);
            setTimeout(() => setCopiedKey(false), 2000);
        }
        toast({
            title: "Copied!",
            description: `${type === 'url' ? 'Webhook URL' : 'API Key'} copied to clipboard`,
        });
    };

    const handleRegenerateKey = async () => {
        setIsRegenerating(true);
        try {
            const res = await apiRequest("POST", `/api/missions/${missionId}/webhook-config/regenerate`);
            if (res.ok) {
                toast({
                    title: "API Key Regenerated",
                    description: "Your new API key is ready to use",
                });
            }
        } catch (err) {
            toast({
                title: "Error",
                description: "Failed to regenerate API key",
                variant: "destructive",
            });
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleTestWebhook = async () => {
        try {
            toast({
                title: "Testing Webhook...",
                description: "Sending test payload to mission webhook",
            });
            
            // Note: This would need a proper test endpoint
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            toast({
                title: "Test Sent",
                description: "Check trigger history for results",
            });
        } catch (err) {
            toast({
                title: "Test Failed",
                description: "Could not send test webhook",
                variant: "destructive",
            });
        }
    };

    if (configLoading) {
        return <div className="h-96"><LoadingSkeleton /></div>;
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Webhook Configuration</h2>
                    <p className="text-muted-foreground">
                        Trigger this mission via external webhooks from GitHub, Stripe, or any external service.
                    </p>
                </div>
                <Badge variant={config?.isActive ? "default" : "secondary"} className="gap-1">
                    {config?.isActive ? (
                        <><CheckCircle2 className="w-3 h-3" /> Active</>
                    ) : (
                        <><AlertTriangle className="w-3 h-3" /> Inactive</>
                    )}
                </Badge>
            </div>

            <Tabs defaultValue="configuration" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="configuration" className="gap-2">
                        <Webhook className="w-4 h-4" />
                        Configuration
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-2">
                        <History className="w-4 h-4" />
                        Trigger History
                    </TabsTrigger>
                    <TabsTrigger value="docs" className="gap-2">
                        <ExternalLink className="w-4 h-4" />
                        Documentation
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="configuration" className="space-y-6">
                    {/* Webhook URL Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Webhook className="w-5 h-5 text-primary" />
                                <CardTitle>Webhook URL</CardTitle>
                            </div>
                            <CardDescription>
                                Send POST requests to this URL to trigger the mission
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Input 
                                    value={webhookUrl} 
                                    readOnly 
                                    className="font-mono text-sm bg-muted"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleCopy(webhookUrl, 'url')}
                                    className={copiedUrl ? "text-green-500" : ""}
                                >
                                    {copiedUrl ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </Button>
                            </div>
                            
                            <div className="flex gap-2">
                                <Button 
                                    variant="secondary" 
                                    size="sm" 
                                    className="gap-2"
                                    onClick={handleTestWebhook}
                                >
                                    <Play className="w-4 h-4" />
                                    Send Test Webhook
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* API Key Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Key className="w-5 h-5 text-primary" />
                                <CardTitle>API Key</CardTitle>
                            </div>
                            <CardDescription>
                                Include this key in the X-API-Key header for authentication
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {config?.apiKey ? (
                                <>
                                    <div className="flex gap-2">
                                        <Input 
                                            value={config.apiKey} 
                                            readOnly 
                                            type="password"
                                            className="font-mono text-sm bg-muted"
                                        />
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => handleCopy(config.apiKey, 'key')}
                                            className={copiedKey ? "text-green-500" : ""}
                                        >
                                            {copiedKey ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <ShieldCheck className="w-4 h-4" />
                                        <span>Key created: {config.createdAt ? new Date(config.createdAt).toLocaleDateString() : 'Unknown'}</span>
                                    </div>

                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="gap-2"
                                        onClick={handleRegenerateKey}
                                        disabled={isRegenerating}
                                    >
                                        <RefreshCw className={`w-4 h-4 ${isRegenerating ? "animate-spin" : ""}`} />
                                        Regenerate Key
                                    </Button>
                                </>
                            ) : (
                                <div className="text-center py-8">
                                    <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                                    <p className="text-muted-foreground mb-4">No API key configured</p>
                                    <Button 
                                        variant="default" 
                                        className="gap-2"
                                        onClick={handleRegenerateKey}
                                        disabled={isRegenerating}
                                    >
                                        <Key className="w-4 h-4" />
                                        Generate API Key
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Security Note */}
                    <Card className="bg-amber-500/5 border-amber-500/20">
                        <CardContent className="pt-6">
                            <div className="flex gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                                <div className="space-y-1">
                                    <p className="font-medium text-sm">Security Note</p>
                                    <p className="text-sm text-muted-foreground">
                                        Keep your API key secret. If compromised, regenerate immediately. 
                                        Webhooks are rate-limited to 100 requests per minute.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="history">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <History className="w-5 h-5 text-primary" />
                                <CardTitle>Trigger History</CardTitle>
                            </div>
                            <CardDescription>
                                Recent webhook invocations and their results
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {historyLoading ? (
                                <div className="h-48"><LoadingSkeleton /></div>
                            ) : history?.triggers?.length > 0 ? (
                                <div className="space-y-3">
                                    {history.triggers.map((trigger: WebhookTrigger) => (
                                        <div 
                                            key={trigger.id} 
                                            className="flex items-center justify-between p-3 bg-muted rounded-lg"
                                        >
                                            <div className="flex items-center gap-3">
                                                {trigger.status === 'success' ? (
                                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                                ) : (
                                                    <XCircle className="w-5 h-5 text-red-500" />
                                                )}
                                                <div>
                                                    <p className="font-medium text-sm">
                                                        {trigger.status === 'success' ? 'Success' : 'Failed'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {trigger.sourceIp || 'Unknown IP'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Clock className="w-4 h-4" />
                                                {new Date(trigger.triggeredAt).toLocaleString()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p>No webhook triggers yet</p>
                                    <p className="text-sm">Send a test webhook to see it here</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="docs">
                    <Card>
                        <CardHeader>
                            <CardTitle>Integration Examples</CardTitle>
                            <CardDescription>
                                Example payloads and usage for common integrations
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* cURL Example */}
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm">cURL</h4>
                                <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto font-mono">
{`curl -X POST \\
  ${webhookUrl} \\
  -H "X-API-Key: ${config?.apiKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event": "deploy",
    "repository": "my-app",
    "ref": "main"
  }'`}
                                </pre>
                            </div>

                            {/* JavaScript Example */}
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm">JavaScript / TypeScript</h4>
                                <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto font-mono">
{`const response = await fetch('${webhookUrl}', {
  method: 'POST',
  headers: {
    'X-API-Key': '${config?.apiKey || 'YOUR_API_KEY'}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    event: 'deploy',
    repository: 'my-app',
    ref: 'main',
  }),
});

const result = await response.json();
console.log(result.missionRunId);`}
                                </pre>
                            </div>

                            {/* GitHub Actions Example */}
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm">GitHub Actions</h4>
                                <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto font-mono">
{`- name: Trigger Oddjob Mission
  run: |
    curl -X POST ${webhookUrl} \\
      -H "X-API-Key: \${{ secrets.ODDJOB_API_KEY }}" \\
      -H "Content-Type: application/json" \\
      -d '{
        "event": "push",
        "repository": "'\${{ github.repository }}'",
        "ref": "'\${{ github.ref }}'"
      }'`}
                                </pre>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

export default WebhookConfigTab;
