/**
 * How many decimals a plain number needs to stay meaningful.
 *
 * A fixed 2 digits erases small intermediate values: a "Monthly Interest Rate
 * (decimal)" field holding 0.00375 rendered as "0", which reads as a broken
 * calculation. Scale the precision to the magnitude instead, and cap it so a
 * float artefact doesn't print 17 digits.
 *
 * Kept out of FormRenderer so callers that only format numbers (the copilot
 * response parser) don't pull the form renderer — and its map — into their chunk.
 */
export function fractionDigitsFor(v: number): number {
  const abs = Math.abs(v);
  if (abs === 0 || abs >= 1) return 2;
  // 0.5 -> 2, 0.05 -> 3, 0.00375 -> 5 (two significant digits, floor of 2).
  return Math.min(8, Math.max(2, Math.ceil(-Math.log10(abs)) + 2));
}
