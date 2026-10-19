/**
 * Template Gallery Component
 * 
 * Modal displaying pre-built agent templates organized by category.
 */

import React, { useState, useEffect } from 'react';
import { X, Search, Sparkles, Clock, Zap, Shield, BarChart3, FileText, Users, MessageSquare } from 'lucide-react';
import { AgentTemplate } from '../../../../shared/schema/agent-builder';
import { api } from '../../utils/api';

interface TemplateGalleryProps {
  onSelect: (template: AgentTemplate) => void;
  onClose: () => void;
}

const categoryIcons: Record<string, React.ComponentType<{ size?: number | string }>> = {
  'customer-service': MessageSquare,
  'data-processing': FileText,
  'content-generation': Sparkles,
  'automation': Zap,
  'analysis': BarChart3,
  'integration': Users,
  'custom': Shield
};

const categoryColors: Record<string, string> = {
  'customer-service': '#3b82f6',
  'data-processing': '#10b981',
  'content-generation': '#f59e0b',
  'automation': '#8b5cf6',
  'analysis': '#06b6d4',
  'integration': '#ec4899',
  'custom': '#64748b'
};

const categories = [
  { id: 'all', name: 'All Templates' },
  { id: 'customer-service', name: 'Customer Service' },
  { id: 'data-processing', name: 'Data Processing' },
  { id: 'content-generation', name: 'Content Generation' },
  { id: 'automation', name: 'Automation' },
  { id: 'analysis', name: 'Analysis' },
  { id: 'integration', name: 'Integrations' }
];

export const TemplateGallery: React.FC<TemplateGalleryProps> = ({
  onSelect,
  onClose
}) => {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<AgentTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [templates, selectedCategory, searchQuery]);

  const loadTemplates = async () => {
    try {
      const response = await api.get('/api/agents/templates');
      setTemplates(response.data.templates || []);
    } catch (error) {
      console.error('Failed to load templates:', error);
      // Use default templates if API fails
      setTemplates(getDefaultTemplates());
    } finally {
      setIsLoading(false);
    }
  };

  const filterTemplates = () => {
    let filtered = templates;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((t) => t.category === selectedCategory);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    setFilteredTemplates(filtered);
  };

  const getDefaultTemplates = (): AgentTemplate[] => [
    {
      id: 'customer-support-classifier',
      name: 'Customer Support Classifier',
      description: 'Automatically classify and route customer support tickets based on content analysis',
      category: 'customer-service',
      icon: 'message-square',
      estimatedComplexity: 'moderate',
      averageLatency: '~2s',
      popularity: 95,
      tags: ['support', 'classification', 'routing'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'ticketContent', type: 'string', description: 'The support ticket text', required: true }
      ]
    },
    {
      id: 'document-extractor',
      name: 'Document Information Extractor',
      description: 'Extract key information from contracts, invoices, and documents with OCR and NLP',
      category: 'data-processing',
      icon: 'file-text',
      estimatedComplexity: 'complex',
      averageLatency: '~5s',
      popularity: 88,
      tags: ['ocr', 'documents', 'extraction'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'documentUrl', type: 'string', description: 'URL to the document', required: true },
        { name: 'extractionSchema', type: 'object', description: 'Fields to extract', required: true }
      ]
    },
    {
      id: 'content-writer',
      name: 'AI Content Writer',
      description: 'Generate blog posts, social media content, and marketing copy from briefs',
      category: 'content-generation',
      icon: 'sparkles',
      estimatedComplexity: 'moderate',
      averageLatency: '~8s',
      popularity: 92,
      tags: ['content', 'writing', 'marketing'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'topic', type: 'string', description: 'Content topic', required: true },
        { name: 'tone', type: 'string', description: 'Writing tone (professional, casual, etc)', required: false, default: 'professional' }
      ]
    },
    {
      id: 'meeting-summarizer',
      name: 'Meeting Summarizer & Action Items',
      description: 'Process meeting transcripts to extract summaries, decisions, and action items',
      category: 'automation',
      icon: 'zap',
      estimatedComplexity: 'moderate',
      averageLatency: '~3s',
      popularity: 85,
      tags: ['meetings', 'summarization', 'actions'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'transcript', type: 'string', description: 'Meeting transcript text', required: true }
      ]
    },
    {
      id: 'sentiment-analyzer',
      name: 'Real-time Sentiment Analyzer',
      description: 'Monitor social media, reviews, or support tickets for sentiment trends and alerts',
      category: 'analysis',
      icon: 'bar-chart-3',
      estimatedComplexity: 'simple',
      averageLatency: '~1s',
      popularity: 78,
      tags: ['sentiment', 'analysis', 'monitoring'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'text', type: 'string', description: 'Text to analyze', required: true }
      ]
    },
    {
      id: 'slack-jira-bridge',
      name: 'Slack to Jira Bridge',
      description: 'Convert Slack messages into Jira tickets with automatic categorization',
      category: 'integration',
      icon: 'users',
      estimatedComplexity: 'moderate',
      averageLatency: '~2s',
      popularity: 82,
      tags: ['slack', 'jira', 'integration'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'slackMessage', type: 'string', description: 'Slack message content', required: true },
        { name: 'channel', type: 'string', description: 'Slack channel name', required: true }
      ]
    },
    {
      id: 'lead-scorer',
      name: 'Lead Qualification & Scoring',
      description: 'Score and qualify sales leads based on behavior, firmographics, and engagement',
      category: 'analysis',
      icon: 'bar-chart-3',
      estimatedComplexity: 'complex',
      averageLatency: '~1s',
      popularity: 75,
      tags: ['sales', 'leads', 'scoring'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'leadData', type: 'object', description: 'Lead information', required: true }
      ]
    },
    {
      id: 'compliance-checker',
      name: 'Contract Compliance Checker',
      description: 'Analyze contracts for GDPR, SOX, and regulatory compliance with risk scoring',
      category: 'analysis',
      icon: 'shield',
      estimatedComplexity: 'complex',
      averageLatency: '~4s',
      popularity: 70,
      tags: ['compliance', 'legal', 'gdpr'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'contractText', type: 'string', description: 'Contract document text', required: true },
        { name: 'jurisdiction', type: 'string', description: 'Legal jurisdiction', required: true }
      ]
    },
    {
      id: 'onboarding-guide',
      name: 'Employee Onboarding Guide',
      description: 'Personalized onboarding assistant that guides new hires through company processes',
      category: 'automation',
      icon: 'zap',
      estimatedComplexity: 'moderate',
      averageLatency: '~2s',
      popularity: 68,
      tags: ['hr', 'onboarding', 'training'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'employeeInfo', type: 'object', description: 'New hire information', required: true }
      ]
    },
    {
      id: 'anomaly-detector',
      name: 'System Anomaly Detector',
      description: 'Monitor system logs and metrics for anomalies with alerting and root cause analysis',
      category: 'analysis',
      icon: 'bar-chart-3',
      estimatedComplexity: 'complex',
      averageLatency: '~1s',
      popularity: 72,
      tags: ['monitoring', 'anomaly', 'devops'],
      workflow: {
        nodes: [],
        edges: []
      },
      variables: [
        { name: 'metrics', type: 'array', description: 'System metrics data', required: true }
      ]
    }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content template-gallery" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Agent Templates</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="gallery-filters">
          <div className="search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="category-tabs">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`category-tab ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="gallery-grid">
          {isLoading ? (
            <div className="loading-state">Loading templates...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="empty-state">No templates found</div>
          ) : (
            filteredTemplates.map((template) => {
              const Icon = categoryIcons[template.category] || Sparkles;
              const color = categoryColors[template.category] || '#6b7280';

              return (
                <div
                  key={template.id}
                  className="template-card"
                  onClick={() => onSelect(template)}
                >
                  <div className="template-header" style={{ backgroundColor: `${color}10` }}>
                    <div className="template-icon" style={{ color }}>
                      <Icon size={24} />
                    </div>
                    {template.popularity && template.popularity > 80 && (
                      <span className="popular-badge">Popular</span>
                    )}
                  </div>

                  <div className="template-body">
                    <h3>{template.name}</h3>
                    <p>{template.description}</p>

                    <div className="template-meta">
                      <span className={`complexity-badge ${template.estimatedComplexity}`}>
                        {template.estimatedComplexity}
                      </span>
                      <span className="latency-badge">
                        <Clock size={12} />
                        {template.averageLatency}
                      </span>
                    </div>

                    {template.tags && (
                      <div className="template-tags">
                        {template.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplateGallery;
