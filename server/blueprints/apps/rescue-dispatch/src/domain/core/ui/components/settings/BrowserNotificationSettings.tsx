/**
 * BrowserNotificationSettings Component
 *
 * Settings UI for configuring browser push notifications for decision approvals.
 * Integrates with the BrowserNotificationService to request permissions and
 * manage risk-level filtering.
 *
 * Requirements: 6.1, 6.5, 6.6, 6.7
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Bell, AlertTriangle, Save } from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { BrowserNotificationService, type BrowserNotificationConfig } from '@domain-ui/core/ui/services/browser-notification.service';

// ─── Types ──────────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

export interface BrowserNotificationPreferences {
  browserNotificationsEnabled: boolean;
  browserNotificationRiskLevels: RiskLevel[];
}

export interface BrowserNotificationSettingsProps {
  /** Callback when preferences are saved */
  onSave?: (preferences: BrowserNotificationPreferences) => Promise<void>;
  /** Initial preferences loaded from server */
  initialPreferences?: BrowserNotificationPreferences;
  /** Additional className */
  className?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PREFERENCES: BrowserNotificationPreferences = {
  browserNotificationsEnabled: false,
  browserNotificationRiskLevels: ['high'],
};

const RISK_LEVEL_CONFIG: { id: RiskLevel; label: string; description: string }[] = [
  { id: 'high', label: 'High Risk', description: 'Critical operations like production deployments' },
  { id: 'medium', label: 'Medium Risk', description: 'Moderate operations like database changes' },
  { id: 'low', label: 'Low Risk', description: 'Safe operations like file reads' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function BrowserNotificationSettings({
  onSave,
  initialPreferences,
  className,
}: BrowserNotificationSettingsProps) {
  const { toast } = useToast();

  // Service instance (singleton per component lifecycle)
  const notificationService = useMemo(() => new BrowserNotificationService(), []);

  // Local state
  const [enabled, setEnabled] = useState(
    initialPreferences?.browserNotificationsEnabled ?? DEFAULT_PREFERENCES.browserNotificationsEnabled
  );
  const [riskLevels, setRiskLevels] = useState<RiskLevel[]>(
    initialPreferences?.browserNotificationRiskLevels ?? DEFAULT_PREFERENCES.browserNotificationRiskLevels
  );
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>(
    notificationService.getConfig().permissionState
  );
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync initial preferences when they load
  useEffect(() => {
    if (initialPreferences) {
      setEnabled(initialPreferences.browserNotificationsEnabled);
      setRiskLevels(initialPreferences.browserNotificationRiskLevels);
    }
  }, [initialPreferences]);

  // Cleanup service on unmount
  useEffect(() => {
    return () => {
      notificationService.dispose();
    };
  }, [notificationService]);

  // Derived state
  const isApiSupported = notificationService.isNotificationApiSupported();
  const isPermissionDenied = permissionState === 'denied';
  const isToggleDisabled = !isApiSupported || isPermissionDenied;

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleToggleChange = useCallback(async (checked: boolean) => {
    if (checked) {
      // Request permission when enabling — Requirement 6.1
      const result = await notificationService.requestPermission();
      setPermissionState(result);

      if (result === 'granted') {
        setEnabled(true);
        notificationService.setConfig({ enabled: true, riskLevels });
        setHasChanges(true);
      } else if (result === 'denied') {
        // Permission denied — disable toggle, don't prompt again — Requirement 6.5
        setEnabled(false);
        notificationService.setConfig({ enabled: false });
        toast({
          title: 'Permission denied',
          description: 'Browser notifications were blocked. You can re-enable in browser settings.',
          variant: 'destructive',
        });
      }
      // 'default' (dismissed) — leave toggle off
    } else {
      // Disabling notifications
      setEnabled(false);
      notificationService.setConfig({ enabled: false });
      setHasChanges(true);
    }
  }, [notificationService, riskLevels, toast]);

  const handleRiskLevelToggle = useCallback((level: RiskLevel) => {
    setRiskLevels((prev) => {
      const newLevels = prev.includes(level)
        ? prev.filter((l) => l !== level)
        : [...prev, level];
      // Don't allow empty selection — keep at least one
      if (newLevels.length === 0) return prev;
      notificationService.setConfig({ riskLevels: newLevels });
      return newLevels;
    });
    setHasChanges(true);
  }, [notificationService]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setIsSaving(true);
    try {
      await onSave({
        browserNotificationsEnabled: enabled,
        browserNotificationRiskLevels: riskLevels,
      });
      setHasChanges(false);
      toast({
        title: 'Browser notification preferences saved',
        description: 'Your browser notification settings have been updated.',
      });
    } catch {
      toast({
        title: 'Error saving preferences',
        description: 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [onSave, enabled, riskLevels, toast]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Card className={className} data-testid="browser-notification-settings">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Browser Notifications
            </CardTitle>
            <CardDescription>
              Receive native browser notifications for pending approval decisions when Oddjob is not in focus
            </CardDescription>
          </div>
          {onSave && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              data-testid="button-save-browser-notifications"
            >
              <Save className="h-4 w-4 mr-1" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Unsupported browser message — Requirement 6.7 */}
        {!isApiSupported && (
          <div
            className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
            role="alert"
            data-testid="browser-notifications-unsupported"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>Browser does not support notifications</span>
          </div>
        )}

        {/* Permission denied message — Requirement 6.5 */}
        {isApiSupported && isPermissionDenied && (
          <div
            className="flex items-center gap-2 p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm"
            role="alert"
            data-testid="browser-notifications-denied"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Notification permission was denied. To re-enable, update your browser&apos;s site settings for this page.
            </span>
          </div>
        )}

        {/* Enable/disable toggle — Requirement 6.1 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label
              htmlFor="browser-notifications-enabled"
              className={isToggleDisabled ? 'text-muted-foreground' : ''}
            >
              Enable Browser Notifications
            </Label>
            <p className="text-sm text-muted-foreground">
              {isToggleDisabled
                ? isPermissionDenied
                  ? 'Permission was denied — notifications cannot be sent'
                  : 'Your browser does not support the Notification API'
                : 'Get notified about pending approval decisions even when this tab is not focused'}
            </p>
          </div>
          <Switch
            id="browser-notifications-enabled"
            checked={enabled}
            onCheckedChange={handleToggleChange}
            disabled={isToggleDisabled}
            aria-label="Enable browser notifications"
            data-testid="switch-browser-notifications"
          />
        </div>

        {/* Risk level configuration — Requirement 6.6 */}
        {enabled && isApiSupported && !isPermissionDenied && (
          <>
            <Separator />
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Risk Level Triggers</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose which decision risk levels trigger a browser notification
                </p>
              </div>
              <div className="space-y-3">
                {RISK_LEVEL_CONFIG.map((level) => (
                  <div key={level.id} className="flex items-start space-x-3">
                    <Checkbox
                      id={`risk-level-${level.id}`}
                      checked={riskLevels.includes(level.id)}
                      onCheckedChange={() => handleRiskLevelToggle(level.id)}
                      aria-label={`Notify for ${level.label} decisions`}
                      data-testid={`checkbox-risk-${level.id}`}
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor={`risk-level-${level.id}`}
                        className="font-medium cursor-pointer text-sm"
                      >
                        {level.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{level.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default BrowserNotificationSettings;
