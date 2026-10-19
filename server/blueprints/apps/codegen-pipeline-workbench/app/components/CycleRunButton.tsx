"use client";

import { useEffect, useState } from "react";
import { isEmbedded, triggerCycle } from "../../lib/workbench-bridge";

export function CycleRunButton() {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(isEmbedded());
  }, []);

  if (!embedded) return null;

  return (
    <button
      type="button"
      onClick={() => triggerCycle("Codegen Pipeline Workbench requested a fresh cycle run", { source: "codegen-nav" })}
      className="ml-auto rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/20"
    >
      Run cycle
    </button>
  );
}
