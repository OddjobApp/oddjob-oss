/**
 * "Computer Use Sessions" section of the admin Settings page.
 * Trycua computer-use session defaults.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { ExternalLink, Monitor } from 'lucide-react';
import { resolveActiveOrgId } from '@/lib/queryClient';
import { ComputerUseSkillsPanel } from './ComputerUseSkillsPanel';

interface ComputerUseSettingsCardProps {
  handleSaveOrgSettings: () => void;
  orgSettingsLoading: boolean;
  saveOrgSettingsMutation: { isPending: boolean };
  setTrycuaDefaultOs: React.Dispatch<React.SetStateAction<'linux' | 'windows' | 'macos'>>;
  setTrycuaEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setTrycuaMaxSessionTime: React.Dispatch<React.SetStateAction<string>>;
  trycuaDefaultOs: 'linux' | 'windows' | 'macos';
  trycuaEnabled: boolean;
  trycuaMaxSessionTime: string;
}

export function ComputerUseSettingsCard({
  handleSaveOrgSettings,
  orgSettingsLoading,
  saveOrgSettingsMutation,
  setTrycuaDefaultOs,
  setTrycuaEnabled,
  setTrycuaMaxSessionTime,
  trycuaDefaultOs,
  trycuaEnabled,
  trycuaMaxSessionTime,
}: ComputerUseSettingsCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Monitor className="w-5 h-5 text-primary" />
                      <CardTitle>Computer Use Sessions</CardTitle>
                    </div>
                    <CardDescription>Control Trycua sandbox access for agent-driven desktop workflows</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="trycua-enabled">Enable Trycua</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow authenticated organization users and agents to create governed computer-use sessions
                        </p>
                      </div>
                      <Switch
                        id="trycua-enabled"
                        checked={trycuaEnabled}
                        onCheckedChange={setTrycuaEnabled}
                        disabled={orgSettingsLoading}
                        data-testid="switch-trycua-enabled"
                      />
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="trycua-default-os">Default Operating System</Label>
                        <Select
                          value={trycuaDefaultOs}
                          onValueChange={(value) => setTrycuaDefaultOs(value as 'linux' | 'windows' | 'macos')}
                        >
                          <SelectTrigger id="trycua-default-os" data-testid="select-trycua-default-os">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="linux">Linux</SelectItem>
                            <SelectItem value="windows">Windows</SelectItem>
                            <SelectItem value="macos">macOS</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="trycua-max-session-time">Max Session Time (Minutes)</Label>
                        <Input
                          id="trycua-max-session-time"
                          type="number"
                          min="1"
                          max="1440"
                          value={trycuaMaxSessionTime}
                          onChange={(e) => setTrycuaMaxSessionTime(e.target.value)}
                          data-testid="input-trycua-max-session-time"
                        />
                      </div>
                    </div>

                    <Separator />

                    <ComputerUseSkillsPanel enabled={trycuaEnabled && !orgSettingsLoading} />

                    <Separator />

                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          // The org the app has selected; without it the server falls back to the session's org.
                          const orgId = resolveActiveOrgId();
                          window.open(`/api/integrations/trycua/desktop/viewer${orgId ? `?orgId=${orgId}` : ''}`, '_blank', 'noopener,noreferrer');
                        }}
                        disabled={!trycuaEnabled || orgSettingsLoading}
                        title="Open this organization's desktop in a new tab, e.g. to log in to sites the agent will use"
                        data-testid="button-open-trycua-desktop"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open desktop
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleSaveOrgSettings()}
                        disabled={orgSettingsLoading || saveOrgSettingsMutation.isPending}
                        data-testid="button-save-trycua-settings"
                      >
                        {saveOrgSettingsMutation.isPending ? 'Saving...' : 'Update Computer Use'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
  );
}
