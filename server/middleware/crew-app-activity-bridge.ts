/** Read-only & navigation bridge: uses the deployed app's token-scoped history API and reports view/selection state to CREW. */
import { CREW_APP_PRESENTATION_CSS } from '../../shared/crew-app-presentation.js';

export const CREW_APP_ACTIVITY_BRIDGE = `<script data-oddjob-crew-activity>
(function(){
 var query = new URLSearchParams(location.search);
 var room = query.get('crewRoom');
 if (!room || parent === window) return;
 var selectedRecord = null;
 var initCol = query.get('collection');
 var initRec = query.get('recordId') || query.get('focusId');
 if (initCol && initRec) selectedRecord = { collection: initCol, recordId: initRec };
 function emitView(){
  var pathname = typeof location.pathname === 'string' && location.pathname ? location.pathname : '/';
  var msg = { source: 'crew-app-view', version: 1, roomKey: room, pathname: pathname };
  if (selectedRecord && selectedRecord.collection && selectedRecord.recordId) {
   msg.selectedRecord = { collection: String(selectedRecord.collection).slice(0, 100), recordId: String(selectedRecord.recordId).slice(0, 150) };
  }
  parent.postMessage(msg, location.origin);
 }
 if (typeof history !== 'undefined' && history) {
  ['pushState', 'replaceState'].forEach(function(method){
   var orig = history[method];
   if (typeof orig === 'function') {
    history[method] = function(){
     var res = orig.apply(this, arguments);
     try { emitView(); } catch(_) {}
     return res;
    };
   }
  });
 }
 if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
  window.addEventListener('popstate', function(){ try { emitView(); } catch(_) {} });
  window.oddjobCrew = {
   roomKey: room,
   setSelectedRecord: function(record){
    selectedRecord = record && record.collection && record.recordId
     ? { collection: String(record.collection), recordId: String(record.recordId) }
     : null;
    emitView();
   },
   notifyView: emitView
  };
 }
 if (query.get('crewActivity') !== 'chat') {
  emitView();
  return;
 }
 var style = document.createElement('style');
 style.textContent = ${JSON.stringify(CREW_APP_PRESENTATION_CSS)};
 document.head.appendChild(style);
 emitView();
 var busy = false;
 async function refresh(){
  if (busy) return;
  busy = true;
  try {
   var response = await fetch('/api/oddjob/events/history?limit=100', {credentials:'same-origin'});
   if (!response.ok) throw new Error('Activity history unavailable (' + response.status + ')');
   var data = await response.json();
   if (!Array.isArray(data.events)) throw new Error('Invalid activity history response');
   parent.postMessage({source:'crew-app-activity',version:1,roomKey:room,events:data.events},location.origin);
  } catch(error) {
   parent.postMessage({source:'crew-app-activity',version:1,roomKey:room,error:String(error.message || 'Activity history unavailable')},location.origin);
  } finally { busy = false; }
 }
 refresh();
 var timer = setInterval(refresh,10000);
 if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
  window.addEventListener('message', function(event){
   var d = event && event.data;
   if (!d || event.origin !== location.origin || event.source !== parent || d.source !== 'crew-host-event' || d.roomKey !== room) return;
   refresh();
   if (typeof CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('oddjob:crew-host-event', { detail: d }));
   }
  });
  window.addEventListener('pagehide',function(){clearInterval(timer);});
 }
})();</script>`;
