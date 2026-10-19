import React, { useMemo } from "react";
import { evaluateStudio } from "@shared/form-studio";
import { definitionFromLegacyForm } from "@shared/form-studio-legacy";
import { StudioRenderer } from "./StudioRenderer";

/**
 * A drop-in for the older FormRenderer: the same props, rendered by the Form
 * Studio renderer and checked by the same strict engine the server runs.
 *
 * Callers that built a plain field list keep doing so. What changes is that a
 * required field is enforced the same way everywhere, and a calculator's formula
 * that cannot run says so instead of showing a blank. Computed values are sent
 * with the answers, as FormRenderer sent them.
 */

export interface StudioFormProps {
  schema: unknown;
  onSubmit: (data: Record<string, any>) => void | Promise<void>;
  submitLabel?: string;
  context?: Record<string, any>;
  disabled?: boolean;
  /** Accepted for FormRenderer compatibility; the renderer follows the page's theme. */
  themeConfig?: unknown;
  className?: string;
}

export function StudioForm({ schema, onSubmit, submitLabel = "Submit", context, disabled, className }: StudioFormProps) {
  const { definition, initialInputs, legacy } = useMemo(() => definitionFromLegacyForm(schema, context), [schema, context]);

  return (
    <StudioRenderer
      definition={definition}
      initialInputs={initialInputs}
      audience="respondent"
      submitLabel={submitLabel}
      showPageTitles={!legacy || definition.studio.pages.length > 1}
      disabled={disabled}
      className={className}
      onSubmit={async (inputs) => {
        const { values } = evaluateStudio(definition, inputs, true);
        await onSubmit({ ...inputs, ...values });
      }}
    />
  );
}

export default StudioForm;
