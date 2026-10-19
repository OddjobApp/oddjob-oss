/**
 * "Notifications" section of the admin Settings page.
 * Email and Slack notification routing.
 *
 * Extracted from Settings.tsx, which held thirteen of these cards inline in a
 * single component. The JSX is byte-for-byte what it was; the identifiers it
 * used to take from the parent's ~30 useState hooks now arrive as props of the
 * same names, so nothing inside the markup changed.
 */
import type React from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Bell } from 'lucide-react';

interface NotificationSettingsCardProps {
  emailNotifications: boolean;
  emailRecipients: string;
  handleSaveSettings: () => void;
  saveSettingsMutation: { isPending: boolean };
  setEmailNotifications: React.Dispatch<React.SetStateAction<boolean>>;
  setEmailRecipients: React.Dispatch<React.SetStateAction<string>>;
  setSlackNotifications: React.Dispatch<React.SetStateAction<boolean>>;
  slackNotifications: boolean;
}

export function NotificationSettingsCard({
  emailNotifications,
  emailRecipients,
  handleSaveSettings,
  saveSettingsMutation,
  setEmailNotifications,
  setEmailRecipients,
  setSlackNotifications,
  slackNotifications,
}: NotificationSettingsCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Bell className="w-5 h-5 text-primary" />
                      <CardTitle>Notifications</CardTitle>
                    </div>
                    <CardDescription>Configure alert and notification channels</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="email-notifications">Email Notifications</Label>
                        <p className="text-sm text-muted-foreground">
                          Send alerts via email
                        </p>
                      </div>
                      <Switch
                        id="email-notifications"
                        checked={emailNotifications}
                        onCheckedChange={setEmailNotifications}
                        data-testid="switch-email-notifications"
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="slack-notifications">Slack Notifications</Label>
                        <p className="text-sm text-muted-foreground">
                          Send alerts to Slack channels
                        </p>
                      </div>
                      <Switch
                        id="slack-notifications"
                        checked={slackNotifications}
                        onCheckedChange={setSlackNotifications}
                        data-testid="switch-slack-notifications"
                      />
                    </div>

                    {emailNotifications && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <Label htmlFor="email-recipients">Default Recipients</Label>
                          <Input
                            id="email-recipients"
                            value={emailRecipients}
                            onChange={(e) => setEmailRecipients(e.target.value)}
                            placeholder="ops@oddjob.com, admin@oddjob.com"
                            data-testid="input-email-recipients"
                          />
                          <p className="text-xs text-muted-foreground">
                            Comma-separated email addresses
                          </p>
                        </div>
                      </>
                    )}

                    <Separator />

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => handleSaveSettings()}
                        disabled={saveSettingsMutation.isPending}
                        data-testid="button-save-notifications"
                      >
                        {saveSettingsMutation.isPending ? 'Saving...' : 'Update Notifications'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
  );
}
