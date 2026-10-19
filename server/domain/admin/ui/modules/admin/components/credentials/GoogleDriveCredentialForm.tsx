import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import type { GoogleDriveMetadata, Credential } from "@shared/schema/system";

interface GoogleDriveCredentialFormProps {
  credential: Credential | null;
  metadata: GoogleDriveMetadata;
  onMetadataChange: (metadata: GoogleDriveMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
}

export function GoogleDriveCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading
}: GoogleDriveCredentialFormProps) {
  const handleChange = (field: keyof GoogleDriveMetadata, value: string) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Drive Configuration</CardTitle>
        <CardDescription>
          Configure OAuth 2.0 credentials for Google Drive integration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-blue-800">
            To connect Google Drive, you need to create OAuth 2.0 credentials in the 
            <a 
              href="https://console.cloud.google.com/apis/credentials" 
              target="_blank" 
              rel="noopener noreferrer"
              className="font-medium underline ml-1"
            >
              Google Cloud Console
            </a>.
            Enable the Google Drive API and configure the OAuth consent screen.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gdrive-clientId">Client ID</Label>
          <Input
            id="gdrive-clientId"
            value={metadata.clientId}
            onChange={(e) => handleChange('clientId', e.target.value)}
            placeholder="123456789-abc123.apps.googleusercontent.com"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="gdrive-clientSecret">Client Secret</Label>
          <Input
            id="gdrive-clientSecret"
            type="password"
            value={metadata.clientSecret}
            onChange={(e) => handleChange('clientSecret', e.target.value)}
            placeholder="GOCSPX-..."
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="gdrive-refreshToken">Refresh Token</Label>
          <Input
            id="gdrive-refreshToken"
            type="password"
            value={metadata.refreshToken}
            onChange={(e) => handleChange('refreshToken', e.target.value)}
            placeholder="1//04..."
            disabled={!isEditing || isLoading}
          />
          <p className="text-xs text-muted-foreground">
            The refresh token is obtained after completing the OAuth flow
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export type { GoogleDriveMetadata };
