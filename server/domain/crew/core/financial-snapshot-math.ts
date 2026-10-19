import {currencyScale,decimalUnits,unitsDecimal} from '@shared/financial-money.js';
import type {FinancialSnapshotView,FinancialSnapshotComparison,SnapshotMetric} from '@shared/financial-snapshots.js';
import {FINANCIAL_SERIES_FIELDS,type FinancialForecastCoverage} from '@shared/financial-workflow.js';
export function snapshotMetrics(items:any[]):{metrics:SnapshotMetric[];assumptions:string[];exclusions:string[];coverage:FinancialForecastCoverage[];predictionAssessments:NonNullable<FinancialSnapshotView['predictionAssessments']>} {
 const metrics:SnapshotMetric[]=[],assumptions:string[]=[],exclusions:string[]=[],coverage:FinancialForecastCoverage[]=[],predictionAssessments:NonNullable<FinancialSnapshotView['predictionAssessments']>=[];
 for(const item of items){if(item.calculation){const c=item.calculation;if(c.complete!==true)throw new Error('Incomplete calculation cannot be frozen');for(const t of c.totals){decimalUnits(t.value,currencyScale(t.currency));metrics.push({key:`total:${c.entity}:${c.field}:${c.filter}:${t.currency}`,label:`${c.entity} ${c.field} (${c.filter})`,currency:t.currency,value:t.value});}assumptions.push(`${c.matchedRecords} source records; ${c.filter}; SUM(${c.entity}.${c.field}) grouped by currency.`);}
 if(item.forecast){const f=item.forecast;if(f.complete===false)throw new Error('Incomplete forecast cannot be frozen');
  const freezeSeries=(series:any[],scenario?:string)=>{for(const r of series){
   for(const field of Object.keys(r))if(!['period','periodStart','periodEnd',...FINANCIAL_SERIES_FIELDS].includes(field))throw new Error(`Unsupported forecast field ${field}; snapshot coverage must be updated`);
   const periodSource=scenario===undefined?r:f.series.find((base:any)=>base.period===r.period)??r;
   for(const field of FINANCIAL_SERIES_FIELDS){if(r[field]===undefined)continue;const scale=currencyScale(f.currency),value=unitsDecimal(decimalUnits(r[field],scale),scale);
    metrics.push({key:`forecast:${f.method}:${f.periodUnit}:${r.period}:${f.currency}${field==='value'?'':`:${field}`}${scenario===undefined?'':`:scenario:${encodeURIComponent(scenario)}`}`,
      label:`${scenario===undefined?'':`${scenario} · `}${f.method.replaceAll('_',' ')} ${f.periodUnit} ${r.period}${field==='value'?'':` · ${field.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase()}`}`,currency:f.currency,value,periodStart:periodSource.periodStart,periodEnd:periodSource.periodEnd});}}};
  freezeSeries(f.series);for(const scenario of f.scenarios??[])freezeSeries(scenario.series,scenario.name);
  assumptions.push(...(f.assumptions??[]));exclusions.push(...(f.warnings??[]));
  if(f.coverage){coverage.push(f.coverage);exclusions.push(...f.coverage.excluded);}
  if(f.predictionAssessment){const p=f.predictionAssessment;if(!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1)throw new Error('Invalid prediction confidence');predictionAssessments.push({currency:f.currency,predicted_label:p.predicted_label,confidence:p.confidence,calibration:'heuristic_uncalibrated'});assumptions.push('Prediction confidence is heuristic and uncalibrated; it is not a probability or a fitted confidence interval.');}
 }}
 if(!metrics.length)throw new Error('No executed calculation or forecast values available');
 if(new Set(metrics.map(m=>m.key)).size!==metrics.length)throw new Error('Duplicate snapshot metrics require distinct source scope');
 assumptions.push('Frozen executed result and parameters; individual ledger rows are not included in this artifact.');
 return {metrics,assumptions:[...new Set(assumptions)],exclusions:[...new Set(exclusions)],coverage,predictionAssessments};
}
export function compareFinancialSnapshots(baseline:FinancialSnapshotView,current:FinancialSnapshotView,mappings:{baselineKey:string;currentKey:string}[]=[]):FinancialSnapshotComparison {
 if(baseline.status!=='saved'||current.status!=='saved')throw new Error('Only saved snapshots can be compared');
 if(baseline.organizationId!==current.organizationId)throw new Error('Snapshots belong to different organizations');
 if(baseline.workflow&&current.workflow&&baseline.workflow.projectId!==current.workflow.projectId)throw new Error('Snapshots belong to different projects');
 if(new Set(baseline.metrics.map(m=>m.key)).size!==baseline.metrics.length||new Set(current.metrics.map(m=>m.key)).size!==current.metrics.length)throw new Error('Duplicate snapshot metrics cannot be compared');
 const warnings:string[]=[];
 if(baseline.sourceTool!==current.sourceTool)warnings.push('Source tools differ; verify accounting basis.');
 if(JSON.stringify(baseline.assumptions)!==JSON.stringify(current.assumptions))warnings.push('Assumptions or source coverage differ.');
 if(JSON.stringify(baseline.sourceParameters)!==JSON.stringify(current.sourceParameters))warnings.push('Calculation inputs, filters or forecast drivers differ.');
 if(baseline.exclusions.length||current.exclusions.length)warnings.push('One or both snapshots exclude commitments; review coverage before interpretation.');
 if(baseline.metrics.some(m=>m.key.startsWith('forecast:'))&&baseline.sourceAsOf!==current.sourceAsOf)warnings.push('Forecasts have different source dates; rows compare relative horizons, not identical calendar periods.');
 const left=new Map(baseline.metrics.map(m=>[m.key,m])),right=new Map(current.metrics.map(m=>[m.key,m]));
 if(mappings.length){
  if(!baseline.periodStart||!baseline.periodEnd||baseline.periodStart!==current.periodStart||baseline.periodEnd!==current.periodEnd)throw new Error('Explicit forecast-to-actual mappings require matching reporting-period labels');
  if(new Set(mappings.map(m=>m.baselineKey)).size!==mappings.length||new Set(mappings.map(m=>m.currentKey)).size!==mappings.length)throw new Error('Metric mappings must be one-to-one');
  const replacements=mappings.map(m=>{const a=left.get(m.baselineKey),b=right.get(m.currentKey);if(!a||!b||a.currency!==b.currency)throw new Error('Mapped metrics must exist and use the same currency');if(m.baselineKey!==m.currentKey&&right.has(m.baselineKey)&&!mappings.some(other=>other.currentKey===m.baselineKey))throw new Error('Metric mapping would overwrite another metric');return {key:m.baselineKey,sourceKey:m.currentKey,value:{...b,label:`${a.label} → ${b.label}`}};});
  for(const m of replacements)right.delete(m.sourceKey);for(const m of replacements)right.set(m.key,m.value);
  warnings.push('Explicit metric mapping applied to matching user-labeled periods; verify that source observation dates and accounting basis represent those periods.');
 }
 const rows=[...new Set([...left.keys(),...right.keys()])].map(key=>{const a=left.get(key),b=right.get(key),m=(b??a)!;let change:string|null=null,percent:string|null=null;
 if(a&&b){if(a.currency!==b.currency)throw new Error('Matching metric keys use different currencies; no conversion was performed');
 const scale=currencyScale(m.currency),au=decimalUnits(a.value,scale),bu=decimalUnits(b.value,scale),delta=bu-au;change=unitsDecimal(delta,scale);if(au!==0n){const numerator=delta*10000n,negative=(numerator<0n)!==(au<0n),n=numerator<0n?-numerator:numerator,d=au<0n?-au:au;const rounded=(n+d/2n)/d;percent=unitsDecimal(negative?-rounded:rounded,2);}if(au<0n)warnings.push('Negative baseline values require care when interpreting percentage changes.');
 if(a.periodStart!==b.periodStart||a.periodEnd!==b.periodEnd)warnings.push('Calendar periods differ; changes compare relative forecast horizons, not forecast versus actual for the same dates.');}
 return {label:m.label,currency:m.currency,baseline:a?.value??null,current:b?.value??null,change,percent,
   baselinePeriod:a?.periodStart?`${a.periodStart} – ${a.periodEnd??a.periodStart}`:undefined,currentPeriod:b?.periodStart?`${b.periodStart} – ${b.periodEnd??b.periodStart}`:undefined};});
 if(rows.some(r=>r.baseline===null||r.current===null))warnings.push('Some metrics or currencies exist in only one snapshot; no change was calculated for them.');
 return {baseline,current,rows,warnings:[...new Set(warnings)]};
}
