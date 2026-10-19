export function financialSnapshotRequest(message:string):{name:string;args:Record<string,string>}|null{
 const text=message.trim().replace(/[.!?]$/,'');
 const save=/^(?:please )?(?:save|capture|create) (?:a |an )?(?:financial )?snapshot (?:named|called) (.+)$/i.exec(text);
 const clean=(s:string)=>s.trim().replace(/^["“]|["”]$/g,'');
 if(save)return {name:'propose_financial_snapshot',args:{name:clean(save[1])}};
 if(/^(?:please )?(?:list|show)(?: me)?(?: all| my| our| the)?(?: saved)?(?: financial)? snapshots$/i.test(text))return {name:'list_financial_snapshots',args:{}};
 const compare=/^(?:please )?compare (.+?) (?:with|to) (.+)$/i.exec(text);
 if(compare&&/snapshot|baseline|close/i.test(text))return {name:'compare_financial_snapshots',args:{baseline:clean(compare[1].replace(/^(?:financial )?snapshot /i,'')),current:clean(compare[2].replace(/^(?:financial )?snapshot /i,''))}};
 const get=/^(?:please )?(?:show|get|retrieve)(?: me)? (?:financial )?snapshot (.+)$/i.exec(text);
 return get?{name:'get_financial_snapshot',args:{reference:clean(get[1])}}:null;
}

/** Only an explicit named capture request authorizes a draft after a fresh result. */
export function financialSnapshotHandoffRequest(message:string):{sourceRequest:string;name:string}|null {
 const match=/^(.+?)\s+(?:and|then)\s+(?:please\s+)?(?:save|capture|create)\s+(?:a\s+)?(?:financial\s+)?snapshot\s+(?:named|called)\s+(.+?)\s*[.!?]?$/i.exec(message.trim());
 if(!match)return null;
 const name=match[2].trim().replace(/^["“]|["”]$/g,'');
 return name&&name.length<=200?{sourceRequest:match[1].trim(),name}:null;
}
