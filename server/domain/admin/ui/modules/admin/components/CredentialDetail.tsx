/**
 * Credential Detail Page.
 *
 * Type-specific fields live in ./credentials/, dispatched by
 * CredentialFormFactory. This decomposition already existed — it was written
 * alongside a 1,305-line CredentialDetail.tsx that inlined all seven forms,
 * and nothing ever imported it: AdminRouting still lazy-loaded the monolith,
 * so the refactor sat dark while the long file stayed on the live route. The
 * monolith is now deleted and this file took its name, so every existing
 * import path keeps working.
 *
 * The factory covers the same seven types the monolith did (jira, database,
 * ai_provider, airflow, smtp, confluence, google_drive) and adds a default
 * branch, which the monolith lacked — an unrecognised type used to render
 * nothing at all. See CredentialFormFactory.test.tsx.
 */

import { useState, useEffect } from 'react';
import { useRoute, Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Key, Brain, Edit2, Save, X } from 'lucide-react';
import { SiConfluence } from 'react-icons/si';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { Credential } from "@shared/schema/system";
import { 
  CredentialFormFactory, 
  JiraMetadata,
  DatabaseMetadata,
  AIProviderMetadata,
  AirflowMetadata,
  SmtpMetadata,
  ConfluenceMetadata,
  GoogleDriveMetadata
} from './credentials/index.js';

type CredentialMetadata = 
  | JiraMetadata 
  | DatabaseMetadata 
  | AIProviderMetadata 
  | AirflowMetadata 
  | SmtpMetadata 
  | ConfluenceMetadata 
  | GoogleDriveMetadata;

// Default metadata factories
const getDefaultMetadata = (type: string): CredentialMetadata => {
  switch (type) {
    case 'jira':
      return { endpoint: '', account: '', apiKey: '' };
    case 'database':
      return { host: '', port: 5432, database: '', user: '', engine: 'postgres' };
    case 'ai_provider':
      return { provider: 'openai', organizationId: '', apiVersion: '', projectId: '', baseUrl: 'http://localhost:11434', model: '' };
    case 'airflow':
      return { baseUrl: '', authType: 'none', username: '' };
    case 'smtp':
      return { host: '', port: 587, secure: false, user: '', fromEmail: '' };
    case 'confluence':
      return { endpoint: '', account: '', apiKey: '', domain: '', spaceKey: '' };
    case 'google_drive':
      return { provider: 'google_drive', clientId: '', clientSecret: '', refreshToken: '' };
    default:
      return {} as CredentialMetadata;
  }
};

// Parse metadata from credential
const parseMetadata = (credential: Credential | null): CredentialMetadata => {
  if (!credential?.metadata) return getDefaultMetadata(credential?.type || '');
  
  const defaults = getDefaultMetadata(credential.type);
  return { ...defaults, ...credential.metadata } as CredentialMetadata;
};

export default function CredentialDetail() {
  const [, connectionParams] = useRoute('/connections/credentials/:id');
  const [, legacyParams] = useRoute('/credentials/:id');
  const params = connectionParams || legacyParams;
  const credentialId = params?.id ? parseInt(params.id, 10) : 0;
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  // Fetch credential
  const { data: credential, isLoading } = useQuery<Credential>({
    queryKey: ['/api/credentials', credentialId],
    queryFn: async () => {
      const res = await fetch(`/api/credentials/${credentialId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch credential");
      return res.json();
    },
    enabled: credentialId > 0,
  });

  // Local state
  const [editedCredential, setEditedCredential] = useState<Partial<Credential>>({});
  const [metadata, setMetadata] = useState<CredentialMetadata>({} as CredentialMetadata);
  const [jiraTestResult, setJiraTestResult] = useState<any>(null);
  // A replacement secret; empty leaves the stored one in place. Never pre-filled:
  // the server does not send secrets back.
  const [newSecret, setNewSecret] = useState('');
  const secretSource = (credential as (Credential & { secretSource?: 'stored' | 'environment' | 'missing' }) | undefined)?.secretSource;

  // Initialize state when credential loads
  useEffect(() => {
    if (credential) {
      setEditedCredential({
        name: credential.name,
        description: credential.description,
        envVarName: credential.envVarName,
      });
      setMetadata(parseMetadata(credential));
      setIsEditing(false);
      setJiraTestResult(null);
    }
  }, [credential]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Credential>) => {
      return await apiRequest('PATCH', `/api/credentials/${credentialId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/credentials'] });
      queryClient.invalidateQueries({ queryKey: ['/api/credentials', credentialId] });
      toast({ title: 'Credential updated', description: 'Changes saved successfully.' });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    },
  });

  // JIRA test mutation
  const testJiraMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/credentials/${credentialId}/test`);
      return response.json();
    },
    onSuccess: (result) => {
      setJiraTestResult(result);
      toast({
        title: result.success ? 'Connection Successful' : 'Connection Failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    },
  });

  const handleSave = () => {
    const updates: Partial<Credential> & { secret?: string } = {
      name: editedCredential.name,
      description: editedCredential.description,
      metadata: metadata,
    };
    if (newSecret) updates.secret = newSecret;
    updateMutation.mutate(updates, { onSuccess: () => setNewSecret('') });
  };

  const handleCancel = () => {
    if (credential) {
      setEditedCredential({
        name: credential.name,
        description: credential.description,
        envVarName: credential.envVarName,
      });
      setMetadata(parseMetadata(credential));
    }
    setNewSecret('');
    setIsEditing(false);
    setJiraTestResult(null);
  };

  // Get provider name for AI credentials
  const aiMetadata = credential?.type === 'ai_provider' ? (credential.metadata as AIProviderMetadata) : null;
  const providerName = aiMetadata?.provider === 'openai' ? 'OpenAI' :
    aiMetadata?.provider === 'anthropic' ? 'Anthropic Claude' :
    aiMetadata?.provider === 'google' ? 'Google Gemini' : null;

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading credential...</div>;
  }

  if (!credential) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">Credential not found</p>
        <Link href="/connections/credentials">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Credentials
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/connections/credentials">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{credential.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Credential Details</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel} data-testid="button-cancel">
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={updateMutation.isPending}
                data-testid="button-save"
              >
                <Save className="w-4 h-4 mr-2" />
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <Button onClick={() => setIsEditing(true)} data-testid="button-edit">
              <Edit2 className="w-4 h-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Core credential details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                {isEditing ? (
                  <Input
                    value={editedCredential.name || ''}
                    onChange={(e) => setEditedCredential({ ...editedCredential, name: e.target.value })}
                    data-testid="input-name"
                  />
                ) : (
                  <p className="text-foreground">{credential.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                {isEditing ? (
                  <Textarea
                    value={editedCredential.description || ''}
                    onChange={(e) => setEditedCredential({ ...editedCredential, description: e.target.value })}
                    placeholder="Describe this credential..."
                    rows={3}
                    data-testid="input-description"
                  />
                ) : (
                  <p className="text-foreground">
                    {credential.description || <span className="text-muted-foreground italic">No description</span>}
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Type</Label>
                <div className="flex items-center gap-2">
                  {credential.type === 'ai_provider' ? (
                    <Brain className="w-4 h-4 text-purple-500" />
                  ) : credential.type === 'confluence' ? (
                    <SiConfluence className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Key className="w-4 h-4 text-blue-500" />
                  )}
                  <Badge variant="secondary">
                    {credential.type === 'ai_provider' && providerName
                      ? providerName
                      : credential.type.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="credential-secret">Secret</Label>
                {isEditing ? (
                  <Input
                    id="credential-secret"
                    type="password"
                    autoComplete="off"
                    placeholder={secretSource === 'stored' ? 'Leave blank to keep the current secret' : 'Enter the secret'}
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    data-testid="input-credential-secret"
                  />
                ) : (
                  <p className="text-sm" data-testid="text-secret-status">
                    {secretSource === 'stored' ? 'Set (stored encrypted)'
                      : secretSource === 'environment' ? `From the server environment variable ${credential.envVarName}`
                      : 'Not set'}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Secrets are stored encrypted for your organization and are never shown again.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Type-Specific Configuration via Factory */}
          <CredentialFormFactory
            credential={credential}
            metadata={metadata}
            onMetadataChange={setMetadata}
            isEditing={isEditing}
            isLoading={isLoading}
            testResult={jiraTestResult}
            onTest={() => testJiraMutation.mutate()}
            isTesting={testJiraMutation.isPending}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Storage</Label>
                <p className="text-sm text-foreground">
                  {secretSource === 'stored' ? 'Encrypted, sealed to your organization'
                    : secretSource === 'environment' ? 'Server environment (legacy)'
                    : 'No secret stored'}
                </p>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="text-muted-foreground">Created By</Label>
                <p className="text-sm text-foreground">{credential.createdBy}</p>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="text-muted-foreground">Created At</Label>
                <p className="text-sm text-foreground">
                  {credential.createdAt ? new Date(credential.createdAt).toLocaleString() : '-'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
