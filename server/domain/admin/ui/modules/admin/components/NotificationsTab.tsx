/**
 * Notifications Tab
 * Notification preferences configuration
 */

import React from "react";
import { NotificationPreferences, type NotificationPreference } from "@domain-ui/core/ui/components/settings/NotificationPreferences";
import { BrowserNotificationSettings, type BrowserNotificationPreferences } from "@domain-ui/core/ui/components/settings/BrowserNotificationSettings";
import { PushNotificationsCard } from "@domain-ui/core/ui/components/settings/PushNotificationsCard";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export interface NotificationsTabProps {
  emailEnabled: boolean;
  slackEnabled: boolean;
}

export function NotificationsTab({ emailEnabled, slackEnabled }: NotificationsTabProps) {
  const { toast } = useToast();

  // Fetch persisted browser notification preferences
  const { data: browserNotifPrefs } = useQuery({
    queryKey: ['/api/settings/browser-notifications'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/settings/browser-notifications');
      return res.json() as Promise<BrowserNotificationPreferences>;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Notification Preferences</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure how you receive notifications about system events</p>
        </div>
      </div>

      <NotificationPreferences
        emailEnabled={emailEnabled}
        slackEnabled={slackEnabled}
        onSave={async (preferences: NotificationPreference[]) => {
          await apiRequest('PUT', '/api/settings/notifications', { preferences });
          toast({
            title: 'Notification preferences saved',
            description: 'Your notification preferences have been updated.',
          });
        }}
      />

      <PushNotificationsCard />

      <BrowserNotificationSettings
        initialPreferences={browserNotifPrefs}
        onSave={async (preferences: BrowserNotificationPreferences) => {
          await apiRequest('PUT', '/api/settings/browser-notifications', preferences);
        }}
      />
    </div>
  );
}

