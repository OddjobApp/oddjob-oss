import React from 'react';
import { SignalStudioPod } from './SignalStudioPod';
import type { SignalStudioProps } from './types';
import { cn } from '@/lib/utils';

export function SignalStudio({
  organizationId = 1,
  initialView = 'overview',
  className,
  isFullScreen,
  onToggleFullScreen,
  isFocusMode,
  onToggleFocusMode,
  onClose,
}: SignalStudioProps) {
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const tabParam = searchParams?.get('tab') || searchParams?.get('view');
  const targetView = (tabParam && ['overview', 'spatial', 'signals', 'sources', 'rules', 'packs', 'filters'].includes(tabParam))
    ? tabParam
    : initialView;

  const mappedView =
    targetView === 'backbone' || targetView === 'subscriptions'
      ? 'rules'
      : (targetView as 'overview' | 'spatial' | 'signals' | 'sources' | 'rules' | 'packs');

  return (
    <div
      className={cn('h-full w-full overflow-hidden bg-background', className)}
      data-testid="signal-studio-main"
    >
      <SignalStudioPod
        organizationId={organizationId}
        initialView={mappedView}
        isFocusMode={isFocusMode}
        onToggleFocusMode={onToggleFocusMode}
        onClose={onClose}
      />
    </div>
  );
}

export default SignalStudio;
