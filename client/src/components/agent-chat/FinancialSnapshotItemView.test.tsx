import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
const request=vi.hoisted(()=>vi.fn());vi.mock('@/lib/queryClient',()=>({apiRequest:request}));
import {FinancialSnapshotItemView} from './FinancialSnapshotItemView';
it('keeps partial coverage and uncalibrated prediction visible on a saved snapshot',()=>{
 request.mockResolvedValue({json:async()=>({status:'saved'})});
 render(<FinancialSnapshotItemView item={{id:'s',kind:'accounting',title:'Forecast snapshot',snapshot:{id:'s',name:'October forecast',status:'saved',organizationId:473,sessionKey:'room',capturedAt:'2026-10-09',sourceAsOf:'2026-10-08',sourceTurnId:1,sourceTool:'quickbooks_forecast_cashflow',sourceHash:'hash',metrics:[{key:'balance',label:'Ending cash',currency:'USD',value:'100.00'}],assumptions:[],exclusions:['Payroll'],
  coverage:[{kind:'scheduled_commitments',completeness:'partial',modeled:['Invoices'],excluded:['Payroll'],confidence:'heuristic_uncalibrated'}],predictionAssessments:[{currency:'USD',predicted_label:'no_shortfall',confidence:0.42,calibration:'heuristic_uncalibrated'}]}}}/>);
 expect(screen.getByText(/Partial forecast coverage/)).toBeTruthy();
 expect(screen.getByText(/42% confidence \(heuristic, uncalibrated\)/)).toBeTruthy();
 expect(screen.getByText('$100.00')).toBeTruthy();
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('requires the Save click and reports durable completion only after response',async()=>{
 request.mockImplementation(async(method:string)=>({json:async()=>({status:method==='POST'?'saved':'draft'})}));render(<FinancialSnapshotItemView item={{id:'s',kind:'accounting',title:'Snapshot',snapshot:{id:'s',name:'October baseline',status:'draft',organizationId:473,sessionKey:'room',capturedAt:'2026-10-09',sourceAsOf:'2026-10-08',sourceTurnId:1,sourceTool:'quickbooks_calculate_total',sourceHash:'hash',metrics:[{key:'balance',label:'Invoice balance',currency:'USD',value:'100.00'}],assumptions:['Executed source only'],exclusions:[]}}}/>);
 await waitFor(()=>expect(request).toHaveBeenCalledWith('GET','/api/crew/room/financial-snapshots/s?orgId=473'));expect(request.mock.calls.some(c=>c[0]==='POST')).toBe(false);expect(screen.getByText(/100.00/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Save snapshot'}));await waitFor(()=>expect(screen.getByText(/Saved snapshot/)).toBeTruthy());expect(request).toHaveBeenCalledWith('POST','/api/crew/room/financial-snapshots/s/save?orgId=473',{});
});
it('formats times, keeps the ID out of the heading, and says when the saved state could not be checked',async()=>{
 request.mockRejectedValue(new Error('offline'));
 render(<FinancialSnapshotItemView item={{id:'s',kind:'accounting',title:'Snapshot',snapshot:{id:'3f1c-uuid',name:'Q3 close',status:'draft',organizationId:473,sessionKey:'room',capturedAt:'2026-10-09T15:12:00Z',sourceAsOf:'2026-10-08',sourceTurnId:12,sourceTool:'quickbooks_calculate_total',sourceHash:'h',metrics:[{key:'ar',label:'Receivables',currency:'USD',value:'100.00'}],assumptions:[],exclusions:[]}}}/>);
 expect(screen.getByText(/Source as of Oct 8, 2026/)).toBeTruthy();
 expect(screen.queryByText(/2026-10-09T15:12/)).toBeNull();
 expect(screen.getByText(/From QuickBooks total in turn #12/)).toBeTruthy();
 expect(await screen.findByText(/Could not check whether this snapshot was saved/)).toBeTruthy();
});
