/**
 * "Job Type Governance" section of the admin Settings page.
 *
 * Extracted verbatim from Settings.tsx, which held thirteen of these cards
 * inline in a single 1,266-line component. The markup is unchanged; the four
 * values it used to close over from the parent's ~30 useState hooks are now an
 * explicit prop contract.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Shield } from 'lucide-react';
import { jobTypes } from "@shared/schema/jobs/types";

interface JobTypeGovernanceCardProps {
  allowedJobTypes: string[];
  onChange: (update: (prev: string[]) => string[]) => void;
  onSave: () => void;
  isLoading: boolean;
  isSaving: boolean;
}

export function JobTypeGovernanceCard({
  allowedJobTypes,
  onChange,
  onSave,
  isLoading,
  isSaving,
}: JobTypeGovernanceCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <CardTitle>Job Type Governance</CardTitle>
        </div>
        <CardDescription>Control which job types are available for creation and editing in your organization.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobTypes.map((type) => (
            <div key={type} className="flex items-center space-x-3 p-3 border rounded-md">
              <Switch
                id={`job-type-${type}`}
                checked={allowedJobTypes.includes(type)}
                onCheckedChange={(checked) => {
                  onChange(prev =>
                    checked ? [...prev, type] : prev.filter(t => t !== type)
                  );
                }}
              />
              <Label htmlFor={`job-type-${type}`} className="font-medium cursor-pointer capitalize">
                {type.replace(/_/g, ' ')}
              </Label>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4 gap-2">
          <div className="space-x-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(() => [...jobTypes])}
            >
              Enable All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(() => [])}
            >
              Disable All
            </Button>
          </div>
          <Button
            type="button"
            onClick={() => onSave()}
            disabled={isLoading || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
