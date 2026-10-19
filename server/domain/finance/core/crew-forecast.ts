import { z } from 'zod';
import { currencyScale, decimalUnits, unitsDecimal } from '@shared/financial-money.js';
const money = z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
export const forecastSchema = z.object({
  method: z.enum(['growth', 'linear_trend', 'seasonal', 'cashflow', 'three_statement']),
  currency: z.string().regex(/^[A-Z]{3}$/), periods: z.number().int().min(1).max(120),
  periodUnit: z.enum(['week', 'month', 'quarter', 'year']),
  history: z.array(money).max(1000).optional(), growthRates: z.array(z.number().finite().min(-1).max(10)).max(120).optional(),
  seasonLength: z.number().int().min(2).max(52).optional(), openingCash: money.optional(),
  inflows: z.array(money).max(120).optional(), outflows: z.array(money).max(120).optional(),
  scenarios: z.array(z.object({name:z.string().min(1).max(80), recurringNet:money})).max(10).optional(),
  opening: z.object({cash:money,ar:money,inventory:money,ppe:money,ap:money,debt:money,equity:money,revenue:money}).optional(),
  drivers: z.object({cogsRate:z.number().min(0).max(1),opexRate:z.number().min(0).max(1),taxRate:z.number().min(0).max(1),capexRate:z.number().min(0).max(1),depreciationRate:z.number().min(0).max(1),interestRate:z.number().min(0).max(1),arDays:z.number().nonnegative(),inventoryDays:z.number().nonnegative(),apDays:z.number().nonnegative(),periodDays:z.number().positive()}).optional(),
});
export function calculateFinancialForecast(raw: unknown) {
  const p=forecastSchema.parse(raw), scale=currencyScale(p.currency);
  const units=(v:unknown)=>decimalUnits(v,scale), display=(v:bigint)=>unitsDecimal(v,scale);
  const num=(v:unknown)=>{const u=units(v); if(u>BigInt(Number.MAX_SAFE_INTEGER)||u< -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Forecast exceeds safe numeric precision'); return Number(u)/10**scale;};
  const rounded=(v:number)=>{if(!Number.isFinite(v)) throw new Error('Non-finite forecast'); return units(v);};
  const rates=()=>{if(p.growthRates?.length!==p.periods) throw new Error('One explicit growth rate per forecast period is required');return p.growthRates;};
  const series:Array<Record<string, string|number>>=[];
  const assumptions:string[]=['Deterministic scenario projection; no fitted confidence interval.'];
  if(p.method==='cashflow') {
    if(p.openingCash===undefined || p.inflows?.length!==p.periods || p.outflows?.length!==p.periods) throw new Error('Opening cash and complete inflow/outflow arrays are required');
    let balance=units(p.openingCash);
    for(let i=0;i<p.periods;i++){const inflow=units(p.inflows[i]),outflow=units(p.outflows[i]);if(inflow<0n||outflow<0n)throw new Error('Inflow/outflow schedules must be non-negative');balance+=inflow-outflow;series.push({period:i+1,inflow:display(inflow),outflow:display(outflow),value:display(balance)});}
    assumptions.push('Opening cash + cumulative inflows − cumulative outflows. Negative balances are retained.');
  } else if(p.method==='three_statement') {
    if(!p.opening||!p.drivers)throw new Error('Complete opening balance sheet and explicit drivers are required');
    const o=p.opening,d=p.drivers,g=rates();
    let cash=units(o.cash),ar=units(o.ar),inv=units(o.inventory),ppe=units(o.ppe),ap=units(o.ap),debt=units(o.debt),equity=units(o.equity),revenue=num(o.revenue);
    if(cash+ar+inv+ppe!==ap+debt+equity)throw new Error('Opening balance sheet does not balance');
    for(let i=0;i<p.periods;i++) {
      revenue=num(display(rounded(revenue*(1+g[i]))));const rev=rounded(revenue),cogs=rounded(revenue*d.cogsRate),opex=rounded(revenue*d.opexRate),dep=rounded(num(display(ppe))*d.depreciationRate),interest=rounded(num(display(debt))*d.interestRate);
      if(dep>ppe)throw new Error('Depreciation exceeds fixed assets');
      const pretax=rev-cogs-opex-dep-interest,tax=pretax>0n?rounded(num(display(pretax))*d.taxRate):0n,net=pretax-tax;
      const nextAr=rounded(revenue*d.arDays/d.periodDays),nextInv=rounded(num(display(cogs))*d.inventoryDays/d.periodDays),nextAp=rounded(num(display(cogs))*d.apDays/d.periodDays),capex=rounded(revenue*d.capexRate);
      const operating=net+dep-(nextAr-ar)-(nextInv-inv)+(nextAp-ap),begin=cash;
      cash+=operating-capex; ppe+=capex-dep;ar=nextAr;inv=nextInv;ap=nextAp;equity+=net;
      if(cash+ar+inv+ppe!==ap+debt+equity||begin+operating-capex!==cash)throw new Error('Forecast reconciliation failed');
      series.push({period:i+1,value:display(cash),revenue:display(rev),netIncome:display(net),assets:display(cash+ar+inv+ppe),liabilitiesAndEquity:display(ap+debt+equity),operatingCashFlow:display(operating),capex:display(capex)});
    }
    assumptions.push('Simplified integrated model: fixed debt; no dividends, new financing or deferred tax; no tax benefit assumed on losses. All drivers are per period. Statements reconcile in minor units.');
  } else {
    if(!p.history?.length)throw new Error('Verified historical values are required');
    const h=p.history.map(num); let last=h[h.length-1];
    if(p.method==='growth'){const g=rates();for(let i=0;i<p.periods;i++){last=num(display(rounded(last*(1+g[i]))));series.push({period:i+1,value:display(rounded(last))});}assumptions.push('Last historical value compounded by explicit per-period growth rates.');}
    if(p.method==='linear_trend'){if(h.length<3)throw new Error('Linear trend requires at least three historical periods');const n=h.length,x=(n-1)/2,y=h.reduce((a,b)=>a+b,0)/n;let numerator=0,denominator=0;h.forEach((v,i)=>{numerator+=(i-x)*(v-y);denominator+=(i-x)**2;});const slope=numerator/denominator;for(let i=0;i<p.periods;i++)series.push({period:i+1,value:display(rounded(y+slope*(n+i-x)))});assumptions.push('Ordinary least-squares trend on equally spaced historical periods; negative projections retained.');}
    if(p.method==='seasonal'){const s=p.seasonLength;if(!s||h.length<2*s)throw new Error('Seasonal forecast requires a season length and at least two full seasons');for(let i=0;i<p.periods;i++){const phase=(h.length+i)%s,values=h.filter((_,j)=>j%s===phase);series.push({period:i+1,value:display(rounded(values.reduce((a,b)=>a+b,0)/values.length))});}assumptions.push('Seasonal phase averages; history must start at the documented seasonal origin.');}
  }
  if(p.scenarios?.length&&p.method==='three_statement')throw new Error('Integrated scenarios require rerunning the complete model with changed drivers');
  const scenarios=(p.scenarios??[]).map(s=>({name:s.name,series:series.map((row,i)=>({period:row.period,value:display(units(row.value)+units(s.recurringNet)*BigInt(p.method==='cashflow'?i+1:1))}))}));
  return {type:'financial_forecast',method:p.method,currency:p.currency,periodUnit:p.periodUnit,complete:true,series,scenarios,assumptions,
    coverage:{kind:'input_projection' as const,completeness:'partial' as const,modeled:['Explicit supplied inputs and selected model drivers'],
      excluded:['Unspecified commitments, drivers and external business activity'],confidence:'not_estimated' as const}};
}
