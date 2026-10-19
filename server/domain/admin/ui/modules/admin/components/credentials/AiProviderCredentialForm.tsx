import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import type { Credential } from "@shared/schema/system";

export interface AIProviderMetadata {
  provider: string;
  organizationId?: string;
  apiVersion?: string;
  projectId?: string;
  baseUrl?: string;
  model?: string;
}

interface AiProviderCredentialFormProps {
  credential: Credential | null;
  metadata: AIProviderMetadata;
  onMetadataChange: (metadata: AIProviderMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
}

export function AiProviderCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading
}: AiProviderCredentialFormProps) {
  const handleChange = (field: keyof AIProviderMetadata, value: string) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  const renderProviderSpecificFields = () => {
    switch (metadata.provider) {
      case 'openai':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="ai-orgId">Organization ID (Optional)</Label>
              <Input
                id="ai-orgId"
                value={metadata.organizationId || ''}
                onChange={(e) => handleChange('organizationId', e.target.value)}
                placeholder="org-..."
                disabled={!isEditing || isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-apiVersion">API Version (Optional)</Label>
              <Input
                id="ai-apiVersion"
                value={metadata.apiVersion || ''}
                onChange={(e) => handleChange('apiVersion', e.target.value)}
                placeholder="2024-02-01"
                disabled={!isEditing || isLoading}
              />
            </div>
          </>
        );
      case 'anthropic':
        return (
          <div className="space-y-2">
            <Label htmlFor="ai-apiVersion">API Version (Optional)</Label>
            <Input
              id="ai-apiVersion"
              value={metadata.apiVersion || ''}
              onChange={(e) => handleChange('apiVersion', e.target.value)}
              placeholder="2024-01-01"
              disabled={!isEditing || isLoading}
            />
          </div>
        );
      case 'google':
        return (
          <div className="space-y-2">
            <Label htmlFor="ai-projectId">Project ID</Label>
            <Input
              id="ai-projectId"
              value={metadata.projectId || ''}
              onChange={(e) => handleChange('projectId', e.target.value)}
              placeholder="my-project-123"
              disabled={!isEditing || isLoading}
            />
          </div>
        );
      case 'ollama':
      case 'local_openai':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="ai-baseUrl">Base URL</Label>
              <Input
                id="ai-baseUrl"
                value={metadata.baseUrl || (metadata.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1')}
                onChange={(e) => handleChange('baseUrl', e.target.value)}
                placeholder={metadata.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'}
                disabled={!isEditing || isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model (Optional)</Label>
              <Input
                id="ai-model"
                value={metadata.model || ''}
                onChange={(e) => handleChange('model', e.target.value)}
                placeholder={metadata.provider === 'ollama' ? 'llama3.2' : 'local-model'}
                disabled={!isEditing || isLoading}
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider Configuration</CardTitle>
        <CardDescription>
          Configure your AI provider settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ai-provider">Provider</Label>
          <Select
            value={metadata.provider}
            onValueChange={(value) => handleChange('provider', value)}
            disabled={!isEditing || isLoading}
          >
            <SelectTrigger id="ai-provider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="google">Google (Gemini)</SelectItem>
              <SelectItem value="ollama">Ollama (Local)</SelectItem>
              <SelectItem value="local_openai">Local OpenAI Compatible (LM Studio, vLLM)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {renderProviderSpecificFields()}
      </CardContent>
    </Card>
  );
}
