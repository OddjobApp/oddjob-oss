import React from 'react';
import type { Credential } from "@shared/schema/system";
import { JiraCredentialForm, JiraMetadata } from './JiraCredentialForm.js';
import { DatabaseCredentialForm, DatabaseMetadata } from './DatabaseCredentialForm.js';
import { AiProviderCredentialForm, AIProviderMetadata } from './AiProviderCredentialForm.js';
import { AirflowCredentialForm, AirflowMetadata } from './AirflowCredentialForm.js';
import { SmtpCredentialForm, SmtpMetadata } from './SmtpCredentialForm.js';
import { ConfluenceCredentialForm, ConfluenceMetadata } from './ConfluenceCredentialForm.js';
import { GoogleDriveCredentialForm, GoogleDriveMetadata } from './GoogleDriveCredentialForm.js';

// Type for all credential metadata types
type CredentialMetadata = 
  | JiraMetadata 
  | DatabaseMetadata 
  | AIProviderMetadata 
  | AirflowMetadata 
  | SmtpMetadata 
  | ConfluenceMetadata 
  | GoogleDriveMetadata;

interface CredentialFormFactoryProps {
  credential: Credential | null;
  metadata: CredentialMetadata;
  onMetadataChange: (metadata: CredentialMetadata) => void;
  isEditing: boolean;
  isLoading: boolean;
  // JIRA-specific props
  testResult?: {
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
  } | null;
  onTest?: () => void;
  isTesting?: boolean;
}

export function CredentialFormFactory({
  credential,
  metadata,
  onMetadataChange,
  isEditing,
  isLoading,
  testResult,
  onTest,
  isTesting
}: CredentialFormFactoryProps) {
  const type = credential?.type;

  switch (type) {
    case 'jira':
      return (
        <JiraCredentialForm
          credential={credential}
          metadata={metadata as JiraMetadata}
          onMetadataChange={onMetadataChange as (metadata: JiraMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
          testResult={testResult || null}
          onTest={onTest || (() => {})}
          isTesting={isTesting || false}
        />
      );

    case 'database':
      return (
        <DatabaseCredentialForm
          credential={credential}
          metadata={metadata as DatabaseMetadata}
          onMetadataChange={onMetadataChange as (metadata: DatabaseMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
        />
      );

    case 'ai_provider':
      return (
        <AiProviderCredentialForm
          credential={credential}
          metadata={metadata as AIProviderMetadata}
          onMetadataChange={onMetadataChange as (metadata: AIProviderMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
        />
      );

    case 'airflow':
      return (
        <AirflowCredentialForm
          credential={credential}
          metadata={metadata as AirflowMetadata}
          onMetadataChange={onMetadataChange as (metadata: AirflowMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
        />
      );

    case 'smtp':
      return (
        <SmtpCredentialForm
          credential={credential}
          metadata={metadata as SmtpMetadata}
          onMetadataChange={onMetadataChange as (metadata: SmtpMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
        />
      );

    case 'confluence':
      return (
        <ConfluenceCredentialForm
          credential={credential}
          metadata={metadata as ConfluenceMetadata}
          onMetadataChange={onMetadataChange as (metadata: ConfluenceMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
        />
      );

    case 'google_drive':
      return (
        <GoogleDriveCredentialForm
          credential={credential}
          metadata={metadata as GoogleDriveMetadata}
          onMetadataChange={onMetadataChange as (metadata: GoogleDriveMetadata) => void}
          isEditing={isEditing}
          isLoading={isLoading}
        />
      );

    default:
      return (
        <div className="p-4 text-muted-foreground">
          <p>No configuration form available for credential type: {type || 'unknown'}</p>
        </div>
      );
  }
}

export type { CredentialMetadata };
