import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';

const hasCookie = (name: string) => document.cookie.split(';').some(value => value.trim() === `${name}=true`);
const gpcEnabled = () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
function saveCookie(name: string) {
  document.cookie = `${name}=true; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  return hasCookie(name);
}
const action = 'min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Dismissal is independent of the tracking choice and never grants consent. */
export function PrivacyBanner() {
  const [open, setOpen] = useState(() => !hasCookie('oj_privacy_notice_dismissed'));
  const [optedOut, setOptedOut] = useState(() => hasCookie('oj_opt_out') || gpcEnabled());
  const [error, setError] = useState('');
  const [location] = useLocation();
  const isChatRoom = location.startsWith('/workspace/chat') || location.startsWith('/chat');

  useEffect(() => {
    if (gpcEnabled()) saveCookie('oj_opt_out');
  }, []);

  function optOut() {
    if (!saveCookie('oj_opt_out')) {
      setError('Your browser could not save this preference. Enable cookies for this site or turn on Global Privacy Control in your browser.');
      return;
    }
    setOptedOut(true);
    setError('');
    window.dispatchEvent(new Event('oddjob:privacy-change'));
  }

  const content = open ? (
    <aside
      aria-label="Cookie and privacy choices"
      className="fixed bottom-0 inset-x-0 z-chrome border-t border-border bg-card/95 text-foreground backdrop-blur-md shadow-2xl transition-all"
    >
      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6 sm:px-8">
        <h2 className="text-lg font-semibold">Your privacy choices</h2>
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
          Essential cookies support sign-in and security. You can opt out of optional tracking and the sale or sharing of personal information. Dismissing this notice does not change your preference.
        </p>
        <p className="text-sm leading-6">
          <a className="underline underline-offset-4" href="/privacy">Privacy Policy</a>
          <span aria-hidden="true"> · </span>
          <a className="underline underline-offset-4" href="/terms">Terms of Service</a>
        </p>
        <p role="status" className="text-sm">
          {optedOut
            ? (gpcEnabled()
                ? 'Global Privacy Control is enabled. Your opt-out is active.'
                : 'Your tracking opt-out is saved for this browser.')
            : 'Choose whether to opt out below. No account is required.'}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={`${action} bg-primary text-primary-foreground disabled:opacity-70`}
            onClick={optOut}
            disabled={optedOut}
          >
            {optedOut ? 'Opt-out active' : 'Do Not Sell or Share My Personal Information'}
          </button>
          <button
            type="button"
            className={action}
            onClick={() => {
              saveCookie('oj_privacy_notice_dismissed');
              setOpen(false);
            }}
          >
            Dismiss notice
          </button>
        </div>
      </div>
    </aside>
  ) : isChatRoom ? null : (
    <aside
      aria-label="Cookie and privacy choices"
      className="fixed bottom-3 right-3 z-chrome"
    >
      <button
        type="button"
        className={`${action} bg-card/90 text-foreground border-border shadow-md backdrop-blur-sm underline underline-offset-4 text-xs h-9 min-h-0 py-1.5 px-3`}
        onClick={() => setOpen(true)}
      >
        Do Not Sell or Share My Personal Information
      </button>
    </aside>
  );

  if (typeof document === 'undefined' || !content) return null;
  return createPortal(content, document.body);
}
