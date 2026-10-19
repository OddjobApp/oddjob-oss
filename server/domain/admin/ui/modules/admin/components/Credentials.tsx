import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Plus, Key, Brain, Lock, Webhook, Server, Trash2, MoreVertical, Info } from 'lucide-react';
import { SiConfluence, SiGoogledrive } from 'react-icons/si';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@domain-ui/core/ui/components/ui/alert';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { AIProviderMetadata, Credential } from "@shared/schema/system";

const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', description: 'GPT-4, ChatGPT, DALL-E' },
  { value: 'anthropic', label: 'Anthropic Claude', description: 'Claude 3.5 Sonnet, Opus' },
  { value: 'google', label: 'Google Gemini', description: 'Gemini Pro, Flash' },
  { value: 'ollama', label: 'Ollama (Local)', description: 'Run local models like Llama3, Mistral' },
] as const;

export default function Credentials() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch credentials
  const { data: credentials = [], isLoading } = useQuery<Credential[]>({
    queryKey: ['/api/credentials'],
    queryFn: async () => {
      const res = await fetch("/api/credentials", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch credentials");
      }
      return res.json();
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/credentials/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/credentials'] });
      toast({
        title: 'Credential deleted',
        description: 'The credential has been removed successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to delete credential',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const filteredCredentials = credentials.filter(cred =>
    cred.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cred.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDeleteCredential = (credentialId: number) => {
    if (confirm('Are you sure you want to delete this credential?')) {
      deleteMutation.mutate(credentialId);
    }
  };

  const getTypeIcon = (type: string, metadata?: any) => {
    if (type === 'ai_provider') {
      return <Brain className="w-4 h-4 text-primary" />;
    }
    switch (type) {
      case 'api_key':
        return <Key className="w-4 h-4 text-foreground/80" />;
      case 'password':
        return <Lock className="w-4 h-4 text-foreground/80" />;
      case 'webhook':
        return <Webhook className="w-4 h-4 text-foreground/80" />;
      case 'ssh_key':
        return <Server className="w-4 h-4 text-foreground/80" />;
      case 'confluence':
        return <SiConfluence className="w-4 h-4 text-primary" />;
      case 'google_drive':
        return <SiGoogledrive className="w-4 h-4 text-primary" />;
      default:
        return <Key className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getTypeBadge = (cred: Credential) => {
    if (cred.type === 'ai_provider' && cred.metadata) {
      const metadata = cred.metadata as AIProviderMetadata;
      const provider = AI_PROVIDERS.find(p => p.value === metadata.provider);
      return (
        <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">
          {provider?.label || 'AI Provider'}
        </Badge>
      );
    }
    return <Badge variant="secondary">{cred.type.replace('_', ' ').toUpperCase()}</Badge>;
  };

  const formatDate = (dateString: string | Date) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Credentials</h1>
          <p className="text-sm text-muted-foreground mt-1">Securely manage API keys, passwords, and tokens</p>
        </div>
        <Link href="/connections/credentials/new">
          <Button data-testid="button-create-credential">
            <Plus className="w-4 h-4 mr-2" />
            Add Credential
          </Button>
        </Link>
      </div>

      <Alert>
        <Info className="w-4 h-4" />
        <AlertDescription>
          Credentials reference Odd Job Secrets (environment variables). The actual secret values are stored securely in Odd Job's Secrets tool, not in the database.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Stored Credentials</CardTitle>
              <CardDescription>Encrypted secrets used by your jobs</CardDescription>
            </div>
            <Input
              placeholder="Search credentials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
              data-testid="input-search-credentials"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading credentials...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Environment Variable</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Created Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCredentials.map((cred) => (
                  <TableRow key={cred.id} data-testid={`row-credential-${cred.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/connections/credentials/${cred.id}`} className="flex items-center gap-2 hover:underline cursor-pointer">
                        {getTypeIcon(cred.type, cred.metadata)}
                        <span>{cred.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell>{getTypeBadge(cred)}</TableCell>
                    <TableCell>
                      <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                        {cred.envVarName}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{cred.createdBy}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {cred.createdAt ? formatDate(cred.createdAt) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${cred.id}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDeleteCredential(cred.id)} className="text-destructive">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && filteredCredentials.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No credentials found matching your search.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

