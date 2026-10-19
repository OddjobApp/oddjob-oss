/**
 * Node Palette Component
 * 
 * Sidebar for dragging and dropping node types onto the canvas.
 */

import React from 'react';
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
  Server,
  Workflow
} from 'lucide-react';

interface NodePaletteProps {
  onAddNode: (type: string, position?: { x: number; y: number }) => void;
  disabled?: boolean;
}

const nodeTypes = [
  {
    type: 'trigger',
    label: 'Trigger',
    description: 'Start the workflow',
    icon: Play,
    color: '#10b981'
  },
  {
    type: 'llm',
    label: 'AI/LLM',
    description: 'Language model inference',
    icon: Brain,
    color: '#8b5cf6'
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Branch based on logic',
    icon: GitBranch,
    color: '#f59e0b'
  },
  {
    type: 'action',
    label: 'Action',
    description: 'Execute custom code',
    icon: Zap,
    color: '#3b82f6'
  },
  {
    type: 'knowledge',
    label: 'Knowledge',
    description: 'Query knowledge base',
    icon: Database,
    color: '#06b6d4'
  },
  {
    type: 'integration',
    label: 'Integration',
    description: 'Connect to external services',
    icon: Plug,
    color: '#ec4899'
  },
  {
    type: 'output',
    label: 'Output',
    description: 'Return or send results',
    icon: Send,
    color: '#22c55e'
  },
  {
    type: 'loop',
    label: 'Loop',
    description: 'Iterate over collection',
    icon: Repeat,
    color: '#f97316'
  },
  {
    type: 'parallel',
    label: 'Parallel',
    description: 'Execute branches concurrently',
    icon: Layers,
    color: '#6366f1'
  },
  {
    type: 'delay',
    label: 'Delay',
    description: 'Wait for specified time',
    icon: Clock,
    color: '#64748b'
  },
  {
    type: 'webhook',
    label: 'Webhook',
    description: 'HTTP request/response',
    icon: Webhook,
    color: '#14b8a6'
  },
  {
    type: 'mcp-client',
    label: 'MCP Client',
    description: 'Connect to external MCP servers',
    icon: Server,
    color: '#a855f7'
  },
  {
    type: 'reasoning-router',
    label: 'Reasoning Router',
    description: 'Route complex queries to reasoning models',
    icon: Workflow,
    color: '#6366f1'
  }
];

export const NodePalette: React.FC<NodePaletteProps> = ({ 
  onAddNode, 
  disabled = false 
}) => {
  const handleDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData('application/reactflow', nodeType);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleClick = (nodeType: string) => {
    if (!disabled) {
      onAddNode(nodeType);
    }
  };

  return (
    <div className={`node-palette ${disabled ? 'disabled' : ''}`}>
      <h3 className="palette-title">Nodes</h3>
      <div className="palette-items">
        {nodeTypes.map((nodeType) => {
          const Icon = nodeType.icon;
          return (
            <div
              key={nodeType.type}
              className="palette-item"
              draggable={!disabled}
              onDragStart={(e) => handleDragStart(e, nodeType.type)}
              onClick={() => handleClick(nodeType.type)}
              style={{ 
                borderLeftColor: nodeType.color,
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'not-allowed' : 'grab'
              }}
            >
              <div 
                className="palette-icon"
                style={{ color: nodeType.color }}
              >
                <Icon size={20} />
              </div>
              <div className="palette-info">
                <div className="palette-label">{nodeType.label}</div>
                <div className="palette-description">{nodeType.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NodePalette;
