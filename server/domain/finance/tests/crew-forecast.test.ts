import {describe,it,expect} from 'vitest';
import {calculateFinancialForecast} from '../core/crew-forecast.js';
describe('Executable financial forecasts',()=>{
 const base={currency:'USD',periodUnit:'month',periods:2};
 it('reconciles cash schedules, retains deficits and accumulates scenario deltas',()=>{
 const f=calculateFinancialForecast({...base,method:'cashflow',openingCash:'10.00',inflows:[0,2],outflows:[12,1],scenarios:[{name:'Stress',recurringNet:'-1.00'}]});
 expect(f.series.map(r=>r.value)).toEqual(['-2.00','-1.00']);expect(f.scenarios[0].series.map(r=>r.value)).toEqual(['-3.00','-3.00']);});
 it('uses per-period growth and fitted trends',()=>{
 expect(calculateFinancialForecast({...base,method:'growth',history:[100],growthRates:[.1,.1]}).series.map(r=>r.value)).toEqual(['110.00','121.00']);
 expect(calculateFinancialForecast({...base,method:'linear_trend',history:[10,20,30]}).series.map(r=>r.value)).toEqual(['40.00','50.00']);});
 it('uses complete seasonal history',()=>{expect(calculateFinancialForecast({...base,method:'seasonal',seasonLength:2,history:[10,20,12,22]}).series.map(r=>r.value)).toEqual(['11.00','21.00']);});
 it('rejects missing periods and inadequate history',()=>{expect(()=>calculateFinancialForecast({...base,method:'cashflow',openingCash:0,inflows:[1],outflows:[1]})).toThrow();expect(()=>calculateFinancialForecast({...base,method:'seasonal',seasonLength:2,history:[1,2]})).toThrow();});
 it('reconciles integrated statements and rejects an unbalanced opening',()=>{
 const p={...base,method:'three_statement',growthRates:[0,0],opening:{cash:100,ar:0,inventory:0,ppe:100,ap:0,debt:0,equity:200,revenue:100},drivers:{cogsRate:.5,opexRate:.2,taxRate:.2,capexRate:.1,depreciationRate:.1,interestRate:0,arDays:0,inventoryDays:0,apDays:0,periodDays:30}};
 const f=calculateFinancialForecast(p);expect(f.series[0].value).toBe('116.00');for(const r of f.series)expect(r.assets).toBe(r.liabilitiesAndEquity);
 expect(()=>calculateFinancialForecast({...p,opening:{...p.opening,equity:201}})).toThrow('does not balance');});
 it('preserves three-minor-digit currency precision',()=>{expect(calculateFinancialForecast({...base,currency:'KWD',method:'cashflow',openingCash:'0.003',inflows:[0,0],outflows:[0,0]}).series[0].value).toBe('0.003');});
});
