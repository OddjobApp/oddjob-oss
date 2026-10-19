import React,{useEffect,useState} from 'react';
import {incidentRequest,retryKey,type Incident} from '../lib/platform-client';
import {setSelectedRecord,requestCrewInput} from '../lib/crew-sdk';
export default function IncidentResponse() {
  const [items,setItems]=useState<Incident[]>([]),[selected,setSelected]=useState<Incident|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<unknown>(null),[cursor,setCursor]=useState<number|null>(null);
  const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[severity,setSeverity]=useState('SEV-2');
  const [note,setNote]=useState(''),[commander,setCommander]=useState(''),[evidence,setEvidence]=useState(''),[next,setNext]=useState('investigating');
  async function refresh(older=false) {
    const page=await incidentRequest<{items:Incident[];nextCursor:number|null}>('GET',undefined,older?cursor??undefined:undefined);
    setItems(previous=>older?[...previous,...page.items]:page.items); setCursor(page.nextCursor);
    if(selected) setSelected(await incidentRequest<Incident>('GET',undefined,undefined,selected.id));
  }
  useEffect(()=>{try{const cached=localStorage.getItem(retryKey());if(cached)setPending(JSON.parse(cached));}catch{setError('Retry storage unavailable. Commands cannot be sent until storage is available.');} void refresh().catch(err=>setError(err.message));},[]);
  async function send(command:unknown) {
    setBusy(true);setError('');
    try {
      localStorage.setItem(retryKey(),JSON.stringify(command));setPending(command);
      const result=await incidentRequest<{incident:Incident}>('POST',command);
      localStorage.removeItem(retryKey());setPending(null);setSelected(result.incident);setNext(result.incident.status==='open'?'investigating':result.incident.status==='investigating'?'mitigated':result.incident.status==='mitigated'?'resolved':'open');setSelectedRecord({collection:'incident_response_cases',recordId:result.incident.id});
      await refresh();
    } catch(err) {setError(`${err instanceof Error?err.message:'Command failed'} The command remains available for retry with its original ID.`);}
    finally{setBusy(false);}
  }
  return <main className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-5">
    <header><h1 className="text-2xl font-semibold">Incident Response</h1><p>Durable coordination in CREW. Recovery references are operator reports, not independent deployment verification.</p></header>
    <p className="rounded border border-amber-700 p-3">Logs, PR creation, CI, deployment, rollback and Jira writes require connected provider tools and their approval gates. This workbench performs none of those actions automatically.</p>
    {error&&<p role="alert">{error}</p>}
    {pending!=null&&<section className="border border-amber-700 p-3"><p>A command is unconfirmed. Retrying keeps the same command ID.</p><button disabled={busy} onClick={()=>void send(pending)}>Retry saved command</button><button className="ml-4" disabled={busy} onClick={()=>{localStorage.removeItem(retryKey());setPending(null);setError('Retry discarded locally; refresh and inspect the incident before submitting again.');}}>Discard local retry</button></section>}
    <button disabled={busy} onClick={()=>void refresh().catch(err=>setError(err.message))}>Refresh incidents</button>
    <form className="grid gap-3 max-w-xl" onSubmit={event=>{event.preventDefault();void send({action:'declare',requestId:crypto.randomUUID(),title,description,severity});}}>
      <h2 className="text-xl">Declare an incident</h2>
      <label>Title<input className="block bg-slate-900 border p-2 w-full" required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)}/></label>
      <label>Observed impact<textarea className="block bg-slate-900 border p-2 w-full" required maxLength={4000} value={description} onChange={event=>setDescription(event.target.value)}/></label>
      <label>Severity<select className="bg-slate-900 ml-2" value={severity} onChange={event=>setSeverity(event.target.value)}>{['SEV-1','SEV-2','SEV-3','SEV-4'].map(value=><option key={value}>{value}</option>)}</select></label>
      <button disabled={busy||pending!=null}>Declare incident</button>
    </form>
    <section><h2 className="text-xl">Incident register</h2>{!items.length&&<p>No incidents recorded in this room.</p>}{items.map(item=><button key={item.id} className="block border p-3 my-2 text-left w-full" onClick={()=>{void incidentRequest<Incident>('GET',undefined,undefined,item.id).then(setSelected).catch(err=>setError(err.message));setSelectedRecord({collection:'incident_response_cases',recordId:item.id});setNext(item.status==='open'?'investigating':item.status==='investigating'?'mitigated':item.status==='mitigated'?'resolved':'open');}}>{item.severity} · {item.title} · {item.status} · revision {item.version}</button>)}{cursor&&<button onClick={()=>void refresh(true).catch(err=>setError(err.message))}>Load older incidents</button>}</section>
    {selected&&<section className="border p-4 space-y-3"><h2 className="text-xl">{selected.title}</h2><p>{selected.description}</p><p>Incident {selected.id} · {selected.status} · commander {selected.commander??'unassigned'}</p>
      <p>The selected persisted case is shared as context with CREW. Ask the room to review its timeline and propose a source-backed response.</p>
      <button onClick={()=>void requestCrewInput({kind:'question',title:`What should we investigate next for ${selected.title}?`}).then(result=>setError(result.status==='submitted'?'Input received in CREW. Review it before recording a transition.':'Input request cancelled.')).catch(err=>setError(err.message))}>Ask in CREW</button>
      <form className="grid gap-3 max-w-xl" onSubmit={event=>{event.preventDefault();void send({action:'transition',requestId:crypto.randomUUID(),incidentId:selected.id,expectedVersion:selected.version,status:next,note,...(commander?{commander}:{}),...(evidence?{evidenceUrl:evidence}:{})});}}>
        <label>Next state<select className="ml-2 bg-slate-900" value={next} onChange={event=>setNext(event.target.value)}>{({open:['investigating'],investigating:['mitigated'],mitigated:['resolved','investigating'],resolved:['open']}[selected.status]??[]).map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Commander<input className="block border bg-slate-900 p-2" value={commander} onChange={event=>setCommander(event.target.value)} /></label>
        <label>Observed findings<textarea className="block border bg-slate-900 p-2 w-full" required maxLength={4000} value={note} onChange={event=>setNote(event.target.value)}/></label>
        <label>Evidence URL<input className="block border bg-slate-900 p-2 w-full" type="url" value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="https://…" /></label>
        <button disabled={busy||pending!=null}>Record transition</button>
      </form>
      <h3>Timeline</h3>{selected.events.map(event=><article key={event.requestId} className="border-t py-2"><p>{event.at} · {event.action}</p><p>{event.note}</p>{event.evidenceUrl&&<a href={event.evidenceUrl} target="_blank" rel="noopener noreferrer">Open reported evidence</a>}</article>)}
    </section>}
  </main>;
}
