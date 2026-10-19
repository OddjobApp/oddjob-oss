import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import type { DatabaseMetadata, Credential } from "@shared/schema/system";

interface DatabaseCredentialFormProps {
  credential: Credential | null;
  metadata: DatabaseMetadata;
  onMetadataChange: (metadata: DatabaseMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
}

export function DatabaseCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading
}: DatabaseCredentialFormProps) {
  const handleChange = (field: keyof DatabaseMetadata, value: any) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Configuration</CardTitle>
        <CardDescription>
          Configure your database connection settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="db-engine">Database Engine</Label>
          <Select
            value={metadata.engine}
            onValueChange={(value) => handleChange('engine', value)}
            disabled={!isEditing || isLoading}
          >
            <SelectTrigger id="db-engine">
              <SelectValue placeholder="Select engine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="postgres">PostgreSQL</SelectItem>
              <SelectItem value="mysql">MySQL</SelectItem>
              <SelectItem value="mssql">SQL Server</SelectItem>
              <SelectItem value="sqlite">SQLite</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="db-host">Host</Label>
          <Input
            id="db-host"
            value={metadata.host}
            onChange={(e) => handleChange('host', e.target.value)}
            placeholder="localhost"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="db-port">Port</Label>
          <Input
            id="db-port"
            type="number"
            value={metadata.port}
            onChange={(e) => handleChange('port', parseInt(e.target.value))}
            placeholder="5432"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="db-database">Database Name</Label>
          <Input
            id="db-database"
            value={metadata.database}
            onChange={(e) => handleChange('database', e.target.value)}
            placeholder="mydatabase"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="db-user">Username</Label>
          <Input
            id="db-user"
            value={metadata.user}
            onChange={(e) => handleChange('user', e.target.value)}
            placeholder="dbuser"
            disabled={!isEditing || isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export type { DatabaseMetadata };
