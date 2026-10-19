import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { recoverChunkLoadError } from '@/lib/chunk-error-recovery';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Uncaught error in ${this.props.name || 'Component'}:`, error, errorInfo);
  }

  private handleReset = () => {
    if (recoverChunkLoadError(this.state.error)) return;
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-6 border border-destructive/20 bg-destructive/5 rounded-lg text-center space-y-4 min-h-[200px]">
          <div className="flex items-center space-x-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <h3 className="font-semibold">{this.props.name || 'Component'} Failed to Load</h3>
          </div>
          
          <div className="text-left w-full max-w-2xl bg-background/10 p-4 rounded border border-destructive/10 overflow-auto max-h-[300px]">
            <p className="text-sm font-bold text-destructive mb-2">
              Error: {this.state.error?.message}
            </p>
            {this.state.error?.stack && (
              <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
            )}
          </div>

          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            This module encountered an unexpected error. Please check the logs above for diagnostic details.
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={this.handleReset}
            className="flex items-center space-x-2"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Try Again</span>
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
