import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import type { AirflowMetadata, Credential } from "@shared/schema/system";

interface AirflowCredentialFormProps {
  credential: Credential | null;
  metadata: AirflowMetadata;
  onMetadataChange: (metadata: AirflowMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
}

export function AirflowCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading
}: AirflowCredentialFormProps) {
  const handleChange = (field: keyof AirflowMetadata, value: any) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Airflow Configuration</CardTitle>
        <CardDescription>
          Configure your Apache Airflow instance connection settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="airflow-baseUrl">Airflow Base URL</Label>
          <Input
            id="airflow-baseUrl"
            value={metadata.baseUrl}
            onChange={(e) => handleChange('baseUrl', e.target.value)}
            placeholder="http://localhost:8080"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="airflow-authType">Authentication Type</Label>
          <Select
            value={metadata.authType}
            onValueChange={(value) => handleChange('authType', value)}
            disabled={!isEditing || isLoading}
          >
            <SelectTrigger id="airflow-authType">
              <SelectValue placeholder="Select auth type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="basic">Basic Auth</SelectItem>
              <SelectItem value="token">API Token</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {metadata.authType !== 'none' && (
          <div className="space-y-2">
            <Label htmlFor="airflow-username">Username</Label>
            <Input
              id="airflow-username"
              value={metadata.username}
              onChange={(e) => handleChange('username', e.target.value)}
              placeholder="admin"
              disabled={!isEditing || isLoading}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { AirflowMetadata };
