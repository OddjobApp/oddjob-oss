/** These sample datasets are explicitly denominated in USD. */
export function formatDemoUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " USD";
}
