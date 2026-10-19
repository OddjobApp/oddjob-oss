import React, { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import FormStudioPod, { type FormStudioTab } from "../FormStudioPod";

const TABS: FormStudioTab[] = ["sources", "structure", "logic", "results", "tests", "preview", "publish"];

/**
 * Form Studio on its own page, at the address the Form Builder used, so existing
 * links to /armory/forms/builder/:id open the form in the Studio.
 */
export default function FormStudioPage() {
  const [, params] = useRoute("/armory/forms/builder/:id?");
  const [, setLocation] = useLocation();
  const rawId = (params as { id?: string } | null)?.id;
  const formId = Number(rawId);

  useEffect(() => {
    // The builder's "new form" address: new forms start in the library's create dialog.
    if (!rawId) setLocation("/armory/forms?create=blank");
  }, [rawId, setLocation]);

  if (!rawId) return null;
  if (!Number.isInteger(formId) || formId <= 0) {
    return <p role="alert" className="p-6 text-sm text-destructive">“{rawId}” is not a form id.</p>;
  }

  const requestedTab = new URLSearchParams(window.location.search).get("tab") as FormStudioTab | null;
  return (
    <div className="flex h-[calc(100vh-4.5rem)] min-h-0 flex-col">
      <FormStudioPod
        key={formId}
        formId={formId}
        view={requestedTab && TABS.includes(requestedTab) ? requestedTab : undefined}
        onBack={() => setLocation("/armory/forms")}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
