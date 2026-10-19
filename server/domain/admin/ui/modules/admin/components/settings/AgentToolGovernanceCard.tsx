/**
 * "Agent Tool Governance" section of the admin Settings page.
 *
 * Extracted verbatim from Settings.tsx. The tool list was an inline array
 * literal inside the JSX; it is a module constant here so the default-reset
 * button and the checkbox list cannot drift apart — previously the reset
 * button repeated the four ids by hand.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Sparkles } from 'lucide-react';

export const GOVERNABLE_AGENT_TOOLS = [
  { id: 'search_knowledge_base', label: 'Knowledge Base Search', desc: 'Allow agents to search internal docs' },
  { id: 'calculator', label: 'Calculator', desc: 'Allow basic arithmetic' },
  { id: 'http_request', label: 'HTTP Requests', desc: 'Allow external API calls (GET, POST)' },
  { id: 'current_time', label: 'System Time', desc: 'Allow access to current time' },
] as const;

interface AgentToolGovernanceCardProps {
  allowedAgentTools: string[];
  onChange: (update: (prev: string[]) => string[]) => void;
  onSave: () => void;
  isLoading: boolean;
  isSaving: boolean;
}

export function AgentToolGovernanceCard({
  allowedAgentTools,
  onChange,
  onSave,
  isLoading,
  isSaving,
}: AgentToolGovernanceCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <CardTitle>Agent Tool Governance</CardTitle>
        </div>
        <CardDescription>Control which tools your Autonomous Agents are allowed to use organization-wide.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {GOVERNABLE_AGENT_TOOLS.map((tool) => (
            <div key={tool.id} className="flex items-start space-x-3 p-3 border rounded-md">
              <Switch
                id={`tool-${tool.id}`}
                checked={allowedAgentTools.includes(tool.id)}
                onCheckedChange={(checked) => {
                  onChange(prev =>
                    checked ? [...prev, tool.id] : prev.filter(t => t !== tool.id)
                  );
                }}
              />
              <div className="space-y-1">
                <Label htmlFor={`tool-${tool.id}`} className="font-medium cursor-pointer">
                  {tool.label}
                </Label>
                <p className="text-xs text-muted-foreground">{tool.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onChange(() => GOVERNABLE_AGENT_TOOLS.map(t => t.id));
            }}
          >
            Reset to Default
          </Button>
          <Button
            type="button"
            onClick={() => onSave()}
            disabled={isLoading || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
