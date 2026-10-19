import React, { Suspense, ReactNode, Component, ErrorInfo } from "react";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";

interface SectionErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

class SectionErrorBoundary extends Component<SectionErrorBoundaryProps, SectionErrorBoundaryState> {
  state: SectionErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Section] Render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive text-center">
          Failed to load this section.{" "}
          <button className="underline" onClick={() => this.setState({ hasError: false })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface SectionProps {
  /** Content to render while data is loading */
  fallback?: ReactNode;
  /** Error fallback (defaults to inline error message with retry) */
  errorFallback?: ReactNode;
  children: ReactNode;
}

/**
 * Section — progressive Suspense boundary with error recovery.
 *
 * Wrap any data-dependent section in <Section> so it renders independently
 * from sibling sections. A slow query in one section won't delay others.
 *
 * Usage:
 *   <Section fallback={<Skeleton className="h-32 w-full" />}>
 *     <MyDataComponent />   ← must use useSuspenseQuery internally
 *   </Section>
 */
export function Section({ fallback, errorFallback, children }: SectionProps) {
  const skeletonFallback = fallback ?? <Skeleton className="h-32 w-full rounded-lg" />;
  return (
    <SectionErrorBoundary fallback={errorFallback}>
      <Suspense fallback={skeletonFallback}>
        {children}
      </Suspense>
    </SectionErrorBoundary>
  );
}
