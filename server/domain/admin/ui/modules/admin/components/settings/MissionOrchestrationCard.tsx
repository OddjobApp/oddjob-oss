/**
 * "Mission Orchestration" section of the admin Settings page.
 * Concurrent mission limit.
 *
 * Extracted from Settings.tsx with its JSX unchanged; the identifiers it used
 * to close over are now props of the same names.
 */
import type React from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Clock } from 'lucide-react';

interface MissionOrchestrationCardProps {
  handleSaveOrgSettings: () => void;
  missionConcurrency: number;
  orgSettingsLoading: boolean;
  saveOrgSettingsMutation: { isPending: boolean };
  setMissionConcurrency: React.Dispatch<React.SetStateAction<number>>;
}

export function MissionOrchestrationCard({
  handleSaveOrgSettings,
  missionConcurrency,
  orgSettingsLoading,
  saveOrgSettingsMutation,
  setMissionConcurrency,
}: MissionOrchestrationCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-primary" />
                      <CardTitle>Mission Orchestration</CardTitle>
                    </div>
                    <CardDescription>Control the execution behavior of autonomous missions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="mission-concurrency">Max Parallel Missions</Label>
                      <Select 
                        value={missionConcurrency.toString()} 
                        onValueChange={(val) => setMissionConcurrency(parseInt(val, 10))}
                      >
                        <SelectTrigger id="mission-concurrency" data-testid="select-mission-concurrency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 (Sequential Only)</SelectItem>
                          <SelectItem value="2">2 Parallel Missions</SelectItem>
                          <SelectItem value="3">3 Parallel Missions</SelectItem>
                          <SelectItem value="5">5 Parallel Missions</SelectItem>
                          <SelectItem value="10">10 Parallel Missions</SelectItem>
                          <SelectItem value="20">20 (Maximum Power)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Limits how many autonomous missions can run in parallel. Sequential mode (1) is recommended to avoid LLM rate limits.
                      </p>
                    </div>

                    <Separator />

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => handleSaveOrgSettings()}
                        disabled={orgSettingsLoading || saveOrgSettingsMutation.isPending}
                        data-testid="button-save-orchestration-settings"
                      >
                        {saveOrgSettingsMutation.isPending ? 'Saving...' : 'Update Orchestration'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
  );
}
