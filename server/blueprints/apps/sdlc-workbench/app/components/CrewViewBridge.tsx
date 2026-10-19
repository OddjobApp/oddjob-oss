"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Reports navigation only. This is not evidence that an operation completed. */
export function CrewViewBridge() {
  const pathname = usePathname();
  useEffect(() => {
    const roomKey = new URLSearchParams(window.location.search).get("crewRoom");
    if (!roomKey || window.parent === window) return;
    window.parent.postMessage({ source: "crew-app-view", version: 1, roomKey, pathname }, window.location.origin);
  }, [pathname]);
  return null;
}
