import {randomUUID,createHash} from 'node:crypto';
import {and,eq,isNull,desc} from 'drizzle-orm';
import {db} from '@server/database_service.js';
import {crewSessions,crewTurns,financialSnapshots} from '@shared/schema/index.js';
import {snapshotMetrics,compareFinancialSnapshots} from './financial-snapshot-math.js';
import type {ToolContext} from '@domain/tools/v1/capabilities/types.js';
import {requireToolOrgId} from '@domain/tools/v1/capabilities/org-context.js';
import {getOrgConditions} from '@server/utils/org-conditions.js';
import type {FinancialSnapshotView} from '@shared/financial-snapshots.js';
import type {WorkspaceResultItem} from '@shared/crew-workspace-results.js';
const supported=new Set(['quickbooks_calculate_total','quickbooks_forecast_cashflow','calculate_financial_forecast']);
const org=(c:ToolContext,t:any)=>getOrgConditions({organizationId:requireToolOrgId(c),userId:c.userId??'crew',isAdmin:false,isSuperAdmin:false,isOrgAdmin:false},t,false);
async function room(c:ToolContext){if(!c.sessionKey)throw new Error('A CREW room is required');const [r]=await db.select().from(crewSessions).where(and(...org(c,crewSessions),eq(crewSessions.sessionKey,c.sessionKey))).limit(1);if(!r)throw new Error('Room unavailable');return r;}
const scope=(c:ToolContext,projectId:number|null)=>and(...org(c,financialSnapshots),projectId===null?isNull(financialSnapshots.projectId):eq(financialSnapshots.projectId,projectId));
const view=(r:typeof financialSnapshots.$inferSelect):FinancialSnapshotView=>({...r.payload,status:r.status,
 ...(r.payload.workflow?{workflow:{...r.payload.workflow,checkpoint:r.status==='saved'?'saved' as const:'awaiting_save' as const}}:{})});
export const financialSnapshotsService={
 async propose(p:{name:string;sourceTurnId?:number;artifactIndex?:number;periodStart?:string;periodEnd?:string},c:ToolContext){
  const r=await room(c);if(!c.userId)throw new Error('An authenticated author is required');
  const turns=await db.select().from(crewTurns).where(and(...org(c,crewTurns),eq(crewTurns.sessionId,r.id),...(p.sourceTurnId?[eq(crewTurns.id,p.sourceTurnId)]:[]))).orderBy(desc(crewTurns.id)).limit(p.sourceTurnId?1:50);
  let source:typeof turns[number]|undefined,index=-1;
  for(const t of turns){const found=t.artifacts.findIndex((a,i)=>supported.has(a.tool)&&t.toolsUsed.some(call=>call.name===a.tool&&call.ok)&&a.payload.type==='google_workspace_results'&&(p.artifactIndex===undefined||i===p.artifactIndex));if(found>=0){source=t;index=found;break;}}
  if(!source)throw new Error('Run a financial calculation or forecast first; no successful source artifact is available in this room');
  const artifact=source.artifacts[index],sourcePayload=artifact.payload;const raw=JSON.stringify(sourcePayload);if(raw.length>1000000)throw new Error('Snapshot source exceeds size limit');
  const data=snapshotMetrics(sourcePayload.items as any[]),capturedAt=new Date().toISOString();
  const sourceDates=[...new Set((sourcePayload.items as WorkspaceResultItem[]).flatMap(item=>item.forecast?.asOf?[item.forecast.asOf]:[]))];
  if(sourceDates.length>1)throw new Error('Forecast source dates differ; capture each source separately');
  const sourceAsOf=sourceDates[0]??source.createdAt?.toISOString()??capturedAt;
  if(!Number.isFinite(Date.parse(sourceAsOf)))throw new Error('Forecast source date is invalid');
  const sourceHash=createHash('sha256').update(raw).digest('hex');
  const dedupeKey=createHash('sha256').update(JSON.stringify([r.organizationId,r.id,source.id,index,p.name,p.periodStart,p.periodEnd,sourceHash])).digest('hex');
  const id=randomUUID();const payload:FinancialSnapshotView={id,name:p.name,status:'draft',organizationId:requireToolOrgId(c),sessionKey:r.sessionKey,capturedAt,sourceAsOf,sourceTurnId:source.id,sourceTool:artifact.tool,periodStart:p.periodStart,periodEnd:p.periodEnd,sourceHash,sourceParameters:sourcePayload.sourceArgs as Record<string,unknown>,...data};
  payload.workflow={version:1,recipe:'financial_result_to_snapshot',organizationId:requireToolOrgId(c),projectId:r.projectId,sessionKey:r.sessionKey,
   source:{turnId:source.id,artifactIndex:index,tool:artifact.tool,hash:sourceHash,observedAt:sourceAsOf},snapshotId:id,checkpoint:'awaiting_save'};
  if(p.periodStart||p.periodEnd)payload.assumptions.push('Reporting period is a user label; source values remain as observed at the source turn, not a retroactive historical query.');
  await db.insert(financialSnapshots).values({id,organizationId:requireToolOrgId(c),projectId:r.projectId,sessionId:r.id,name:p.name,sourceTurnId:source.id,sourceArtifactIndex:index,dedupeKey,payload,sourcePayload,createdBy:c.userId}).onConflictDoNothing({target:financialSnapshots.dedupeKey});
  const [saved]=await db.select().from(financialSnapshots).where(and(scope(c,r.projectId),eq(financialSnapshots.dedupeKey,dedupeKey))).limit(1);return view(saved);
 },
 async confirm(id:string,c:ToolContext){const r=await room(c);const condition=and(scope(c,r.projectId),eq(financialSnapshots.sessionId,r.id),eq(financialSnapshots.id,id));
  await db.update(financialSnapshots).set({status:'saved',savedAt:new Date()}).where(and(condition,eq(financialSnapshots.status,'draft')));
  const [saved]=await db.select().from(financialSnapshots).where(condition).limit(1);if(!saved)throw new Error('Snapshot unavailable');return view(saved);
 },
 async list(c:ToolContext){const r=await room(c);return (await db.select().from(financialSnapshots).where(and(scope(c,r.projectId),eq(financialSnapshots.status,'saved'))).orderBy(desc(financialSnapshots.createdAt)).limit(100)).map(view);},
 async review(id:string,c:ToolContext){const r=await room(c);const [row]=await db.select().from(financialSnapshots).where(and(scope(c,r.projectId),eq(financialSnapshots.sessionId,r.id),eq(financialSnapshots.id,id))).limit(1);if(!row)throw new Error('Snapshot unavailable');return view(row);},
 async get(reference:string,c:ToolContext){const r=await room(c);const id=/^[0-9a-f-]{36}$/i.test(reference);const rows=await db.select().from(financialSnapshots).where(and(scope(c,r.projectId),eq(financialSnapshots.status,'saved'),id?eq(financialSnapshots.id,reference):eq(financialSnapshots.name,reference))).limit(2);if(rows.length!==1)throw new Error(rows.length?'Snapshot name is ambiguous; use its ID':'Saved snapshot unavailable');return view(rows[0]);},
 async compare(a:string,b:string,c:ToolContext,mappings:{baselineKey:string;currentKey:string}[]=[]){const baseline=await this.get(a,c),current=await this.get(b,c);return compareFinancialSnapshots(baseline,current,mappings);},
};
