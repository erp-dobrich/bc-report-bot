const zlib=require('zlib'),fs=require('fs'),path=require('path'),bc=require('./bc'),{getStores}=require('./stores-db');
const STOP='__STOP__',HOST=bc.HOST,LIST=HOST+'?page=99001519&company=Ovcharovo_EUR&dc=0&bookmark=16%3bj6TmBQJ7AAAAAns%3d',STATE=path.join(__dirname,'data','checker-state.json');
const ALLOWED=new Set(['871700205','871700229','871700383','871700392','8900203','8900240','8900251','8900253','8900270','99601098','99601099']);
const F={item:'513796353_c2',desc:'328252749_c7',loc:'11512027_c8',inv:'1378592350_c14',sold:'1432469543_c12',dif:'665574632_c13'},LF='1683018650_c1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cap=null,listCap=null,job=loadState(),reportFrame=null,activeCode='',lastView='',route='';
let waiters=new Set(),revision=Math.max(Date.now(),Number(job?.updatedAt)||0);job.rev=revision;
function blank(){return{running:false,stop:false,phase:'idle',filter:'',stores:[],targets:[],total:0,done:0,current:'',currentStore:'',currentDate:'',currentRows:0,read:0,results:{},error:null,startedAt:0,finishedAt:0,updatedAt:0,rev:0}}
function loadState(){try{const x=JSON.parse(fs.readFileSync(STATE,'utf8'));return{...blank(),...x,running:false,stop:false,current:'',currentRows:0,error:null,phase:x?.finishedAt?'done':'idle',rev:0}}catch{return blank()}}
function snapshot(){return{...job,results:{...(job.results||{})}}}
function touch(){revision=Math.max(revision+1,Date.now());job.rev=revision;job.updatedAt=Date.now();for(const done of waiters)done();waiters.clear()}
function saveState(){try{touch();fs.mkdirSync(path.dirname(STATE),{recursive:true});fs.writeFileSync(STATE,JSON.stringify({results:job.results||{},startedAt:job.startedAt||0,finishedAt:job.finishedAt||0,updatedAt:job.updatedAt}))}catch(e){console.log('CHECKER STATE | '+e.message)}}
function waitStatus(since=0,ms=25000){since=Number(since)||0;if((job.rev||0)>since)return Promise.resolve(snapshot());return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);waiters.delete(finish);resolve(snapshot())},timer=setTimeout(finish,Math.max(1000,Math.min(Number(ms)||25000,30000)));waiters.add(finish)})}
function abort(){if(job.stop)throw Error(STOP)}
async function pause(ms){await sleep(ms);abort()}
function val(c){return c==null?'':String(typeof c==='object'?(c.stringValue??c.StringValue??c.objectValue??c.ObjectValue??c.value??c.Value??''):c).trim()}
function bool(v){if(typeof v==='boolean')return v;if(typeof v==='number')return v!==0;return /^(true|1)$/i.test(val(v))}
function int(v){const n=Number(typeof v==='object'?val(v):v);return Number.isInteger(n)?n:null}
function decoded(p){if(typeof p!=='string'||p.length<20)return[];try{const s=zlib.gunzipSync(Buffer.from(p,'base64')).toString('utf8').trim();if(!s)return[];try{return[JSON.parse(s)]}catch{}const out=[];for(const part of s.split('\x1e')){const x=part.trim();if(!x)continue;try{out.push(JSON.parse(x))}catch(e){if(cap)cap.decodeError='Невалиден compressed BC fragment: '+e.message}}if(!out.length&&cap&&!cap.decodeError)cap.decodeError='Compressed BC отговорът не се разчете';return out}catch(e){if(cap)cap.decodeError='Compressed BC отговорът не се разархивира: '+e.message;return[]}}
function newListCap(){return{codes:new Set(),unread:null,canRead:null,last:0,key:'',meta:new Map()}}
function refKey(o){const r=o?.ControlReference||o?.controlReference;if(!r)return'';const f=String(r.formId??r.FormId??''),c=String(r.controlPath??r.ControlPath??'');return f||c?f+'|'+c:''}
function refForm(k){return String(k||'').split('|')[0]}
function syncList(){if(!listCap)return;if(listCap.key){const m=listCap.meta.get(listCap.key);if(m){if(Number.isInteger(m.unread))listCap.unread=m.unread;if(typeof m.canRead==='boolean')listCap.canRead=m.canRead}}}
function readListMeta(o){if(!listCap||o?.t!=='PropertyChange')return;const n=o.PropertyName;if(n!=='Data.Rows.UnreadRowsForward'&&n!=='Data.Rows.CanReadRowsForward')return;const k=refKey(o);if(!k)return;const m=listCap.meta.get(k)||{};if(n==='Data.Rows.UnreadRowsForward'){const v=int(o.PropertyValue);if(v!==null)m.unread=v}else m.canRead=bool(o.PropertyValue);listCap.meta.set(k,m);if(k===listCap.key){if(Number.isInteger(m.unread))listCap.unread=m.unread;if(typeof m.canRead==='boolean')listCap.canRead=m.canRead}listCap.last=Date.now()}
function readListRow(o){if(!listCap||!o||!/^DataRow(?:Inserted|Updated)$/.test(o.t||''))return;const d=o[o.t],row=Array.isArray(d)?d[1]:d,c=row?.cells;if(!c?.[LF])return;const code=val(c[LF]);if(!/^\d{6}S\d+$/.test(code))return;const k=refKey(o);if(k)listCap.key=k;listCap.codes.add(code);listCap.last=Date.now()}
function listCells(c){if(!listCap||!c||typeof c!=='object'||!c[LF])return;const x=val(c[LF]);if(/^\d{6}S\d+$/.test(x)){listCap.codes.add(x);listCap.last=Date.now()}}
function scanList(o,ctx=''){if(!o||typeof o!=='object')return;if(Array.isArray(o)){o.forEach(x=>scanList(x,ctx));return}readListMeta(o);readListRow(o);if(o.cells)listCells(o.cells);if(o.compressed===true)for(const k of['result','data'])for(const x of decoded(o[k]))scanList(x,ctx);for(const[k,v]of Object.entries(o)){if(o.compressed===true&&(k==='result'||k==='data'))continue;if(v&&typeof v==='object')scanList(v,ctx);else if(typeof v==='string'&&/^\s*[\[{]/.test(v)){try{scanList(JSON.parse(v),ctx)}catch{for(const q of v.split('\x1e'))try{if(q.trim())scanList(JSON.parse(q),ctx)}catch{}}}}}
function resultTitle(o,depth=0){if(!o||typeof o!=='object'||depth>8)return false;if(Array.isArray(o))return o.some(x=>resultTitle(x,depth+1));for(const k of['Caption','caption','Title','title','Text','text'])if(/Недостиг\s+на\s+количества\s+в\s+магазин/i.test(String(o[k]||'')))return true;return Array.isArray(o.Children)&&o.Children.some(x=>resultTitle(x,depth+1))}
function findResultForm(o){if(!cap||!o||typeof o!=='object')return;if(Array.isArray(o)){for(const x of o)findResultForm(x);return}if(o.t==='lf'&&resultTitle(o)){const id=String(o.ServerId||o.ControlReference?.formId||'');if(id)cap.dialogForm=id}if(o.compressed===true)for(const k of['result','data'])for(const x of decoded(o[k]))findResultForm(x);for(const[k,v]of Object.entries(o)){if(o.compressed===true&&(k==='result'||k==='data'))continue;if(v&&typeof v==='object')findResultForm(v)}}
function gridState(k){let g=cap.grids.get(k);if(!g){g={rows:new Map(),unread:null,canRead:null,last:0,refresh:false};cap.grids.set(k,g)}return g}
function syncResultGrid(){if(!cap)return;if(!cap.gridKey){const rows=[...cap.grids.entries()].filter(([,g])=>g.rows.size).sort((a,b)=>b[1].rows.size-a[1].rows.size);if(rows.length)cap.gridKey=rows[0][0];else{const meta=[...cap.grids.entries()].filter(([,g])=>g.refresh||Number.isInteger(g.unread)||typeof g.canRead==='boolean');if(meta.length===1)cap.gridKey=meta[0][0]}}if(!cap.gridKey)return;const g=cap.grids.get(cap.gridKey);if(!g)return;cap.serverRows=g.rows;if(Number.isInteger(g.unread))cap.unread=g.unread;if(typeof g.canRead==='boolean')cap.canRead=g.canRead;cap.metaLast=g.last||cap.metaLast}
function readResultMeta(o,k){if(!cap||!k)return;const changes=o.Changes||(o.t==='PropertyChange'?{[o.PropertyName]:o.PropertyValue}:{}),g=gridState(k);let changed=false;if(Object.prototype.hasOwnProperty.call(changes,'Data.Rows.UnreadRowsForward')){const v=int(changes['Data.Rows.UnreadRowsForward']);if(v!==null&&v!==g.unread){g.unread=v;changed=true}}if(Object.prototype.hasOwnProperty.call(changes,'Data.Rows.CanReadRowsForward')){const v=bool(changes['Data.Rows.CanReadRowsForward']);if(v!==g.canRead){g.canRead=v;changed=true}}if(o.t==='DataRefreshChange'&&!g.refresh){g.refresh=true;changed=true}if(changed){g.last=Date.now();cap.metaLast=g.last}syncResultGrid()}
function serverRow(row,k,idx=null){if(!cap||!row?.cells?.[F.item]||!k)return;const c=row.cells,item=val(c[F.item]);if(!item)return;const location=val(c[F.loc])||cap.store,g=gridState(k),bookmark=String(row.bookmark||'').trim(),ri=Number.isInteger(idx)?idx:int(row.rowIndex??row.RowIndex??row.index),fallback=[item,location,val(c[F.desc]),val(c[F.inv]),val(c[F.sold]),val(c[F.dif])].join('|'),key=bookmark||`${k}|${Number.isInteger(ri)?'i'+ri:'v'+fallback}`,old=g.rows.get(key)||{},has=id=>Object.prototype.hasOwnProperty.call(c,id),data={...old,item,location,bookmark:bookmark||old.bookmark||''};if(has(F.desc))data.description=val(c[F.desc]);else if(data.description==null)data.description='';if(has(F.inv))data.inventory=val(c[F.inv]);else if(data.inventory==null)data.inventory='';if(has(F.sold))data.sold=val(c[F.sold]);else if(data.sold==null)data.sold='';if(has(F.dif))data.deficiency=val(c[F.dif]);else if(data.deficiency==null)data.deficiency='';if(Number.isInteger(ri))data.rowIndex=ri;const changed=!g.rows.has(key)||Object.keys(data).some(x=>data[x]!==old[x]);g.rows.set(key,data);if(changed){g.last=Date.now();cap.serverLast=g.last;cap.socket=g.last}syncResultGrid();job.currentRows=cap.serverRows.size}
function walkResult(o,ctx='',hint=null){if(!cap||!o||typeof o!=='object')return;if(Array.isArray(o)){o.forEach((x,i)=>walkResult(x,ctx,i));return}const own=refKey(o)||ctx;if(own)readResultMeta(o,own);if(/^DataRow(?:Inserted|Updated)$/.test(o.t||'')){const d=o[o.t],idx=Array.isArray(d)?int(d[0]):null,row=Array.isArray(d)?d[1]:d;serverRow(row,own,idx)}else if(o.cells?.[F.item])serverRow(o,own,null);if(o.compressed===true)for(const k of['result','data'])for(const x of decoded(o[k]))walkResult(x,own);for(const[k,v]of Object.entries(o)){if(o.compressed===true&&(k==='result'||k==='data'))continue;if(v&&typeof v==='object')walkResult(v,own);else if(typeof v==='string'&&/^\s*[\[{]/.test(v)){try{walkResult(JSON.parse(v),own)}catch{for(const q of v.split('\x1e'))try{if(q.trim())walkResult(JSON.parse(q),own)}catch{}}}}}
function requestInteractions(x){const out=[];for(const a of x?.arguments||[])for(const prm of a?.params||[])for(const i of prm?.interactionsToInvoke||[]){let params={};try{params=JSON.parse(i.namedParameters||'{}')}catch{}out.push({...i,params,navigation:prm.navigationContext?.location||'',openFormIds:prm.openFormIds||[]})}return out}
function resultSent(x,channel){if(!cap||x?.target!=='InvokeRequest')return;const list=requestInteractions(x);if(cap.awaitingInvocation&&cap.armAt&&Date.now()-cap.armAt<7000){const hit=list.find(i=>i.interactionName==='InvokeAction'&&(!i.navigation||/page=99001512/i.test(i.navigation)));if(hit){cap.awaitingInvocation=false;cap.channel=channel;cap.invocationId=String(x.invocationId??'');cap.actionForm=String(hit.formId||'');cap.responseSeen=false;cap.requestAt=Date.now();return}}if(cap.channel!==channel||!cap.gridKey)return;for(const i of list)if(i.interactionName==='ScrollRepeater'&&`${i.formId||''}|${i.controlPath||''}`===cap.gridKey)cap.followups.add(String(x.invocationId??''))}
function resultReceived(x,channel){if(!cap||!cap.invocationId||cap.channel!==channel)return;const id=String(x?.invocationId??''),primary=id===cap.invocationId,follow=cap.followups.has(id);if(!primary&&!follow)return;if(primary&&x.type===3)cap.responseSeen=true;if(follow&&x.type===3)cap.followups.delete(id);findResultForm(x);walkResult(x);cap.socket=Date.now();syncResultGrid()}
function handleSocketFrame(event){const direction=event&&typeof event==='object'&&Object.prototype.hasOwnProperty.call(event,'payload')?event.direction:'received',payload=event&&typeof event==='object'&&Object.prototype.hasOwnProperty.call(event,'payload')?event.payload:event,channel=event&&typeof event==='object'?event.channel:null;for(const part of String(payload||'').split('\x1e'))try{if(!part.trim())continue;const x=JSON.parse(part);if(direction==='sent')resultSent(x,channel);else{if(listCap)scanList(x);resultReceived(x,channel)}}catch{}syncList()}
function put(item,loc,d={}){item=val(item);loc=val(loc);if(!cap||!item)return;const location=loc||cap.store,ri=Number(d?.rowIndex),k=Number.isInteger(ri)&&ri>0?'i'+ri:`v|${item}|${location}|${val(d?.description)}|${val(d?.inventory)}|${val(d?.sold)}|${val(d?.deficiency)}`,old=cap.rows.get(k),row={...(old||{}),item,location,...d};const changed=!old||Object.keys(row).some(x=>row[x]!==old[x]);cap.rows.set(k,row);if(changed)cap.last=Date.now()}
function bookmark(code){ const u=s=>Buffer.from(s,'utf16le'),store=code.split('S')[0],r=u(code); return'54;'+Buffer.concat([
Buffer.from([0x8f,0xa4,0xe6,0x05,0x02,0x7b,0x06]), u(store), Buffer.from([0,0,2,0x7b,0xff]), r.subarray(0,r.length-1) ]).toString('base64'); }
function reportUrl(code){ const u=new URL(HOST); u.searchParams.set('page','99001512'); u.searchParams.set('company','Ovcharovo_EUR');
u.searchParams.set('dc','0'); u.searchParams.set('bookmark',bookmark(code)); return u.toString(); }
const pad=n=>String(n).padStart(2,'0');
function scope(){ const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
const last=+p.day-1,stores=getStores().map(x=>x.code); return{stores,last,from:`01.${p.month}.${p.year}`,to:last?`${pad(last)}.${p.month}.${p.year}`:''}; }
function runScope(){const base=scope(),active=new Set(base.stores),requested=Array.isArray(job.stores)?job.stores.map(String).filter(x=>active.has(x)):[];
const date=x=>/^\d{2}\.\d{2}\.\d{4}$/.test(String(x||''))?String(x):'';return{stores:requested.length?requested:base.stores,last:base.last,from:date(job.from)||base.from,to:date(job.to)||base.to};}
function scopedListUrl(stores,from,to){const u=new URL(LIST),filter=`'Store No.' IS '${stores.join('|')}' AND 'Trans. Ending Date' IS '${from}..${to}'`;u.searchParams.set('filter',filter);return u.toString().replace(/\+/g,'%20')}
async function listFrame(ms=15000,needSearch=false){const end=Date.now()+ms,p=await bc.ensurePage();while(Date.now()<end){abort();const frames=p.frames();for(const f of frames){try{const rows=f.locator('a[role="button"]:visible,[role="button"]:visible').filter({hasText:/^\s*\d{6}S\d+\s*$/});if(await rows.count().catch(()=>0))return f;const grid=f.locator('table.ms-nav-grid-data-table:visible,[role="grid"]:visible,.ms-nav-grid:visible,.ms-nav-scrollable:visible,.scroll-source:visible');if(await grid.count().catch(()=>0)){if(!needSearch)return f;const search=f.locator('input.ms-SearchBox-field:visible,input[type="search"]:visible,input[role="searchbox"]:visible,[role="searchbox"] input:visible,input[placeholder*="Търс"]:visible,input[aria-label*="Търс"]:visible');if(await search.count().catch(()=>0))return f}if(listCap?.codes?.size){const first=[...listCap.codes][0];if(first&&await f.getByText(first,{exact:true}).count().catch(()=>0))return f}const url=String(f.url?.()||'');if(/page=99001519/i.test(url)){const body=f.locator('body:visible');if(await body.count().catch(()=>0)&&Date.now()>end-9000)return f}}catch{}}await pause(50)}return null}
async function loadListPage(p,url,text='',tries=3){let last='Списъкът не се зареди';for(let attempt=1;attempt<=tries;attempt++){abort();listCap=newListCap();try{await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});let f=await listFrame(15000,!!String(text||'').trim());if(!f)throw Error('Списъкът не се зареди');await filterList(f,text);f=await listFrame(10000,false);if(!f)throw Error('Списъкът не се зареди след филтъра');for(let end=Date.now()+5000;Date.now()<end&&!listCap.codes.size;){const s=await listStep(f);addVisible(s);if(listCap.codes.size)break;await pause(50)}return f}catch(e){last=String(e?.message||e).split('\n')[0];if(attempt>=tries)break;console.log(`  ⚠ ${last}; презареждам списъка и опитвам отново (${attempt+1}/${tries})`);await pause(400)}}listCap=null;throw Error(last||'Списъкът не се зареди')}
async function pick(x){ const a=[]; for(let i=0,n=await x.count().catch(()=>0);i<n;i++)try{ const e=x.nth(i); if(!await e.isVisible())continue;
const b=await e.boundingBox(); if(b)a.push({e,y:b.y}); }catch{} return a.sort((a,b)=>b.y-a.y)[0]?.e||null; }
async function pickTop(x){ const a=[]; for(let i=0,n=await x.count().catch(()=>0);i<n;i++)try{ const e=x.nth(i);if(!await e.isVisible())continue;
const b=await e.boundingBox();if(b)a.push({e,y:b.y});}catch{}return a.sort((a,b)=>a.y-b.y)[0]?.e||null;}
async function listStep(f,mode='stay'){ return f.evaluate(mode=>{
const a=[...document.querySelectorAll('a[role="button"]')].filter(e=>/^\s*\d{6}S\d+\s*$/.test(e.textContent||''));
const codes=a.map(e=>(e.textContent||'').trim()).filter(x=>/^\d{6}S\d+$/.test(x)); let s=a[0]; while(s&&s!==document.documentElement){
const c=getComputedStyle(s); if(s.scrollHeight>s.clientHeight+40&&/(auto|scroll)/.test(c.overflowY||''))break; s=s.parentElement; }
if(!s||s===document.documentElement) s=[...document.querySelectorAll('.ms-nav-scrollable,.scroll-source')]
.filter(e=>e.scrollHeight>e.clientHeight+40) .sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]||null;
if(!s)return{codes,bottom:true,moved:false}; const old=s.scrollTop,max=Math.max(0,s.scrollHeight-s.clientHeight);
const step=Math.max(140,Math.floor(s.clientHeight*.55)); if(mode==='reset')s.scrollTop=0; if(mode==='move')s.scrollTop=Math.min(max,old+step);
if(mode==='nudge')s.scrollTop=Math.max(0,old-Math.max(90,Math.floor(s.clientHeight*.18))); if(mode==='end')s.scrollTop=max;
if(mode!=='stay')s.dispatchEvent(new Event('scroll',{bubbles:true})); return{codes,bottom:s.scrollTop>=max-2,moved:s.scrollTop!==old};
},mode).catch(()=>({codes:[],bottom:true,moved:false})); }
function addVisible(s){ if(!listCap)return; const n=listCap.codes.size; s.codes.forEach(x=>listCap.codes.add(x)); if(listCap.codes.size!==n){
listCap.last=Date.now(); syncList(); } }
function showList(last){ if(!listCap)return last; const n=listCap.codes.size; if(n!==last){ job.read=n; console.log(`  намерени: ${n}`); } return n; }
async function waitListProgress(f,size,unread,ms=1400){ const end=Date.now()+ms; while(Date.now()<end){ abort(); const s=await listStep(f);
addVisible(s); if(listCap.codes.size>size)return true;
if(Number.isInteger(unread)&&Number.isInteger(listCap.unread)&&listCap.unread<unread)return true;
if(listCap.unread===0||listCap.canRead===false)return true; await pause(50); } return false; }
async function kickList(f){ await listStep(f,'nudge'); await pause(45); await listStep(f,'end'); }
async function filterList(f,text){ text=String(text||'').trim(); if(!text)return;
const q='input.ms-SearchBox-field,input[type="search"],input[role="searchbox"],[role="searchbox"] input,input[placeholder*="Търс"],input[aria-label*="Търс"]';
let input=await pick(f.locator(q)); if(!input){ const icon=await pick(f.locator('i[data-icon-name="Search"]')); if(icon){
const b=icon.locator('xpath=ancestor::button[1]'); await(await b.count()?b.first():icon).click().catch(()=>{}); await pause(100); }
for(let end=Date.now()+2500;Date.now()<end&&!input;){ input=await pick(f.locator(q)); if(!input)await pause(40); } }
if(!input)throw Error('Не намерих филтъра'); await input.fill(text); listCap=newListCap(); await input.press('Enter').catch(()=>{}); await pause(250);
}
async function collectReports(text='',url=LIST){ const p=await bc.ensurePage();
let f=await loadListPage(p,url,text,2); await listStep(f,'reset'); await pause(120);
let last=-1,stuck=0; for(let i=0;i<500;i++){ abort(); const s=await listStep(f); addVisible(s); syncList(); last=showList(last);
if(listCap.unread===0||listCap.canRead===false){ await pause(120); const z=await listStep(f); addVisible(z); last=showList(last); break; }
const size=listCap.codes.size,unread=listCap.unread; if(s.bottom)await kickList(f); else await listStep(f,'move');
const moved=await waitListProgress(f,size,unread,1500); last=showList(last); if(moved){ stuck=0; continue; }
if(Number.isInteger(listCap.unread)&&listCap.unread>0){ if(++stuck>=6)break; await kickList(f); await pause(120); }else if(++stuck>=3)break; }
const out=[...listCap.codes],unread=listCap.unread; listCap=null; if(!out.length)throw Error('Не намерих отчети');
if(Number.isInteger(unread)&&unread>0) throw Error(`Остават ${unread} непрочетени отчета`); return out.map(code=>({code})); }
async function reportView(f,code){ return f.evaluate(code=>{
const text=e=>String(e?.value??e?.innerText??e?.textContent??'').replace(/\s+/g,' ').trim();
const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
const rx=/\b\d{6}S\d+\b/g,headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(vis);
const values=new Set();for(const e of headings)for(const x of(text(e).match(rx)||[]))values.add(x);
const hit=headings.find(e=>(text(e).match(rx)||[]).includes(code));
const title=String(document.title||''),titleCodes=title.match(rx)||[];for(const x of titleCodes)values.add(x);
const found=!!hit||titleCodes.includes(code);let unpostedSales=null;
if(found){const e=hit||document.body,root=e.closest?.('.spa-view.shown,.spa-view,.ms-nav-content,[role="dialog"],.task-dialog-content-container')||document.body;
document.querySelectorAll('[data-bc-report]').forEach(x=>x.removeAttribute('data-bc-report'));root.setAttribute('data-bc-report','1');const rt=text(root),um=rt.match(/(?:Неосчетоводени\s+записи\s+за\s+продажби|Unposted\s+Sales\s+Entries)[^0-9]{0,80}([0-9][0-9\s.,]*)/i);if(um){const n=Number(String(um[1]).replace(/[^0-9]/g,''));if(Number.isFinite(n))unpostedSales=n}}
const ready=[...document.querySelectorAll('button,[role="button"],h1,h2,h3,[role="heading"]')].some(e=>vis(e)&&/Провери за липси в наличността|Осчетоводен отчет|Отворен Отчет/i.test(text(e)+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')));
const message=[...document.querySelectorAll('[role="alert"],[role="alertdialog"]')].filter(vis).map(text).join(' ').slice(0,220);
return{found,actual:[...values].join(', '),message,ready,unpostedSales}; },code).catch(e=>({found:false,actual:'',message:e.message.split('\n')[0].slice(0,160),ready:false,unpostedSales:null})); }
async function waitReport(code,ms=5000,previous='',noCodeMs=0){ const p=await bc.ensurePage();let wrong='',since=0,readySince=0;lastView='';
for(let end=Date.now()+ms;Date.now()<end;){ abort();let actual='',messages=[],ready=false;
const frames=p.frames(),ordered=reportFrame&&frames.includes(reportFrame)?[reportFrame,...frames.filter(f=>f!==reportFrame)]:frames;
for(const f of ordered){ const r=await reportView(f,code); if(r.found){reportFrame=f;activeCode=code;return true}
if(r.actual)actual=r.actual;if(r.message)messages.push(r.message);if(r.ready)ready=true; }
lastView=`виждам: ${actual||'няма разпознат номер'}${ready?' | картата е заредена':''}${messages.length?' | '+messages.join(' | '):''}`;
if(previous&&actual&&actual!==previous&&actual!==code){if(wrong!==actual){wrong=actual;since=Date.now()}else if(Date.now()-since>=200)return false}else{wrong='';since=0}
if(noCodeMs&&ready&&!actual){if(!readySince)readySince=Date.now();else if(Date.now()-readySince>=noCodeMs)return false}else readySince=0;
await pause(100); } return false; }
async function openReport(code){ abort();const p=await bc.ensurePage();reportFrame=null;route='адрес'; try{
await p.goto(reportUrl(code),{waitUntil:'domcontentloaded',timeout:30000}); if(await waitReport(code,4500,'',1800))return;
}catch(e){abort();lastView=e.message.split('\n')[0]} abort();console.log(`  Отваряне ${code}: ${lastView}; резервно през списъка`);route='списък'; try{
const f=await loadListPage(p,LIST,code,2);abort();
const row=f.locator('a[role="button"]:visible').filter({hasText:new RegExp('^\\s*'+code+'\\s*$')});
await row.first().click({timeout:5000,force:true}); if(await waitReport(code,5000))return; throw Error(lastView);
}catch(e){abort();throw Error(`Отчетът ${code} не се отвори и през списъка: ${e.message.split('\n')[0]}`)} finally{listCap=null} }
async function findListReport(f,code,ms=9000){await listStep(f,'reset');await pause(100);let stuck=0;for(let end=Date.now()+ms;Date.now()<end;){abort();const row=f.locator('a[role="button"]:visible').filter({hasText:new RegExp('^\\s*'+code+'\\s*$')}),hit=await pickTop(row);if(hit)return hit;const s=await listStep(f);addVisible(s);if((listCap?.unread===0||listCap?.canRead===false)&&s.bottom)return null;const size=listCap?.codes?.size||0,unread=listCap?.unread;if(s.bottom)await kickList(f);else await listStep(f,'move');if(await waitListProgress(f,size,unread,900)){stuck=0;continue}if(++stuck>=4)return null}return null}
async function openStoreFirst(store,code,url){abort();const p=await bc.ensurePage();reportFrame=null;route='магазин';let listError='';try{
const f=await loadListPage(p,url,'',2),first=await findListReport(f,code,6000);if(!first)throw Error(`Не намерих точния отчет ${code} в списъка за магазин ${store}`);
console.log(`  Магазин ${store}: отварям точния първи отчет ${code}`);await first.click({timeout:5000,force:true});
if(await waitReport(code,5500))return;throw Error(`BC не потвърди точния отчет ${code} (${lastView})`);
}catch(e){abort();listError=String(e?.message||e).split('\n')[0];console.log(`  ⚠ ${listError}; отварям точно ${code} по адрес`);listCap=null;try{route='точен адрес';await openReport(code);return}catch(e2){abort();throw Error(`Не успях да отворя ${code} за магазин ${store}: ${listError}; точен адрес: ${String(e2?.message||e2).split('\n')[0]}`)}}finally{listCap=null}}
async function nextReport(code){ abort();const f=reportFrame;if(!f||f.isDetached()||!activeCode)return false; try{
if(!(await reportView(f,activeCode)).found)return false; const marked=await f.evaluate(()=>{
document.querySelectorAll('[data-bc-next]').forEach(e=>e.removeAttribute('data-bc-next'));
const root=document.querySelector('[data-bc-report]')||document.querySelector('.spa-view.shown')||document.body;
const candidates=[...root.querySelectorAll('button,[role="button"]')].filter(e=>{ const r=e.getBoundingClientRect(),s=getComputedStyle(e);
return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('[role="grid"],tr,[role="row"],[hidden]');
}); let next=candidates.filter(e=>/Следващ|Next/i.test((e.getAttribute('aria-label')||'')+' '+(e.title||'')+' '+(e.textContent||'')));
if(!next.length)next=candidates.filter(e=>e.querySelector('i[data-icon-name="ChevronRight"]'));
if(!next.length)return false;next[0].setAttribute('data-bc-next','1');return true; }); if(!marked)return false;
route='стрелка';await f.locator('[data-bc-next="1"]').click({timeout:2000,force:true}); if(await waitReport(code,5000,activeCode))return true;
console.log(`  Следващ ${code}: ${lastView}; резервно по адрес`);return false; }catch(e){abort();return false} }
async function markStoreNext(f){return f.evaluate(()=>{
document.querySelectorAll('[data-bc-store-next]').forEach(e=>e.removeAttribute('data-bc-store-next'));
const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('[role="grid"],tr,[role="row"],[hidden],[aria-hidden="true"]'));
let next=buttons.find(e=>/Следващ|Next/i.test((e.getAttribute('aria-label')||'')+' '+(e.title||'')+' '+(e.textContent||'')));
if(!next)next=buttons.find(e=>e.querySelector('i[data-icon-name="ChevronRight"][class*="navigation-icon"]'));
if(!next)return false;next.setAttribute('data-bc-store-next','1');return true;
}).catch(()=>false)}
async function storeCurrent(code){const p=await bc.ensurePage(),frames=p.frames(),ordered=reportFrame&&frames.includes(reportFrame)?[reportFrame,...frames.filter(f=>f!==reportFrame)]:frames;
for(const f of ordered){const r=await reportView(f,code);if(r.found){reportFrame=f;return{...r,found:true,frame:f,actual:r.actual||code}}if(r.actual)return{...r,found:false,frame:f,actual:r.actual}}return{found:false,frame:null,actual:'',unpostedSales:null}}
async function nextStoreReport(code){abort();route='стрелка';const previous=activeCode;if(!previous)throw Error('Няма предишен отчет за стрелката „Следващ“');
await pause(220);const p=await bc.ensurePage();
for(let attempt=1;attempt<=2;attempt++){
 let arrowFrame=null;
 for(let end=Date.now()+3500;Date.now()<end&&!arrowFrame;){abort();const frames=p.frames(),ordered=reportFrame&&frames.includes(reportFrame)?[reportFrame,...frames.filter(f=>f!==reportFrame)]:frames;
  for(const f of ordered)if(await markStoreNext(f)){arrowFrame=f;break}if(!arrowFrame)await pause(80)}
 if(!arrowFrame)throw Error(`Не намерих стрелката „Следващ“ след ${previous}`);
 if(attempt>1){const cur=await storeCurrent(previous);if(!cur.found)throw Error(`Не потвърдих, че още съм на ${previous}; не натискам стрелката втори път, за да не прескоча отчет`)}
 console.log(`  Следващ → ${code}${attempt>1?' | повторен опит':''}`);
 await arrowFrame.locator('[data-bc-store-next="1"]').click({timeout:2000,force:true}).catch(async()=>{await arrowFrame.locator('[data-bc-store-next="1"]').evaluate(e=>e.click())});
 let stillPrevious=false,other='';
 for(let end=Date.now()+(attempt===1?3500:5000);Date.now()<end;){abort();const frames=p.frames(),ordered=arrowFrame&&frames.includes(arrowFrame)?[arrowFrame,...frames.filter(f=>f!==arrowFrame)]:frames;
  for(const f of ordered){const r=await reportView(f,code);if(r.found){reportFrame=f;activeCode=code;return true}const codes=String(r.actual||'').match(/\b\d{6}S\d+\b/g)||[];
   if(codes.includes(previous))stillPrevious=true;const wrong=codes.find(x=>x!==previous&&x!==code);if(wrong){other=wrong;break}}
  if(other)throw Error(`Стрелката отвори ${other}, а очаквах ${code}`);await pause(90)}
 if(attempt===1&&stillPrevious)continue;
 throw Error(`След стрелката BC не потвърди следващия отчет ${code}; не използвам адрес или списък, за да не прескоча реда`);
}
throw Error(`Не успях да отворя ${code} със стрелката „Следващ“`)}
async function action(){const p=await bc.ensurePage();let openedMore=false;
for(let end=Date.now()+5000;Date.now()<end;){abort();const all=p.frames(),frames=reportFrame&&all.includes(reportFrame)?[reportFrame,...all.filter(f=>f!==reportFrame)]:all;
for(const f of frames){
const direct=f.locator('button:visible,[role="button"]:visible,a:visible').filter({hasText:/Провери за липси в наличността/i});
const a=await pick(direct);if(a)return a;
const labelled=await pick(f.locator('[aria-label*="Провери за липси в наличността"]:visible,[title*="Провери за липси в наличността"]:visible'));if(labelled)return labelled;
}
if(!openedMore){for(const f of frames){const more=await pickTop(f.locator('button:visible,[role="button"]:visible').filter({hasText:/Повече опции|Покажи повече|More options|Show more/i}));
const labelled=more||await pickTop(f.locator('button[aria-label*="Повече опции"]:visible,[role="button"][aria-label*="Повече опции"]:visible,button[title*="Повече опции"]:visible,[role="button"][title*="Повече опции"]:visible'));
if(labelled){await labelled.click({timeout:1500,force:true}).catch(async()=>{await labelled.evaluate(e=>e.click()).catch(()=>{})});openedMore=true;await pause(160);break}}
}else await pause(80);
}return null;}
async function bcErrorDialog(dismiss=false){const p=await bc.ensurePage();for(const f of p.frames())try{const r=await f.evaluate(dismiss=>{const txt=e=>String(e?.value??e?.innerText??e?.textContent??'').replace(/\s+/g,' ').trim(),vis=e=>{if(!e)return false;const b=e.getBoundingClientRect(),st=getComputedStyle(e);return b.width>0&&b.height>0&&st.display!=='none'&&st.visibility!=='hidden'};document.querySelectorAll('[data-bc-check-error]').forEach(e=>e.removeAttribute('data-bc-check-error'));const rx=/Как да докладвате този проблем|Артикул не съществува|Идентификационни полета и стойности|Възникна грешка|Грешка(?:\s+при)?|не може да бъде|не е намерен|does not exist|An error occurred|Error:/i;const root=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"],.ms-Dialog-main,.ms-nav-dialog,.dialog')].filter(vis).find(e=>rx.test(txt(e))&&!/Недостиг\s+на\s+количества\s+в\s+магазин/i.test(txt(e)));if(!root)return{open:false,text:''};root.setAttribute('data-bc-check-error','1');let text=txt(root).replace(/\s*Как да докладвате този проблем[\s\S]*$/i,'').replace(/\s*Тази информация беше ли полезна[\s\S]*$/i,'').trim().slice(0,900);if(dismiss){const buttons=[...root.querySelectorAll('button,[role="button"]')].filter(vis),ok=buttons.find(b=>/^(OK|ОК|Добре|Затваряне|Close)$/i.test(txt(b)))||buttons.find(b=>/OK|ОК|Затваряне|Close/i.test(txt(b)));if(ok)ok.click()}return{open:true,text:text||'Business Central върна грешка'}},dismiss).catch(()=>null);if(r?.open){if(dismiss)await sleep(100);return r}}catch{}return{open:false,text:''}}
function bcActionError(message){const e=Error(message);e.code='BC_ACTION_ERROR';return e}
async function modal(mode='stay'){ let reason=''; for(const p of[await bc.ensurePage()]) for(const f of p.frames())try{
const r=await f.evaluate(mode=>{ const txt=e=>String(e?.value??e?.innerText??e?.textContent??'').replace(/\s+/g,' ').trim(); const vis=e=>{
if(!e)return false; const r=e.getBoundingClientRect(),s=getComputedStyle(e);
return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; };
const h=[...document.querySelectorAll('[title],[role="heading"],h1,h2,h3')].find(e=>{
if(!/Недостиг\s+на\s+количества\s+в\s+магазин/i.test(txt(e)+' '+(e.getAttribute('title')||'')))return false;
const r=e.closest('.ms-nav-content,.task-dialog-content-container,[role="dialog"]');
if(r)return vis(r)&&!r.closest('[hidden],[aria-hidden="true"]')&&(vis(e)||[...r.querySelectorAll('[role="grid"]')].some(vis));
return vis(e)&&!e.closest('[hidden],[aria-hidden="true"]'); });
if(!h)return{open:false,rows:[],expected:0,bottom:true,moved:false,reason:'Не разпознах прозореца; видими заглавия: '+[...document.querySelectorAll('[role="heading"],h1,h2,h3')].filter(vis).map(txt).join(' | ').slice(0,200)};
const root=h?.closest('.ms-nav-content,.task-dialog-content-container,[role="dialog"]')||document;
const heads=[...root.querySelectorAll('[id^="column_header_"]')]; const hid=n=>heads.find(e=>txt(e).replace(/[↑↓▲▼]/g,'').trim()===n)?.id||'';
const field=(row,c,id)=>{ let e=row.querySelector(`[controlname="${c}"] .value,[controlname="${c}"]`);
if(!e&&id)e=row.querySelector(`[aria-labelledby~="${CSS.escape(id)}"]`); return txt(e); };
const ih=hid('Артикул №'),dh=hid('Описание'),lh=hid('Код местоположение'),invh=hid('Наличност'),soldh=hid('Продадено к-во'),difh=hid('Разлика в к-вото'),rows=[]; for(const row of root.querySelectorAll('tr,[role="row"]')){ if(!vis(row))continue;
const item=field(row,'Item No.',ih); const location=field(row,'Location Code',lh); if(item){
 const ri=Number(row.getAttribute('aria-rowindex')||row.querySelector('[aria-rowindex]')?.getAttribute('aria-rowindex'));
 rows.push({item,location,description:field(row,'Description',dh),inventory:field(row,'Inventory',invh),sold:field(row,'Sold Qty.',soldh),deficiency:field(row,'Difference Qty.',difh),rowIndex:Number.isFinite(ri)&&ri>0?ri:null});
} } const grids=[...root.querySelectorAll('[role="grid"][aria-rowcount]')] .filter(vis)
.sort((a,b)=>(+b.getAttribute('aria-rowcount')||0)-(+a.getAttribute('aria-rowcount')||0));
const g=grids[0],raw=g?Number(g.getAttribute('aria-rowcount')):NaN; const expectedRaw=Number.isFinite(raw)&&raw>=0?raw:null;
const headerRows=new Set(heads.map(e=>e.closest('tr,[role="row"]')).filter(Boolean)).size;
let s=root.querySelector('[controlname="Item No."]')||g||root.querySelector('[role="gridcell"]'); while(s&&s!==document.documentElement){
const c=getComputedStyle(s); if(s.scrollHeight>s.clientHeight+30&&/(auto|scroll)/.test(c.overflowY||'')) break; if(s===root){ s=null; break; }
s=s.parentElement; } if(!s||s===document.documentElement) s=[...root.querySelectorAll('.ms-nav-scrollable,.scroll-source')]
.filter(e=>e.scrollHeight>e.clientHeight+30) .sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]||null;
let bottom=true,moved=false; if(s){ const old=s.scrollTop,max=Math.max(0,s.scrollHeight-s.clientHeight); if(mode==='reset')s.scrollTop=0;
if(mode==='move')s.scrollTop=Math.min(max,old+Math.max(120,Math.floor(s.clientHeight*.5)));if(mode==='nudge')s.scrollTop=Math.max(0,old-Math.max(90,Math.floor(s.clientHeight*.2)));if(mode==='end')s.scrollTop=max;if(mode!=='stay')
s.dispatchEvent(new Event('scroll',{bubbles:true})); bottom=s.scrollTop>=max-2; moved=s.scrollTop!==old; }const codeText=txt(root)+' '+[...root.querySelectorAll('input,textarea')].map(e=>String(e.value||'')).join(' '),reportCodes=[...new Set(codeText.match(/\b\d{6}S\d+\b/g)||[])],emptyView=/Няма какво да се покаже в този изглед|There is nothing to show in this view/i.test(txt(root));return{ open:true,
rows,expectedRaw,headerRows,bottom,moved,reportCodes,emptyView }; },mode); if(r.open)return r; if(r.reason)reason=r.reason; }catch(e){reason=e.message.split('\n')[0]} return{ open:false,
rows:[], expectedRaw:null, headerRows:0, bottom:true, moved:false,reportCodes:[],emptyView:false,reason }; }
function incompleteRead(message){const e=Error(message);e.code='CHECKER_INCOMPLETE_READ';return e}
function resetResultCapture(){
 if(!cap)return;cap.rows=new Map();cap.serverRows=new Map();cap.grids=new Map();cap.gridKey='';cap.dialogForm='';cap.unread=null;cap.canRead=null;cap.last=0;cap.serverLast=0;cap.socket=0;cap.metaLast=0;cap.decodeError='';cap.awaitingInvocation=false;cap.invocationId='';cap.channel=null;cap.actionForm='';cap.responseSeen=false;cap.requestAt=0;cap.armAt=0;cap.followups=new Set();job.currentRows=0;
}
function armResultCapture(){if(!cap)return;cap.awaitingInvocation=true;cap.invocationId='';cap.channel=null;cap.actionForm='';cap.responseSeen=false;cap.requestAt=0;cap.armAt=Date.now();cap.followups.clear()}
function expectedResultRows(m){const raw=Number.isInteger(m?.expectedRaw)?m.expectedRaw:null;if(raw===null)return null;const headers=Number.isInteger(m?.headerRows)?m.headerRows:0;return Math.max(0,raw-headers)}
function resultKey(r){const idx=Number(r?.rowIndex);return Number.isInteger(idx)&&idx>0?'i'+idx:`v|${val(r?.item)}|${val(r?.location)||cap?.store||''}|${val(r?.description)}|${val(r?.inventory)}|${val(r?.sold)}|${val(r?.deficiency)}`}
function mergeDomRows(rows){if(!cap)return false;let changed=false,last='';for(const r of rows||[]){const k=resultKey(r),old=cap.rows.get(k);if(!old||Object.keys(r).some(x=>r[x]!==old[x])){cap.rows.set(k,{...(old||{}),...r});changed=true;last=r.item||last}}if(changed){cap.last=Date.now();job.currentRows=Math.max(cap.rows.size,cap.serverRows.size);if(last)console.log(`  извлечени DOM: ${cap.rows.size} | ${last}`)}return changed}
function sortedRows(map){return[...map.values()].sort((a,b)=>(Number(a.rowIndex)||1e9)-(Number(b.rowIndex)||1e9))}
async function waitResultProgress(rows,unread,stamp,ms=1400){const end=Date.now()+ms;while(Date.now()<end){abort();syncResultGrid();if(!cap)return false;if(cap.serverRows.size>rows)return true;if(Number.isInteger(unread)&&Number.isInteger(cap.unread)&&cap.unread<unread)return true;if((cap.serverLast||0)>stamp||(cap.metaLast||0)>stamp)return true;await sleep(20)}return false}
async function selectVisibleResultRows(target){
 if(!cap||!Number.isInteger(target)||target<=0||cap.serverRows.size>=target)return 0;const p=await bc.ensurePage();let clicks=0;
 for(const f of p.frames())try{const count=await f.evaluate(()=>{const txt=e=>String(e?.value??e?.innerText??e?.textContent??'').replace(/\s+/g,' ').trim(),vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const h=[...document.querySelectorAll('[title],[role="heading"],h1,h2,h3')].find(e=>vis(e)&&/Недостиг\s+на\s+количества\s+в\s+магазин/i.test(txt(e)+' '+(e.getAttribute('title')||'')));if(!h)return 0;const root=h.closest('.ms-nav-content,.task-dialog-content-container,[role="dialog"]')||document;return[...root.querySelectorAll('tr,[role="row"]')].filter(r=>vis(r)&&r.querySelector('[controlname="Item No."]')).length}).catch(()=>0);if(!count)continue;
  for(let i=0;i<count&&cap&&cap.serverRows.size<target;i++){abort();const marked=await f.evaluate(i=>{const txt=e=>String(e?.value??e?.innerText??e?.textContent??'').replace(/\s+/g,' ').trim(),vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const h=[...document.querySelectorAll('[title],[role="heading"],h1,h2,h3')].find(e=>vis(e)&&/Недостиг\s+на\s+количества\s+в\s+магазин/i.test(txt(e)+' '+(e.getAttribute('title')||'')));if(!h)return false;const root=h.closest('.ms-nav-content,.task-dialog-content-container,[role="dialog"]')||document;document.querySelectorAll('[data-bc-result-select]').forEach(e=>e.removeAttribute('data-bc-result-select'));const rows=[...root.querySelectorAll('tr,[role="row"]')].filter(r=>vis(r)&&r.querySelector('[controlname="Item No."]'));const row=rows[i];if(!row)return false;row.setAttribute('data-bc-result-select','1');return true},i).catch(()=>false);if(!marked)continue;const row=f.locator('[data-bc-result-select="1"]:visible').first(),cell=row.locator('[controlname="Item No."]').first(),before=cap.serverLast||0,targetEl=await cell.count().catch(()=>0)?cell:row;await targetEl.click({timeout:900,force:true}).catch(async()=>{await row.click({timeout:900,force:true}).catch(()=>{})});clicks++;for(let end=Date.now()+180;Date.now()<end&&cap&&(cap.serverLast||0)===before;)await sleep(15)}return clicks
 }catch{}return clicks
}
async function collectRowsAttempt(attempt){
 const start=Date.now(),LIMIT=9000;let lastSig='',stableAt=0,lastExpected=null,lastRaw=null,lastBottom=false,lastEmptyView=false,opened=false,lastLog=0,stuckAt=0,nudges=0,reportConfirmed=false;
 while(Date.now()-start<LIMIT){abort();if(cap?.decodeError)throw incompleteRead(cap.decodeError);syncResultGrid();const now=Date.now(),bcErr=await bcErrorDialog(false);
  if(bcErr.open){await bcErrorDialog(true).catch(()=>{});throw bcActionError('Business Central: '+bcErr.text)}
  let m=await modal();if(m?.open){opened=true;const codes=Array.isArray(m.reportCodes)?m.reportCodes:[];if(codes.length&&!codes.includes(cap.code))throw incompleteRead(`Прозорецът с резултата е за ${codes.join(', ')}, а очаквам ${cap.code}`);if(codes.includes(cap.code))reportConfirmed=true;lastBottom=!!m.bottom;lastEmptyView=!!m.emptyView;const e=expectedResultRows(m);if(Number.isInteger(e))lastExpected=lastExpected===null?e:Math.max(lastExpected,e);if(Number.isInteger(m.expectedRaw))lastRaw=lastRaw===null?m.expectedRaw:Math.max(lastRaw,m.expectedRaw);if(mergeDomRows(m.rows))stuckAt=Date.now();syncResultGrid()}
  if(!opened&&!cap.invocationId){if(now-start>2600)throw incompleteRead('След натискането BC не отвори резултат и не потвърди действието');await sleep(15);continue}
  if(!opened&&cap.invocationId&&!cap.responseSeen){if(now-(cap.requestAt||start)>5000)throw incompleteRead('BC не върна отговор за InvokeAction '+cap.invocationId);await sleep(15);continue}
  const expected=Number.isInteger(lastExpected)?lastExpected:null,serverN=cap.serverRows.size,domN=cap.rows.size,known=Number.isInteger(cap.unread)||typeof cap.canRead==='boolean',more=Number.isInteger(cap.unread)?cap.unread>0:cap.canRead===true,done=Number.isInteger(cap.unread)?cap.unread===0:cap.canRead===false;
  const sig=`s:${serverN}|d:${domN}|e:${expected??'?'}|u:${cap.unread??'?'}|c:${cap.canRead??'?'}|b:${lastBottom}|r:${reportConfirmed}|z:${lastEmptyView}`;if(sig!==lastSig){lastSig=sig;stableAt=Date.now();if(!stuckAt)stuckAt=stableAt}else if(!stableAt)stableAt=Date.now();
  if(Date.now()-lastLog>350){console.log(`  BC ${serverN} | DOM ${domN}${expected!==null?' / очаквани '+expected:''} | aria-rowcount ${lastRaw??'?'} | отчет ${reportConfirmed?'да':'?'} | празен изглед ${lastEmptyView?'да':'не'} | записи ${Number.isInteger(cap.cardUnposted)?cap.cardUnposted:'?'} | unread ${cap.unread??'?'} | canRead ${cap.canRead??'?'} | bottom ${lastBottom?'да':'не'}`);lastLog=Date.now()}
  if(expected!==null&&domN>expected)throw incompleteRead(`DOM върна ${domN} реда, а aria очаква ${expected}`);
  if(opened&&!reportConfirmed){const trustedBlankEmpty=cap.cardVerified===true&&Number.isInteger(cap.cardUnposted)&&cap.cardUnposted>0&&domN===0&&lastBottom&&!more&&(expected===0||lastEmptyView);if(trustedBlankEmpty&&Date.now()-stableAt>=220){console.log(`  прочетени: 0 | празен резултат без „Отчет No.“, но картата ${cap.code} е потвърдена и има ${cap.cardUnposted} неосчетоводени записа | опит ${attempt}/2`);return[]}if(now-start>3000){if((expected===0||lastEmptyView)&&Number.isInteger(cap.cardUnposted)&&cap.cardUnposted===0)throw incompleteRead(`Празен резултат без „Отчет No.“; картата ${cap.code} е потвърдена, но има 0 неосчетоводени записи за продажби`);throw incompleteRead(`Не потвърдих „Отчет No.“ = ${cap.code} в прозореца с резултата`)}await sleep(20);continue}
  if(opened&&reportConfirmed&&expected!==null&&domN===expected&&lastBottom&&!more&&Date.now()-stableAt>=160){const out=sortedRows(cap.rows);console.log(`  прочетени ВСИЧКИ: ${out.length} / aria ${expected} | DOM${known?' + BC metadata':''} | отчет ${cap.code} | опит ${attempt}/2`);return out}
  if(opened&&reportConfirmed&&cap.gridKey&&known&&done&&!more&&serverN>0&&(expected===null||serverN===expected)&&Date.now()-stableAt>=120){const out=sortedRows(cap.serverRows);console.log(`  прочетени ВСИЧКИ: ${out.length} | BC metadata | отчет ${cap.code} | unread: ${cap.unread??'?'} | canRead: ${cap.canRead??'?'} | опит ${attempt}/2`);return out}
  if(opened&&reportConfirmed&&domN===0&&lastBottom&&!more&&(expected===0||lastEmptyView)&&Date.now()-stableAt>=180){console.log(`  прочетени: 0 | празният резултат е потвърден | отчет ${cap.code} | опит ${attempt}/2`);return[]}
  if(opened&&!lastBottom){await modal('move');await sleep(45);continue}
  if(opened&&more){await modal('end');await sleep(70);continue}
  if(opened&&expected!==null&&domN<expected&&lastBottom){if(!stuckAt)stuckAt=Date.now();if(Date.now()-stuckAt>350){nudges++;await modal('nudge');await sleep(45);await modal('end');await sleep(Math.min(180,70+nudges*15));stuckAt=Date.now()}else await sleep(35);continue}
  if(opened&&reportConfirmed&&expected===null&&known&&done&&!more&&domN>0&&lastBottom&&Date.now()-stableAt>=250){const out=sortedRows(cap.rows);console.log(`  прочетени ВСИЧКИ: ${out.length} | DOM + BC край | отчет ${cap.code} | опит ${attempt}/2`);return out}
  await sleep(25)
 }
 const expected=Number.isInteger(lastExpected)?lastExpected:null,extra=`BC ${cap?.serverRows?.size||0}${expected!==null?' / aria '+expected:''}; DOM ${cap?.rows?.size||0}; отчет ${reportConfirmed?'да':'не'}; grid ${cap?.gridKey||'?'}; form ${cap?.dialogForm||'?'}; unread ${cap?.unread??'?'}; canRead ${cap?.canRead??'?'}`;throw incompleteRead(`Не успях да докажа пълния резултат (${extra})`)
}
async function collectRowsWithRetry(){let firstError=null;for(let attempt=1;attempt<=2;attempt++){if(attempt===2){console.log('  ↻ Втори чист опит');await closeCheck().catch(()=>{});await pause(100);resetResultCapture();const a=await action();if(!a)throw Error('Не намерих проверката при втория опит');armResultCapture();await a.click({timeout:5000,force:true})}try{return await collectRowsAttempt(attempt)}catch(e){if(e?.code!=='CHECKER_INCOMPLETE_READ'||attempt===2)throw e;firstError=e;console.log('  ⚠ Несигурно четене: '+e.message)}}throw firstError||Error('Не успях да прочета резултата')}
async function closeCheck(){ if(!(await modal()).open)return; const p=await bc.ensurePage();await p.keyboard.press('Escape');
for(let end=Date.now()+1500;Date.now()<end;){if(!(await modal()).open)return;await sleep(50)} throw Error('Прозорецът за проверката не се затвори'); }
async function checkOne(r,opt={}){ const started=Date.now(),times={};let result,error,card=null;route='';
const timed=async(name,fn)=>{const t=Date.now();try{return await fn()}finally{times[name]=Date.now()-t}}; try{
await timed('NAV',async()=>{if(opt.firstStore)await openStoreFirst(opt.store,r.code,opt.listUrl);else if(opt.storeMode)await nextStoreReport(r.code);else if(!opt.next||!await nextReport(r.code))await openReport(r.code);card=await storeCurrent(r.code);if(!card?.found)throw Error(`Преди проверката не потвърдих точната карта ${r.code}`)}); abort();const a=await timed('ACTION',action);
if(!a)throw Error('Не намерих проверката');
cap={code:r.code,store:r.code.split('S')[0],cardVerified:true,cardUnposted:Number.isInteger(card?.unpostedSales)?card.unpostedSales:null};resetResultCapture();job.currentRows=0;
const t=Date.now();armResultCapture();await timed('CLICK',()=>a.click({timeout:5000,force:true}));
const items=await timed('RESULT',collectRowsWithRetry);console.log(`  ВСИЧКИ артикули (${items.length}): ${items.map(x=>x.item).join(', ')||'няма'}`);const bad=items.filter(x=>!ALLOWED.has(String(x.item)));
result={status:bad.length?'bad':items.length?'ok':'empty',items,bad,checkMs:Date.now()-t}; }catch(e){error=e}finally{ cap=null;
try{await timed('CLOSE',closeCheck)}catch(e){error=error||e} times.TOTAL=Date.now()-started;
console.log('  ⏱ '+['NAV','ACTION','CLICK','RESULT','CLOSE','TOTAL'].map(k=>`${k} ${((times[k]||0)/1000).toFixed(2)}s`).join(' | ')+` | ${route}`); }
if(error)throw error; return{...result,totalMs:times.TOTAL}; }
function reportStore(code){return String(code||'').split('S')[0]}
function normalizeTargets(targets){const active=new Set(getStores().map(x=>String(x.code))),seen=new Set(),out=[];for(const x of Array.isArray(targets)?targets:[]){const code=String(x?.code||x?.report||'').trim();if(!/^\d{6}S\d+$/.test(code)||seen.has(code))continue;const store=reportStore(code);if(!active.has(store))continue;const date=/^\d{2}\.\d{2}\.\d{4}$/.test(String(x?.date||''))?String(x.date):'';seen.add(code);out.push({code,store,date})}return out}
function errorKind(e){return e?.code==='BC_ACTION_ERROR'?'bc':'technical'}
function groupReports(reports,stores){const m=new Map(),n=r=>Number(String(r.code||'').split('S')[1])||0;for(const r of reports){const s=reportStore(r.code);if(!m.has(s))m.set(s,[]);m.get(s).push(r)}for(const rows of m.values())rows.sort((a,b)=>n(a)-n(b));const out=[],used=new Set();for(const s of stores||[])if(m.has(s)){out.push([s,m.get(s)]);used.add(s)}for(const [s,rows]of m)if(!used.has(s))out.push([s,rows]);return out}
async function run(){try{job.phase='reading';const sc=runScope(),supplied=normalizeTargets(job.targets);console.log(`Чета списъка... активни магазини: ${sc.stores.length} | ${sc.from}${sc.to?'..'+sc.to:''}`);
let reports=[];if(supplied.length){reports=supplied.filter(r=>sc.stores.includes(reportStore(r.code)));job.read=reports.length;console.log(`Точни отчети от таблото: ${reports.length}`)}else{if(!sc.stores.length||!sc.to){job.total=0;job.phase='checking';return}const listUrl=scopedListUrl(sc.stores,sc.from,sc.to);reports=await collectReports(job.filter,listUrl)}abort();
const groups=groupReports(reports,sc.stores);job.total=reports.length;job.phase='checking';touch();console.log(`Намерени отчети: ${reports.length} | магазини с отчети: ${groups.length} | ${sc.from}..${sc.to}`);let pos=0,forceFresh=false;const retry=[];
for(const [store,rows]of groups){if(job.stop)break;const storeUrl=scopedListUrl([store],sc.from,sc.to);console.log(`МАГАЗИН ${store} | отчети: ${rows.length}`);forceFresh=true;
for(let j=0;j<rows.length&&!job.stop;j++){const r=rows[j];pos++;job.current=r.code;job.currentStore=store;job.currentDate=r.date||'';job.currentRows=0;touch();console.log(`[${pos}/${reports.length}] ${r.code}`);let x=null,err=null;
try{x=await checkOne(r,{storeMode:true,firstStore:forceFresh,store,listUrl:storeUrl});forceFresh=false}catch(e){if(job.stop||e.message===STOP)break;err=e;if(!forceFresh&&errorKind(e)!=='bc'){console.log(`  ↻ Безопасно възстановяване: отварям точно ${r.code} от филтрирания списък на магазин ${store}`);try{x=await checkOne(r,{storeMode:true,firstStore:true,store,listUrl:storeUrl});err=null;forceFresh=false}catch(e2){if(job.stop||e2.message===STOP)break;err=e2}}}
if(job.stop)break;if(x){job.results[r.code]=x;job.done=pos;saveState();console.log(`${r.code} = ${x.status.toUpperCase()} | редове: ${x.items.length}${x.bad.length?' | непозволени: '+x.bad.map(x=>x.item).join(','):''} | ${(x.totalMs/1000).toFixed(2)} сек`)}else{const msg=String(err?.message||err||'Неизвестна грешка'),kind=errorKind(err);job.results[r.code]={status:'error',error:msg,errorKind:kind};job.done=pos;saveState();console.log(`${r.code} = ГРЕШКА [${kind==='bc'?'BC':'ТЕХНИЧЕСКА'}] | ${msg}`);if(kind==='technical')retry.push(r);forceFresh=true}}}
if(!job.stop&&retry.length){console.log(`ПОВТОРЕН ОПИТ НА ТЕХНИЧЕСКИТЕ ГРЕШКИ: ${retry.length}`);let n=0;for(const r of retry){if(job.stop)break;if(job.results[r.code]?.status!=='error'||job.results[r.code]?.errorKind!=='technical')continue;n++;job.current=r.code;job.currentStore=reportStore(r.code);job.currentDate=r.date||'';job.currentRows=0;touch();console.log(`  [retry ${n}/${retry.length}] ${r.code} | точен адрес`);try{const x=await checkOne(r,{});job.results[r.code]=x;saveState();console.log(`  ${r.code} = ${x.status.toUpperCase()} след повторен опит | редове: ${x.items.length}${x.bad.length?' | непозволени: '+x.bad.map(x=>x.item).join(','):''}`)}catch(e){if(job.stop||e.message===STOP)break;const msg=String(e?.message||e||'Неизвестна грешка'),kind=errorKind(e);job.results[r.code]={status:'error',error:msg,errorKind:kind,retried:true};saveState();console.log(`  ${r.code} = ГРЕШКА и след повторен опит [${kind==='bc'?'BC':'ТЕХНИЧЕСКА'}] | ${msg}`)}}}
}catch(e){if(!job.stop&&e.message!==STOP){job.error=e.message;console.log('ГРЕШКА:',e.message)}}finally{cap=null;listCap=null;job.running=false;job.current='';job.currentStore='';job.currentDate='';job.currentRows=0;job.finishedAt=Date.now();job.phase=job.stop?'stopped':'done';saveState();console.log(job.stop?'СПРЯНО':'ГОТОВО')}}
function start(options=''){if(job.running)return{ok:false,error:'Вече работи.'};const o=options&&typeof options==='object'?options:{filter:options},store=String(o.store||'').trim(),targets=normalizeTargets(o.targets),stores=/^\d{6}$/.test(store)?[store]:[];
job={...blank(),running:true,phase:'reading',filter:String(o.filter||'').trim().slice(0,200),stores,targets,from:String(o.from||'').trim(),to:String(o.to||'').trim(),startedAt:Date.now(),updatedAt:Date.now()};saveState();void run();return{ok:true};}
function stop(){ job.stop=true; saveState(); return{ok:true}; }
function clear(){if(job.running)return{ok:false,error:'Първо спри.'};job=blank();touch();try{fs.unlinkSync(STATE)}catch(e){if(e.code!=='ENOENT')console.log('CHECKER STATE | '+e.message)}return{ok:true}}
function status(){return snapshot()}
module.exports={start,stop,clear,status,waitStatus,handleSocketFrame};