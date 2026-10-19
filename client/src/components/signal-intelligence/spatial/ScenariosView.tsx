import { ScenarioSandbox } from '../ScenarioSandbox';

/**
 * ScenariosView — Wrapper that renders ScenarioSandbox inline as a first-class
 * tabbed view (not in a modal dialog).
 *
 * The surrounding `role="tabpanel"` with `id` and `aria-labelledby` attributes
 * is provided by ViewContainer, so this component focuses solely on rendering
 * the sandbox content.
 *
 * Requirements: 3.5
 */

export interface ScenariosViewProps {
  organizationId: number;
}

export function ScenariosView({ organizationId }: ScenariosViewProps) {
  return (
    <div className="min-h-[400px]" data-testid="scenarios-view">
      <ScenarioSandbox organizationId={organizationId} />
    </div>
  );
}
