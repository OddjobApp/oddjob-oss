import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { useState } from 'react';

interface MaintenanceBannerProps {
  userRole?: string;
  onDismiss?: () => void;
}

export default function MaintenanceBanner({ userRole, onDismiss }: MaintenanceBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div className="bg-yellow-50 border-b border-yellow-200" data-testid="banner-maintenance">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-900">
                System Maintenance Mode Active
              </p>
              <p className="text-xs text-yellow-700 mt-0.5">
                Job executions are currently disabled. {userRole === 'admin' && 'Go to Settings to disable maintenance mode.'}
              </p>
            </div>
          </div>
          {userRole === 'admin' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-yellow-700 hover:text-yellow-900 hover:bg-yellow-100"
              data-testid="button-dismiss-maintenance-banner"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
