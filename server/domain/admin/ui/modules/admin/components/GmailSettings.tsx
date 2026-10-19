import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@domain-ui/core/ui/components/ui/alert';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { SiGmail } from 'react-icons/si';

interface GmailStatus {
    configured: boolean;
    authenticated: boolean;
    message: string;
}

export default function GmailSettings() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isDisconnecting, setIsDisconnecting] = useState(false);

    // Fetch Gmail status
    const { data: status, isLoading, error } = useQuery<GmailStatus>({
        queryKey: ['/api/gmail/status'],
        queryFn: async () => {
            const res = await fetch('/api/gmail/status', {
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error('Failed to fetch Gmail status');
            }
            return res.json();
        },
    });

    // Get Auth URL mutation
    const connectMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/gmail/oauth/url', {
                credentials: 'include',
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || 'Failed to get auth URL');
            }
            return res.json();
        },
        onSuccess: (data) => {
            // Redirect to Google OAuth
            window.location.href = data.url;
        },
        onError: (error: Error) => {
            toast({
                title: 'Connection Failed',
                description: error.message,
                variant: 'destructive',
            });
        },
    });

    // Disconnect mutation
    const disconnectMutation = useMutation({
        mutationFn: async () => {
            await apiRequest('DELETE', '/api/gmail/disconnect');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/gmail/status'] });
            toast({
                title: 'Disconnected',
                description: 'Gmail account has been disconnected.',
            });
            setIsDisconnecting(false);
        },
        onError: (error: Error) => {
            toast({
                title: 'Disconnect Failed',
                description: error.message,
                variant: 'destructive',
            });
            setIsDisconnecting(false);
        },
    });

    const handleConnect = () => {
        connectMutation.mutate();
    };

    const handleDisconnect = () => {
        if (confirm('Are you sure you want to disconnect your Gmail account?')) {
            setIsDisconnecting(true);
            disconnectMutation.mutate();
        }
    };

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <SiGmail className="w-5 h-5 text-red-500" />
                        <CardTitle>Gmail Integration</CardTitle>
                    </div>
                    <CardDescription>Loading status...</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <SiGmail className="w-5 h-5 text-red-500" />
                    <CardTitle>Gmail Integration</CardTitle>
                </div>
                <CardDescription>Connect your Gmail account to send HIL (Human-in-the-Loop) notifications directly from your email address.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {error ? (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>Failed to load Gmail status: {(error as Error).message}</AlertDescription>
                    </Alert>
                ) : (
                    <>
                        {!status?.configured ? (
                            <Alert className="bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-900">
                                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                                <AlertTitle className="text-yellow-800 dark:text-yellow-300">Configuration Required</AlertTitle>
                                <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                                    Gmail environment variables are missing. Please set <code>GMAIL CLIENT ID</code> and <code>GMAIL CLIENT SECRET</code> in your environment or secrets manager.
                                </AlertDescription>
                            </Alert>
                        ) : status.authenticated ? (
                            <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-900">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-green-100 dark:bg-green-800 rounded-full">
                                        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-300" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-green-900 dark:text-green-100">Connected</p>
                                        <p className="text-sm text-green-700 dark:text-green-400">Your Gmail account is ready to send notifications.</p>
                                    </div>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDisconnect}
                                    disabled={isDisconnecting}
                                    className="border-red-200 hover:bg-red-50 hover:text-red-600 text-red-500"
                                >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Disconnect
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-1">
                                    <p className="font-medium">Not Connected</p>
                                    <p className="text-sm text-muted-foreground">Authenticate with your Google account to enable email sending.</p>
                                </div>
                                <Button onClick={handleConnect} disabled={connectMutation.isPending}>
                                    {connectMutation.isPending ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                            Connecting...
                                        </>
                                    ) : (
                                        <>
                                            <ExternalLink className="w-4 h-4 mr-2" />
                                            Connect Gmail
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}

                        {status?.configured && (
                            <div className="text-xs text-muted-foreground mt-2">
                                <p>Status: {status.message}</p>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

