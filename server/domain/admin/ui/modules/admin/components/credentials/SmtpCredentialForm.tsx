import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import type { SmtpMetadata, Credential } from "@shared/schema/system";

interface SmtpCredentialFormProps {
  credential: Credential | null;
  metadata: SmtpMetadata;
  onMetadataChange: (metadata: SmtpMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
}

export function SmtpCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading
}: SmtpCredentialFormProps) {
  const handleChange = (field: keyof SmtpMetadata, value: any) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMTP Configuration</CardTitle>
        <CardDescription>
          Configure your email server settings for sending notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="smtp-host">SMTP Host</Label>
          <Input
            id="smtp-host"
            value={metadata.host}
            onChange={(e) => handleChange('host', e.target.value)}
            placeholder="smtp.gmail.com"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp-port">Port</Label>
          <Input
            id="smtp-port"
            type="number"
            value={metadata.port}
            onChange={(e) => handleChange('port', parseInt(e.target.value))}
            placeholder="587"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="flex items-center space-x-2 pt-2">
          <Checkbox
            id="smtp-secure"
            checked={metadata.secure}
            onCheckedChange={(checked) => handleChange('secure', checked)}
            disabled={!isEditing || isLoading}
          />
          <Label htmlFor="smtp-secure" className="text-sm font-normal">
            Use SSL/TLS encryption
          </Label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp-user">Username</Label>
          <Input
            id="smtp-user"
            value={metadata.user}
            onChange={(e) => handleChange('user', e.target.value)}
            placeholder="your-email@example.com"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp-fromEmail">From Email Address</Label>
          <Input
            id="smtp-fromEmail"
            type="email"
            value={metadata.fromEmail}
            onChange={(e) => handleChange('fromEmail', e.target.value)}
            placeholder="notifications@yourcompany.com"
            disabled={!isEditing || isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export type { SmtpMetadata };
