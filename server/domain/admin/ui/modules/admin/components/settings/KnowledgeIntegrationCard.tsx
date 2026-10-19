/**
 * "Knowledge Integration" section of the admin Settings page.
 * Knowledge store, graph, psychologist and skill-import toggles.
 *
 * Extracted from Settings.tsx, which held thirteen of these cards inline in a
 * single component. The JSX is byte-for-byte what it was; the identifiers it
 * used to take from the parent's ~30 useState hooks now arrive as props of the
 * same names, so nothing inside the markup changed.
 */
import type React from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Network } from 'lucide-react';

interface KnowledgeIntegrationCardProps {
  handleSaveOrgSettings: () => void;
  knowledgeGraphEnabled: boolean;
  knowledgeStoreEnabled: boolean;
  orgSettingsLoading: boolean;
  psychologistEnabled: boolean;
  saveOrgSettingsMutation: { isPending: boolean };
  setKnowledgeGraphEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setKnowledgeStoreEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setPsychologistEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setSkillImportEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  skillImportEnabled: boolean;
}

export function KnowledgeIntegrationCard({
  handleSaveOrgSettings,
  knowledgeGraphEnabled,
  knowledgeStoreEnabled,
  orgSettingsLoading,
  psychologistEnabled,
  saveOrgSettingsMutation,
  setKnowledgeGraphEnabled,
  setKnowledgeStoreEnabled,
  setPsychologistEnabled,
  setSkillImportEnabled,
  skillImportEnabled,
}: KnowledgeIntegrationCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Network className="w-5 h-5 text-primary" />
                      <CardTitle>Knowledge Integration</CardTitle>
                    </div>
                    <CardDescription>Enable or disable knowledge store and knowledge graph features for your organization</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="knowledge-store-enabled">Knowledge Store Integration</Label>
                        <p className="text-sm text-muted-foreground">
                          Enable document-based storage for job outputs (RAG)
                        </p>
                      </div>
                      <Switch
                        id="knowledge-store-enabled"
                        checked={knowledgeStoreEnabled}
                        onCheckedChange={setKnowledgeStoreEnabled}
                        disabled={orgSettingsLoading}
                        data-testid="switch-knowledge-store-enabled"
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="knowledge-graph-enabled">Knowledge Graph Integration</Label>
                        <p className="text-sm text-muted-foreground">
                          Enable entity and relationship extraction from pipeline outputs
                        </p>
                      </div>
                      <Switch
                        id="knowledge-graph-enabled"
                        checked={knowledgeGraphEnabled}
                        onCheckedChange={setKnowledgeGraphEnabled}
                        disabled={orgSettingsLoading}
                        data-testid="switch-knowledge-graph-enabled"
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="psychologist-enabled">Psychologist Agent (Intent Inference)</Label>
                        <p className="text-sm text-muted-foreground">
                          Enable real-time inference of user intent from mouse behavior
                        </p>
                      </div>
                      <Switch
                        id="psychologist-enabled"
                        checked={psychologistEnabled}
                        onCheckedChange={setPsychologistEnabled}
                        disabled={orgSettingsLoading}
                        data-testid="switch-psychologist-enabled"
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="skill-import-enabled">Enable Skill Import</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow users to import external skills and agents
                        </p>
                      </div>
                      <Switch
                        id="skill-import-enabled"
                        checked={skillImportEnabled}
                        onCheckedChange={setSkillImportEnabled}
                        disabled={orgSettingsLoading}
                        data-testid="switch-skill-import-enabled"
                      />
                    </div>

                    <Separator />

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => handleSaveOrgSettings()}
                        disabled={orgSettingsLoading || saveOrgSettingsMutation.isPending}
                        data-testid="button-save-org-settings"
                      >
                        {saveOrgSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
  );
}
