import React from "react";
import ClientAppStudioPod, {
  type AppStudioMode,
  type AppStudioView,
  type AppStudioChange,
} from "@/modules/apps/AppStudioPod";

export interface AppStudioPodProps {
  mode: AppStudioMode;
  view?: AppStudioView;
  appId?: number;
  appName?: string;
  appSlug?: string;
  publicSlug?: string | null;
  status?: string | null;
  jobId?: string | null;
  jobStatus?: string | null;
  title?: string;
  requirements?: string | null;
  lastChange?: AppStudioChange | null;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * App Studio — App Forge and App Builder mounted beside a CREW room.
 *
 * Forge mode streams a running build as a compact progress row and promotes
 * itself into Builder mode in place once the run produces an app. Builder mode
 * carries the full interactive studio: preview, files, visual editor, wiring,
 * API contract, diagnostics and publish.
 */
export default function AppStudioPod(props: AppStudioPodProps) {
  return <ClientAppStudioPod {...props} />;
}
