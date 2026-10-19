/**
 * Governance Tab
 * Pentagonal OODA Governor and consensus settings
 */

import React from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Save, ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import ConsensusDashboard from "@domain-ui/governor/ui/components/governor/ConsensusDashboard";

export interface GovernanceTabProps {
  governorSettings: { enabled: boolean; mode: 'AUTONOMOUS' | 'ADVISORY' | 'OFF' };
  setGovernorSettings: React.Dispatch<React.SetStateAction<{ enabled: boolean; mode: 'AUTONOMOUS' | 'ADVISORY' | 'OFF' }>>;
  onSave: () => void;
  isSaving: boolean;
}

export function GovernanceTab({
  governorSettings,
  setGovernorSettings,
  onSave,
  isSaving,
}: GovernanceTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Pentagonal OODA Governor</h2>
          <p className="text-sm text-muted-foreground mt-1">Real-time governance consensus & safety monitoring</p>
        </div>
        <Button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSave(); }} disabled={isSaving}>
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>

      <ConsensusDashboard />

      <Card className="border-indigo-100 shadow-sm">
        <CardHeader className="pb-3 px-6 pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              <CardTitle className="text-lg">Governance Mode</CardTitle>
            </div>
            <div className="flex items-center gap-3 bg-indigo-500/10 px-3 py-1.5 rounded-full border border-indigo-500/20">
              <Label htmlFor="gov-master-switch" className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Master Control</Label>
              <Switch
                id="gov-master-switch"
                checked={governorSettings.mode !== 'OFF'}
                onCheckedChange={(checked) => {
                  setGovernorSettings(prev => ({
                    ...prev,
                    mode: checked ? 'ADVISORY' : 'OFF',
                    enabled: checked
                  }));
                }}
              />
            </div>
          </div>
          <CardDescription>
            When enabled, all destructive agent actions must be approved by the Pentagonal Consensus (W0-W4).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-0 px-6 pb-6">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase font-bold text-muted-foreground">Operation Level</Label>
              <Select
                value={governorSettings.mode}
                onValueChange={(val: 'AUTONOMOUS' | 'ADVISORY' | 'OFF') => setGovernorSettings(prev => ({ ...prev, mode: val, enabled: val !== 'OFF' }))}
                disabled={governorSettings.mode === 'OFF'}
              >
                <SelectTrigger className="w-full h-11 border-indigo-500/20 bg-card/50 text-foreground" id="governor-mode">
                  <SelectValue placeholder="Select Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OFF">OFF (Monitoring Only)</SelectItem>
                  <SelectItem value="ADVISORY">ADVISORY (Human-in-the-loop)</SelectItem>
                  <SelectItem value="AUTONOMOUS">AUTONOMOUS (Full 5-Node Consensus)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground italic">
                {governorSettings.mode === 'AUTONOMOUS'
                  ? "⚠️ WARNING: Agents will execute actions automatically if consensus threshold is met."
                  : governorSettings.mode === 'ADVISORY'
                    ? "INFO: Governor will flag risks and wait for your manual confirmation."
                    : "INFO: Governor is inactive. System will rely on standard authorization."}
              </p>
            </div>

            <div className="bg-card/30 border border-border rounded-xl p-4 mt-2">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-indigo-400" />
                <h4 className="text-xs font-bold uppercase text-muted-foreground">Consensus Architecture</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { id: 'W-1', role: 'Strategist', color: 'blue', desc: 'Plans the optimal path.' },
                  { id: 'W-2', role: 'Critic', color: 'red', desc: 'Active VETO if risk > 0.9.' },
                  { id: 'W-3', role: 'Explorer', color: 'amber', desc: 'Finds alternative routes.' },
                  { id: 'W-4', role: 'Auditor', color: 'green', desc: 'Compliance & History check.' }
                ].map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg border border-border/50 shadow-sm">
                    <div className={cn("px-2 py-0.5 rounded text-[10px] font-black uppercase text-foreground", {
                      'bg-blue-500': item.color === 'blue',
                      'bg-red-500': item.color === 'red',
                      'bg-amber-500': item.color === 'amber',
                      'bg-green-500': item.color === 'green',
                    })}>{item.id}</div>
                    <div>
                      <div className="text-[11px] font-bold text-foreground">{item.role}</div>
                      <div className="text-[9px] text-muted-foreground leading-tight">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
