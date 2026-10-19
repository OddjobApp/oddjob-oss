/**
 * "Embed OAuth Configuration" section of the admin Settings page — OAuth 2 for
 * the embedded agent, plus the profile-API domain allowlist.
 *
 * Extracted verbatim from Settings.tsx; markup unchanged. It was the largest
 * of the thirteen inline cards at 120 lines.
 */
import type React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { KeyRound } from 'lucide-react';

export type EmbedOAuthConfig = {
    embedOAuthEnabled?: boolean;
    embedOAuthClientId?: string;
    embedOAuthClientSecretRef?: string;
    embedOAuthAuthUrl?: string;
    embedOAuthTokenUrl?: string;
    embedOAuthScopes?: string[];
    embedOAuthRedirectUri?: string;
  };

interface EmbedOAuthCardProps {
  embedOAuthConfig: EmbedOAuthConfig;
  setEmbedOAuthConfig: React.Dispatch<React.SetStateAction<EmbedOAuthConfig>>;
  profileApiDomainAllowlist: string[];
  setProfileApiDomainAllowlist: React.Dispatch<React.SetStateAction<string[]>>;
  handleSaveOrgSettings: () => void;
  orgSettingsLoading: boolean;
  saveOrgSettingsMutation: { isPending: boolean };
}

export function EmbedOAuthCard({
  embedOAuthConfig,
  setEmbedOAuthConfig,
  profileApiDomainAllowlist,
  setProfileApiDomainAllowlist,
  handleSaveOrgSettings,
  orgSettingsLoading,
  saveOrgSettingsMutation,
}: EmbedOAuthCardProps) {
  return (
      <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-primary" />
                        <CardTitle>Embed OAuth Configuration</CardTitle>
                      </div>
                      <CardDescription>Configure OAuth 2 for embedded agent authentication. Users can sign in via your OAuth provider before using the embedded chat.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <Label htmlFor="profile-api-allowlist">Profile API Domain Allowlist</Label>
                        <Input
                          id="profile-api-allowlist"
                          value={profileApiDomainAllowlist.join(', ')}
                          onChange={(e) => setProfileApiDomainAllowlist(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                          placeholder="https://api.customer.com, *.customer.com"
                        />
                        <p className="text-xs text-muted-foreground">
                          Comma-separated list. When set, profileApiUrl must match. Use *.domain.com for wildcard. Leave empty to allow all.
                        </p>
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="embed-oauth-enabled">Enable Embed OAuth</Label>
                          <p className="text-sm text-muted-foreground">
                            Allow users to authenticate via OAuth when using embedded agents
                          </p>
                        </div>
                        <Switch
                          id="embed-oauth-enabled"
                          checked={embedOAuthConfig.embedOAuthEnabled ?? false}
                          onCheckedChange={(v) => setEmbedOAuthConfig((c) => ({ ...c, embedOAuthEnabled: v }))}
                          disabled={orgSettingsLoading}
                        />
                      </div>

                      {embedOAuthConfig.embedOAuthEnabled && (
                        <>
                          <Separator />
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="embed-oauth-client-id">Client ID</Label>
                              <Input
                                id="embed-oauth-client-id"
                                value={embedOAuthConfig.embedOAuthClientId ?? ''}
                                onChange={(e) => setEmbedOAuthConfig((c) => ({ ...c, embedOAuthClientId: e.target.value }))}
                                placeholder="your-oauth-client-id"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="embed-oauth-client-secret-ref">Client Secret Env Var</Label>
                              <Input
                                id="embed-oauth-client-secret-ref"
                                value={embedOAuthConfig.embedOAuthClientSecretRef ?? ''}
                                onChange={(e) => setEmbedOAuthConfig((c) => ({ ...c, embedOAuthClientSecretRef: e.target.value }))}
                                placeholder="EMBED_OAUTH_CLIENT_SECRET"
                              />
                              <p className="text-xs text-muted-foreground">
                                Environment variable name containing the client secret (never stored in DB)
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="embed-oauth-auth-url">Authorization URL</Label>
                              <Input
                                id="embed-oauth-auth-url"
                                value={embedOAuthConfig.embedOAuthAuthUrl ?? ''}
                                onChange={(e) => setEmbedOAuthConfig((c) => ({ ...c, embedOAuthAuthUrl: e.target.value }))}
                                placeholder="https://auth.example.com/oauth/authorize"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="embed-oauth-token-url">Token URL</Label>
                              <Input
                                id="embed-oauth-token-url"
                                value={embedOAuthConfig.embedOAuthTokenUrl ?? ''}
                                onChange={(e) => setEmbedOAuthConfig((c) => ({ ...c, embedOAuthTokenUrl: e.target.value }))}
                                placeholder="https://auth.example.com/oauth/token"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="embed-oauth-scopes">Scopes (comma-separated)</Label>
                            <Input
                              id="embed-oauth-scopes"
                              value={(embedOAuthConfig.embedOAuthScopes ?? ['openid']).join(', ')}
                              onChange={(e) => {
                                const scopes = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                                setEmbedOAuthConfig((c) => ({ ...c, embedOAuthScopes: scopes.length ? scopes : ['openid'] }));
                              }}
                              placeholder="openid, profile, email"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="embed-oauth-redirect-uri">Redirect URI</Label>
                            <Input
                              id="embed-oauth-redirect-uri"
                              value={embedOAuthConfig.embedOAuthRedirectUri ?? ''}
                              onChange={(e) => setEmbedOAuthConfig((c) => ({ ...c, embedOAuthRedirectUri: e.target.value }))}
                              placeholder="https://oddjob.app/api/public/agents/oauth/callback"
                            />
                            <p className="text-xs text-muted-foreground">
                              Leave blank to use default: /api/public/agents/oauth/callback (single URL for all agents; register once in your IdP)
                            </p>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              onClick={() => handleSaveOrgSettings()}
                              disabled={orgSettingsLoading || saveOrgSettingsMutation.isPending}
                            >
                              {saveOrgSettingsMutation.isPending ? 'Saving...' : 'Save Embed OAuth'}
                            </Button>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
  );
}
