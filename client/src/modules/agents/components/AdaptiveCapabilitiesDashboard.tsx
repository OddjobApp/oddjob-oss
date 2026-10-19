/**
 * Adaptive Capabilities Dashboard
 * 
 * Main dashboard for viewing and controlling all 4 advanced AI capabilities.
 */

import { useState } from "react";
import { useAdaptiveExecution } from "../hooks/use-tool-discovery";
import { useSwarms } from "../hooks/use-swarm";
import { useAgentCognitiveState } from "../hooks/use-meta-cognitive";
import { 
  Brain, 
  Users, 
  Search, 
  Wrench, 
  Play, 
  Settings,
  Activity,
  CheckCircle,
  AlertCircle
} from "lucide-react";

interface CapabilityCardProps {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
  stats: {
    label: string;
    value: string | number;
  }[];
}

const CapabilityCard = ({ name, description, icon, enabled, onToggle, stats }: CapabilityCardProps) => (
  <div className={`p-6 rounded-lg border-2 transition-all ${enabled ? 'border-blue-500 bg-blue-50' : 'border-border bg-card'}`}>
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-lg ${enabled ? 'bg-blue-500 text-foreground' : 'bg-muted text-muted-foreground'}`}>
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-lg">{name}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
          enabled 
            ? 'bg-blue-500 text-foreground hover:bg-blue-600' 
            : 'bg-muted text-foreground hover:bg-muted'
        }`}
      >
        {enabled ? 'Enabled' : 'Disabled'}
      </button>
    </div>
    
    <div className="grid grid-cols-3 gap-4 mt-4">
      {stats.map((stat, i) => (
        <div key={i} className="text-center p-3 bg-card rounded-lg">
          <div className="text-2xl font-bold text-foreground">{stat.value}</div>
          <div className="text-xs text-muted-foreground">{stat.label}</div>
        </div>
      ))}
    </div>
  </div>
);

export function AdaptiveCapabilitiesDashboard({ agentId = "default-agent" }: { agentId?: string }) {
  const [config, setConfig] = useState({
    reflection: true,
    swarming: false,
    metaCognitive: true,
    toolDiscovery: true,
  });

  const { execute, result, isExecuting } = useAdaptiveExecution();
  const { data: swarms } = useSwarms();
  const { data: health, insights } = useAgentCognitiveState(agentId) as any;

  const capabilities: CapabilityCardProps[] = [
    {
      id: "reflection",
      name: "ReAct Reflection",
      description: "Self-correction through explicit verification",
      icon: <Brain className="w-6 h-6" />,
      enabled: config.reflection,
      onToggle: () => setConfig(c => ({ ...c, reflection: !c.reflection })),
      stats: [
        { label: "Reflections", value: result?.reflections?.length || 0 },
        { label: "Issues Fixed", value: result?.issuesCorrected || 0 },
        { label: "Quality", value: result?.quality ? `${(result.quality * 100).toFixed(0)}%` : "N/A" },
      ],
    },
    {
      id: "swarming",
      name: "Multi-Agent Swarming",
      description: "Consensus-based multi-agent coordination",
      icon: <Users className="w-6 h-6" />,
      enabled: config.swarming,
      onToggle: () => setConfig(c => ({ ...c, swarming: !c.swarming })),
      stats: [
        { label: "Active Swarms", value: swarms?.length || 0 },
        { label: "Agents", value: "3-5" },
        { label: "Consensus", value: "95%" },
      ],
    },
    {
      id: "metaCognitive",
      name: "Meta-Cognitive Planning",
      description: "Self-directed reasoning strategy selection",
      icon: <Activity className="w-6 h-6" />,
      enabled: config.metaCognitive,
      onToggle: () => setConfig(c => ({ ...c, metaCognitive: !c.metaCognitive })),
      stats: [
        { label: "Strategy", value: result?.strategiesUsed?.[0] || "None" },
        { label: "Adaptations", value: result?.adaptations || 0 },
        { label: "Health", value: health?.status || "Unknown" },
      ],
    },
    {
      id: "toolDiscovery",
      name: "Tool Discovery",
      description: "Dynamic tool discovery and creation",
      icon: <Wrench className="w-6 h-6" />,
      enabled: config.toolDiscovery,
      onToggle: () => setConfig(c => ({ ...c, toolDiscovery: !c.toolDiscovery })),
      stats: [
        { label: "Tools Used", value: result?.toolsUsed?.length || 0 },
        { label: "Created", value: result?.toolsCreated?.length || 0 },
        { label: "Discovered", value: "5" },
      ],
    },
  ];

  const handleExecute = async () => {
    await execute({
      agentId,
      task: {
        description: "Test task with adaptive capabilities",
        goal: "Demonstrate all 4 capabilities",
        complexity: "medium",
      },
      config: {
        enableReflection: config.reflection,
        enableSwarming: config.swarming,
        enableMetaCognitive: config.metaCognitive,
        enableToolDiscovery: config.toolDiscovery,
      },
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Adaptive AI Capabilities</h1>
          <p className="text-muted-foreground mt-1">Configure and monitor advanced agent behaviors</p>
        </div>
        <button
          onClick={handleExecute}
          disabled={isExecuting}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-foreground rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExecuting ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Run Test
            </>
          )}
        </button>
      </div>

      {/* Active Configuration */}
      <div className="mb-8 p-4 bg-muted rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Active: {[
              config.reflection && "Reflection",
              config.swarming && "Swarming",
              config.metaCognitive && "Meta-Cognitive",
              config.toolDiscovery && "Tool Discovery"
            ].filter(Boolean).join(" + ") || "None"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {health && (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              health.status === 'healthy' ? 'bg-green-100 text-green-700' :
              health.status === 'degraded' ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {health.status === 'healthy' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              Cognitive Health: {health.status}
            </div>
          )}
        </div>
      </div>

      {/* Capability Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {capabilities.map(cap => (
          <CapabilityCard key={cap.id} {...cap} />
        ))}
      </div>

      {/* Execution Result */}
      {result && (
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="font-semibold text-lg mb-4">Last Execution Result</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">Success</div>
              <div className={`text-lg font-semibold ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                {result.success ? 'Yes' : 'No'}
              </div>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">Quality Score</div>
              <div className="text-lg font-semibold">{(result.quality * 100).toFixed(1)}%</div>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">Time</div>
              <div className="text-lg font-semibold">{(result.totalTimeMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">Token Usage</div>
              <div className="text-lg font-semibold">{result.tokenUsage.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
