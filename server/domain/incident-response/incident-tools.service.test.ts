import {describe,it,expect,vi} from 'vitest';
import {incidentToolsService} from './incident-tools.service';
describe('retired incident demonstration handlers',()=>{
  it('never fabricates success even when the legacy enable flag is set',async()=>{
    vi.stubEnv('INCIDENT_RESPONSE_ENABLED','true');
    try {
      for(const [name,handler] of Object.entries(incidentToolsService)) {
        if(name==='getToolDefinitions') continue;
        const result=await (handler as (params:unknown)=>Promise<any>)({orgId:1});
        expect(result.success).toBe(false);expect(result.error).toContain('No external action was performed');expect(result.data).toBeUndefined();
      }
    } finally {vi.unstubAllEnvs();}
  });
});
