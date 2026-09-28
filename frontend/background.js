const STATE_KEYS={STORE_STATE:'bc-store-status-state',CHECK_STATE:'bc-report-check-state'};
const WORKER='https://bot-config.erp-admin.workers.dev',CONFIG_URL=`${WORKER}/config`,API_URL=`${WORKER}/api`;
let configCache=null,configAt=0;
chrome.storage.local.remove(STATE_KEYS.CHECK_STATE).catch(()=>{});

function versionParts(v){return String(v||'0').split(/[.+-]/)[0].split('.').map(x=>Number(x)||0)}
function versionCmp(a,b){const A=versionParts(a),B=versionParts(b),n=Math.max(A.length,B.length);for(let i=0;i<n;i++){const d=(A[i]||0)-(B[i]||0);if(d)return d>0?1:-1}return 0}
async function getConfig(force=false){
 if(!force&&configCache&&Date.now()-configAt<15000)return configCache;
 const r=await fetch(CONFIG_URL,{cache:'no-store'}),x=await r.json().catch(()=>({}));
 if(!r.ok||!x?.ok)throw Error(x?.error||'Не мога да прочета конфигурацията на бота');
 configCache=x;configAt=Date.now();return x;
}
function versionState(cfg){
 const current=chrome.runtime.getManifest().version,latest=String(cfg?.latestVersion||'').trim();
 if(!latest)return{ok:false,error:'Липсва latestVersion в конфигурацията.',code:'VERSION_CONFIG_ERROR',data:{currentVersion:current}};
 const data={currentVersion:current,latestVersion:latest,minimumVersion:String(cfg?.minimumVersion||latest),updateUrl:String(cfg?.updateUrl||'').trim(),updatedAt:cfg?.updatedAt||null};
 if(versionCmp(current,latest)!==0)return{ok:false,error:`Версия ${current} е заключена. Нужна е последната версия ${latest}.`,code:'UPDATE_REQUIRED',data};
 return{ok:true,data};
}
async function openUpdateUrl(url){
 const target=String(url||'').trim();
 if(!/^https:\/\//i.test(target))return false;
 await chrome.tabs.create({url:target});return true;
}
async function requestUpdate(cfg){
 const state=versionState(cfg);
 if(state.ok)return{ok:true,data:{...state.data,status:'current'}};
 if(state.code!=='UPDATE_REQUIRED')return state;
 try{
  const result=await chrome.runtime.requestUpdateCheck();
  if(result?.status==='update_available')return{ok:true,data:{...state.data,status:'update_available',availableVersion:result.version||state.data.latestVersion}};
  if(result?.status==='throttled')return{ok:true,data:{...state.data,status:'throttled'}};
 }catch{}
 const opened=await openUpdateUrl(state.data.updateUrl).catch(()=>false);
 if(opened)return{ok:true,data:{...state.data,status:'manual_opened'}};
 return{ok:false,error:'Chrome не намери автоматична актуализация и няма зададен updateUrl.',code:'UPDATE_UNAVAILABLE',data:state.data};
}

chrome.runtime.onUpdateAvailable.addListener(()=>chrome.runtime.reload());

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(!['API','STORE_STATE','CHECK_STATE','VERSION','UPDATE'].includes(m.type))return;
 (async()=>{try{
  if(m.type==='STORE_STATE'||m.type==='CHECK_STATE'){
   const key=STATE_KEYS[m.type],store=chrome.storage.session;
   if(m.action==='get'){const x=await store.get(key);return reply({ok:true,data:x[key]||null})}
   if(m.action==='set'){await store.set({[key]:m.data});return reply({ok:true})}
   if(m.action==='clear'){await store.remove(key);return reply({ok:true})}
   throw Error('Невалидна state операция');
  }
  const cfg=await getConfig(m.type==='VERSION'||m.type==='UPDATE');
  if(m.type==='VERSION')return reply(versionState(cfg));
  if(m.type==='UPDATE')return reply(await requestUpdate(cfg));
  const blocked=versionState(cfg);
  if(!blocked.ok)return reply(blocked);
  const headers={'Content-Type':'application/json','X-Client-Version':chrome.runtime.getManifest().version};
  const r=await fetch(`${API_URL}${m.path}`,{method:m.method||'GET',headers,body:m.body?JSON.stringify(m.body):undefined,cache:'no-store'}),data=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
  if(r.status===426){configCache=null;return reply({ok:false,error:data?.error||'Нужна е актуализация на разширението',code:'UPDATE_REQUIRED',data})}
  reply({ok:r.ok,data,error:r.ok?undefined:(data?.error||`HTTP ${r.status}`)});
 }catch(e){reply({ok:false,error:e.message||'Сървърът не е достъпен',code:'VERSION_CHECK_FAILED'})}})();
 return true;
});