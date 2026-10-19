import {it,expect,vi} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {requireTestDatabaseUrl} from '../../../../tests/configure-test-environment.js';
import {db} from '@server/database_service.js';
import {crewSessions,crewTurns,projects} from '@shared/schema/index.js';
import {financialSnapshotsService} from './financial-snapshots.service.js';
it('saves grounded values, freezes later source changes, and denies another organization',async()=>{
 requireTestDatabaseUrl();const rollback=new Error('test rollback');
 try{await db.transaction(async tx=>{
 const select=vi.spyOn(db,'select').mockImplementation(tx.select.bind(tx) as any),insert=vi.spyOn(db,'insert').mockImplementation(tx.insert.bind(tx) as any),update=vi.spyOn(db,'update').mockImplementation(tx.update.bind(tx) as any);
 try{
 const key=`snapshot-test-${randomUUID()}`,[room]=await tx.insert(crewSessions).values({organizationId:1,sessionKey:key}).returning();
 const foreignKey=`foreign-${key}`;await tx.insert(crewSessions).values({organizationId:2,sessionKey:foreignKey});
 const otherProjectKey=`project-${key}`;const [otherProject]=await tx.insert(projects).values({organizationId:1,key:otherProjectKey,name:'Snapshot test project',createdBy:'test'}).returning();await tx.insert(crewSessions).values({organizationId:1,sessionKey:otherProjectKey,projectId:otherProject.id});
 const artifact=(value:string)=>({tool:'quickbooks_calculate_total',payload:{type:'google_workspace_results',sourceArgs:{entity:'Invoice',field:'Balance'},items:[{calculation:{complete:true,entity:'Invoice',field:'Balance',filter:'Outstanding balances',matchedRecords:1,totals:[{currency:'USD',value,count:1}]}}]}});
 const [turn]=await tx.insert(crewTurns).values({sessionId:room.id,organizationId:1,speakerType:'agent',speakerName:'Test',content:'Executed',toolsUsed:[{name:'quickbooks_calculate_total',ok:true,ms:1}],artifacts:[artifact('100.00')]}).returning();
 const context={organizationId:1,userId:'test',sessionKey:key},params={name:'Baseline',sourceTurnId:turn.id};
 const draft=await financialSnapshotsService.propose(params,context);expect((await financialSnapshotsService.propose(params,context)).id).toBe(draft.id);
 expect(draft.workflow).toMatchObject({version:1,recipe:'financial_result_to_snapshot',checkpoint:'awaiting_save',organizationId:1,projectId:null,source:{turnId:turn.id,hash:draft.sourceHash}});
 await expect(financialSnapshotsService.get(draft.id,context)).rejects.toThrow('unavailable');
 const saved=await financialSnapshotsService.confirm(draft.id,context);expect(saved.status).toBe('saved');
 expect(saved.workflow?.checkpoint).toBe('saved');
 const {eq}=await import('drizzle-orm');await tx.update(crewTurns).set({artifacts:[artifact('999.00')]}).where(eq(crewTurns.id,turn.id));
 expect((await financialSnapshotsService.get(saved.id,context)).metrics[0].value).toBe('100.00');
 await expect(financialSnapshotsService.get(saved.id,{organizationId:2,userId:'test',sessionKey:foreignKey})).rejects.toThrow('unavailable');
 await expect(financialSnapshotsService.get(saved.id,{organizationId:1,userId:'test',sessionKey:otherProjectKey})).rejects.toThrow('unavailable');
 }finally{select.mockRestore();insert.mockRestore();update.mockRestore();}
 throw rollback;
 });}catch(e){if(e!==rollback)throw e;}
});
it('persists forecast provenance, all monetary values and coverage through save and retrieval',async()=>{
 requireTestDatabaseUrl();const rollback=new Error('forecast workflow rollback');
 try{await db.transaction(async tx=>{
 const select=vi.spyOn(db,'select').mockImplementation(tx.select.bind(tx) as any),insert=vi.spyOn(db,'insert').mockImplementation(tx.insert.bind(tx) as any),update=vi.spyOn(db,'update').mockImplementation(tx.update.bind(tx) as any);
 try{
 const key=`forecast-test-${randomUUID()}`,[room]=await tx.insert(crewSessions).values({organizationId:1,sessionKey:key}).returning();
 const context={organizationId:1,userId:'test',sessionKey:key};
 const [turn]=await tx.insert(crewTurns).values({sessionId:room.id,organizationId:1,speakerType:'agent',speakerName:'Test',content:'Executed forecast',
  toolsUsed:[{name:'quickbooks_forecast_cashflow',ok:true,ms:1}],artifacts:[{tool:'quickbooks_forecast_cashflow',payload:{type:'google_workspace_results',sourceArgs:{horizonWeeks:1},items:[{id:'forecast',kind:'accounting',title:'USD forecast',forecast:{complete:true,method:'cashflow',currency:'USD',periodUnit:'week',asOf:'2026-10-01',
   series:[{period:1,value:'100.00',inflow:'20.00',outflow:'10.00',periodStart:'2026-10-01',periodEnd:'2026-10-07'}],scenarios:[{name:'Downside',series:[{period:1,value:'80.00'}]}],
   assumptions:['Dated commitments only'],warnings:['Overdue invoice excluded'],coverage:{kind:'scheduled_commitments',completeness:'partial',modeled:['Bank','Invoices','Bills'],excluded:['Payroll','Future sales'],confidence:'heuristic_uncalibrated'},predictionAssessment:{predicted_label:'no_shortfall',confidence:0.42}}}]}}]}).returning();
 const draft=await financialSnapshotsService.propose({name:'October forecast',sourceTurnId:turn.id},context);
 expect(draft.sourceAsOf).toBe('2026-10-01');expect(draft.metrics).toHaveLength(4);expect(draft.exclusions).toContain('Payroll');
 await financialSnapshotsService.confirm(draft.id,context);
 const reloaded=await financialSnapshotsService.get(draft.id,context);
 expect(reloaded.workflow?.checkpoint).toBe('saved');expect(reloaded.predictionAssessments?.[0].calibration).toBe('heuristic_uncalibrated');
 expect(reloaded.metrics.find(m=>m.key.endsWith(':inflow'))?.value).toBe('20.00');
 expect((await financialSnapshotsService.compare(draft.id,draft.id,context)).rows.every(row=>row.change==='0.00')).toBe(true);
 }finally{select.mockRestore();insert.mockRestore();update.mockRestore();}
 throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
});
it('allows only draft confirmation and blocks snapshot mutation/deletion at the database boundary',async()=>{
 const client=new Client({connectionString:requireTestDatabaseUrl()});await client.connect();
 try{await client.query('BEGIN');const id=randomUUID();
 await client.query(`INSERT INTO financial_snapshots(id,organization_id,session_id,name,source_turn_id,source_artifact_index,dedupe_key,payload,source_payload,created_by) VALUES($1,1,1,'test snapshot',1,0,$2,$3,$4,'test')`,[id,id,JSON.stringify({metrics:[{currency:'USD',value:'100.00'}]}),JSON.stringify({source:'executed'})]);
 await client.query('UPDATE financial_snapshots SET status=$1,saved_at=now() WHERE id=$2',['saved',id]);
 for(const statement of ['UPDATE financial_snapshots SET payload=$2 WHERE id=$1','DELETE FROM financial_snapshots WHERE id=$1']){
 await client.query('SAVEPOINT immutable_check');let rejected=false;try{await client.query(statement,statement.startsWith('UPDATE')?[id,'{}']:[id]);}catch(e){rejected=String(e).includes('immutable');}await client.query('ROLLBACK TO SAVEPOINT immutable_check');expect(rejected).toBe(true);}
 const stored=await client.query('SELECT payload,status FROM financial_snapshots WHERE id=$1',[id]);expect(stored.rows[0].payload.metrics[0].value).toBe('100.00');expect(stored.rows[0].status).toBe('saved');
 const foreign=await client.query('SELECT id FROM financial_snapshots WHERE id=$1 AND organization_id=$2',[id,2]);expect(foreign.rows).toHaveLength(0);
 }finally{await client.query('ROLLBACK');await client.end();}
});
