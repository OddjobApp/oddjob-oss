import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import {
  Eye,
  Copy,
  Database,
  FileText,
  Code,
  FileJson,
  Clock,
  TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VariablePreview } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/useDataFlowVisualization';

interface VariablePreviewProps {
  variable: VariablePreview;
  onInspect?: (variable: VariablePreview) => void;
  compact?: boolean;
  className?: string;
}

export const VariablePreviewCard: React.FC<VariablePreviewProps> = ({
  variable,
  onInspect,
  compact = false,
  className
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getDataTypeIcon = (type: string) => {
    switch (type) {
      case 'text':
        return <FileText className="w-4 h-4" />;
      case 'number':
        return <TrendingUp className="w-4 h-4" />;
      case 'boolean':
        return <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white" />;
      case 'array':
        return <div className="w-4 h-4 bg-blue-500 border-2 border-white rounded" />;
      case 'object':
        return <FileJson className="w-4 h-4" />;
      case 'table':
        return <Database className="w-4 h-4" />;
      case 'reference':
        return <div className="w-4 h-4 border-2 border-dashed rounded" />;
      default:
        return <Code className="w-4 h-4" />;
    }
  };

  const getDataTypeColor = (type: string) => {
    switch (type) {
      case 'text':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'number':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'boolean':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'array':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'object':
        return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      case 'table':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'reference':
        return 'bg-muted text-foreground border-border';
      default:
        return 'bg-muted text-foreground border-border';
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return value.toLocaleString();
    if (typeof value === 'string') {
      if (value.length > 50) {
        return value.substring(0, 47) + '...';
      }
      return value;
    }
    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        if (json.length > 50) {
          return json.substring(0, 47) + '...';
        }
        return json;
      } catch {
        return '[Object]';
      }
    }
    if (Array.isArray(value)) {
      return `Array(${value.length})`;
    }
    return String(value);
  };

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 p-2 rounded border bg-card hover:bg-accent transition-colors cursor-pointer", className)}
        onClick={() => onInspect?.(variable)}
        title={`Variable: ${variable.name}\nType: ${variable.type}\nValue: ${formatValue(variable.value)}`}
      >
        {getDataTypeIcon(variable.type)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium truncate">{variable.name}</span>
            <Badge variant="secondary" className="text-xs">
              {variable.type}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {formatValue(variable.value)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {getDataTypeIcon(variable.type)}
            {variable.name}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Badge
              variant="outline"
              className={cn("text-xs", getDataTypeColor(variable.type))}
            >
              {variable.type}
            </Badge>
            {variable.sampleSize !== undefined && (
              <Badge variant="secondary" className="text-xs">
                ~{variable.sampleSize} bytes
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className={cn(
          "border rounded-md p-3 transition-all",
          getDataTypeColor(variable.type)
        )}>
          {/* Variable value */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1">Value:</div>
              <pre className="text-sm bg-background border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {formatValue(variable.value)}
              </pre>
            </div>

            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-6 px-2"
              >
                {isExpanded ? <Eye className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>

              {onInspect && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onInspect(variable)}
                  className="h-6 px-2"
                  title="Inspect variable"
                >
                  <Clock className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Expanded details */}
          {isExpanded && (
            <div className="space-y-3 border-t pt-3">
              {variable.description && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Description:</div>
                  <div className="text-sm">{variable.description}</div>
                </div>
              )}

              {variable.nodeId && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Source:</div>
                  <div className="text-sm font-mono">{variable.nodeId}</div>
                </div>
              )}

              {variable.stepIndex !== undefined && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Step Index:</div>
                  <div className="text-sm">{variable.stepIndex}</div>
                </div>
              )}

              {/* Data analysis */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-medium text-muted-foreground">Data Size:</div>
                  <div>
                    {variable.sampleSize !== undefined
                      ? `${variable.sampleSize} bytes`
                      : 'Unknown'
                    }
                  </div>
                </div>
                <div>
                  <div className="font-medium text-muted-foreground">Type Inference:</div>
                  <div>{variable.type}</div>
                </div>
              </div>

              {/* Copy value button */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(variable.value, null, 2))}
                  className="flex-1"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy JSON
                </Button>

                {onInspect && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onInspect(variable)}
                    className="flex-1"
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    Inspect
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VariablePreviewCard;

