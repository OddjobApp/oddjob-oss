/**
 * "Security" section of the admin Settings page.
 * MFA requirement and session timeout.
 *
 * Extracted from Settings.tsx with its JSX unchanged; the identifiers it used
 * to close over are now props of the same names.
 */
import type React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Shield } from 'lucide-react';

interface SecuritySettingsCardProps {
  requireMFA: boolean;
  sessionTimeout: string;
  setRequireMFA: React.Dispatch<React.SetStateAction<boolean>>;
  setSessionTimeoutValue: React.Dispatch<React.SetStateAction<string>>;
}

export function SecuritySettingsCard({
  requireMFA,
  sessionTimeout,
  setRequireMFA,
  setSessionTimeoutValue,
}: SecuritySettingsCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      <CardTitle>Security</CardTitle>
                    </div>
                    <CardDescription>Security and authentication settings</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="session-timeout">Session Timeout (Minutes)</Label>
                      <Select value={sessionTimeout} onValueChange={setSessionTimeoutValue}>
                        <SelectTrigger id="session-timeout" data-testid="select-session-timeout">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5 minutes</SelectItem>
                          <SelectItem value="10">10 minutes</SelectItem>
                          <SelectItem value="15">15 minutes</SelectItem>
                          <SelectItem value="20">20 minutes</SelectItem>
                          <SelectItem value="30">30 minutes</SelectItem>
                          <SelectItem value="60">1 hour</SelectItem>
                          <SelectItem value="120">2 hours</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        User will be automatically logged out after this period of inactivity
                      </p>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="require-mfa">Require Multi-Factor Authentication</Label>
                        <p className="text-sm text-muted-foreground">
                          Enforce MFA for all users
                        </p>
                      </div>
                      <Switch
                        id="require-mfa"
                        checked={requireMFA}
                        onCheckedChange={setRequireMFA}
                        data-testid="switch-require-mfa"
                      />
                    </div>
                  </CardContent>
                </Card>
  );
}
