/**
 * Agent Node Component
 * 
 * Visual representation of workflow nodes in the agent builder.
 * Handles different node types with appropriate styling and handles.
 */

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { 
  Play, 
  Brain, 
  GitBranch, 
  Zap, 
  Database, 
  Plug, 
  Send, 
  Repeat, 
  Layers, 
  Clock,
  Webhook,
  AlertCircle,
  CheckCircle,
  Loader2,
  LucideIcon,
  Server,
  Workflow
} from 'lucide-react';

interface AgentNodeData {
  label: string;
  description?: string;
  config?: Record<string, any>;
  inputs?: string[];
  outputs?: string[];
  status?: 'idle' | 'running' | 'success' | 'error';
  errorMessage?: string;
}

const iconMap: Record<string, LucideIcon> = {
  trigger: Play,
  llm: Brain,
  condition: GitBranch,
  action: Zap,
  knowledge: Database,
  integration: Plug,
  output: Send,
  loop: Repeat,
  parallel: Layers,
  delay: Clock,
  webhook: Webhook,
  'mcp-client': Server,
  'reasoning-router': Workflow
};

const colorMap: Record<string, string> = {
  trigger: '#10b981',
  llm: '#8b5cf6',
  condition: '#f59e0b',
  action: '#3b82f6',
  knowledge: '#06b6d4',
  integration: '#ec4899',
  output: '#22c55e',
  loop: '#f97316',
  parallel: '#6366f1',
  delay: '#64748b',
  webhook: '#14b8a6',
  'mcp-client': '#a855f7',
  'reasoning-router': '#6366f1'
};

export const AgentNodeComponent: React.FC<NodeProps<AgentNodeData>> = memo(({
  id,
  type,
  data,
  selected,
  isConnectable
}) => {
  const Icon = iconMap[type] || AlertCircle;
  const status = data.status || 'idle';

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <Loader2 size={14} className="spin dynamic-color" />;
      case 'success':
        return <CheckCircle size={14} className="dynamic-color" />;
      case 'error':
        return <AlertCircle size={14} className="dynamic-color" />;

      default:
        return null;
    }
  };

  return (
    <div 
      className={`agent-node dynamic-border-color dynamic-shadow node-type-${type} ${selected ? 'selected' : ''} ${status}`}
    >

      {/* Input handles */}
      {type !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Top}
          id="in"
          isConnectable={isConnectable}
          className="node-handle dynamic-bg"
        />

      )}

      {/* Node content */}
      <div className="node-content">
        <div className="node-icon dynamic-bg dynamic-color">


          <Icon size={18} />
        </div>
        
        <div className="node-info">
          <div className="node-label">
            {data.label}
            {getStatusIcon() && (
              <span className="node-status">{getStatusIcon()}</span>
            )}
          </div>
          {data.description && (
            <div className="node-description">{data.description}</div>
          )}
          
          {/* Config preview */}
          {data.config && Object.keys(data.config).length > 0 && (
            <div className="node-config-preview">
              {data.config.model && (
                <span className="config-item">{data.config.model}</span>
              )}
              {data.config.collection && (
                <span className="config-item">{data.config.collection}</span>
              )}
              {data.config.integration && (
                <span className="config-item">{data.config.integration}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Output handles */}
      {type !== 'output' && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="out"
          isConnectable={isConnectable}
          className="node-handle dynamic-bg"
        />

      )}

      {/* Conditional handles for condition nodes */}
      {type === 'condition' && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            isConnectable={isConnectable}
            className="node-handle conditional dynamic-bg"
            style={{ '--dynamic-bg': '#22c55e' } as React.CSSProperties}
          >

            <span className="handle-label true">T</span>
          </Handle>
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            isConnectable={isConnectable}
            className="node-handle conditional dynamic-bg"
            style={{ '--dynamic-bg': '#ef4444' } as React.CSSProperties}
          >

            <span className="handle-label false">F</span>
          </Handle>
        </>
      )}

      {/* Multiple outputs for parallel nodes */}
      {type === 'parallel' && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="branch-1"
            isConnectable={isConnectable}
            className="node-handle dynamic-bg handle-top-30"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="branch-2"
            isConnectable={isConnectable}
            className="node-handle dynamic-bg handle-top-50"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="branch-3"
            isConnectable={isConnectable}
            className="node-handle dynamic-bg handle-top-70"
          />
        </>
      )}

    </div>
  );
});

AgentNodeComponent.displayName = 'AgentNodeComponent';

export default AgentNodeComponent;
