/**
 * Natural Language Agent Generator
 * 
 * AI-powered component that converts natural language descriptions
 * into agent workflows using the Neuro-Symbolic reasoning system.
 */

import React, { useState } from 'react';
import { Sparkles, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '../../utils/api';
import { AgentDefinition } from '../../../../shared/schema/agent-builder';

interface NLAgentGeneratorProps {
  onGenerate: (agent: AgentDefinition) => void;
  onClose: () => void;
}

export const NLAgentGenerator: React.FC<NLAgentGeneratorProps> = ({
  onGenerate,
  onClose
}) => {
  const [description, setDescription] = useState('');
  const [context, setContext] = useState({
    domain: '',
    integrations: [] as string[],
    knowledgeBases: [] as string[],
    expectedVolume: 'medium' as const
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAgent, setGeneratedAgent] = useState<AgentDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');

  const handleGenerate = async () => {
    if (!description.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const response = await api.post('/api/agents/generate', {
        description,
        context: context.domain ? context : undefined,
        constraints: {
          maxComplexity: 'complex'
        }
      });
      
      if (response.data.success) {
        setGeneratedAgent(response.data.agent);
        setExplanation(response.data.explanation);
      } else {
        setError('Failed to generate agent. Please try a more detailed description.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = () => {
    if (generatedAgent) {
      onGenerate(generatedAgent);
    }
  };

  const examplePrompts = [
    "Build an agent that processes customer support tickets, categorizes them by urgency, and routes to the right team",
    "Create a document analysis agent that extracts key information from contracts and flags risky clauses",
    "Make an agent that monitors system logs, detects anomalies, and sends alerts to Slack",
    "Build an agent that takes meeting transcripts, extracts action items, and creates Jira tickets"
  ];

  const integrations = [
    'slack', 'jira', 'salesforce', 'github', 'notion', 
    'confluence', 'zendesk', 'servicenow', 'hubspot', 'airtable', 'postgres'
  ];

  const domains = [
    'customer-service', 'sales', 'marketing', 'engineering',
    'legal', 'finance', 'hr', 'operations', 'general'
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content nl-generator" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Sparkles className="icon" />
            AI Agent Generator
          </h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {!generatedAgent ? (
            <>
              <div className="description-section">
                <label>Describe what you want your agent to do:</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Build an agent that processes invoices, extracts line items, and flags discrepancies..."
                  rows={5}
                  disabled={isGenerating}
                />
                
                <div className="example-prompts">
                  <label>Example prompts:</label>
                  <div className="prompt-chips">
                    {examplePrompts.map((prompt, i) => (
                      <button
                        key={i}
                        className="prompt-chip"
                        onClick={() => setDescription(prompt)}
                        disabled={isGenerating}
                      >
                        {prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="context-section">
                <details>
                  <summary>Advanced Configuration (Optional)</summary>
                  
                  <div className="context-fields">
                    <div className="field">
                      <label>Domain:</label>
                      <select
                        value={context.domain}
                        onChange={(e) => setContext({ ...context, domain: e.target.value })}
                        disabled={isGenerating}
                      >
                        <option value="">Select domain...</option>
                        {domains.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label>Expected Volume:</label>
                      <select
                        value={context.expectedVolume}
                        onChange={(e) => setContext({ ...context, expectedVolume: e.target.value as any })}
                        disabled={isGenerating}
                      >
                        <option value="low">Low (100s/day)</option>
                        <option value="medium">Medium (1000s/day)</option>
                        <option value="high">High (10000s/day)</option>
                      </select>
                    </div>

                    <div className="field">
                      <label>Integrations:</label>
                      <div className="integration-chips">
                        {integrations.map((integration) => (
                          <button
                            key={integration}
                            className={`integration-chip ${context.integrations.includes(integration) ? 'selected' : ''}`}
                            onClick={() => {
                              const newIntegrations = context.integrations.includes(integration)
                                ? context.integrations.filter((i) => i !== integration)
                                : [...context.integrations, integration];
                              setContext({ ...context, integrations: newIntegrations });
                            }}
                            disabled={isGenerating}
                          >
                            {integration}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              </div>

              {error && (
                <div className="error-message">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              <div className="modal-actions">
                <button 
                  className="btn btn-secondary" 
                  onClick={onClose}
                  disabled={isGenerating}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerate}
                  disabled={!description.trim() || isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="spin" size={16} />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Generate Agent
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="generated-preview">
                <div className="success-header">
                  <CheckCircle size={32} color="#22c55e" />
                  <h3>Agent Generated!</h3>
                </div>

                <div className="agent-preview">
                  <h4>{generatedAgent.name}</h4>
                  <p>{generatedAgent.description}</p>
                  
                  <div className="stats">
                    <div className="stat">
                      <strong>{generatedAgent.workflow?.nodes.length || 0}</strong>
                      <span>nodes</span>
                    </div>
                    <div className="stat">
                      <strong>{generatedAgent.workflow?.edges.length || 0}</strong>
                      <span>connections</span>
                    </div>
                  </div>

                  {explanation && (
                    <div className="explanation">
                      <h5>How it works:</h5>
                      <p>{explanation}</p>
                    </div>
                  )}

                  {generatedAgent.constitutionalPrinciples && generatedAgent.constitutionalPrinciples.length > 0 && (
                    <div className="principles">
                      <h5>Safety Principles:</h5>
                      <ul>
                        {generatedAgent.constitutionalPrinciples.map((p) => (
                          <li key={p.id}>{p.principle}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setGeneratedAgent(null)}
                >
                  Regenerate
                </button>
                <button
                  className="btn btn-success"
                  onClick={handleAccept}
                >
                  <CheckCircle size={16} />
                  Use This Agent
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NLAgentGenerator;
