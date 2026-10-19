/**
 * Capital Purchase Sandbox / amortization engine (PRD §4.3).
 *
 * Pure financial math (no store dependency for the core calc): given a financed
 * purchase, produce the amortization schedule, total interest, and the
 * opportunity cost of the down payment had it been invested instead.
 */

export interface AmortizationInput {
    principal: number;
    downPayment: number;
    annualRate: number; // e.g. 0.069 for 6.9% APR
    termMonths: number;
    opportunityRate?: number; // annual return if the down payment were invested (default 0.07)
}

export interface AmortizationRow {
    month: number;
    payment: number;
    interest: number;
    principalPaid: number;
    balance: number;
}

export interface AmortizationResult {
    financed: number;
    monthlyPayment: number;
    totalPaid: number;
    totalInterest: number;
    opportunityCostOfDownPayment: number;
    trueCost: number; // totalInterest + opportunity cost of the down payment
    schedule: AmortizationRow[];
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

export function simulateAmortization(input: AmortizationInput): AmortizationResult {
    const financed = Math.max(0, input.principal - input.downPayment);
    const n = Math.max(1, Math.round(input.termMonths));
    const r = input.annualRate / 12;
    const opportunityRate = input.opportunityRate ?? 0.07;

    const monthlyPayment = r === 0 ? financed / n : (financed * r) / (1 - Math.pow(1 + r, -n));

    const schedule: AmortizationRow[] = [];
    let balance = financed;
    let totalInterest = 0;
    for (let month = 1; month <= n; month++) {
        const interest = balance * r;
        let principalPaid = monthlyPayment - interest;
        if (month === n) principalPaid = balance; // clear rounding residue on final payment
        balance = Math.max(0, balance - principalPaid);
        totalInterest += interest;
        schedule.push({
            month,
            payment: round(interest + principalPaid),
            interest: round(interest),
            principalPaid: round(principalPaid),
            balance: round(balance),
        });
    }

    const opportunityCostOfDownPayment =
        input.downPayment * (Math.pow(1 + opportunityRate / 12, n) - 1);
    const totalPaid = financed + totalInterest;

    return {
        financed: round(financed),
        monthlyPayment: round(monthlyPayment),
        totalPaid: round(totalPaid),
        totalInterest: round(totalInterest),
        opportunityCostOfDownPayment: round(opportunityCostOfDownPayment),
        trueCost: round(totalInterest + opportunityCostOfDownPayment),
        schedule,
    };
}
