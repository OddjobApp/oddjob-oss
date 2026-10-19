import React, { useMemo } from "react";
import { definitionFromLegacyForm } from "@shared/form-studio-legacy";
import { evaluateStudio } from "@shared/form-studio";
import { StudioRenderer } from "@/modules/forms/StudioRenderer";
import { FormStep } from "@/types/form-types";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { X } from "lucide-react";

/**
 * A backward-compatible adapter wrapping StudioRenderer for callers expecting
 * the legacy MultiStepFormWizard interface. The legacy component has been retired
 * in favor of the unified Form Studio runner with live validation, computed fields,
 * and review steps.
 */
export interface MultiStepFormWizardProps {
  steps: FormStep[];
  onComplete: (data: Record<string, any>) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  defaultValues?: Record<string, any>;
  className?: string;
}

export default function MultiStepFormWizard({
  steps,
  onComplete,
  onCancel,
  isSubmitting = false,
  defaultValues = {},
  className,
}: MultiStepFormWizardProps) {
  const { definition, initialInputs } = useMemo(() => {
    return definitionFromLegacyForm({ steps }, defaultValues);
  }, [steps, defaultValues]);

  return (
    <div className="space-y-4" data-testid="multi-step-form-wizard">
      {onCancel && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Cancel form"
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        </div>
      )}
      <StudioRenderer
        definition={definition}
        initialInputs={{ ...initialInputs, ...defaultValues }}
        audience="respondent"
        showPageTitles
        disabled={isSubmitting}
        className={className}
        onSubmit={async (inputs) => {
          const { values } = evaluateStudio(definition, inputs, true);
          await onComplete({ ...inputs, ...values });
        }}
      />
    </div>
  );
}
