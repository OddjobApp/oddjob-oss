"use client";

import React, { useState, useCallback } from 'react';
import { Play, RefreshCw, Plus, Trash2, AlertCircle, CheckCircle, Code, FileText, Zap, BookOpen } from 'lucide-react';

interface TransformationRule {
  id: string;
  type: 'direct' | 'wrap_object' | 'map_value' | 'parse_json' | 'to_string' | 'extract_field';
  sourcePath: string;
  targetPath: string;
  config?: {
    wrapperKey?: string;
    mapping?: Record<string, any>;
    extractPath?: string;
  };
}

interface TransformerTestHarnessProps {
  rules?: TransformationRule[];
  jobName?: string;
  onSave?: (rules: TransformationRule[]) => void;
}

const RULE_TYPES = [
  { value: 'direct', label: 'Direct Copy', description: 'Copy value from source to target' },
  { value: 'wrap_object', label: 'Wrap Object', description: 'Wrap value in an object with a key' },
  { value: 'map_value', label: 'Map Value', description: 'Map values using a lookup table' },
  { value: 'parse_json', label: 'Parse JSON', description: 'Parse JSON string to object' },
  { value: 'to_string', label: 'To String', description: 'Convert value to string' },
  { value: 'extract_field', label: 'Extract Field', description: 'Extract nested field from object' },
];

const SAMPLE_TEMPLATES = [
  {
    name: 'User Profile',
    description: 'Transform user data with field mapping',
    data: {
      "user_id": 12345,
      "full_name": "Jane Smith",
      "email_address": "jane.smith@example.com",
      "user_status": "active",
      "profile": {
        "department": "Engineering",
        "title": "Senior Developer",
        "location": "San Francisco"
      }
    },
    rules: [
      { id: 'r1', type: 'direct', sourcePath: 'user_id', targetPath: 'id' },
      { id: 'r2', type: 'direct', sourcePath: 'full_name', targetPath: 'name' },
      { id: 'r3', type: 'direct', sourcePath: 'email_address', targetPath: 'email' },
      { id: 'r4', type: 'map_value', sourcePath: 'user_status', targetPath: 'status', config: { mapping: { 'active': 'Active', 'inactive': 'Inactive', 'pending': 'Pending' } } },
      { id: 'r5', type: 'extract_field', sourcePath: 'profile', targetPath: 'department', config: { extractPath: 'department' } },
      { id: 'r6', type: 'extract_field', sourcePath: 'profile', targetPath: 'title', config: { extractPath: 'title' } },
    ]
  },
  {
    name: 'E-commerce Order',
    description: 'Transform order data with status mapping',
    data: {
      "order_number": "ORD-2024-001",
      "customer": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "items": [
        { "product_id": "P001", "quantity": 2, "price": 29.99 },
        { "product_id": "P002", "quantity": 1, "price": 49.99 }
      ],
      "order_status": "processing",
      "total_amount": 109.97
    },
    rules: [
      { id: 'r1', type: 'direct', sourcePath: 'order_number', targetPath: 'orderId' },
      { id: 'r2', type: 'extract_field', sourcePath: 'customer', targetPath: 'customerName', config: { extractPath: 'name' } },
      { id: 'r3', type: 'extract_field', sourcePath: 'customer', targetPath: 'customerEmail', config: { extractPath: 'email' } },
      { id: 'r4', type: 'map_value', sourcePath: 'order_status', targetPath: 'status', config: { mapping: { 'processing': 'Processing', 'shipped': 'Shipped', 'delivered': 'Delivered', 'cancelled': 'Cancelled' } } },
      { id: 'r5', type: 'direct', sourcePath: 'total_amount', targetPath: 'total' },
      { id: 'r6', type: 'direct', sourcePath: 'items', targetPath: 'lineItems' },
    ]
  },
  {
    name: 'API Response',
    description: 'Parse and restructure API response',
    data: {
      "response": {
        "success": true,
        "data": {
          "users": [
            { "id": 1, "attributes": { "name": "Alice", "role": "admin" } },
            { "id": 2, "attributes": { "name": "Bob", "role": "user" } }
          ]
        },
        "meta": { "total": 2, "page": 1 }
      }
    },
    rules: [
      { id: 'r1', type: 'extract_field', sourcePath: 'response', targetPath: 'success', config: { extractPath: 'success' } },
      { id: 'r2', type: 'extract_field', sourcePath: 'response', targetPath: 'users', config: { extractPath: 'data.users' } },
      { id: 'r3', type: 'extract_field', sourcePath: 'response', targetPath: 'totalCount', config: { extractPath: 'meta.total' } },
      { id: 'r4', type: 'extract_field', sourcePath: 'response', targetPath: 'currentPage', config: { extractPath: 'meta.page' } },
    ]
  },
];

export default function TransformerTestHarness({ rules: initialRules = [], jobName = 'Transformer', onSave }: TransformerTestHarnessProps) {
  const [rules, setRules] = useState<TransformationRule[]>(initialRules);
  const [inputData, setInputData] = useState('{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "status": "active",\n  "metadata": {\n    "department": "Engineering",\n    "level": "Senior"\n  }\n}');
  const [outputData, setOutputData] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRule, setSelectedRule] = useState<number | null>(null);

  const addRule = useCallback(() => {
    const newRule: TransformationRule = {
      id: `rule-${Date.now()}`,
      type: 'direct',
      sourcePath: '',
      targetPath: '',
    };
    setRules([...rules, newRule]);
    setSelectedRule(rules.length);
  }, [rules]);

  const removeRule = useCallback((index: number) => {
    setRules(rules.filter((_, i) => i !== index));
    if (selectedRule === index) setSelectedRule(null);
    else if (selectedRule !== null && selectedRule > index) setSelectedRule(selectedRule - 1);
  }, [rules, selectedRule]);

  const updateRule = useCallback((index: number, updates: Partial<TransformationRule>) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], ...updates };
    setRules(updated);
  }, [rules]);

  const executeTransformation = useCallback(async () => {
    setIsExecuting(true);
    setError(null);
    setOutputData(null);

    try {
      const parsedInput = JSON.parse(inputData);
      
      // Call the actual TransformationEngine via API
      const response = await fetch('/api/jobs/test-transformation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputData: parsedInput,
          rules: rules,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Transformation failed');
      }

      setOutputData(JSON.stringify(result.output, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute transformation');
    } finally {
      setIsExecuting(false);
    }
  }, [rules, inputData]);

  const getNestedValue = (obj: any, path: string): any => {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  };

  const setNestedValue = (obj: any, path: string, value: any): void => {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
  };

  const handleSave = () => {
    onSave?.(rules);
  };

  const loadTemplate = useCallback((template: any) => {
    setInputData(JSON.stringify(template.data, null, 2));
    setRules(template.rules);
    setOutputData(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <Zap className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Transformer Test Harness</h3>
            <p className="text-sm text-muted-foreground">{jobName}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Template Selector */}
          <select
            onChange={(e) => {
              const template = SAMPLE_TEMPLATES.find(t => t.name === e.target.value);
              if (template) loadTemplate(template);
            }}
            className="px-3 py-2 bg-muted border border-border text-foreground text-sm rounded-lg"
          >
            <option value="">Load Template...</option>
            {SAMPLE_TEMPLATES.map((template) => (
              <option key={template.name} value={template.name}>
                {template.name}
              </option>
            ))}
          </select>
          <button
            onClick={executeTransformation}
            disabled={isExecuting || rules.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-muted disabled:text-muted-foreground text-foreground rounded-lg transition-colors"
          >
            {isExecuting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Execute
              </>
            )}
          </button>
          {onSave && (
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-muted hover:bg-muted text-foreground rounded-lg transition-colors"
            >
              Save Rules
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-400">Transformation Error</p>
            <p className="text-sm text-rose-700 dark:text-rose-300 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rules Editor */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-foreground">Transformation Rules</h4>
            <button
              onClick={addRule}
              className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted text-foreground text-sm rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Rule
            </button>
          </div>

          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-border rounded-lg">
                <Code className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No transformation rules defined</p>
                <p className="text-xs text-muted-foreground mt-1">Add a rule to get started</p>
              </div>
            ) : (
              rules.map((rule, index) => (
                <div
                  key={rule.id}
                  className={`p-4 bg-muted/50 border rounded-lg transition-all ${
                    selectedRule === index ? 'border-blue-500/50 bg-muted/80' : 'border-border'
                  }`}
                  onClick={() => setSelectedRule(index)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <select
                        value={rule.type}
                        onChange={(e) => updateRule(index, { type: e.target.value as any })}
                        className="w-full bg-card border border-border text-foreground text-sm rounded px-3 py-2"
                      >
                        {RULE_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">
                        {RULE_TYPES.find((t) => t.value === rule.type)?.description}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRule(index);
                      }}
                      className="p-1.5 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Source Path</label>
                      <input
                        type="text"
                        value={rule.sourcePath}
                        onChange={(e) => updateRule(index, { sourcePath: e.target.value })}
                        placeholder="e.g., name, metadata.department"
                        className="w-full bg-card border border-border text-foreground text-sm rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Target Path</label>
                      <input
                        type="text"
                        value={rule.targetPath}
                        onChange={(e) => updateRule(index, { targetPath: e.target.value })}
                        placeholder="e.g., fullName, team"
                        className="w-full bg-card border border-border text-foreground text-sm rounded px-3 py-2"
                      />
                    </div>
                  </div>

                  {/* Rule-specific config */}
                  {rule.type === 'wrap_object' && (
                    <div className="mt-3">
                      <label className="text-xs text-muted-foreground block mb-1">Wrapper Key</label>
                      <input
                        type="text"
                        value={rule.config?.wrapperKey || ''}
                        onChange={(e) => updateRule(index, { config: { ...rule.config, wrapperKey: e.target.value } })}
                        placeholder="e.g., name"
                        className="w-full bg-card border border-border text-foreground text-sm rounded px-3 py-2"
                      />
                    </div>
                  )}

                  {rule.type === 'map_value' && (
                    <div className="mt-3">
                      <label className="text-xs text-muted-foreground block mb-1">Mapping (JSON)</label>
                      <textarea
                        value={JSON.stringify(rule.config?.mapping || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            const mapping = JSON.parse(e.target.value);
                            updateRule(index, { config: { ...rule.config, mapping } });
                          } catch {
                            // Invalid JSON, don't update
                          }
                        }}
                        placeholder='{\n  "active": "Active",\n  "inactive": "Inactive"\n}'
                        className="w-full bg-card border border-border text-foreground text-sm rounded px-3 py-2 font-mono"
                        rows={3}
                      />
                    </div>
                  )}

                  {rule.type === 'extract_field' && (
                    <div className="mt-3">
                      <label className="text-xs text-muted-foreground block mb-1">Extract Path</label>
                      <input
                        type="text"
                        value={rule.config?.extractPath || ''}
                        onChange={(e) => updateRule(index, { config: { ...rule.config, extractPath: e.target.value } })}
                        placeholder="e.g., department"
                        className="w-full bg-card border border-border text-foreground text-sm rounded px-3 py-2"
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Input/Output Panels */}
        <div className="space-y-4">
          {/* Input Data */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h4 className="text-sm font-medium text-foreground">Input Data</h4>
            </div>
            <textarea
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              className="w-full h-48 bg-card border border-border text-foreground text-sm rounded-lg p-4 font-mono"
              placeholder="Enter JSON input data..."
            />
          </div>

          {/* Output Data */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-muted-foreground" />
              <h4 className="text-sm font-medium text-foreground">Output Data</h4>
              {outputData && (
                <span className="text-xs text-emerald-400">✓ Transformed</span>
              )}
            </div>
            <div className="relative">
              <textarea
                value={outputData || ''}
                readOnly
                className="w-full h-48 bg-card border border-border text-foreground text-sm rounded-lg p-4 font-mono"
                placeholder="Output will appear here after execution..."
              />
              {!outputData && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-sm text-muted-foreground">Execute transformation to see output</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
