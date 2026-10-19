import { useEffect } from "react";
import { useLocation } from "wouter";
import { assistantLinkPath } from "@shared/assistant-link";

// The assistant lives in the core app, so going to /dashboard from here reloads the
// page. An in-page request to open the assistant was lost in that reload, leaving
// the plain dashboard; the link carries the view across it instead.
export default function AssistantWorkbench() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation(assistantLinkPath("updates"), { replace: true } as any);
  }, [setLocation]);

  return null;
}
