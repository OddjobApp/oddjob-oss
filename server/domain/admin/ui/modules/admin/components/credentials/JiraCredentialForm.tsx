import { useState, useEffect } from 'react';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Alert, AlertDescription } from '@domain-ui/core/ui/components/ui/alert';
import { CheckCircle2, XCircle, Zap } from 'lucide-react';
import type { JiraMetadata, Credential } from "@shared/schema/system";

interface JiraTestResult {
  success: boolean;
  message: string;
  details?: {
    accountId?: string;
    displayName?: string;
    emailAddress?: string;
    active?: boolean;
    status?: number;
    statusText?: string;
    errorType?: string;
  };
}

interface JiraCredentialFormProps {
  credential: Credential | null;
  metadata: JiraMetadata;
  onMetadataChange: (metadata: JiraMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
  testResult: JiraTestResult | null;
  onTest: () => void;
  isTesting: boolean;
}

export function JiraCredentialForm({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading,
  testResult,
  onTest,
  isTesting
}: JiraCredentialFormProps) {
  const handleChange = (field: keyof JiraMetadata, value: string) => {
    onMetadataChange({ ...metadata, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          JIRA Configuration
        </CardTitle>
        <CardDescription>
          Configure your JIRA instance connection settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="jira-endpoint">JIRA Endpoint</Label>
          <Input
            id="jira-endpoint"
            value={metadata.endpoint}
            onChange={(e) => handleChange('endpoint', e.target.value)}
            placeholder="https://your-domain.atlassian.net"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="jira-account">Account</Label>
          <Input
            id="jira-account"
            type="email"
            value={metadata.account}
            onChange={(e) => handleChange('account', e.target.value)}
            placeholder="your.email@example.com"
            disabled={!isEditing || isLoading}
          />
        </div>

        <div className="pt-4">
          <Button
            variant="outline"
            onClick={onTest}
            disabled={isTesting || !metadata.endpoint}
            className="w-full"
          >
            {isTesting ? (
              <>
                <Zap className="mr-2 h-4 w-4 animate-pulse" />
                Testing Connection...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Test Connection
              </>
            )}
          </Button>
        </div>

        {testResult && (
          <Alert variant={testResult.success ? "default" : "destructive"}>
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            <AlertDescription>
              {testResult.message}
              {testResult.details?.displayName && (
                <div className="mt-1 text-sm text-muted-foreground">
                  Connected as: {testResult.details.displayName}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export type { JiraMetadata };
