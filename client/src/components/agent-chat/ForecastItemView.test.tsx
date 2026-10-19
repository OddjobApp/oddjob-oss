import React from 'react';
import {it,expect,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {ForecastItemView} from './ForecastItemView';
afterEach(cleanup);
it('shows dated partial coverage without treating dates as monetary columns',()=>{
 render(<ForecastItemView item={{id:'f',kind:'accounting',title:'Forecast',forecast:{currency:'USD',method:'cashflow',periodUnit:'week',
  series:[{period:1,value:'100.00',periodStart:'2026-10-09',periodEnd:'2026-10-15'}],scenarios:[],assumptions:[],warnings:['Payroll'],
  coverage:{kind:'scheduled_commitments',completeness:'partial',modeled:['Dated invoices'],excluded:['Payroll'],confidence:'heuristic_uncalibrated'}}}}/>);
 expect(screen.getByText(/Scheduled commitments only/)).toBeTruthy();
 expect(screen.getByText(/Oct 9, 2026 – Oct 15, 2026/)).toBeTruthy();
 expect(screen.queryByText('Period start')).toBeNull();
 expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
});
it('labels forecasts and exposes source exclusions rather than hiding deficits',()=>{
 render(<ForecastItemView item={{id:'f',kind:'accounting',title:'Forecast',forecast:{currency:'USD',method:'cashflow',periodUnit:'week',series:[{period:1,value:'-10.00'}],scenarios:[],assumptions:['Existing commitments only'],warnings:['Invoice 1: overdue; excluded']}}}/>);
 expect(screen.getAllByText('-$10.00').length).toBeGreaterThan(0);
 expect(screen.getByText(/Projection/)).toBeTruthy();
 expect(screen.getByText(/Invoice 1: overdue/)).toBeTruthy();
});
it('reads as a person would: method, periods and model columns are labelled, not raw keys',()=>{
 render(<ForecastItemView item={{id:'f',kind:'accounting',title:'Forecast',forecast:{currency:'USD',method:'three_statement',periodUnit:'month',series:[{period:1,value:'5.00',netIncome:'1.00',liabilitiesAndEquity:'9.00'}],scenarios:[],assumptions:[],warnings:[],predictionAssessment:{predicted_label:'no_shortfall',confidence:0.42}}}}/>);
 expect(screen.getByText('Three-statement forecast · USD')).toBeTruthy();
 expect(screen.getByText(/Projection over 1 month/)).toBeTruthy();
 expect(screen.getByText('No shortfall expected')).toBeTruthy();
 expect(screen.getAllByText('Month 1').length).toBeGreaterThan(0);
 expect(screen.getByText('Net income')).toBeTruthy();
 expect(screen.getByText('Liabilities & equity')).toBeTruthy();
 expect(screen.queryByText('netIncome')).toBeNull();
 expect(screen.queryByText(/three_statement/)).toBeNull();
});
