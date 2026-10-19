/**
 * "SMTP Configuration" section of the admin Settings page.
 * SMTP relay used for outbound platform email.
 *
 * Extracted from Settings.tsx, which held thirteen of these cards inline in a
 * single component. The JSX is byte-for-byte what it was; the identifiers it
 * used to take from the parent's ~30 useState hooks now arrive as props of the
 * same names, so nothing inside the markup changed.
 */
import type React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Mail } from 'lucide-react';

interface SmtpSettingsCardProps {
  setSmtpEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setSmtpFrom: React.Dispatch<React.SetStateAction<string>>;
  setSmtpHost: React.Dispatch<React.SetStateAction<string>>;
  setSmtpPass: React.Dispatch<React.SetStateAction<string>>;
  setSmtpPort: React.Dispatch<React.SetStateAction<string>>;
  setSmtpSecure: React.Dispatch<React.SetStateAction<boolean>>;
  setSmtpUser: React.Dispatch<React.SetStateAction<string>>;
  smtpEnabled: boolean;
  smtpFrom: string;
  smtpHost: string;
  smtpPass: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
}

export function SmtpSettingsCard({
  setSmtpEnabled,
  setSmtpFrom,
  setSmtpHost,
  setSmtpPass,
  setSmtpPort,
  setSmtpSecure,
  setSmtpUser,
  smtpEnabled,
  smtpFrom,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpSecure,
  smtpUser,
}: SmtpSettingsCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Mail className="w-5 h-5 text-primary" />
                      <CardTitle>SMTP Configuration</CardTitle>
                    </div>
                    <CardDescription>Configure SMTP relay for sending emails</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="smtp-enabled">Enable SMTP</Label>
                        <p className="text-sm text-muted-foreground">
                          Use SMTP server to send emails instead of console logging
                        </p>
                      </div>
                      <Switch
                        id="smtp-enabled"
                        checked={smtpEnabled}
                        onCheckedChange={setSmtpEnabled}
                        data-testid="switch-smtp-enabled"
                      />
                    </div>

                    {smtpEnabled && (
                      <>
                        <Separator />
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="smtp-host">SMTP Host</Label>
                            <Input
                              id="smtp-host"
                              value={smtpHost}
                              onChange={(e) => setSmtpHost(e.target.value)}
                              placeholder="smtp.gmail.com"
                              data-testid="input-smtp-host"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="smtp-port">Port</Label>
                            <Input
                              id="smtp-port"
                              type="number"
                              value={smtpPort}
                              onChange={(e) => setSmtpPort(e.target.value)}
                              placeholder="587"
                              data-testid="input-smtp-port"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="smtp-secure">Use TLS/SSL</Label>
                            <p className="text-sm text-muted-foreground">
                              Enable for port 465 (SSL) or when server requires secure connection
                            </p>
                          </div>
                          <Switch
                            id="smtp-secure"
                            checked={smtpSecure}
                            onCheckedChange={setSmtpSecure}
                            data-testid="switch-smtp-secure"
                          />
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <Label htmlFor="smtp-user">Username</Label>
                          <Input
                            id="smtp-user"
                            value={smtpUser}
                            onChange={(e) => setSmtpUser(e.target.value)}
                            placeholder="your-email@example.com"
                            data-testid="input-smtp-user"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="smtp-pass">Password</Label>
                          <Input
                            id="smtp-pass"
                            type="password"
                            value={smtpPass}
                            onChange={(e) => setSmtpPass(e.target.value)}
                            placeholder="Your SMTP password or app password"
                            data-testid="input-smtp-pass"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="smtp-from">From Address</Label>
                          <Input
                            id="smtp-from"
                            value={smtpFrom}
                            onChange={(e) => setSmtpFrom(e.target.value)}
                            placeholder="Oddjob <noreply@oddjob.com>"
                            data-testid="input-smtp-from"
                          />
                          <p className="text-xs text-muted-foreground">
                            Email address or "Name &lt;email@example.com&gt;" format
                          </p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
  );
}
