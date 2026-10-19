import { useState, useEffect, useCallback } from 'react';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowLeft, Info, AlertCircle } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Alert, AlertDescription } from '@domain-ui/core/ui/components/ui/alert';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { AIProviderMetadata, AirflowMetadata, ConfluenceMetadata, Credential, JiraMetadata } from "@shared/schema/system";
import { ProviderSetupGuide } from '../components/ProviderSetupGuide.js';

const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', description: 'GPT-4, ChatGPT, DALL-E' },
  { value: 'anthropic', label: 'Anthropic Claude', description: 'Claude 3.5 Sonnet, Opus' },
  { value: 'google', label: 'Google Gemini', description: 'Gemini Pro, Flash' },
  { value: 'midjourney', label: 'Midjourney (Proxy)', description: 'Midjourney Image Generation' },
] as const;

export default function CredentialNew() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [newCredential, setNewCredential] = useState({
    name: '',
    type: 'api_key',
    description: '',
    envVarName: '',
    metadata: null as any,
  });
  const [selectedProvider, setSelectedProvider] = useState<'openai' | 'anthropic' | 'google' | 'midjourney'>('openai');
  const [apiKeyValue, setApiKeyValue] = useState('');
  // The credential's own secret, stored encrypted for the organization. It
  // replaces naming a server environment variable, which on a shared platform
  // meant pointing at the operator's secrets rather than your own.
  const [secretValue, setSecretValue] = useState('');
  const [jiraMetadata, setJiraMetadata] = useState({
    baseUrl: '',
    email: '',
  });
  const [airflowMetadata, setAirflowMetadata] = useState({
    baseUrl: '',
    authType: 'none',
    username: '',
  });
  const [midjourneyMetadata, setMidjourneyMetadata] = useState({
    baseUrl: 'https://api.midjourney-proxy.com',
    mode: 'fast'
  });
  const [confluenceMetadata, setConfluenceMetadata] = useState({
    baseUrl: '',
    username: '',
    domain: '',
    spaceKey: '',
  });

  // A Google provider points at the organization's Gemini connection (saved via
  // /api/org-model); every other credential carries its own secret.
  const usesOrgGeminiConnection = newCredential.type === 'ai_provider' && selectedProvider === 'google';

  // Fetch existing credentials for auto-generation
  const { data: credentials = [] } = useQuery<Credential[]>({
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

  // Auto-generate envVarName for AI providers
  const generateEnvVarName = useCallback((provider: 'openai' | 'anthropic' | 'google' | 'midjourney'): string => {
    const prefixMap = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GEMINI_API_KEY',
      midjourney: 'MIDJOURNEY_API_KEY',
    };
    const prefix = prefixMap[provider];

    // Find existing credentials with this prefix
    const existingNumbers = credentials
      .filter(cred => cred.envVarName.startsWith(prefix))
      .map(cred => {
        const match = cred.envVarName.match(/_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => !isNaN(num));

    // Find the next available number
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }

    return `${prefix}_${nextNumber}`;
  }, [credentials]);

  // Auto-generate envVarName for JIRA
  const generateJiraEnvVarName = useCallback((): string => {
    const prefix = 'JIRA_API_TOKEN';

    // Find existing credentials with this prefix
    const existingNumbers = credentials
      .filter(cred => cred.envVarName.startsWith(prefix))
      .map(cred => {
        const match = cred.envVarName.match(/_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => !isNaN(num));

    // Find the next available number
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }

    return `${prefix}_${nextNumber}`;
  }, [credentials]);

  // Auto-generate envVarName for Airflow
  const generateAirflowEnvVarName = useCallback((): string => {
    const prefix = 'AIRFLOW_AUTH';

    // Find existing credentials with this prefix
    const existingNumbers = credentials
      .filter(cred => cred.envVarName.startsWith(prefix))
      .map(cred => {
        const match = cred.envVarName.match(/_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => !isNaN(num));

    // Find the next available number
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }

    return `${prefix}_${nextNumber}`;
  }, [credentials]);

  // Auto-generate envVarName for Confluence
  const generateConfluenceEnvVarName = useCallback((): string => {
    const prefix = 'CONFLUENCE_API_TOKEN';

    // Find existing credentials with this prefix
    const existingNumbers = credentials
      .filter(cred => cred.envVarName.startsWith(prefix))
      .map(cred => {
        const match = cred.envVarName.match(/_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => !isNaN(num));

    // Find the next available number
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }

    return `${prefix}_${nextNumber}`;
  }, [credentials]);

  // Auto-generate envVarName when type or provider changes
  useEffect(() => {
    if (newCredential.type === 'ai_provider') {
      const generatedName = generateEnvVarName(selectedProvider);
      setNewCredential(prev => ({ ...prev, envVarName: generatedName }));
    } else if (newCredential.type === 'jira') {
      const generatedName = generateJiraEnvVarName();
      setNewCredential(prev => ({ ...prev, envVarName: generatedName }));
    } else if (newCredential.type === 'airflow') {
      const generatedName = generateAirflowEnvVarName();
      setNewCredential(prev => ({ ...prev, envVarName: generatedName }));
    } else if (newCredential.type === 'confluence') {
      const generatedName = generateConfluenceEnvVarName();
      setNewCredential(prev => ({ ...prev, envVarName: generatedName }));
    }
  }, [newCredential.type, selectedProvider, generateEnvVarName, generateJiraEnvVarName, generateAirflowEnvVarName, generateConfluenceEnvVarName]);


  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (credential: typeof newCredential) => {
      // Build metadata for AI provider or JIRA or Airflow or Confluence
      let metadata: any = null;
      if (credential.type === 'ai_provider') {
        if (selectedProvider === 'openai') {
          metadata = { provider: 'openai' };
        } else if (selectedProvider === 'anthropic') {
          metadata = { provider: 'anthropic', apiVersion: '2023-06-01' };
        } else if (selectedProvider === 'google') {
          metadata = { provider: 'google' };
        } else if (selectedProvider === 'midjourney') {
          metadata = {
            provider: 'midjourney',
            baseUrl: midjourneyMetadata.baseUrl,
            mode: midjourneyMetadata.mode as "fast" | "relax"
          };
        }
      } else if (credential.type === 'jira') {
        metadata = {
          baseUrl: jiraMetadata.baseUrl,
          email: jiraMetadata.email,
        };
      } else if (credential.type === 'airflow') {
        metadata = {
          baseUrl: airflowMetadata.baseUrl,
          authType: airflowMetadata.authType,
          username: airflowMetadata.username || undefined,
        };
      } else if (credential.type === 'confluence') {
        metadata = {
          baseUrl: confluenceMetadata.baseUrl,
          username: confluenceMetadata.username,
          domain: confluenceMetadata.domain || undefined,
          spaceKey: confluenceMetadata.spaceKey || undefined,
        };
      }

      const { envVarName: _envVarName, ...rest } = credential;
      const requestBody: any = {
        ...rest,
        metadata,
        createdBy: user?.email || 'unknown@oddjob.com',
      };
      if (!usesOrgGeminiConnection) requestBody.secret = secretValue;

      // If API key value is provided (for Gemini), include it
      if (credential.type === 'ai_provider' && selectedProvider === 'google' && apiKeyValue) {
        await apiRequest('PUT', '/api/org-model', { apiKey: apiKeyValue, model: 'gemini-2.5-flash' });
      }

      const response = await apiRequest('POST', '/api/credentials', requestBody);
      return await response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/credentials'] });
      const credentialId = data.id;

      toast({
        title: 'Credential created',
        description: 'The credential has been added successfully.',
      });

      // Navigate to the credential detail page
      setLocation(`/connections/credentials/${credentialId}`);
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to create credential',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(newCredential);
  };

  const handleCancel = () => {
    setLocation('/connections/credentials');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCancel}
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Add New Credential</h1>
          <p className="text-sm text-muted-foreground mt-1">Create a credential for use in your jobs</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Credential Details</CardTitle>
            <CardDescription>Enter information about the credential you want to store</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cred-name">Name</Label>
              <Input
                id="cred-name"
                placeholder="e.g., OpenAI Production API Key"
                value={newCredential.name}
                onChange={(e) => setNewCredential({ ...newCredential, name: e.target.value })}
                data-testid="input-credential-name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cred-description">Description (Optional)</Label>
              <Textarea
                id="cred-description"
                placeholder="Describe what this credential is used for..."
                value={newCredential.description}
                onChange={(e) => setNewCredential({ ...newCredential, description: e.target.value })}
                data-testid="input-credential-description"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cred-type">Type</Label>
              <Select
                value={newCredential.type}
                onValueChange={(value) => setNewCredential({ ...newCredential, type: value })}
              >
                <SelectTrigger id="cred-type" data-testid="select-credential-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="password">Password</SelectItem>
                  <SelectItem value="oauth_token">OAuth Token</SelectItem>
                  <SelectItem value="webhook">Webhook URL</SelectItem>
                  <SelectItem value="ssh_key">SSH Key</SelectItem>
                  <SelectItem value="ai_provider">AI Provider (OpenAI, Claude, Gemini)</SelectItem>
                  <SelectItem value="jira">JIRA</SelectItem>
                  <SelectItem value="airflow">Apache Airflow</SelectItem>
                  <SelectItem value="confluence">Atlassian Confluence</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newCredential.type === 'ai_provider' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ai-provider">AI Provider</Label>
                  <Select
                    value={selectedProvider}
                    onValueChange={(value) => {
                      setSelectedProvider(value as typeof selectedProvider);
                      if (value !== 'google') {
                        setApiKeyValue('');
                      }
                    }}
                  >
                    <SelectTrigger id="ai-provider" data-testid="select-ai-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_PROVIDERS.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          <div className="flex flex-col">
                            <span>{provider.label}</span>
                            <span className="text-xs text-muted-foreground">{provider.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedProvider === 'google' && (
                  <div className="space-y-2">
                    <Label htmlFor="gemini-api-key">Organization Gemini API key</Label>
                    <p className="text-sm text-muted-foreground">This replaces the Gemini connection for your organization. Google bills API usage separately from Oddjob.</p>
                    <Input
                      id="gemini-api-key"
                      type="password"
                      placeholder="Enter your Gemini API key"
                      value={apiKeyValue}
                      onChange={(e) => setApiKeyValue(e.target.value)}
                      data-testid="input-gemini-api-key"
                      required
                    />
                  </div>
                )}

                {selectedProvider === 'midjourney' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="mj-base-url">Proxy Base URL</Label>
                      <Input
                        id="mj-base-url"
                        placeholder="https://your-proxy.com"
                        value={midjourneyMetadata.baseUrl}
                        onChange={(e) => setMidjourneyMetadata({ ...midjourneyMetadata, baseUrl: e.target.value })}
                        required
                      />
                      <p className="text-xs text-muted-foreground">The API endpoint of your Midjourney Proxy service.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Mode</Label>
                      <Select value={midjourneyMetadata.mode} onValueChange={(val) => setMidjourneyMetadata({ ...midjourneyMetadata, mode: val })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fast">Fast</SelectItem>
                          <SelectItem value="relax">Relax</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </>
            )}

            {newCredential.type === 'jira' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="jira-base-url">JIRA Base URL</Label>
                  <Input
                    id="jira-base-url"
                    type="url"
                    placeholder="https://your-domain.atlassian.net"
                    value={jiraMetadata.baseUrl}
                    onChange={(e) => setJiraMetadata({ ...jiraMetadata, baseUrl: e.target.value })}
                    data-testid="input-jira-base-url"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The base URL of your JIRA instance (e.g., https://your-domain.atlassian.net)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jira-email">JIRA Email</Label>
                  <Input
                    id="jira-email"
                    type="email"
                    placeholder="user@example.com"
                    value={jiraMetadata.email}
                    onChange={(e) => setJiraMetadata({ ...jiraMetadata, email: e.target.value })}
                    data-testid="input-jira-email"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Your JIRA account email address (used for Basic authentication)
                  </p>
                </div>
              </>
            )}

            {!usesOrgGeminiConnection && (
              <div className="space-y-2">
                <Label htmlFor="credential-secret">Secret</Label>
                <Input
                  id="credential-secret"
                  type="password"
                  autoComplete="off"
                  placeholder="API key, token or password"
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  data-testid="input-credential-secret"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted for your organization. It is never shown again; replace it from the credential's page.
                </p>
              </div>
            )}

            {newCredential.type === 'ai_provider' && selectedProvider !== 'google' && selectedProvider !== 'midjourney' ? (
              <ProviderSetupGuide
                provider={selectedProvider as 'openai' | 'anthropic'}
              />
            ) : newCredential.type === 'ai_provider' && selectedProvider === 'midjourney' ? (
              <Alert>
                <Info className="w-4 h-4" />
                <AlertDescription className="space-y-3">
                  <div>
                    <strong>Midjourney Proxy Setup:</strong>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Obtain your Midjourney proxy API endpoint and token</li>
                    <li>Set the Base URL in the configuration below</li>
                    <li>Paste your proxy API token into Secret</li>
                  </ol>
                  <div className="text-xs text-muted-foreground pt-2">
                    Note: Midjourney does not have an official API. This integration uses a third-party proxy service.
                  </div>
                </AlertDescription>
              </Alert>
            ) : newCredential.type === 'jira' ? (
              <Alert>
                <Info className="w-4 h-4" />
                <AlertDescription className="space-y-3">
                  <div>
                    <strong>JIRA API Token Setup:</strong>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Go to <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary underline">Atlassian API Tokens</a></li>
                    <li>Click "Create API token"</li>
                    <li>Give it a name (e.g., "Odd Job")</li>
                    <li>Copy the generated token</li>
                    <li>Paste the API token into Secret</li>
                    <li>Paste the raw API token (do NOT base64 encode it)</li>
                  </ol>
                  <div className="text-xs text-muted-foreground pt-2">
                    Note: The system will automatically encode your email and token for Basic authentication.
                  </div>
                </AlertDescription>
              </Alert>
            ) : newCredential.type === 'airflow' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="airflow-base-url">Airflow Base URL</Label>
                  <Input
                    id="airflow-base-url"
                    type="url"
                    placeholder="https://airflow.example.com/api/v1"
                    value={airflowMetadata.baseUrl}
                    onChange={(e) => setAirflowMetadata({ ...airflowMetadata, baseUrl: e.target.value })}
                    data-testid="input-airflow-base-url"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The API Base URL (e.g., https://airflow.example.com/api/v1)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="airflow-auth-type">Authentication Type</Label>
                  <Select
                    value={airflowMetadata.authType}
                    onValueChange={(value) => setAirflowMetadata({ ...airflowMetadata, authType: value })}
                  >
                    <SelectTrigger id="airflow-auth-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (Public)</SelectItem>
                      <SelectItem value="basic">Basic Auth (Username + Password)</SelectItem>
                      <SelectItem value="bearer">Bearer Token (Access Token)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {airflowMetadata.authType === 'basic' && (
                  <div className="space-y-2">
                    <Label htmlFor="airflow-username">Username</Label>
                    <Input
                      id="airflow-username"
                      placeholder="Airflow Username"
                      value={airflowMetadata.username}
                      onChange={(e) => setAirflowMetadata({ ...airflowMetadata, username: e.target.value })}
                    />
                  </div>
                )}

                <Alert>
                  <Info className="w-4 h-4" />
                  <AlertDescription>
                    Enter the {airflowMetadata.authType === 'basic' ? 'Password' : 'Token'} as the Secret below.
                  </AlertDescription>
                </Alert>
              </div>
            ) : newCredential.type === 'confluence' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="confluence-base-url">Confluence Base URL</Label>
                  <Input
                    id="confluence-base-url"
                    type="url"
                    placeholder="https://your-domain.atlassian.net/wiki"
                    value={confluenceMetadata.baseUrl}
                    onChange={(e) => setConfluenceMetadata({ ...confluenceMetadata, baseUrl: e.target.value })}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The base URL of your Confluence Wiki (include /wiki if applicable)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confluence-username">Email Address</Label>
                  <Input
                    id="confluence-username"
                    type="email"
                    placeholder="user@example.com"
                    value={confluenceMetadata.username}
                    onChange={(e) => setConfluenceMetadata({ ...confluenceMetadata, username: e.target.value })}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Your Atlassian account email address
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confluence-domain">Domain (Optional)</Label>
                  <Input
                    id="confluence-domain"
                    placeholder="example.atlassian.net"
                    value={confluenceMetadata.domain}
                    onChange={(e) => setConfluenceMetadata({ ...confluenceMetadata, domain: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confluence-spacekey">Space Key (Optional - Hard Lock)</Label>
                  <Input
                    id="confluence-spacekey"
                    placeholder="e.g. ENG"
                    value={confluenceMetadata.spaceKey}
                    onChange={(e) => setConfluenceMetadata({ ...confluenceMetadata, spaceKey: e.target.value.toUpperCase() })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lock the agent to this space only. Leave blank for site-wide access.
                  </p>
                </div>

                <Alert>
                  <Info className="w-4 h-4" />
                  <AlertDescription>
                    Enter the <strong>Atlassian API Token</strong> as the Secret below.
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              !newCredential.name ||
              !newCredential.envVarName ||
              createMutation.isPending ||
              (newCredential.type === 'jira' && (!jiraMetadata.baseUrl || !jiraMetadata.email)) ||
              (newCredential.type === 'ai_provider' && selectedProvider === 'google' && !apiKeyValue) ||
              (newCredential.type === 'airflow' && !airflowMetadata.baseUrl) ||
              (newCredential.type === 'confluence' && (!confluenceMetadata.baseUrl || !confluenceMetadata.username))
            }
            data-testid="button-save"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Credential'}
          </Button>
        </div>
      </form>
    </div>
  );
}

