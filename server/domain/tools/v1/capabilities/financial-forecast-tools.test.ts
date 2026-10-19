import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({client:vi.fn(),predict:vi.fn(),roles:['audit'] as string[]}));
vi.mock('@domain/integrations/quickbooks/service.js',()=>({getQuickBooksClient:mocks.client}));
// The caller's finance roles, judged by the real matrix.
vi.mock('@domain/projects/core/finance-roles.service.js',async()=>{const {financeAccess}=await import('@shared/finance-roles.js');
 return {financeRolesService:{assertCan:async(_c:unknown,entity:string,op:any)=>{if(!financeAccess(mocks.roles as any).can(entity,op))throw new Error(`Forbidden: ${op} ${entity}`);return {projectId:44,access:financeAccess(mocks.roles as any)};}}};});
vi.mock('./data.js',()=>({DATA_TOOLS:{run_prediction:{execute:mocks.predict}}}));
import {FINANCIAL_FORECAST_TOOLS} from './financial-forecast-tools.js';
beforeEach(()=>{vi.clearAllMocks();mocks.roles=['audit'];});
describe('Financial forecast agent capabilities',()=>{
 it('passes organization-scoped dataset inputs to the existing prediction engine',async()=>{
 mocks.predict.mockResolvedValue('{"success":true}');const c={organizationId:473,projectId:44};await FINANCIAL_FORECAST_TOOLS.calculate_dataset_prediction.execute({datasetId:7,limit:10},c);
 expect(mocks.predict).toHaveBeenCalledWith({datasetId:7,limit:10},c);
 mocks.predict.mockResolvedValue('Prediction Error: missing data');await expect(FINANCIAL_FORECAST_TOOLS.calculate_dataset_prediction.execute({datasetId:7,limit:10},c)).rejects.toThrow('missing data');
 });
 it('rejects missing scope and opening balances',async()=>{
 await expect(FINANCIAL_FORECAST_TOOLS.calculate_dataset_prediction.execute({datasetId:7},{})).rejects.toThrow();
 mocks.client.mockResolvedValue({client:{company:async()=>({HomeCurrency:{value:'USD'}}),list:async()=>({items:[],nextStart:null})}});
 await expect(FINANCIAL_FORECAST_TOOLS.quickbooks_forecast_cashflow.execute({horizonWeeks:13},{organizationId:473})).rejects.toThrow('opening cash');
 });
 it('needs read access to accounts, invoices and bills: AR alone is refused before QuickBooks is called',async()=>{
 mocks.roles=['ar'];
 await expect(FINANCIAL_FORECAST_TOOLS.quickbooks_forecast_cashflow.execute({horizonWeeks:13},{organizationId:473,projectId:44,userId:'u1'})).rejects.toThrow('Forbidden: read Bill');
 expect(mocks.client).not.toHaveBeenCalled();
 });
 it('reads scoped schedules and separates overdue exclusions from prediction assessment',async()=>{
 mocks.client.mockResolvedValue({client:{company:async()=>({HomeCurrency:{value:'USD'}}),list:async(entity:string)=>({nextStart:null,items:entity==='Account'?[{Id:'1',AccountType:'Bank',CurrentBalance:100}]:entity==='Invoice'?[{Id:'2',Balance:5,DueDate:'2000-01-01'}]:[]})}});
 const data=JSON.parse(await FINANCIAL_FORECAST_TOOLS.quickbooks_forecast_cashflow.execute({horizonWeeks:2},{organizationId:473,projectId:44}));
 expect(mocks.client).toHaveBeenCalledWith(473,44);expect(data.forecasts[0].series[1].value).toBe('100.00');expect(data.warnings).toHaveLength(1);expect(data.forecasts[0].predictionAssessment.predicted_label).toBe('no_shortfall');
 expect(data.forecasts[0].coverage).toMatchObject({kind:'scheduled_commitments',completeness:'partial',confidence:'heuristic_uncalibrated'});
 expect(data.forecasts[0].coverage.excluded).toContain('Payroll');
 expect(data.forecasts[0].series[0].periodStart).toBe(data.asOf);
 });
});
