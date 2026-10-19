/**
 * "General Settings" section of the admin Settings page.
 * System timezone and other top-level defaults.
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
import { SettingsIcon } from 'lucide-react';
import { useMaintenanceMode } from '@/contexts/MaintenanceContext';
import { TIMEZONES } from '@/lib/timezones';

interface GeneralSettingsCardProps {
  setSystemTimezone: React.Dispatch<React.SetStateAction<string>>;
  systemTimezone: string;
}

export function GeneralSettingsCard({
  setSystemTimezone,
  systemTimezone,
}: GeneralSettingsCardProps) {
  const { isMaintenanceMode, setMaintenanceMode, isLoading: isMaintenanceLoading } = useMaintenanceMode();

  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <SettingsIcon className="w-5 h-5 text-primary" />
                      <CardTitle>General Settings</CardTitle>
                    </div>
                    <CardDescription>Core system configuration</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="maintenance-mode">Maintenance Mode</Label>
                        <p className="text-sm text-muted-foreground">
                          Temporarily disable all job executions
                        </p>
                      </div>
                      <Switch
                        id="maintenance-mode"
                        checked={isMaintenanceMode}
                        onCheckedChange={(checked) => {
                          setMaintenanceMode(checked);
                        }}
                        disabled={isMaintenanceLoading}
                        data-testid="switch-maintenance-mode"
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label htmlFor="system-timezone">System Timezone</Label>
                      <Select
                        value={systemTimezone}
                        onValueChange={setSystemTimezone}
                      >
                        <SelectTrigger id="system-timezone" data-testid="select-timezone">
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Default timezone for system operations and scheduling
                      </p>
                    </div>
                  </CardContent>
                </Card>
  );
}
