/**
 * Push notifications for this browser.
 *
 * Unlike BrowserNotificationSettings (which only fires while an Oddjob tab is
 * open), this subscribes the browser with the push service, so approvals waiting
 * for you and missions you started still reach you when every tab is closed.
 * Each browser/device is subscribed separately.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Loader2, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  subscribed: boolean;
}

function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** VAPID public keys are URL-safe base64; PushManager wants the raw bytes. */
export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function PushNotificationsCard() {
  const { toast } = useToast();
  const supported = pushSupported();
  const [thisBrowser, setThisBrowser] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: config, isLoading, isError } = useQuery<PushConfig>({
    queryKey: ['/api/push/config'],
    queryFn: async () => (await apiRequest('GET', '/api/push/config')).json(),
  });

  useEffect(() => {
    if (!supported) return;
    currentSubscription().then((sub) => setThisBrowser(!!sub)).catch(() => setThisBrowser(false));
  }, [supported]);

  const enable = useCallback(async () => {
    if (!config?.publicKey) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast({
        title: 'Notifications are blocked',
        description: 'Allow notifications for this site in your browser settings, then try again.',
        variant: 'destructive',
      });
      return;
    }
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const options = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.publicKey) };
    let subscription: PushSubscription;
    try {
      subscription = await registration.pushManager.subscribe(options);
    } catch {
      // Subscribed earlier under a different server key: drop it and start over.
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      subscription = await registration.pushManager.subscribe(options);
    }
    await apiRequest('POST', '/api/push/subscriptions', subscription.toJSON());
    setThisBrowser(true);
    toast({ title: 'Push notifications on', description: 'This browser will be notified even when Oddjob is closed.' });
  }, [config?.publicKey, toast]);

  const disable = useCallback(async () => {
    const subscription = await currentSubscription();
    if (subscription) {
      await apiRequest('DELETE', '/api/push/subscriptions', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setThisBrowser(false);
    toast({ title: 'Push notifications off', description: 'This browser will no longer be notified.' });
  }, [toast]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await (on ? enable() : disable());
    } catch (err: any) {
      toast({ title: 'Could not change push notifications', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const res = await apiRequest('POST', '/api/push/test');
      const { delivered } = await res.json();
      toast({
        title: delivered > 0 ? 'Test sent' : 'Nothing was delivered',
        description: delivered > 0
          ? `Delivered to ${delivered} browser${delivered === 1 ? '' : 's'}.`
          : 'No subscribed browser accepted it. Turn push off and on again.',
        variant: delivered > 0 ? undefined : 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  let status: string | null = null;
  if (!supported) status = "This browser doesn't support push notifications.";
  else if (isLoading) status = null;
  // An unanswered check is not the same as a server without keys: saying
  // "not configured" while the server was restarting was simply wrong.
  else if (isError) status = "Couldn't check whether this server sends push notifications. Reload to try again.";
  else if (!config?.enabled) status = 'Push notifications are not configured on this server (VAPID keys are unset).';

  const available = supported && !!config?.enabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" />
          Push notifications
        </CardTitle>
        <CardDescription>
          Get notified when an approval is waiting for you or a mission you started completes, even when no Oddjob tab is open.
          Each browser and device is turned on separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
        <div className="flex items-center justify-between">
          <Label htmlFor="push-this-browser" className="text-sm font-medium">
            Notify this browser
          </Label>
          <div className="flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Switch
              id="push-this-browser"
              checked={!!thisBrowser}
              disabled={!available || busy || thisBrowser === null}
              onCheckedChange={toggle}
            />
          </div>
        </div>
        {available && thisBrowser && (
          <Button variant="outline" size="sm" onClick={sendTest} disabled={busy}>
            <Send className="mr-2 h-4 w-4" />
            Send a test notification
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
