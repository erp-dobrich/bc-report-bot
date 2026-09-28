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
function updateError(cfg){
 const current=chrome.runtime.getManifest().version,min=String(cfg?.minimumVersion||'0.0.0'),latest=String(cfg?.latestVersion||min);
 if(versionCmp(current,min)<0)return{ok:false,error:`Нужна е актуализация на разширението. Текуща ${current}, нужна ${min}.`,code:'UPDATE_REQUIRED',data:{currentVersion:current,minimumVersion:min,latestVersion:latest}};
 return null;
}

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(!['API','STORE_STATE','CHECK_STATE','VERSION'].includes(m.type))return;
 (async()=>{try{
  if(m.type==='STORE_STATE'||m.type==='CHECK_STATE'){
   const key=STATE_KEYS[m.type],store=chrome.storage.session;
   if(m.action==='get'){const x=await store.get(key);return reply({ok:true,data:x[key]||null})}
   if(m.action==='set'){await store.set({[key]:m.data});return reply({ok:true})}
   if(m.action==='clear'){await store.remove(key);return reply({ok:true})}
   throw Error('Невалидна state операция');
  }
  const cfg=await getConfig(m.type==='VERSION'),blocked=updateError(cfg);
  if(m.type==='VERSION')return reply(blocked||{ok:true,data:{currentVersion:chrome.runtime.getManifest().version,latestVersion:cfg.latestVersion,minimumVersion:cfg.minimumVersion,updatedAt:cfg.updatedAt}});
  if(blocked)return reply(blocked);
  const headers={'Content-Type':'application/json','X-Client-Version':chrome.runtime.getManifest().version};
  const r=await fetch(`${API_URL}${m.path}`,{method:m.method||'GET',headers,body:m.body?JSON.stringify(m.body):undefined,cache:'no-store'}),data=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
  if(r.status===426){configCache=null;return reply({ok:false,error:data?.error||'Нужна е актуализация на разширението',code:'UPDATE_REQUIRED',data})}
  reply({ok:r.ok,data,error:r.ok?undefined:(data?.error||`HTTP ${r.status}`)});
 }catch(e){reply({ok:false,error:e.message||'Сървърът не е достъпен'})}})();
 return true;
});