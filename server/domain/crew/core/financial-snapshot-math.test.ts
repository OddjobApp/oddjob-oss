import {it,expect} from 'vitest';
import {snapshotMetrics,compareFinancialSnapshots} from './financial-snapshot-math';
import {financialSnapshotRequest,financialSnapshotHandoffRequest} from './financial-snapshot-routing';
import type {FinancialSnapshotView} from '@shared/financial-snapshots';
const snapshot=(value:string,currency='USD'):FinancialSnapshotView=>({id:'id',name:'Snapshot',status:'saved',organizationId:1,sessionKey:'room',capturedAt:'2026-10-09',sourceAsOf:'2026-10-09',sourceTurnId:1,sourceTool:'quickbooks_calculate_total',sourceHash:'hash',assumptions:[],exclusions:[],metrics:[{key:currency,label:'Invoice Balance',currency,value}]});
it('compares exact decimal amounts and zero baselines',()=>{const result=compareFinancialSnapshots(snapshot('0.10'),snapshot('0.30'));expect(result.rows[0]).toMatchObject({change:'0.20',percent:'200.00'});expect(compareFinancialSnapshots(snapshot('0'),snapshot('10')).rows[0].percent).toBeNull();});
it('does not compare across currencies or absent metrics',()=>{const r=compareFinancialSnapshots(snapshot('10','USD'),snapshot('12','EUR'));expect(r.rows.every(row=>row.change===null)).toBe(true);expect(r.warnings.length).toBeGreaterThan(0);});
it('requires matching periods and explicit currency-compatible forecast-to-actual mapping',()=>{const a={...snapshot('100'),periodStart:'2026-10-01',periodEnd:'2026-10-31'},b={...snapshot('110'),periodStart:'2026-10-01',periodEnd:'2026-10-31',metrics:[{key:'actual',label:'Observed cash',currency:'USD',value:'110.00'}]};const mapping=[{baselineKey:'USD',currentKey:'actual'}];expect(compareFinancialSnapshots(a,b,mapping).rows[0].change).toBe('10.00');expect(b.metrics[0].key).toBe('actual');expect(()=>compareFinancialSnapshots(a,{...b,periodEnd:'2026-11-30'},mapping)).toThrow('matching');});
it('freezes only valid executed-result structures and preserves exclusions',()=>{expect(()=>snapshotMetrics([{body:'The forecast is 100'}])).toThrow();const s=snapshotMetrics([{forecast:{method:'cashflow',periodUnit:'week',currency:'KWD',series:[{period:1,value:'0.003'}],assumptions:['scheduled only'],warnings:['overdue excluded']}}]);expect(s.metrics[0].value).toBe('0.003');expect(s.exclusions).toEqual(['overdue excluded']);});
it('routes snapshot requests without suggesting a future action',()=>{expect(financialSnapshotRequest('Save a financial snapshot named October baseline.')).toEqual({name:'propose_financial_snapshot',args:{name:'October baseline'}});expect(financialSnapshotRequest('Compare October baseline with November close.')).toMatchObject({name:'compare_financial_snapshots'});expect(financialSnapshotRequest('Pay all invoices')).toBeNull();});
it('preserves the source action in explicit forecast-to-snapshot requests',()=>{
 expect(financialSnapshotHandoffRequest('Forecast our cashflow and save a snapshot named October baseline.')).toEqual({sourceRequest:'Forecast our cashflow',name:'October baseline'});
 expect(financialSnapshotHandoffRequest('Calculate projected cashflow then capture a financial snapshot called "Week 1"')).toMatchObject({name:'Week 1'});
 expect(financialSnapshotHandoffRequest('Forecast cashflow')).toBeNull();
});
it('freezes statement columns, scenarios, dated coverage and prediction semantics',()=>{
 const frozen=snapshotMetrics([{forecast:{complete:true,method:'three_statement',periodUnit:'month',currency:'USD',
  series:[{period:1,value:'100.10',netIncome:'3.20',assets:'200.00',periodStart:'2026-10-01',periodEnd:'2026-10-31'}],
  scenarios:[{name:'Downside',series:[{period:1,value:'90.10'}]}],assumptions:[],warnings:[],
  coverage:{kind:'input_projection',completeness:'partial',modeled:['Explicit drivers'],excluded:['New financing'],confidence:'not_estimated'},
  predictionAssessment:{predicted_label:'no_shortfall',confidence:0.42}}}]);
 expect(frozen.metrics).toHaveLength(4);
 expect(frozen.metrics.find(m=>m.key.endsWith(':netIncome'))?.value).toBe('3.20');
 expect(frozen.metrics.find(m=>m.key.endsWith(':scenario:Downside'))?.value).toBe('90.10');
 expect(frozen.metrics[0].periodStart).toBe('2026-10-01');
 expect(frozen.exclusions).toContain('New financing');
 expect(frozen.predictionAssessments[0]).toMatchObject({confidence:0.42,calibration:'heuristic_uncalibrated'});
});
it('refuses cross-tenant, draft, duplicate-key and currency-incompatible comparisons',()=>{
 expect(()=>compareFinancialSnapshots(snapshot('10'),{...snapshot('20'),organizationId:2})).toThrow('organizations');
 expect(()=>compareFinancialSnapshots(snapshot('10'),{...snapshot('20'),status:'draft'})).toThrow('saved');
 expect(()=>compareFinancialSnapshots(snapshot('10'),{...snapshot('20'),metrics:[...snapshot('20').metrics,...snapshot('20').metrics]})).toThrow('Duplicate');
 expect(()=>compareFinancialSnapshots(snapshot('10'),{...snapshot('20'),metrics:[{key:'USD',currency:'EUR',label:'Balance',value:'20.00'}]})).toThrow('different currencies');
});
it('exposes calendar periods when comparing corresponding forecast horizons',()=>{
 const a={...snapshot('10'),metrics:[{...snapshot('10').metrics[0],periodStart:'2026-10-01',periodEnd:'2026-10-07'}]},
 b={...snapshot('12'),metrics:[{...snapshot('12').metrics[0],periodStart:'2026-10-08',periodEnd:'2026-10-14'}]};
 const comparison=compareFinancialSnapshots(a,b);
 expect(comparison.rows[0]).toMatchObject({change:'2.00',baselinePeriod:'2026-10-01 – 2026-10-07',currentPeriod:'2026-10-08 – 2026-10-14'});
 expect(comparison.warnings.some(w=>w.includes('relative forecast horizons'))).toBe(true);
});
