import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import type { ConfluenceMetadata, Credential } from "@shared/schema/system";

interface ConfluenceCredentialFormProps {
  credential: Credential | null;
  metadata: ConfluenceMetadata;
  onMetadataChange: (metadata: ConfluenceMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
}

export function ConfluenceCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading
}: ConfluenceCredentialFormProps) {
  const handleChange = (field: keyof ConfluenceMetadata, value: string) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confluence Configuration</CardTitle>
        <CardDescription>
          Configure your Atlassian Confluence connection settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="confluence-endpoint">Confluence Endpoint</Label>
          <Input
            id="confluence-endpoint"
            value={metadata.endpoint}
            onChange={(e) => handleChange('endpoint', e.target.value)}
            placeholder="https://your-domain.atlassian.net/wiki"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confluence-domain">Domain</Label>
          <Input
            id="confluence-domain"
            value={metadata.domain}
            onChange={(e) => handleChange('domain', e.target.value)}
            placeholder="your-domain"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confluence-account">Account</Label>
          <Input
            id="confluence-account"
            type="email"
            value={metadata.account}
            onChange={(e) => handleChange('account', e.target.value)}
            placeholder="your.email@example.com"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confluence-apiKey">API Key</Label>
          <Input
            id="confluence-apiKey"
            type="password"
            value={metadata.apiKey}
            onChange={(e) => handleChange('apiKey', e.target.value)}
            placeholder="Your Confluence API Key"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confluence-spaceKey">Default Space Key (Optional)</Label>
          <Input
            id="confluence-spaceKey"
            value={metadata.spaceKey}
            onChange={(e) => handleChange('spaceKey', e.target.value)}
            placeholder="SPACE"
            disabled={!isEditing || isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export type { ConfluenceMetadata };
