/**
 * "Financial Guardrails" section of the admin Settings page.
 * Monthly budget cap and reset day.
 *
 * Extracted from Settings.tsx with its JSX unchanged; the identifiers it used
 * to close over are now props of the same names.
 */
import type React from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { CreditCard } from 'lucide-react';

interface FinancialGuardrailsCardProps {
  budgetResetDay: number;
  handleSaveOrgSettings: () => void;
  monthlyBudgetUsd: string;
  orgSettingsLoading: boolean;
  saveOrgSettingsMutation: { isPending: boolean };
  setBudgetResetDay: React.Dispatch<React.SetStateAction<number>>;
  setMonthlyBudgetUsd: React.Dispatch<React.SetStateAction<string>>;
}

export function FinancialGuardrailsCard({
  budgetResetDay,
  handleSaveOrgSettings,
  monthlyBudgetUsd,
  orgSettingsLoading,
  saveOrgSettingsMutation,
  setBudgetResetDay,
  setMonthlyBudgetUsd,
}: FinancialGuardrailsCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-primary" />
                      <CardTitle>Financial Guardrails</CardTitle>
                    </div>
                    <CardDescription>Configure organizational budget limits and spending cycles</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="monthly-budget">Monthly Spend Limit (USD)</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            id="monthly-budget"
                            type="number"
                            className="pl-7"
                            value={monthlyBudgetUsd}
                            onChange={(e) => setMonthlyBudgetUsd(e.target.value)}
                            step="0.01"
                            min="0"
                            data-testid="input-monthly-budget"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Maximum allowed spend on AI services per month
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reset-day">Budget Reset Day</Label>
                        <Select 
                          value={budgetResetDay.toString()} 
                          onValueChange={(val) => setBudgetResetDay(parseInt(val, 10))}
                        >
                          <SelectTrigger id="reset-day" data-testid="select-reset-day">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {Array.from({ length: 28 }, (_, i) => (
                              <SelectItem key={i + 1} value={(i + 1).toString()}>
                                Day {i + 1} of every month
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          The day each month when current spend metrics are cleared
                        </p>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => handleSaveOrgSettings()}
                        disabled={orgSettingsLoading || saveOrgSettingsMutation.isPending}
                        data-testid="button-save-financial-settings"
                      >
                        {saveOrgSettingsMutation.isPending ? 'Saving...' : 'Update Budget Policy'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
  );
}
