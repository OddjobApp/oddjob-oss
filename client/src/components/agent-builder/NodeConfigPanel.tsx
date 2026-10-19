/**
 * Node Configuration Panel
 * 
 * Sidebar panel for configuring selected node properties.
 */

import React, { useState, useEffect } from 'react';
import { Node } from 'reactflow';
import { X, Trash2, Settings, Brain, Database, Plug, Code, GitBranch, Server, Workflow } from 'lucide-react';

interface NodeConfigPanelProps {
  node: Node;
  onUpdate: (nodeId: string, config: any) => void;
  onDelete: (nodeId: string) => void;
  readOnly?: boolean;
}

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({
  node,
  onUpdate,
  onDelete,
  readOnly = false
}) => {
  const [config, setConfig] = useState(node.data.config || {});
  const [label, setLabel] = useState(node.data.label || '');
  const [description, setDescription] = useState(node.data.description || '');

  // Update local state when node changes
  useEffect(() => {
    setConfig(node.data.config || {});
    setLabel(node.data.label || '');
    setDescription(node.data.description || '');
  }, [node.id]);

  const handleSave = () => {
    onUpdate(node.id, {
      ...config,
      label,
      description
    });
  };

  const handleConfigChange = (key: string, value: any) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    onUpdate(node.id, newConfig);
  };

  const renderConfigFields = () => {
    switch (node.type) {
      case 'llm':
        return (
          <>
            <div className="config-field">
              <label>Model</label>
              <select
                value={config.model || 'gpt-4'}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                disabled={readOnly}
              >
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="claude-3-opus">Claude 3 Opus</option>
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                <option value="gemini-pro">Gemini Pro</option>
              </select>
            </div>
            <div className="config-field">
              <label>Temperature ({config.temperature || 0.7})</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature || 0.7}
                onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Max Tokens</label>
              <input
                type="number"
                value={config.maxTokens || 2000}
                onChange={(e) => handleConfigChange('maxTokens', parseInt(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>System Prompt</label>
              <textarea
                rows={4}
                value={config.systemPrompt || ''}
                onChange={(e) => handleConfigChange('systemPrompt', e.target.value)}
                placeholder="Enter system instructions..."
                disabled={readOnly}
              />
            </div>
          </>
        );

      case 'knowledge':
        return (
          <>
            <div className="config-field">
              <label>Knowledge Collection</label>
              <input
                type="text"
                value={config.collection || ''}
                onChange={(e) => handleConfigChange('collection', e.target.value)}
                placeholder="e.g., company-docs"
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Search Type</label>
              <select
                value={config.searchType || 'hybrid'}
                onChange={(e) => handleConfigChange('searchType', e.target.value)}
                disabled={readOnly}
              >
                <option value="semantic">Semantic (Vector)</option>
                <option value="keyword">Keyword</option>
                <option value="hybrid">Hybrid (Best of both)</option>
              </select>
            </div>
            <div className="config-field">
              <label>Results (Top K)</label>
              <input
                type="number"
                min="1"
                max="20"
                value={config.topK || 5}
                onChange={(e) => handleConfigChange('topK', parseInt(e.target.value))}
                disabled={readOnly}
              />
            </div>
          </>
        );

      case 'condition':
        return (
          <>
            <div className="config-field">
              <label>Condition Expression</label>
              <input
                type="text"
                value={config.condition || ''}
                onChange={(e) => handleConfigChange('condition', e.target.value)}
                placeholder="e.g., input.confidence > 0.8"
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Operator</label>
              <select
                value={config.operator || 'gt'}
                onChange={(e) => handleConfigChange('operator', e.target.value)}
                disabled={readOnly}
              >
                <option value="equals">Equals</option>
                <option value="contains">Contains</option>
                <option value="gt">Greater Than</option>
                <option value="lt">Less Than</option>
                <option value="regex">Matches Regex</option>
              </select>
            </div>
            <div className="config-field">
              <label>Comparison Value</label>
              <input
                type="text"
                value={config.value || ''}
                onChange={(e) => handleConfigChange('value', e.target.value)}
                placeholder="Value to compare against"
                disabled={readOnly}
              />
            </div>
          </>
        );

      case 'integration':
        return (
          <>
            <div className="config-field">
              <label>Integration</label>
              <select
                value={config.integration || ''}
                onChange={(e) => handleConfigChange('integration', e.target.value)}
                disabled={readOnly}
              >
                <option value="">Select integration...</option>
                <option value="slack">Slack</option>
                <option value="jira">Jira</option>
                <option value="salesforce">Salesforce</option>
                <option value="github">GitHub</option>
                <option value="notion">Notion</option>
                <option value="zendesk">Zendesk</option>
                <option value="servicenow">ServiceNow</option>
                <option value="hubspot">HubSpot</option>
                <option value="airtable">Airtable</option>
              </select>
            </div>
            <div className="config-field">
              <label>Operation</label>
              <input
                type="text"
                value={config.operation || ''}
                onChange={(e) => handleConfigChange('operation', e.target.value)}
                placeholder="e.g., send_message, create_ticket"
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Parameters (JSON)</label>
              <textarea
                rows={3}
                value={JSON.stringify(config.actionParams || {}, null, 2)}
                onChange={(e) => {
                  try {
                    handleConfigChange('actionParams', JSON.parse(e.target.value));
                  } catch {}
                }}
                disabled={readOnly}
              />
            </div>
          </>
        );

      case 'trigger':
        return (
          <>
            <div className="config-field">
              <label>Trigger Type</label>
              <select
                value={config.triggerType || 'webhook'}
                onChange={(e) => handleConfigChange('triggerType', e.target.value)}
                disabled={readOnly}
              >
                <option value="webhook">Webhook</option>
                <option value="schedule">Schedule (Cron)</option>
                <option value="event">Event-Driven</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>
            {config.triggerType === 'schedule' && (
              <div className="config-field">
                <label>Con Schedule</label>
                <input
                  type="text"
                  value={config.schedule || ''}
                  onChange={(e) => handleConfigChange('schedule', e.target.value)}
                  placeholder="0 */6 * * * (every 6 hours)"
                  disabled={readOnly}
                />
              </div>
            )}
          </>
        );

      case 'output':
        return (
          <>
            <div className="config-field">
              <label>Output Type</label>
              <select
                value={config.outputType || 'return'}
                onChange={(e) => handleConfigChange('outputType', e.target.value)}
                disabled={readOnly}
              >
                <option value="return">Return Response</option>
                <option value="webhook">Send to Webhook</option>
                <option value="email">Send Email</option>
                <option value="slack">Send Slack Message</option>
              </select>
            </div>
            {config.outputType === 'webhook' && (
              <div className="config-field">
                <label>Webhook URL</label>
                <input
                  type="text"
                  value={config.webhookUrl || ''}
                  onChange={(e) => handleConfigChange('webhookUrl', e.target.value)}
                  placeholder="https://..."
                  disabled={readOnly}
                />
              </div>
            )}
          </>
        );

      case 'loop':
        return (
          <>
            <div className="config-field">
              <label>Loop Condition</label>
              <input
                type="text"
                value={config.loopCondition || ''}
                onChange={(e) => handleConfigChange('loopCondition', e.target.value)}
                placeholder="e.g., items.length > 0"
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Max Iterations</label>
              <input
                type="number"
                min="1"
                max="100"
                value={config.maxIterations || 10}
                onChange={(e) => handleConfigChange('maxIterations', parseInt(e.target.value))}
                disabled={readOnly}
              />
            </div>
          </>
        );

      case 'delay':
        return (
          <div className="config-field">
            <label>Delay (milliseconds)</label>
            <input
              type="number"
              min="0"
              step="1000"
              value={config.delayMs || 1000}
              onChange={(e) => handleConfigChange('delayMs', parseInt(e.target.value))}
              disabled={readOnly}
            />
          </div>
        );

      case 'webhook':
        return (
          <>
            <div className="config-field">
              <label>Webhook URL</label>
              <input
                type="text"
                value={config.webhookUrl || ''}
                onChange={(e) => handleConfigChange('webhookUrl', e.target.value)}
                placeholder="https://api.example.com/webhook"
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>HTTP Method</label>
              <select
                value={config.webhookMethod || 'POST'}
                onChange={(e) => handleConfigChange('webhookMethod', e.target.value)}
                disabled={readOnly}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
          </>
        );

      case 'mcp-client':
        return (
          <>
            <div className="config-field">
              <label>MCP Server URL</label>
              <input
                type="text"
                value={config.mcpServerUrl || ''}
                onChange={(e) => handleConfigChange('mcpServerUrl', e.target.value)}
                placeholder="http://localhost:3000/sse or stdio command"
                disabled={readOnly}
              />
              <small className="field-help">URL for SSE/HTTP transport, or command for stdio</small>
            </div>
            <div className="config-field">
              <label>Transport</label>
              <select
                value={config.mcpTransport || 'sse'}
                onChange={(e) => handleConfigChange('mcpTransport', e.target.value)}
                disabled={readOnly}
              >
                <option value="sse">SSE (Server-Sent Events)</option>
                <option value="http">HTTP</option>
                <option value="stdio">Stdio (Command)</option>
              </select>
            </div>
            <div className="config-field">
              <label>Tool Name</label>
              <input
                type="text"
                value={config.mcpToolName || ''}
                onChange={(e) => handleConfigChange('mcpToolName', e.target.value)}
                placeholder="e.g., search_knowledge_graph"
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Tool Parameters (JSON)</label>
              <textarea
                rows={3}
                value={JSON.stringify(config.mcpToolParams || {}, null, 2)}
                onChange={(e) => {
                  try {
                    handleConfigChange('mcpToolParams', JSON.parse(e.target.value));
                  } catch {}
                }}
                placeholder='{"query": "search term"}'
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Timeout (ms)</label>
              <input
                type="number"
                min="1000"
                max="300000"
                step="1000"
                value={config.mcpTimeout || 30000}
                onChange={(e) => handleConfigChange('mcpTimeout', parseInt(e.target.value))}
                disabled={readOnly}
              />
            </div>
          </>
        );

      case 'reasoning-router':
        return (
          <>
            <div className="config-field">
              <label>Reasoning Model</label>
              <select
                value={config.reasoningModel || 'o1-mini'}
                onChange={(e) => handleConfigChange('reasoningModel', e.target.value)}
                disabled={readOnly}
              >
                <option value="o1-preview">o1 Preview (Best for complex reasoning)</option>
                <option value="o1-mini">o1 Mini (Fast reasoning)</option>
                <option value="deepseek-r1">DeepSeek R1 (Open source)</option>
                <option value="claude-3-opus">Claude 3 Opus (Analysis)</option>
                <option value="gpt-4">GPT-4 (General purpose)</option>
              </select>
            </div>
            <div className="config-field">
              <label>Reasoning Strategy</label>
              <select
                value={config.reasoningStrategy || 'chain-of-thought'}
                onChange={(e) => handleConfigChange('reasoningStrategy', e.target.value)}
                disabled={readOnly}
              >
                <option value="chain-of-thought">Chain of Thought (Step-by-step)</option>
                <option value="tree-of-thoughts">Tree of Thoughts (Explore multiple paths)</option>
                <option value="self-consistency">Self-Consistency (Vote on answers)</option>
                <option value="reflexion">Reflexion (Self-critique & improve)</option>
                <option value="plan-and-solve">Plan and Solve (Create plan first)</option>
              </select>
            </div>
            <div className="config-field">
              <label>Enable Thinking Output</label>
              <input
                type="checkbox"
                checked={config.enableThinking !== false}
                onChange={(e) => handleConfigChange('enableThinking', e.target.checked)}
                disabled={readOnly}
              />
              <small className="field-help">Show reasoning steps in output</small>
            </div>
            <div className="config-field">
              <label>Max Tokens</label>
              <input
                type="number"
                min="1000"
                max="32000"
                step="1000"
                value={config.maxTokens || 4000}
                onChange={(e) => handleConfigChange('maxTokens', parseInt(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div className="config-field">
              <label>Timeout (ms)</label>
              <input
                type="number"
                min="5000"
                max="300000"
                step="5000"
                value={config.reasoningTimeout || 60000}
                onChange={(e) => handleConfigChange('reasoningTimeout', parseInt(e.target.value))}
                disabled={readOnly}
              />
            </div>
          </>
        );

      default:
        return (
          <div className="config-field">
            <label>Action Type</label>
            <input
              type="text"
              value={config.actionType || ''}
              onChange={(e) => handleConfigChange('actionType', e.target.value)}
              placeholder="e.g., process_data, send_alert"
              disabled={readOnly}
            />
          </div>
        );
    }
  };

  const getNodeIcon = () => {
    switch (node.type) {
      case 'llm': return <Brain size={16} />;
      case 'knowledge': return <Database size={16} />;
      case 'integration': return <Plug size={16} />;
      case 'action': return <Code size={16} />;
      case 'condition': return <GitBranch size={16} />;
      case 'mcp-client': return <Server size={16} />;
      case 'reasoning-router': return <Workflow size={16} />;
      default: return <Settings size={16} />;
    }
  };

  return (
    <div className="node-config-panel">
      <div className="panel-header">
        <div className="panel-title">
          {getNodeIcon()}
          <span>Configure {node.type}</span>
        </div>
        {!readOnly && (
          <button
            className="delete-btn"
            onClick={() => onDelete(node.id)}
            title="Delete node"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="panel-body">
        <div className="config-field">
          <label>Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              handleSave();
            }}
            placeholder="Node name"
            disabled={readOnly}
          />
        </div>

        <div className="config-field">
          <label>Description</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              handleSave();
            }}
            placeholder="What does this node do?"
            disabled={readOnly}
          />
        </div>

        <div className="config-section">
          <h4>Configuration</h4>
          {renderConfigFields()}
        </div>
      </div>
    </div>
  );
};

export default NodeConfigPanel;
