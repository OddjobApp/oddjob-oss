import React from 'react';
import { KeyRound, ShieldCheck, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { imageClickCoordinates, type ImageClick } from '@/lib/image-click-coordinates';

export interface CaptchaChallengeViewProps {
  isOtpChallenge: boolean;
  captchaScreenshot?: string | null;
  viewerUrl?: string | null;
  isZoomed: boolean;
  setIsZoomed: (zoomed: boolean) => void;
  clickCoordinates: ImageClick | null;
  setClickCoordinates: (coords: ImageClick | null) => void;
  captchaSolution: string;
  setCaptchaSolution: (sol: string) => void;
  isSubmitting: boolean;
}

export function CaptchaChallengeView({
  isOtpChallenge,
  captchaScreenshot,
  viewerUrl,
  isZoomed,
  setIsZoomed,
  clickCoordinates,
  setClickCoordinates,
  captchaSolution,
  setCaptchaSolution,
  isSubmitting,
}: CaptchaChallengeViewProps) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" data-testid="captcha-solution-box">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
          {isOtpChallenge ? <KeyRound className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {isOtpChallenge ? 'Enter the verification code to continue' : 'Solve the CAPTCHA to continue'}
        </span>
        <div className="flex items-center gap-2">
          {captchaScreenshot && (
            <button
              type="button"
              onClick={() => { setIsZoomed(!isZoomed); setClickCoordinates(null); }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="toggle-zoom-button"
              title={isZoomed ? "Reset zoom" : "Zoom challenge"}
            >
              {isZoomed ? <ZoomOut className="h-3 w-3" /> : <ZoomIn className="h-3 w-3" />}
              <span>{isZoomed ? 'Fit' : 'Zoom'}</span>
            </button>
          )}
          {viewerUrl && (
            <a
              href={viewerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Open live desktop
            </a>
          )}
        </div>
      </div>
      {captchaScreenshot && (
        <div className="flex flex-col items-center p-2 bg-background/80 rounded border border-border/60 overflow-hidden">
          <div className="relative inline-block overflow-hidden rounded border border-border/40 cursor-crosshair">
            <img
              src={captchaScreenshot}
              alt="CAPTCHA Challenge"
              onClick={(e) => {
                const hit = imageClickCoordinates(e);
                if (hit) setClickCoordinates(hit);
              }}
              className={cn(
                'transition-all duration-200 select-none',
                isZoomed ? 'max-h-[460px] w-auto' : 'max-h-40 object-contain'
              )}
              data-testid="captcha-challenge-image"
            />
            {clickCoordinates && (
              <div
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                style={{ left: clickCoordinates.display.x, top: clickCoordinates.display.y }}
              >
                <span className="relative flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500/80 border border-white items-center justify-center text-[8px] text-white font-bold">
                    •
                  </span>
                </span>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between w-full text-[11px] text-muted-foreground px-1">
            <span>{clickCoordinates ? `Target: (${clickCoordinates.x}px, ${clickCoordinates.y}px)` : 'Click image to mark target position if required'}</span>
            {clickCoordinates && (
              <button
                type="button"
                onClick={() => setClickCoordinates(null)}
                className="text-destructive hover:underline text-[11px]"
                data-testid="clear-coordinates-button"
              >
                Clear pin
              </button>
            )}
          </div>
        </div>
      )}
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>{isOtpChallenge ? 'Enter verification code / OTP:' : 'Enter solution text or confirmation code:'}</span>
        <input
          type="text"
          value={captchaSolution}
          onChange={(e) => setCaptchaSolution(e.target.value)}
          placeholder={isOtpChallenge ? 'e.g. 6-digit authenticator code (e.g. 492019)...' : 'e.g. 7XG4K or SMS verification code...'}
          disabled={isSubmitting}
          className="w-full rounded border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid="captcha-solution-input"
        />
      </label>
    </div>
  );
}
