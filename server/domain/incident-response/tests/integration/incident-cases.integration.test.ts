/** @vitest-environment node */
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {configureTestEnvironment,requireTestDatabaseUrl} from '../../../../../tests/configure-test-environment.js';
configureTestEnvironment();requireTestDatabaseUrl();
const {db}=await import('@server/database_service.js');
const {orgs,apps,crewSessions,appRecords}=await import('@shared/schema/index.js');
const {eq,inArray}=await import('drizzle-orm');
const {commandIncidentCase,listIncidentCases,readIncidentCase}=await import('../../incident-cases.service.js');
const {executeAppRecordAction}=await import('../../../apps/core/app-records-writer.service.js');
let org=0,otherOrg=0,app=0,otherApp=0;
const room=`incident-test-${randomUUID()}`;
const actor=()=>({appId:app,orgId:org,deploymentId:123});
const declare=()=>({action:'declare',requestId:randomUUID(),title:'Isolated test incident',description:'Test contract only; no real outage is asserted.',severity:'SEV-2'});
describe('durable incident coordination against PostgreSQL',()=>{
  beforeAll(async()=>{
    await db.execute('SELECT 1 FROM app_records LIMIT 1' as any);
    const [a]=await db.insert(orgs).values({name:room}).returning();org=a.id;
    const [b]=await db.insert(orgs).values({name:`${room}-other`}).returning();otherOrg=b.id;
    const [x]=await db.insert(apps).values({name:room,slug:room,organizationId:org}).returning();app=x.id;
    const [y]=await db.insert(apps).values({name:`${room}-other`,slug:`${room}-other`,organizationId:otherOrg}).returning();otherApp=y.id;
    await db.insert(crewSessions).values([{sessionKey:room,organizationId:org},{sessionKey:`${room}-second`,organizationId:org},{sessionKey:`${room}-foreign`,organizationId:otherOrg}]);
  });
  beforeEach(async()=>{await db.delete(appRecords).where(eq(appRecords.appId,app));});
  afterAll(async()=>{if(!org)return;await db.delete(crewSessions).where(inArray(crewSessions.organizationId,[org,otherOrg]));await db.delete(apps).where(inArray(apps.id,[app,otherApp]));await db.delete(orgs).where(inArray(orgs.id,[org,otherOrg]));});
  it('supports multiple incidents, reload and append-only lifecycle evidence',async()=>{
    const first=await commandIncidentCase(actor(),room,declare());
    await commandIncidentCase(actor(),room,declare());
    expect((await listIncidentCases(actor(),room)).items).toHaveLength(2);
    const id=first.incident.id;
    const change=(status:string,version:number,extra={})=>({action:'transition',requestId:randomUUID(),incidentId:id,expectedVersion:version,status,note:'Operator observation',...extra});
    await expect(commandIncidentCase(actor(),room,change('resolved',1))).rejects.toThrow('Invalid');
    await expect(commandIncidentCase(actor(),room,change('investigating',1))).rejects.toThrow('commander');
    await commandIncidentCase(actor(),room,change('investigating',1,{commander:'Test commander'}));
    await expect(commandIncidentCase(actor(),room,change('mitigated',2))).rejects.toThrow('evidence');
    await commandIncidentCase(actor(),room,change('mitigated',2,{evidenceUrl:'https://example.test/test-observation'}));
    await commandIncidentCase(actor(),room,change('resolved',3,{evidenceUrl:'https://example.test/test-recovery'}));
    const saved=await readIncidentCase(actor(),room,id);
    expect(saved.status).toBe('resolved');expect(saved.events).toHaveLength(4);expect(saved.version).toBe(4);
  });
  it('serializes duplicates and rejects command reuse with changed content',async()=>{
    const input=declare();
    const attempts=await Promise.all([commandIncidentCase(actor(),room,input),commandIncidentCase(actor(),room,input)]);
    expect(attempts[0].incident.id).toBe(attempts[1].incident.id);
    expect(attempts.map(result=>result.replayed).sort()).toEqual([false,true]);
    await expect(commandIncidentCase(actor(),room,{...input,title:'Different'})).rejects.toThrow('different inputs');
  });
  it('rejects stale concurrent transitions instead of losing history',async()=>{
    const {incident}=await commandIncidentCase(actor(),room,declare());
    const transition=()=>({action:'transition',requestId:randomUUID(),incidentId:incident.id,expectedVersion:1,status:'investigating',commander:'Test',note:'Test observation'});
    const results=await Promise.allSettled([commandIncidentCase(actor(),room,transition()),commandIncidentCase(actor(),room,transition())]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((await readIncidentCase(actor(),room,incident.id)).events).toHaveLength(2);
  });
  it('isolates rooms and organizations and rejects generic edits',async()=>{
    const {incident}=await commandIncidentCase(actor(),room,declare());
    expect((await listIncidentCases(actor(),`${room}-second`)).items).toEqual([]);
    await expect(readIncidentCase(actor(),`${room}-second`,incident.id)).rejects.toThrow('unavailable');
    await expect(listIncidentCases({...actor(),orgId:otherOrg},room)).rejects.toThrow('unavailable');
    await expect(listIncidentCases(actor(),`${room}-foreign`)).rejects.toThrow('unavailable');
    await expect(executeAppRecordAction({organizationId:org,appId:app,collection:'incident_response_cases',action:'delete_record',recordId:incident.id})).rejects.toThrow('cannot forge');
  });
});
