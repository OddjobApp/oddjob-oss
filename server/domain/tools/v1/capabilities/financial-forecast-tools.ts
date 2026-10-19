import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import { requireToolOrgId } from './org-context.js';
import { calculateFinancialForecast, forecastSchema } from '@domain/finance/core/crew-forecast.js';
import { getQuickBooksClient } from '@domain/integrations/quickbooks/service.js';
import { financeRolesService } from '@domain/projects/core/finance-roles.service.js';
import { decimalUnits, currencyScale, unitsDecimal } from '@shared/financial-money.js';
import { deriveCashflowPrediction } from '@domain/finance/core/forecast-prediction.bridge.js';
import { DATA_TOOLS } from './data.js';

export const FINANCIAL_FORECAST_TOOLS:Record<string,ToolDefinition>={
  calculate_dataset_prediction:{name:'calculate_dataset_prediction',label:'Analyze forecast dataset with prediction engine',group:'Accounting',idempotency:'read-safe',riskLevel:'low',
    description:'Run existing Hidden State and Prediction Pods against an organization-scoped dataset. Returns predicate/model assessments, not a monetary forecast. Use with financial forecasting to inspect supported prediction evidence; never infer confidence bands or currency totals from predicate results.',parameters:z.object({datasetId:z.number().int().positive(),limit:z.number().int().min(1).max(100).default(20)}),execute:async(p,c)=>{requireToolOrgId(c);const result=await DATA_TOOLS.run_prediction.execute({datasetId:p.datasetId,limit:p.limit},c);if(typeof result==='string'&&/^(?:Prediction Error|Error):/i.test(result))throw new Error(result);return result;}},
  calculate_financial_forecast:{name:'calculate_financial_forecast',label:'Calculate financial forecast',group:'Accounting',idempotency:'read-safe',riskLevel:'low',
    description:'Execute financial forecasts: growth, linear trend, seasonality, rolling cash-flow schedules, scenarios and reconciled simplified three statements. Read source inputs first; supply verified currency, consistent period units and complete assumptions. Returns a forecast card. No invented inputs or confidence bands.',parameters:forecastSchema,
    execute:async(p,c)=>{requireToolOrgId(c);return JSON.stringify(calculateFinancialForecast(p));}},
  quickbooks_forecast_cashflow:{name:'quickbooks_forecast_cashflow',label:'Forecast QuickBooks cash flow',group:'Accounting',idempotency:'read-safe',riskLevel:'low',
    description:'Read all scoped QuickBooks bank accounts, unpaid invoices and bills and project a 13-week scheduled cash-flow baseline. A projection of existing dated commitments, not a revenue prediction. Returns assumptions, omitted items and separate currencies. Use for our projected cashflow; do not search knowledge instead.',
    parameters:z.object({horizonWeeks:z.number().int().min(1).max(52).default(13)}),execute:async(p,c)=>{
      requireToolOrgId(c);for(const entity of ['Account','Invoice','Bill'])await financeRolesService.assertCan(c,entity,'read');
      const {client}=await getQuickBooksClient(requireToolOrgId(c),c.projectId);const home=(await client.company())?.HomeCurrency?.value;if(!home)throw new Error('Company currency is unverified');
      const groups=new Map<string,{opening:bigint,openingKnown:boolean,inflow:bigint[],outflow:bigint[]}>();const warnings:string[]=[];const now=new Date(),start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),week=7*86400000;let count=0,bankAccounts=0;
      const group=(currency:string)=>{currencyScale(currency);let g=groups.get(currency);if(!g){g={opening:0n,openingKnown:false,inflow:Array(p.horizonWeeks).fill(0n),outflow:Array(p.horizonWeeks).fill(0n)};groups.set(currency,g);}return g;};
      group(home);
      for(const entity of ['Account','Invoice','Bill'] as const){let cursor=1;const seen=new Set<string>();let done=false;
        for(let page=0;page<100;page++){const result=await client.list(entity,{start:cursor,limit:100,...(entity==='Account'?{}:{outstanding:true})});
          for(const r of result.items){if(!r.Id||seen.has(String(r.Id)))throw new Error('Incomplete or duplicate forecast source records');seen.add(String(r.Id));count++;
            if(entity==='Account'){if(r.AccountType!=='Bank')continue;bankAccounts++;const currency=r.CurrencyRef?.value??home;const g=group(currency);g.opening+=decimalUnits(r.CurrentBalance,currencyScale(currency));g.openingKnown=true;continue;}
            const currency=r.CurrencyRef?.value??home,g=group(currency),balance=decimalUnits(r.Balance,currencyScale(currency));if(balance<0n)throw new Error('Negative outstanding balance requires explicit credit treatment');if(balance===0n)continue;
            const due=String(r.DueDate??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due){warnings.push(`${entity} ${r.Id}: missing or invalid due date; excluded`);continue;}
            const index=Math.floor((Date.parse(due)-start)/week);if(index<0){warnings.push(`${entity} ${r.Id}: overdue balance excluded; collection/payment date required`);continue;}if(index>=p.horizonWeeks)continue;(entity==='Invoice'?g.inflow:g.outflow)[index]+=balance;
          }
          if(result.nextStart==null){done=true;break;}if(result.nextStart<=cursor)throw new Error('Forecast source pagination did not advance');cursor=result.nextStart;
        }if(!done)throw new Error('Forecast source exceeds 10,000 records');
      }
      if(!bankAccounts)throw new Error('No bank accounts supply a verified opening cash balance');
      for(const [currency,g] of groups)if(!g.openingKnown){if(g.inflow.some(v=>v!==0n)||g.outflow.some(v=>v!==0n))throw new Error(`A verified ${currency} opening bank balance is required; no zero balance was assumed`);groups.delete(currency);}
      const forecasts=[...groups].map(([currency,g])=>{const scale=currencyScale(currency);const f=calculateFinancialForecast({method:'cashflow',currency,periods:p.horizonWeeks,periodUnit:'week',openingCash:unitsDecimal(g.opening,scale),inflows:g.inflow.map(v=>unitsDecimal(v,scale)),outflows:g.outflow.map(v=>unitsDecimal(v,scale))});
        const safe=(v:unknown)=>{const u=decimalUnits(v,scale);if(u>BigInt(Number.MAX_SAFE_INTEGER)||u< -BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Forecast exceeds prediction engine numeric precision');return Number(u)/10**scale;};
        const weekly=f.series.map((r,i)=>({period:new Date(start+i*week).toISOString().slice(0,10),inflow:safe(r.inflow),outflow:safe(r.outflow),net:safe(r.inflow)-safe(r.outflow),running_balance:safe(r.value)}));const minimum=weekly.reduce((a,b)=>b.running_balance<a.running_balance?b:a);
        const prediction=deriveCashflowPrediction({forecast_id:'preview',kind:'rolling_13week',generated_at:now.toISOString(),horizon_weeks:p.horizonWeeks,opening_balance:safe(unitsDecimal(g.opening,scale)),projected_min_balance:minimum.running_balance,min_balance_period:minimum.period,shortfall_flag:minimum.running_balance<0,weekly_series:weekly,assumptions:{safety_floor:0}},{softInflowShare:1});
        return {...f,series:f.series.map((row,i)=>({...row,periodStart:new Date(start+i*week).toISOString().slice(0,10),periodEnd:new Date(start+(i+1)*week-86400000).toISOString().slice(0,10)})),
          coverage:{kind:'scheduled_commitments',completeness:'partial',modeled:['Bank balances','Dated unpaid invoices','Dated unpaid bills'],
            excluded:['Future sales','Payroll','Tax','Subscriptions','Financing','Overdue commitments without settlement dates',...warnings],confidence:'heuristic_uncalibrated'},
          predictionAssessment:prediction,assumptions:[...f.assumptions,'Existing finance prediction bridge assesses scheduled shortfall risk using soft receivables. Its confidence is heuristic and uncalibrated for this preview; omitted commitments limit interpretation. No prediction or calibration record is persisted.']};});
      return JSON.stringify({type:'financial_forecast',source:'QuickBooks',asOf:new Date(start).toISOString().slice(0,10),matchedRecords:count,complete:true,forecasts,warnings,assumptions:['Bank CurrentBalance opening balances; dated unpaid Invoice/Bill Balance schedules.','Assumes settlement on due dates; future sales, payroll, tax, subscriptions, financing and overdue commitments are not modeled. Not a complete liquidity prediction.']});
    }},
};
