export interface Incident { id:string; title:string; description:string; severity:string; status:string; version:number; commander?:string; events:Array<{requestId:string;action:string;at:string;note:string;evidenceUrl?:string}> }
export async function incidentRequest<T>(method:string,body?:unknown,cursor?:number,id?:string):Promise<T> {
  const room = new URLSearchParams(window.location.search).get('crewRoom');
  if (!room) throw new Error('Open Incident Response inside a CREW room.');
  const query = new URLSearchParams({crewRoom:room,...(cursor?{cursor:String(cursor)}:{})});
  const response = await fetch(`/api/oddjob/incidents${id?`/${encodeURIComponent(id)}`:''}?${query}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.message ?? `Request failed (${response.status})`);
  return data;
}
export function retryKey() { return `incident-command:${location.pathname}:${new URLSearchParams(location.search).get('orgId')}:${new URLSearchParams(location.search).get('crewRoom')}`; }
