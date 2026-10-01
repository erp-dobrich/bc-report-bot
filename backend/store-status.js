const bc=require('./bc'),{gunzipSync}=require('zlib'),fs=require('fs'),path=require('path'),{getStores,listStores,addStore,setActive,deleteStore}=require('./stores-db');
const PAGES=[99001519,99001568],GRID='server:c[3]';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pad=n=>String(n).padStart(2,'0'),sec=t=>((Date.now()-t)/1000).toFixed(2)+'s';
let checking=false;
const MAX_CREATE_JOBS=2,activeCreates=new Set(),activePosts=new Set(),progress=new Map();
function compressedValue(v){
 if(typeof v!=='string')return v;
 try{
  const text=gunzipSync(Buffer.from(v,'base64')).toString('utf8').trim();if(!text)return null;
  try{return JSON.parse(text)}catch{}
  const out=[];for(const part of text.split('\x1e')){const t=part.trim();if(!t)continue;try{out.push(JSON.parse(t))}catch{}}
  return out.length===1?out[0]:out.length?out:null
 }catch{return null}
}
function walk(x,fn){
 if(typeof x==='string'){if(/^\s*[\[{]/.test(x))try{walk(JSON.parse(x),fn)}catch{}return}
 if(!x||typeof x!=='object')return;if(Array.isArray(x)){for(const v of x)walk(v,fn);return}
 fn(x);for(const[k,v]of Object.entries(x)){
  if(x.compressed===true&&(k==='result'||k==='data')){const decoded=compressedValue(v);if(decoded!==null)walk(decoded,fn)}
  else if(typeof v==='object'||typeof v==='string')walk(v,fn);
 }
}
const value=x=>String(x?.stringValue??x?.StringValue??'').trim();
function field(c,n){return value(c[Object.keys(c).find(k=>k.endsWith('_c'+n))])}
function dateNumber(s){const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);if(!m)return 0;const[d,mo,y]=m.slice(1).map(Number),v=new Date(Date.UTC(y,mo-1,d));return v.getUTCFullYear()===y&&v.getUTCMonth()===mo-1&&v.getUTCDate()===d?y*10000+mo*100+d:0}

function sofiaToday(now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return{year:+p.year,month:+p.month,day:+p.day}
}
function monthScope(requested='',now=new Date()){
 const t=sofiaToday(now),current=`${pad(t.month)}.${t.year}`,prevDate=new Date(Date.UTC(t.year,t.month-2,1)),previous=`${pad(prevDate.getUTCMonth()+1)}.${prevDate.getUTCFullYear()}`,month=/^\d{2}\.\d{4}$/.test(String(requested||''))?String(requested):current;
 if(month!==current&&month!==previous)throw Object.assign(Error('Позволени са само текущият и предишният месец'),{status:400});
 const[m,y]=month.split('.').map(Number),currentMonth=month===current,last=currentMonth?Math.max(0,t.day-1):new Date(Date.UTC(y,m,0)).getUTCDate(),asOfDay=currentMonth?t.day:last;
 return{month,m,y,last,asOfDay,from:`01.${month}`,to:last?`${pad(last)}.${month}`:''}
}
function postedAfter(from){
 const m=/^\d{2}\.(\d{2})\.(\d{4})$/.exec(String(from||''));if(!m)return'01.01.2000';let month=Number(m[1])-1,year=Number(m[2]);if(month<1){month=12;year--}const day=new Date(Date.UTC(year,month,0)).getUTCDate();return`${pad(day)}.${pad(month)}.${year}`
}
function listUrl(page,from,to,stores){
 const u=new URL(bc.HOST);u.search='';let filter=`'Store No.' IS '${stores.join('|')}' AND 'Trans. Ending Date' IS '${from}..${to}'`;
 if(page===PAGES[1])filter+=` AND 'LSC Posted Statement'.'Posted Date' IS '>${postedAfter(from)}'`;
 for(const[k,v]of Object.entries({page,company:'Ovcharovo_EUR',dc:0,filter}))u.searchParams.set(k,v);
 return u.toString().replace(/\+/g,'%20');
}
function reportBookmark(code){
 const u=s=>Buffer.from(String(s),'utf16le'),store=String(code).split('S')[0],r=u(code);
 return'54;'+Buffer.concat([Buffer.from([0x8f,0xa4,0xe6,0x05,0x02,0x7b,0x06]),u(store),Buffer.from([0,0,2,0x7b,0xff]),r.subarray(0,r.length-1)]).toString('base64');
}
function reportUrl(code){
 const u=new URL(bc.HOST);u.search='';u.searchParams.set('page','99001512');u.searchParams.set('company','Ovcharovo_EUR');u.searchParams.set('dc','0');u.searchParams.set('bookmark',reportBookmark(code));return u.toString();
}
function capture(p,page){
 const s={form:'',loaded:false,collecting:false,rows:new Map(),meta:new Map(),search:'',last:0,rev:0,scrolls:0,error:''};
 s.info=()=>s.meta.get(s.form)||{};
 s.feed=payload=>{
  try{for(const part of String(payload).split('\x1e')){
   if(!part.trim())continue;const nodes=[];walk(JSON.parse(part),x=>{if(x.t)nodes.push(x)});
   for(const x of nodes){
    const query=x.Query??x.Changes?.Query;
    if(query&&new URLSearchParams(query).get('page')===String(page)){
     const form=x.ServerId??x.ControlReference?.formId;if(form&&!s.form)s.form=form;
    }
    if(x.t==='sfcl')for(const c of x.Children||[])if(c.t==='fvc')s.search=String(c.UserTypedFilterValue??c.ResolvedFilterValue??'').trim();
   }
   for(const x of nodes){
    const r=x.ControlReference;if(!r)continue;const m=s.meta.get(r.formId)||{};
    if(r.controlPath===GRID){
     if(!s.form&&x.t==='DataRefreshChange')s.form=r.formId;
     if(x.t==='PropertyChange'){
      if(x.PropertyName==='Data.Rows.UnreadRowsForward')m.unread=Number(x.PropertyValue);
      if(x.PropertyName==='Data.Rows.CanReadRowsForward')m.canRead=x.PropertyValue;
     }
     if(x.Changes?.Offset!==undefined)m.offset=x.Changes.Offset;
     s.meta.set(r.formId,m);
    }
    if(r.formId!==s.form)continue;
    if(r.controlPath==='server:c[2]/c[0]/c[0]'&&x.Changes&&Object.hasOwn(x.Changes,'ResolvedFilterValue'))s.search=String(x.Changes.ResolvedFilterValue??'').trim();
    if(r.controlPath!==GRID)continue;
    if(x.t==='DataRefreshChange'){if(!s.collecting)s.rows.clear();s.loaded=true}
    if(/^DataRow(?:Inserted|Updated)$/.test(x.t||'')){
     const row=Array.isArray(x[x.t])?x[x.t][1]:x[x.t],c=row?.cells;if(!c)continue;
     const key=row.bookmark||field(c,1);if(!key)continue;const old=s.rows.get(key)||{},v=n=>Object.keys(c).some(k=>k.endsWith('_c'+n));
     s.rows.set(key,{report:v(1)?field(c,1):old.report,store:v(15)?field(c,15):old.store,date:v(40)?field(c,40):old.date,calculated:v(37)?field(c,37):old.calculated});
    }
    if(x.t==='DataRefreshChange'||/^DataRow/.test(x.t||'')||x.t==='PropertyChange'){s.last=Date.now();s.rev++}
   }
  }}catch{s.error='Не успях да разчета отговора от BC'}
 };
 s.sent=payload=>{try{for(const part of String(payload).split('\x1e')){if(!part.trim())continue;const x=JSON.parse(part);for(const a of x.arguments||[])for(const prm of a.params||[])for(const i of prm.interactionsToInvoke||[])if(i.interactionName==='ScrollRepeater'&&i.controlPath===GRID)s.scrolls++}}catch{}};
 p.on('websocket',ws=>{if(!ws.url().includes('/csh'))return;ws.on('framesent',e=>s.sent(e.payload));ws.on('framereceived',e=>s.feed(e.payload))});return s;
}
async function until(fn,message,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(25)}throw Error(message)}
function collect(s,from,to,stores){
 if(s.error)throw Error(s.error);
 if(s.search)throw Error('Има запазено търсене: '+s.search+'; URL филтърът не е достатъчен');
 const out=Object.fromEntries(stores.map(v=>[v,new Set()])),first=dateNumber(from),last=dateNumber(to);
 for(const row of s.rows.values()){
  if(!row.report||!row.store||row.date===undefined)throw Error('Липсват номер, магазин или крайна дата в отговора');
  const n=dateNumber(row.date);
  if(!Object.hasOwn(out,row.store)||!n||n<first||n>last)throw Error('URL филтърът не е приложен правилно: '+row.report+' / '+row.store+' / '+row.date);
  out[row.store].add(row.date);
 }
 return out;
}
async function probe(f){
 return f.evaluate(()=>{const text=e=>(e.textContent||'').replace(/\s+/g,' ').trim(),vis=e=>!!e.getClientRects().length;return!![...document.querySelectorAll('[id^="column_header_"],a[data-sorting-column-link="true"],[role="columnheader"]')].find(e=>text(e)==='Транс. Крайна Дата'&&vis(e))});
}
async function scrollRepeater(p,f,s){
 const before=s.scrolls,grid=f.locator('table.ms-nav-grid-data-table:visible,[role="grid"]:visible,.ms-nav-grid:visible').first();if(!await grid.count())return false;
 const rows=grid.locator('tbody tr[aria-rowindex]:visible,[role="row"][aria-rowindex]:visible'),target=await rows.count()?rows.last():grid;
 for(let n=0;n<4;n++){await target.hover({timeout:5000});await p.mouse.wheel(0,120);const end=Date.now()+600;while(Date.now()<end&&s.scrolls===before)await sleep(30);if(s.scrolls>before)return true}return false;
}
async function dates(p,s,from,to,stores){
 await until(()=>{if(s.error)throw Error(s.error);return s.loaded&&Date.now()-s.last>=200},'BC не върна списъка с URL филтъра',120000);
 const f=await until(async()=>{for(const f of p.frames())if(await probe(f).catch(()=>false))return f},'Не намерих колоната „Транс. Крайна Дата“',120000);s.collecting=true;
 const end=Date.now()+120000;let idle=0;
 while(Date.now()<end){
  if(s.error)throw Error(s.error);if(Date.now()-s.last<250){await sleep(60);continue}collect(s,from,to,stores);const i=s.info();
  if(i.canRead===false||i.unread===0)return collect(s,from,to,stores);
  if(i.canRead===true||i.unread>0){const rows=s.rows.size,unread=i.unread;if(!await scrollRepeater(p,f,s))throw Error(`BC не изпрати ScrollRepeater; прочетени: ${rows}; unread: ${unread??'?'}; canRead: ${i.canRead??'?'}`);await until(()=>{if(s.error)throw Error(s.error);const n=s.info();return s.rows.size>rows||n.canRead===false||Number.isFinite(unread)&&Number.isFinite(n.unread)&&n.unread<unread},'BC прие ScrollRepeater, но не върна следващите редове',15000);idle=0;continue}
  idle||=Date.now();if(Date.now()-idle>1200)return collect(s,from,to,stores);await sleep(80);
 }
 const i=s.info();throw Error(`Четенето отне твърде дълго; прочетени: ${s.rows.size}; unread: ${i.unread??'?'}; canRead: ${i.canRead??'?'}`);
}
async function readPage(page,from,to,stores,details=false){
 const start=Date.now(),p=await bc.getContext().newPage(),s=capture(p,page);let out,nav='',read='',close='';
 try{
  await p.goto(listUrl(page,from,to,stores),{waitUntil:'domcontentloaded',timeout:60000});nav=sec(start);
  const t=Date.now();out=await dates(p,s,from,to,stores);read=sec(t);
 }catch(e){throw Error(page+' / URL: '+e.message)}finally{const t=Date.now();await p.close().catch(()=>{});close=sec(t)}
 console.log(`STORE-STATUS URL | ${page===99001568?'осчетоводени':'неосчетоводени'} | редове: ${s.rows.size} | OPEN ${nav} | READ ${read} | CLOSE ${close} | TOTAL ${sec(start)}`);
 console.log('  '+stores.map(store=>store+': '+out[store].size+' дни').join(' | '));return details?[...s.rows.values()]:out;
}
function exactRows(s,report,store,date){
 const dn=dateNumber(date);return[...s.rows.values()].filter(r=>r.report===report&&r.store===store&&dateNumber(r.date)===dn)
}
async function waitExactRows(p,s,date,store,report,fastMs=2200,accept=()=>true){
 const end=Date.now()+fastMs;
 while(Date.now()<end){
  if(s.error)throw Error(s.error);const rows=exactRows(s,report,store,date);if(rows.length&&rows.some(accept))return rows;
  if(s.loaded&&s.last&&Date.now()-s.last>=180&&(!rows.length||rows.some(accept)))break;await sleep(25);
 }
 await dates(p,s,date,date,[store]);return exactRows(s,report,store,date);
}
function validateDayRows(s,date,store){
 if(s.error)throw Error(s.error);if(s.search)throw Error('Има запазено търсене: '+s.search+'; URL филтърът не е достатъчен');
 const dn=dateNumber(date),rows=[...s.rows.values()];
 for(const row of rows)if(!row.report||row.store!==store||dateNumber(row.date)!==dn)throw Error('URL филтърът не е приложен правилно: '+(row.report||'?')+' / '+(row.store||'?')+' / '+(row.date||'?'));
 return rows
}
async function waitDayRows(p,s,date,store,{anyOk=false,fastMs=450}={}){
 const end=Date.now()+fastMs;
 while(Date.now()<end){
  if(s.error)throw Error(s.error);
  if(s.loaded){
   const rows=validateDayRows(s,date,store),i=s.info(),quiet=s.last?Date.now()-s.last:0;
   if(anyOk&&rows.length)return rows;
   if(quiet>=50&&(i.canRead===false||i.unread===0))return rows;
   if(quiet>=180&&i.canRead!==true&&!Number.isFinite(i.unread))break;
  }
  await sleep(20)
 }
 await dates(p,s,date,date,[store]);return validateDayRows(s,date,store)
}
async function readDayRows(page,date,store,anyOk=true){
 const start=Date.now(),p=await bc.getContext().newPage(),s=capture(p,page);
 try{
  await p.goto(listUrl(page,date,date,[store]),{waitUntil:'domcontentloaded',timeout:60000});
  const rows=await waitDayRows(p,s,date,store,{anyOk});
  console.log(`STORE-DAY | ${page===PAGES[1]?'осчетоводени':'неосчетоводени'} | ${store} / ${date} | редове: ${rows.length} | ${sec(start)}`);return rows
 }finally{await p.close().catch(()=>{})}
}
async function readExactReport(page,date,store,report,accept=()=>true,fastMs=500){
 const start=Date.now(),p=await bc.getContext().newPage(),s=capture(p,page);
 try{
  await p.goto(listUrl(page,date,date,[store]),{waitUntil:'domcontentloaded',timeout:60000});
  const rows=await waitExactRows(p,s,date,store,report,fastMs,accept);
  console.log(`STORE-EXACT | ${page===PAGES[1]?'осчетоводени':'неосчетоводени'} | ${report} | намерени: ${rows.length} | ${sec(start)}`);
  return rows;
 }finally{await p.close().catch(()=>{})}
}
function calendar(scope,unposted,posted,stores){
 const{month,m,y,last,asOfDay}=scope,mm=pad(m),at=(bucket,date)=>bucket instanceof Map?(bucket.get(date)||[]):bucket instanceof Set?(bucket.has(date)?['']:[]):[];
 return{month,asOf:`${pad(asOfDay)}.${mm}.${y}`,stores:stores.map(s=>({store:s.code,name:s.name,city:s.city,days:Array.from({length:last},(_,i)=>{
  const day=i+1,date=`${pad(day)}.${mm}.${y}`,p=at(posted[s.code],date),u=at(unposted[s.code],date),reports=p.length?p:u,status=p.length?'green':u.length?'yellow':'red',x={day,status};
  if(reports.length===1&&reports[0])x.report=reports[0];else if(reports.length>1)x.reports=reports;
  return x;
 })}))};
}

async function readBatches(page,from,to,stores,size=10){
 const out=Object.fromEntries(stores.map(s=>[s,new Map()])),batches=[];
 for(let i=0;i<stores.length;i+=size)batches.push(stores.slice(i,i+size));
 const parts=await Promise.all(batches.map(async(batch,i)=>{
  console.log(`STORE-STATUS BATCH | ${page===99001568?'осчетоводени':'неосчетоводени'} | ${i+1}/${batches.length} | магазини: ${batch.length}`);
  return await readPage(page,from,to,batch,true);
 }));
 for(const rows of parts)for(const row of rows){
  if(!out[row.store])continue;const a=out[row.store].get(row.date)||[];if(row.report&&!a.includes(row.report))a.push(row.report);out[row.store].set(row.date,a);
 }
 return out;
}
async function check(_body,req){
 if(checking||activeCreates.size||activePosts.size)throw Error('Проверката, създаването или осчетоводяването вече работи');checking=true;const start=Date.now();
 try{
  const scope=monthScope(req?.query?.month),stores=getStores(),codes=stores.map(s=>s.code),empty=()=>Object.fromEntries(codes.map(s=>[s,new Map()])),base=calendar(scope,empty(),empty(),stores),last=scope.last;
  if(!last||!codes.length)return base;
  const from=scope.from,to=scope.to;
  console.log(`STORE-STATUS URL | ${scope.month} | магазини: ${codes.length} | ${from}..${to}`);
  const unposted=await readBatches(PAGES[0],from,to,codes,10),posted=await readBatches(PAGES[1],from,to,codes,10);
  const result=calendar(scope,unposted,posted,stores);
  for(const store of result.stores)for(const day of store.days)if(day.status==='yellow'&&fs.existsSync(lockPath(store.store,pad(day.day)+'.'+result.month)))day.resume=true;
  console.log('STORE-STATUS URL | ОБЩО '+sec(start));return result;
 }finally{checking=false}
}
const CARD=99001512,LOCKS=path.join(__dirname,'store-create-locks'),plain=s=>String(s||'').replace(/&/g,'').replace(/\s+/g,' ').trim();
const lockPath=(store,date)=>path.join(LOCKS,store+'-'+date+'.json');
function formInfo(form){
 const fields=new Map(),actions=[];let error=false,lines=[];
 const visit=(x,p)=>{if(x!==form&&x.t==='lf')return;if(x.Name==='Error'||x.Name==='ErrorDialogErrorDetailsGroup')error=true;
  if(x.t==='ssc'&&x.Caption)lines.push(x.Caption);
  if(x.ColumnBinder)fields.set(x.Name,{path:p,caption:plain(x.Caption),value:value(x)});
  if(x.t==='ac')actions.push({path:p,original:x.OriginalAction,caption:plain(x.Caption),system:x.SystemAction??x.Action?.SystemAction??0});
  (x.Children||[]).forEach((c,i)=>visit(c,p+'c['+i+']/'));
 };visit(form,'server:');for(const x of [...fields.values(),...actions])x.path=x.path.replace(/\/$/,'');
 return{form:form.ServerId,query:form.Query||'',fields,actions,error,message:lines[0]||form.Caption||'',bookmark:form.Bookmark||''};
}
function postStage(params,prev={}){
 const values=Array.isArray(prev.values)?[...prev.values]:Array(12).fill('');
 for(let i=0;i<params.length;i++){const v=String(params[i]??'').trim();if(v)values[i]=v}
 let idx=-1;for(let i=0;i<values.length;i++)if(values[i])idx=i;
 let percent=32,phase='BC стартира осчетоводяването';
 if(idx>=1&&idx<=2){percent=idx===1?40:48;phase='Буфериране на аналитичности'}
 else if(idx>=3&&idx<=4){percent=idx===3?58:64;phase='Обработка на транзакции';if(values[3])phase+=' · '+values[3];if(values[4])phase+=' · ред '+values[4]}
 else if(idx>=5&&idx<=7){percent=[70,78,86][idx-5];phase=idx===5?'Осчетоводяване на редове':idx===6?'Записване на продажби':'Актуализиране на наличност';if(values[idx])phase+=' · '+values[idx]}
 else if(idx>=8&&idx<=10){percent=[90,93,96][idx-8];phase=idx===8?'Маркиране на заглавия':idx===9?'Маркиране на редове в продажба':'Маркиране на платежни редове';if(values[idx])phase+=' · '+values[idx]}
 else if(idx>=11){percent=97;phase=values[11]||'Финализиране на осчетоводяването'}
 return{values,percent,phase}
}
function cardCapture(p,onProgress=()=>{}){
 const s={card:null,dialog:null,error:'',requests:[],last:0,serial:0,postProgress:{percent:0,phase:'',open:false,closed:false,seen:false,values:Array(12).fill('')}};
 s.sent=(payload,channel)=>{try{for(const part of String(payload).split('\x1e')){if(!part.trim())continue;const x=JSON.parse(part);if(x.target!=='InvokeRequest')continue;
  const list=[];for(const a of x.arguments||[])for(const prm of a.params||[])for(const i of prm.interactionsToInvoke||[])list.push({...i,params:JSON.parse(i.namedParameters||'{}')});
  s.requests.push({id:x.invocationId,channel,list,done:false,serial:++s.serial});
 }}catch{s.error='Неразчетена заявка при създаване на отчета'}};
 s.received=(payload,channel)=>{try{for(const part of String(payload).split('\x1e')){if(!part.trim())continue;const x=JSON.parse(part),r=s.requests.findLast(q=>q.channel===channel&&q.id===x.invocationId&&!q.done);
  for(const a of x.arguments||[])if(a?.handler==='NavProgressDialogs'){
   const d=a.data||{},params=Array.isArray(d.parameters)?d.parameters:[];
   if(d.method==='OpenDialog'){
    s.postProgress={...s.postProgress,percent:30,phase:'BC отвори процеса за осчетоводяване',open:true,closed:false,seen:true};onProgress(30,s.postProgress.phase);
   }else if(d.method==='UpdateDialog'){
    const stage=postStage(params,s.postProgress);s.postProgress={...s.postProgress,...stage,open:true,closed:false,seen:true};onProgress(stage.percent,stage.phase);
   }else if(d.method==='CloseDialog'){s.postProgress={...s.postProgress,percent:97,phase:'BC приключи обработката',open:false,closed:true,seen:true};onProgress(97,s.postProgress.phase)}
  }
  if(x.type===3&&r)for(const i of r.list)if(i.interactionName==='SaveValue'&&i.formId===s.card?.form)for(const f of s.card.fields.values())if(f.path===i.controlPath)f.value=String(i.params.newValue??'').trim();
  walk(x,n=>{
   if(n.error)s.error=typeof n.error==='string'?n.error:n.error.message||'BC върна грешка';
   if(n.t==='lf'){
    const info=formInfo(n);if(new URLSearchParams(info.query).get('page')===String(CARD))s.card=info;
    if(n.IsLogicalDialog||info.error){s.dialog=info;if(info.error)s.error=info.message}
   }
   const ref=n.ControlReference;if(!ref||!s.card?.form||ref.formId!==s.card.form)return;
   const changes=n.Changes||(n.t==='PropertyChange'?{[n.PropertyName]:n.PropertyValue}:{});
   if(ref.controlPath==='server:'&&changes.Bookmark)s.card.bookmark=changes.Bookmark;
   if(Object.hasOwn(changes,'StringValue'))for(const f of s.card.fields.values())if(f.path===ref.controlPath)f.value=String(changes.StringValue??'').trim();
  });
  if(x.type===3&&r)r.done=true;
  s.last=Date.now();
 }}catch(e){console.log('STORE-WS | пропуснат неразчетен отговор: '+(e?.message||e))}};
 p.on('websocket',ws=>{if(!ws.url().includes('/csh'))return;const id=Symbol();ws.on('framesent',e=>s.sent(e.payload,id));ws.on('framereceived',e=>s.received(e.payload,id))});return s;
}
const POST_BUSINESS_ERROR=/недостиг(?:\s+на\s+количества)?|insufficient|shortage|липсва(?:т|що)?\s+количество|количеств[^\n]{0,160}трябва\s+да\s+е|количеството\s+за\s+обработка[\s\S]{0,320}(?:проследяването|item\s+tracking)|трябва\s+да\s+е|номер\s+на\s+партида|сериен\s+номер|необходим(?:о|а|и)?[^\n]{0,160}(?:номер\s+на\s+партида|сериен\s+номер)|проверете\s+заданието[^\n]{0,160}(?:сериен\s+номер|номер\s+на\s+партида)|запис(?:ът)?\s+в\s+таблица[\s\S]{0,260}вече\s+съществува|record\s+in\s+table[\s\S]{0,260}already\s+exists|must\s+be|item\s+tracking|serial\s+(?:no\.?|number)|lot\s+(?:no\.?|number)|заключен|locked/i;
function postError(message,forceBusiness=false){const e=Error(message);if(forceBusiness||POST_BUSINESS_ERROR.test(String(message||'')))e.bcBusiness=true;return e}
function healthy(s){if(s.error)throw postError(s.error)}
async function pickVisible(q){for(let i=0,n=await q.count();i<n;i++){const e=q.nth(i);if(await e.isVisible()&&await e.isEnabled())return e}return null}
async function button(p,caption,frame){
 const escaped=caption.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp('^\\s*\\+?\\s*'+escaped+'\\s*$','i');
 for(const f of frame?[frame]:p.frames())for(const q of [f.getByRole('button',{name:rx}),f.getByRole('menuitem',{name:rx}),f.getByText(caption,{exact:true})]){const e=await pickVisible(q).catch(()=>null);if(e)return e}return null;
}
function cleanDialogText(text){
 return String(text||'').replace(/\r/g,'').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n').trim();
}
function shortDialogText(text,max=2200){const t=cleanDialogText(text);return t.length>max?t.slice(0,max)+'…':t}
async function postingProblem(p,report){
 const bad=/\u043d\u0435\u0434\u043e\u0441\u0442\u0438\u0433(?:\s+\u043d\u0430\s+\u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u0430)?|\u0433\u0440\u0435\u0448\u043a|error|\u043d\u0435 \u043c\u043e\u0436\u0435 \u0434\u0430|\u043d\u0435 \u0435 \u0432\u044a\u0437\u043c\u043e\u0436\u043d\u043e|insufficient|shortage|\u0437\u0430\u043a\u043b\u044e\u0447\u0435\u043d|locked|\u043b\u0438\u043f\u0441\u0432\u0430(?:\u0442|\u0449\u043e)? \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e|номер\s+на\s+партида|сериен\s+номер|необходим(?:о|а|и)?[^\n]{0,160}(?:номер\s+на\s+партида|сериен\s+номер)|количеството\s+за\s+обработка[\s\S]{0,320}(?:проследяването|item\s+tracking)|запис(?:ът)?\s+в\s+таблица[\s\S]{0,260}вече\s+съществува|record\s+in\s+table[\s\S]{0,260}already\s+exists/i;
 const exceptionUi=/\u043a\u0430\u043a \u0434\u0430 \u0434\u043e\u043a\u043b\u0430\u0434\u0432\u0430\u0442\u0435 \u0442\u043e\u0437\u0438 \u043f\u0440\u043e\u0431\u043b\u0435\u043c|\u0442\u0430\u0437\u0438 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f \u0431\u0435\u0448\u0435 \u043b\u0438 \u043f\u043e\u043b\u0435\u0437\u043d\u0430|\u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0437\u0430 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430|\u043f\u0440\u043e\u0441\u043b\u0435\u0434\u044f\u0432\u0430\u043d\u0435\u0442\u043e \u043d\u0430 \u0435\u043b\u0435\u043c\u0435\u043d\u0442\u0430|\u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435|\u043f\u0440\u043e\u0432\u0435\u0440\u0435\u0442\u0435 \u0437\u0430\u0434\u0430\u043d\u0438\u0435\u0442\u043e|номер\s+на\s+партида|сериен\s+номер|must be|item tracking|serial (?:no\.?|number)|lot (?:no\.?|number)/i;
 const progress=/\u0440\u0430\u0431\u043e\u0442\u0438\u043c \u0432\u044a\u0440\u0445\u0443 \u0442\u043e\u0432\u0430|\u043e\u0441\u0447\u0435\u0442\u043e\u0432\u043e\u0434\u0435\u043d \u043e\u0442\u0447\u0435\u0442|\u0431\u0443\u0444\u0435\u0440\u0438\u0440\u0430\u043d\u0435 \u043d\u0430 \u0430\u043d\u0430\u043b\u0438\u0442\u0438\u0447\u043d\u043e\u0441\u0442\u0438|\u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438|\u0437\u0430\u043f\u0438\u0441\u0438 \u0437\u0430 \u043f\u0440\u043e\u0434\u0430\u0436\u0431\u0430|\u043e\u0441\u0447\u0435\u0442\u043e\u0432\u044f\u0432\u0430\u043d\u0435|\u043e\u0441\u0447\u0435\u0442\u043e\u0432\u043e\u0434\u044f\u0432\u0430\u043d\u0435|\u0430\u043a\u0442\u0443\u0430\u043b\u0438\u0437\u0438\u0440\u0430\u043d\u0430 \u043d\u0430\u043b\u0438\u0447\u043d\u043e\u0441\u0442|\u043c\u0430\u0440\u043a\u0438\u0440\u0430\u043d\u0435 \u043d\u0430 \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438|\u0440\u0435\u0434\u043e\u0432\u0435 \u0432 \u043e\u0442\u0447\u0435\u0442|\u043f\u043b\u0430\u0442\u0435\u0436\u043d\u0438 \u0440\u0435\u0434\u043e\u0432\u0435/i;
 for(const f of p.frames()){
  const roots=f.locator('.spa-view.spa-dialog:visible,[role="dialog"]:visible,[role="alertdialog"]:visible,.ms-nav-exceptiondialogframe:visible');
  const n=Math.min(await roots.count().catch(()=>0),25);
  for(let i=n-1;i>=0;i--){
   const root=roots.nth(i);if(!await root.isVisible().catch(()=>false))continue;
   const text=shortDialogText(await root.innerText({timeout:500}).catch(()=>''));if(!text)continue;
   const isException=await root.evaluate(el=>el.matches('.ms-nav-exceptiondialogframe')||!!el.querySelector('.ms-nav-exceptiondialogframe')).catch(()=>false);
   const contentError=exceptionUi.test(text)||bad.test(text),isProgress=progress.test(text);
   if(isProgress&&!contentError)continue;
   const explicitError=contentError||isException&&!isProgress;
   if(!explicitError)continue;
   const lines=text.split('\n').filter(x=>!/^(\u0422\u044a\u0440\u0441\u0435\u043d\u0435|Group1|\u0417\u0430\u0442\u0432\u0430\u0440\u044f\u043d\u0435|\u041a\u0430\u043a \u0434\u0430 \u0434\u043e\u043a\u043b\u0430\u0434\u0432\u0430\u0442\u0435 \u0442\u043e\u0437\u0438 \u043f\u0440\u043e\u0431\u043b\u0435\u043c|\u0422\u0430\u0437\u0438 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f \u0431\u0435\u0448\u0435 \u043b\u0438 \u043f\u043e\u043b\u0435\u0437\u043d\u0430\??|\u0414\u0430|\u041d\u0435|OK|\u041e\u041a)$/i.test(x));
   const title=lines.find(x=>bad.test(x)||exceptionUi.test(x))||lines[0]||'BC returned an error';
   const rep=lines.find(x=>/^\d{6}S\d+$/i.test(x))||report;
   const details=lines.filter(x=>x!==title&&x!==rep).slice(0,35);
   const message='BC: '+title+(rep?' | \u041e\u0442\u0447\u0435\u0442 '+rep:'')+(details.length?' | '+details.join(' | '):'');
   console.log('STORE-POST | BC ERROR | '+message);
   return message;
  }
 }
 return '';
}
async function throwPostingProblem(p,report){const issue=await postingProblem(p,report);if(issue)throw postError(issue,true)}
async function clickDialogButton(p,caption,message,ms=30000,report=''){
 const escaped=caption.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp('^\\s*\\+?\\s*'+escaped+'\\s*$','i'),end=Date.now()+ms;
 while(Date.now()<end){
  if(report)await throwPostingProblem(p,report);
  for(const f of p.frames()){
   const roots=f.locator('.spa-view.spa-dialog:visible,[role="dialog"]:visible');
   const count=Math.min(await roots.count().catch(()=>0),20);
   for(let i=count-1;i>=0;i--){
    const q=roots.nth(i).getByRole('button',{name:rx});
    for(let j=0,n=await q.count().catch(()=>0);j<n;j++){
     const e=q.nth(j);if(!await e.isVisible().catch(()=>false)||!await e.isEnabled().catch(()=>false))continue;
     try{await e.click({timeout:900});return true}catch(err){const m=String(err?.message||err);if(!/timeout|intercepts pointer|detached|not stable|not visible/i.test(m))throw err}
    }
   }
   const q=f.getByRole('button',{name:rx});
   for(let j=0,n=Math.min(await q.count().catch(()=>0),20);j<n;j++){
    const e=q.nth(j);if(!await e.isVisible().catch(()=>false)||!await e.isEnabled().catch(()=>false))continue;
    try{await e.click({timeout:700});return true}catch(err){const m=String(err?.message||err);if(!/timeout|intercepts pointer|detached|not stable|not visible/i.test(m))throw err}
   }
  }
  await sleep(80);
 }
 throw Error(message);
}
function parseAllowedPostingWarning(text){
 const t=cleanDialogText(text).replace(/\n+/g,' ').replace(/\s+/g,' ').trim();if(!t)return null;
 const row=t.match(/Разликата\s+в\s+редовете\s+е\s*([+-]?\d+(?:[.,]\d+)?)\s*\.?\s*Искате\s+ли\s+да\s+продължите\s+осчетоводяването\s*\??/i);
 if(row)return{kind:'row-difference',difference:row[1],text:t};
 if(/Има\s+\d+\s+Заглавен\s+блок\s+на\s+транзакция[\s\S]*разлика\s+между\s+сумата\s+за\s+продажба\s+и\s+плащане[\s\S]*Позволени\s+разлики\s+в\s+Транз\.[\s\S]*Искате\s+ли\s+да\s+продължите\s+осчетоводяването\s*\??/i.test(t))return{kind:'transaction-balance',text:t};
 return null;
}
async function allowedPostingWarning(p){
 const yes=/^\s*\+?\s*(?:Да|Yes)\s*$/i;
 for(const f of p.frames()){
  const roots=f.locator('.spa-view.spa-dialog:visible,[role="dialog"]:visible,[role="alertdialog"]:visible');
  const n=Math.min(await roots.count().catch(()=>0),20);
  for(let i=n-1;i>=0;i--){
   const root=roots.nth(i);if(!await root.isVisible().catch(()=>false))continue;
   const text=shortDialogText(await root.innerText({timeout:500}).catch(()=>''));const warning=parseAllowedPostingWarning(text);if(!warning)continue;
   const buttons=root.getByRole('button',{name:yes});
   for(let j=0,m=await buttons.count().catch(()=>0);j<m;j++){
    const b=buttons.nth(j);if(await b.isVisible().catch(()=>false)&&await b.isEnabled().catch(()=>false))return{...warning,button:b};
   }
  }
 }
 return null;
}
function hasSystemActionSince(s,after,action){
 return s.requests.some(r=>r.serial>after&&r.list.some(i=>i.interactionName==='InvokeAction'&&Number(i.params?.systemAction)===Number(action)));
}
async function waitPostingStartWithAllowedWarnings(p,s,report,setProgress,rowDifferences){
 const end=Date.now()+30000;let handled=0;
 while(Date.now()<end){
  await throwPostingProblem(p,report);healthy(s);if(s.postProgress.seen)return;
  const warning=await allowedPostingWarning(p);
  if(!warning){await sleep(60);continue}
  if(++handled>8)throw Error('BC показа прекалено много последователни потвърждения при осчетоводяване');
  const after=s.serial;
  if(warning.kind==='row-difference'){
   if(!rowDifferences.includes(warning.difference))rowDifferences.push(warning.difference);
   setProgress(27,'Разлика в редовете '+warning.difference+' · потвърждавам „Да“',{rowDifferences:[...rowDifferences]});
   console.log('STORE-POST | разрешена разлика в редовете: '+warning.difference+' | автоматично ДА');
  }else{
   setProgress(27,'Разлика продажба/плащане · потвърждавам „Да“');
   console.log('STORE-POST | предупреждение за разлика продажба/плащане | автоматично ДА');
  }
  try{await warning.button.click({timeout:2000})}catch(e){const m=String(e?.message||e);if(!/timeout|intercepts pointer|detached|not stable|not visible/i.test(m))throw e;continue}
  await until(async()=>{await throwPostingProblem(p,report);healthy(s);return hasSystemActionSince(s,after,380)},'BC не прие допълнителното потвърждение „Да“',10000);
  const fingerprint=warning.kind+'|'+warning.text;
  await until(async()=>{
   await throwPostingProblem(p,report);healthy(s);if(s.postProgress.seen)return true;
   const next=await allowedPostingWarning(p);return !next||(next.kind+'|'+next.text)!==fingerprint;
  },'BC не затвори допълнителния въпрос след „Да“',10000);
 }
 throw Error('BC не стартира осчетоводяването');
}
async function fieldInput(p,caption){
 const rx=new RegExp('^'+caption.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[ ,:])','i');
 for(const f of p.frames())for(const q of [f.getByRole('textbox',{name:rx}),f.getByRole('combobox',{name:rx}),f.getByLabel(rx)]){
  const input=await pickVisible(q).catch(()=>null);if(input&&await input.evaluate(e=>e.matches('input,textarea')))return input;
 }return null;
}
const POST_ACTION_PATH='server:c[0]/c[1]/c[0]/c[1]';
async function revealActionButton(p,caption){
 let b=await button(p,caption);if(b)return b;
 for(const name of['Действия','Actions','Повече опции','More options']){
  const opener=await button(p,name).catch(()=>null);if(!opener)continue;
  await opener.click({timeout:5000}).catch(()=>{});await sleep(180);
  b=await button(p,caption).catch(()=>null);if(b)return b;
 }
 return null;
}
function reportTitleRx(report){return new RegExp('^\\s*'+String(report).replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')+'(?:\\s*·|\\s*$)','i')}
async function reportCardFrame(p,report){
 const rx=reportTitleRx(report);
 for(const f of p.frames()){
  const groups=[f.locator('h1,h2,h3,[role="heading"],.ms-nav-page-title,.ms-nav-caption').filter({hasText:rx}),f.getByText(rx)];
  for(const q of groups){
   const n=Math.min(await q.count().catch(()=>0),25);
   for(let i=0;i<n;i++){const e=q.nth(i);if(await e.isVisible().catch(()=>false))return f}
  }
 }
 return null;
}
async function postingConfirmationVisible(p){
 const yes=/^\s*\+?\s*(?:Да|Yes)\s*$/i;
 for(const f of p.frames()){
  const roots=f.locator('.spa-view.spa-dialog:visible,[role="dialog"]:visible,[role="alertdialog"]:visible');
  const n=Math.min(await roots.count().catch(()=>0),20);
  for(let i=n-1;i>=0;i--){
   const root=roots.nth(i);if(!await root.isVisible().catch(()=>false))continue;
   const text=shortDialogText(await root.innerText({timeout:400}).catch(()=>''));
   if(!/(осчетовод|\bpost(?:ing|ed)?\b|извлечение|statement)/i.test(text))continue;
   const q=root.getByRole('button',{name:yes});
   for(let j=0,m=await q.count().catch(()=>0);j<m;j++){const b=q.nth(j);if(await b.isVisible().catch(()=>false)&&await b.isEnabled().catch(()=>false))return true}
  }
 }
 return false;
}
async function waitPostingActionAccepted(p,s,report,after,paths=[],ms=10000){
 const end=Date.now()+ms,validPaths=new Set(paths.filter(Boolean));
 while(Date.now()<end){
  await throwPostingProblem(p,report);healthy(s);
  const req=s.requests.find(r=>r.serial>after&&r.list.some(i=>i.interactionName==='InvokeAction'&&validPaths.has(i.controlPath)));
  if(req)return{via:'websocket',req};
  if(s.postProgress.seen)return{via:'progress',req:null};
  if(await postingConfirmationVisible(p))return{via:'dialog',req:null};
  await sleep(40);
 }
 throw Error('BC не стартира действието за осчетоводяване');
}
async function triggerPostingAction(p,s,report,verifiedFrame=null,onAttempt=()=>{}){
 healthy(s);const actual=s.card?.fields?.get('No.')?.value;if(actual&&actual!==report)throw Error('Отвори се друг отчет: '+actual);
 const actions=s.card?.actions||[];
 const action=actions.find(a=>a.path===POST_ACTION_PATH||a.original===POST_ACTION_PATH)||actions.find(a=>/осчетовод|\bpost\b/i.test(a.caption)&&!/осчетоводени|posted statements?/i.test(a.caption));
 const actionPaths=[POST_ACTION_PATH,...actions.filter(a=>action?.caption&&a.caption===action.caption).flatMap(a=>[a.path,a.original])].filter(Boolean);
 console.log('STORE-POST | CARD FORM '+(s.card?.form||'?')+' | actions: '+actions.map(a=>`${a.caption||'?'} [${a.path}]`).join(' | '));
 if(action?.caption){
  const b=await revealActionButton(p,action.caption);
  if(b){
   const after=s.serial;onAttempt();
   try{
    await b.click({timeout:10000});
    const accepted=await waitPostingActionAccepted(p,s,report,after,actionPaths,10000);
    const req=accepted.req,invoked=req?.list?.find(i=>i.interactionName==='InvokeAction');
    console.log('STORE-POST | стартирано действие: '+action.caption+' | '+(invoked?.controlPath||action.path||accepted.via)+' | потвърдено: '+accepted.via);return;
   }catch(e){
    await throwPostingProblem(p,report);healthy(s);
    if(s.postProgress.seen||await postingConfirmationVisible(p))return;
    console.log('STORE-POST | бутонът не стартира потвърдено · пробвам F9 | '+(e?.message||e));
   }
  }
 }
 // Резервен вариант: отчетът вече е потвърден; пращаме F9 към елемент от самата карта.
 let frame=verifiedFrame||await reportCardFrame(p,report).catch(()=>null);
 if(!frame&&actual===report)frame=p.mainFrame();
 if(frame){
  const focusable=frame.locator('input:visible,button:visible,[role="button"]:visible,a:visible,[tabindex]:visible').first();
  const after=s.serial;onAttempt();
  if(await focusable.count().catch(()=>0)){
   await focusable.focus().catch(()=>{});
   await focusable.press('F9',{timeout:5000}).catch(async()=>{await p.keyboard.press('F9')});
  }else{
   const body=frame.locator('body');await body.click({position:{x:10,y:10},timeout:2000}).catch(()=>{});
   await body.press('F9',{timeout:5000}).catch(async()=>{await p.keyboard.press('F9')});
  }
  const accepted=await waitPostingActionAccepted(p,s,report,after,actionPaths,10000);
  const invoked=accepted.req?.list?.find(i=>i.interactionName==='InvokeAction');
  console.log('STORE-POST | стартирано с F9 | '+(invoked?.controlPath||accepted.via)+' | потвърдено: '+accepted.via);return;
 }
 throw Error('Не успях да потвърдя активната карта за отчет '+report+'. Налични действия: '+actions.map(a=>a.caption||'?').join(', '));
}
async function commitField(p,s,name,text){
 healthy(s);const meta=s.card?.fields.get(name);if(!meta)throw Error('Липсва поле: '+name);
 const input=await until(()=>fieldInput(p,meta.caption),'Не намерих полето „'+meta.caption+'“'),isDate=name.includes('Date'),same=v=>isDate?dateNumber(v)===dateNumber(text):v===text;
 if(same(meta.value)&&same((await input.inputValue()).trim()))return;
 const after=s.serial;await input.fill(text,{timeout:10000});await input.press('Tab',{timeout:10000});
 await until(()=>{healthy(s);return s.requests.some(r=>r.serial>after&&r.done&&r.list.some(i=>i.interactionName==='SaveValue'&&i.formId===s.card.form&&i.controlPath===meta.path&&same(String(i.params.newValue||'').trim())))},'BC не потвърди „'+meta.caption+'“');
 if(!same((await input.inputValue()).trim()))throw Error('BC промени „'+meta.caption+'“');
 healthy(s);console.log('STORE-CREATE | '+meta.caption+': '+text);
}
function calculationFieldValue(s){
 if(!s?.card)return'';
 for(const[name,f]of s.card.fields){
  if(!/(calculat|calculated|изчисл|калкул)/i.test(name+' '+(f.caption||'')))continue;
  const v=String(f.value||'').trim();if(dateNumber(v))return v
 }
 return''
}
function calculationConfirmedHere(s,list,report,store,date){
 if(calculationFieldValue(s))return'карта';
 const row=list&&exactRows(list,report,store,date).find(r=>dateNumber(r.calculated));return row?'списък':''
}
async function calculate(p,s,mark=()=>{}){
 healthy(s);const action=s.card.actions.find(a=>/^Изчисляване на Отчет$/i.test(a.caption));if(!action)throw Error('Липсва „Изчисляване на Отчет“');
 const e=await until(()=>button(p,action.caption),'Не намерих „Изчисляване на Отчет“'),after=s.serial;s.dialog=null;await e.click({timeout:10000});
 const request=await until(()=>{healthy(s);return s.requests.find(r=>r.serial>after&&r.list.some(i=>i.formId===s.card.form&&i.interactionName==='InvokeAction'&&[action.path,action.original].includes(i.controlPath)))},'BC не прие изчисляването');
 await until(()=>{healthy(s);return request.done||s.dialog},'Изчисляването не завърши',120000);healthy(s);
 if(s.dialog){
  const d=s.dialog;mark('confirmation');if(!/изчисл|калкул|calculat/i.test(d.message)||/осчетовод|\bpost|изтрив|delete/i.test(d.message))throw Error('BC изисква преглед: '+d.message);
  const ok=d.actions.find(a=>/^(ОК|OK|Да|Yes)$/i.test(a.caption));if(!ok)throw Error('Няма потвърждение за изчисляването');
  const b=await until(()=>button(p,ok.caption),'Не намерих потвърждението'),afterOK=s.serial;s.dialog=null;mark('calculating');await b.click({timeout:10000});
  await until(()=>{healthy(s);return s.requests.some(r=>r.serial>afterOK&&r.done&&r.list.some(i=>i.formId===d.form&&i.interactionName==='InvokeAction'&&i.controlPath===ok.path))},'Потвърждението не завърши',120000);
 }
 await until(()=>{healthy(s);return !s.requests.some(r=>!r.done&&r.list.some(i=>i.interactionName!=='KeepAlive'))&&Date.now()-s.last>100},'BC не приключи обработката',120000);healthy(s);
}
function validCreate(body,now=new Date()){
 const stores=getStores(),codes=stores.map(s=>s.code),store=String(body?.store||''),date=String(body?.date||''),empty=Object.fromEntries(codes.map(v=>[v,new Map()])),c=calendar(now,empty,empty,stores),n=dateNumber(date);
 if(!codes.includes(store)||!n||date.slice(3)!==c.month||n>=dateNumber(c.asOf))throw Object.assign(Error('Избери активен магазин и изминал ден от текущия месец'),{status:400});return{store,date};
}
function resumeRow(rows,journal,store,date){
 if(!journal)return null;
 if(journal.store!==store||journal.date!==date)throw Error('Записът за незавършения опит не съответства на избрания ден');
 if(rows.length!==1)throw Error('Незавършен опит: очаквам точно един съществуващ отчет. Провери го в BC.');
 const row=rows[0];if(journal.report&&journal.report!==row.report)throw Error('Номерът на съществуващия отчет е различен от незавършения опит');
 if(dateNumber(row.calculated))return null;
 if(row.calculated!==''||journal.phase&&!['fields','confirmation'].includes(journal.phase))throw Error('Предишното изчисляване не е потвърдено. Провери резултата в BC преди повторен опит.');
 return row;
}
async function openReport(p,report){
 const rx=new RegExp('^\\s*'+report.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$');
 const e=await until(async()=>{for(const f of p.frames()){
  const q=f.locator('a[role="button"][title^="Отваряне на запис „"]:visible,a[role="button"][title^="Open record"]:visible').filter({hasText:rx});if(await q.count()===1)return q;
 }},'Не намерих съществуващия отчет '+report);await e.click({timeout:10000});
}
async function waitReportCard(p,s,report,ms=8000){
 const end=Date.now()+ms;
 while(Date.now()<end){
  healthy(s);const actual=s.card?.fields?.get('No.')?.value;
  if(actual&&actual!==report)throw Error('Отвори се друг отчет: '+actual);
  const frame=await reportCardFrame(p,report).catch(()=>null);
  if(actual===report||frame)return{card:s.card||null,frame,verifiedBy:actual===report?'websocket':'екран'};
  await sleep(40);
 }
 throw Error('BC не отвори точния отчет '+report);
}
async function openReportDirect(p,s,report,ms=6500){
 await p.goto(reportUrl(report),{waitUntil:'domcontentloaded',timeout:30000});
 const opened=await waitReportCard(p,s,report,ms);console.log('STORE-POST | директна карта '+report+' | потвърдена чрез '+opened.verifiedBy);return opened;
}
async function directReportExists(report,ms=1200){
 const p=await bc.getContext().newPage(),s=cardCapture(p);
 try{
  await p.goto(reportUrl(report),{waitUntil:'domcontentloaded',timeout:30000});const end=Date.now()+ms;
  while(Date.now()<end){
   const actual=s.card?.fields?.get('No.')?.value;if(actual)return actual===report;if(s.error)return false;
   if(await reportCardFrame(p,report).catch(()=>null))return true;await sleep(35)
  }
  return false;
 }catch{return false}finally{await p.close().catch(()=>{})}
}
async function createReport(body){
 const{store,date}=validCreate(body),progressKey=store+'|'+date;
 if(checking)throw Object.assign(Error('Изчакай текущата проверка'),{status:409});
 if([...activeCreates].some(k=>k.startsWith(store+'|')))throw Object.assign(Error('За този магазин вече се създава отчет'),{status:409});
 if(activeCreates.size>=MAX_CREATE_JOBS)throw Object.assign(Error('Вече се създават 2 отчета едновременно'),{status:409});
 activeCreates.add(progressKey);
 const setProgress=(percent,phase,extra={})=>{const old=progress.get(progressKey)||{};progress.set(progressKey,{...old,...extra,active:true,percent,phase,error:'',store,date})};
 const finishProgress=(ok,extra={})=>{const old=progress.get(progressKey)||{};progress.set(progressKey,{...old,...extra,store,date,active:false,percent:ok?100:old.percent||0,phase:ok?'Готово':old.phase||''})};
 setProgress(3,'Проверка на избрания ден',{report:''});
 const start=Date.now(),key=lockPath(store,date);let p,s,started=false,success=false,resumed=false,journal;
 try{
  if(fs.existsSync(key)){try{journal=JSON.parse(fs.readFileSync(key,'utf8'))}catch{throw Error('Неразчетен запис за предишен опит. Провери отчета в BC.')}}
  setProgress(8,'Бърза паралелна проверка на деня');console.log('STORE-CREATE | '+store+' / '+date+' | бърза паралелна проверка');const tCheck=Date.now();
  p=await bc.getContext().newPage();s=cardCapture(p);const list=capture(p,PAGES[0]);
  const postedPromise=readDayRows(PAGES[1],date,store,true);
  const unpostedPromise=(async()=>{await p.goto(listUrl(PAGES[0],date,date,[store]),{waitUntil:'domcontentloaded',timeout:60000});setProgress(13,'Проверка на неосчетоводени');return await waitDayRows(p,list,date,store,{anyOk:!journal})})();
  const[posted,unpostedRows]=await Promise.all([postedPromise,unpostedPromise]);console.log('STORE-CREATE | проверки '+sec(tCheck));
  if(posted.length){const report=posted.map(r=>r.report).filter(Boolean).join(', ');finishProgress(true,{report});return{store,date,status:'green',existing:true,report}}
  setProgress(18,'Проверка за неосчетоводен отчет');
  const previous=resumeRow(unpostedRows,journal,store,date);
  if(previous){
   resumed=true;started=true;setProgress(32,'Отваряне на незавършения отчет',{report:previous.report});console.log('STORE-CREATE | продължавам '+previous.report);await openReport(p,previous.report);
   await until(()=>{healthy(s);return s.card},'BC не отвори съществуващия отчет');if(s.card.fields.get('No.')?.value!==previous.report)throw Error('Отвори се друг отчет');
  }else{
   if(unpostedRows.length){if(journal)fs.unlinkSync(key);const report=unpostedRows.map(r=>r.report).filter(Boolean).join(', ');finishProgress(true,{report});return{store,date,status:'yellow',existing:true,report}}
   setProgress(30,'Създаване на нов отчет');const tCard=Date.now(),newButton=await until(()=>button(p,'Създаване'),'Не намерих „Създаване“');
   journal={store,date,started:new Date().toISOString(),phase:'fields'};fs.mkdirSync(LOCKS,{recursive:true});fs.writeFileSync(key,JSON.stringify(journal),{flag:'wx'});started=true;
   await newButton.click({timeout:10000});await until(()=>{healthy(s);return s.card},'BC не отвори новия отчет');console.log('STORE-CREATE | карта '+sec(tCard));
   const tFields=Date.now(),fields=[['Store No.',store,42,'Магазин'],['Trans. Starting Date',date,50,'Начална дата'],['Trans. Ending Date',date,58,'Крайна дата']];
   for(const[name,text,pct,label]of fields){await commitField(p,s,name,text);setProgress(pct,'Попълване: '+label,{report:s.card.fields.get('No.')?.value||''})}console.log('STORE-CREATE | полета '+sec(tFields));
  }
  healthy(s);const values=s.card.fields;if(values.get('Store No.')?.value!==store||['Trans. Starting Date','Trans. Ending Date'].some(n=>dateNumber(values.get(n)?.value)!==dateNumber(date)))throw Error('Магазинът или датите не са потвърдени');
  const mark=phase=>{journal={...journal,store,date,report:s.card.fields.get('No.')?.value||journal.report,phase};fs.writeFileSync(key,JSON.stringify(journal));if(phase==='confirmation')setProgress(72,'Потвърждение на изчисляването',{report:journal.report||''});if(phase==='calculating')setProgress(82,'Изчисляване на отчета',{report:journal.report||''})};
  const tCalc=Date.now();setProgress(65,'Стартиране на изчисляването',{report:s.card.fields.get('No.')?.value||''});mark('calculating');console.log('STORE-CREATE | изчисляване');await calculate(p,s,mark);console.log('STORE-CREATE | BC изчисляване '+sec(tCalc));
  const report=s.card.fields.get('No.')?.value;if(!report)throw Error('BC не върна номер на отчета');setProgress(91,'Потвърждение на готовия отчет',{report});
  let confirmed='';const quickEnd=Date.now()+100;while(Date.now()<quickEnd&&!confirmed){healthy(s);confirmed=calculationConfirmedHere(s,list,report,store,date);if(!confirmed)await sleep(20)}
  if(confirmed)console.log('STORE-CREATE | бързо потвърждение от '+confirmed);
  else{
   setProgress(94,'Финална защитна проверка',{report});const tVerify=Date.now();
   const rows=await readExactReport(PAGES[0],date,store,report,r=>!!dateNumber(r.calculated),500),row=rows.find(r=>dateNumber(r.calculated));if(!row)throw Error('Не е потвърден изчислен отчет '+report+' за '+date);console.log('STORE-CREATE | защитна проверка '+sec(tVerify));
  }
  healthy(s);
  success=true;fs.unlinkSync(key);finishProgress(true,{report});console.log('STORE-CREATE | '+report+' | ГОТОВО | '+sec(start));return{store,date,status:'yellow',report,existing:false,resumed};
 }catch(e){
  const report=s?.card?.fields.get('No.')?.value;if(started&&!success)e.message+=' '+(report?'Отчет '+report+'. ':'')+'Възможен е частично създаден отчет; провери го в BC. Нов отчет не се създава автоматично повторно.';
  const old=progress.get(progressKey)||{};progress.set(progressKey,{...old,store,date,active:false,error:e.message,report:report||old.report||''});console.log('STORE-CREATE | ГРЕШКА: '+e.message);throw e;
 }finally{if(p)await p.close().catch(()=>{});activeCreates.delete(progressKey);setTimeout(()=>progress.delete(progressKey),60000)}
}

function validPost(body,availability,now=new Date()){
 const{store,date}=validCreate(body,now),report=String(body?.report||'').trim();
 if(!/^\d{6}S\d+$/.test(report)||!report.startsWith(store+'S'))throw Object.assign(Error('Невалиден номер на отчет'),{status:400});
 if(availability?.results?.[report]?.status!=='ok')throw Object.assign(Error('Отчетът не е маркиран като готов за осчетоводяване от последната проверка за наличности'),{status:409});
 return{store,date,report};
}
async function postReport(body,availability){
 const{store,date,report}=validPost(body,availability),progressKey=store+'|'+date;
 if(checking||activeCreates.size)throw Object.assign(Error('Изчакай текущата проверка или създаването на отчет'),{status:409});
 if(activePosts.size)throw Object.assign(Error('Вече се осчетоводява друг отчет'),{status:409});
 activePosts.add(progressKey);
 const setProgress=(percent,phase,extra={})=>{const old=progress.get(progressKey)||{};progress.set(progressKey,{...old,...extra,kind:'post',active:true,percent,phase,error:'',store,date,report})};
 const finishProgress=(ok,extra={})=>{const old=progress.get(progressKey)||{};progress.set(progressKey,{...old,...extra,kind:'post',store,date,report,active:false,percent:ok?100:old.percent||0,phase:ok?'Осчетоводен':old.phase||''})};
 let p,s,list,postAttempted=false,cardFrame=null;const rowDifferences=[];const start=Date.now();setProgress(3,'Отваряне на точния отчет');
 const preparePage=async()=>{
  p=await bc.getContext().newPage();s=cardCapture(p,(pct,phase)=>setProgress(Math.max(25,Math.min(97,Number(pct)||25)),phase));list=null;cardFrame=null;
 };
 const openDirect=async()=>{
  await preparePage();setProgress(5,'Отварям директно точния отчет');const opened=await openReportDirect(p,s,report,6500);cardFrame=opened.frame;setProgress(12,'Точният отчет е отворен директно');return opened
 };
 const openUnposted=async()=>{
  await preparePage();setProgress(5,'Отварям списъка с неосчетоводени');list=capture(p,PAGES[0]);
  await p.goto(listUrl(PAGES[0],date,date,[store]),{waitUntil:'domcontentloaded',timeout:60000});setProgress(8,'Търся точния отчет');
  const rows=await waitExactRows(p,list,date,store,report,1800);if(rows.length)setProgress(11,'Точният отчет е намерен');return rows
 };
 const openFoundFromList=async()=>{
  setProgress(12,'Отварям точния отчет от списъка');await openReport(p,report);const opened=await waitReportCard(p,s,report,8000);cardFrame=opened.frame;return opened
 };
 try{
  let directOk=false,same=[];
  try{await openDirect();directOk=true}catch(e){
   console.log('STORE-POST | директното отваряне не се потвърди · резервен списък | '+e.message);if(p)await p.close().catch(()=>{});p=null;s=null;list=null;cardFrame=null;
  }
  if(!directOk){
   same=await openUnposted();
   if(same.length>1)throw Object.assign(Error('Намерени са няколко еднакви отчета'),{status:409});
   if(!same.length){
    await p.close().catch(()=>{});p=null;s=null;list=null;cardFrame=null;
    const waitUntil=Date.now()+30000;let cycle=0,postedRow=null;
    while(Date.now()<waitUntil&&!same.length&&!postedRow){
     setProgress(6,cycle?'Изчакване на текущо осчетоводяване…':'Проверка дали отчетът вече се осчетоводява');
     const posted=await readPage(PAGES[1],date,date,[store],true);postedRow=posted.find(r=>r.report===report)||null;
     if(postedRow)break;
     if(cycle)await sleep(1200);
     setProgress(8,'Опресняване на неосчетоводени');
     const unposted=await readPage(PAGES[0],date,date,[store],true);same=unposted.filter(r=>r.report===report);
     if(same.length>1)throw Object.assign(Error('Намерени са няколко еднакви отчета'),{status:409});
     cycle++;
    }
    if(postedRow){finishProgress(true,{existing:true,postedReport:postedRow.report});return{store,date,report,postedReport:postedRow.report,status:'green',existing:true}}
    if(!same.length)throw Object.assign(Error('Отчетът не е намерен нито в неосчетоводените, нито в осчетоводените след изчакване. Възможно е още да се обработва от друга сесия.'),{status:409});
    setProgress(10,'Отчетът отново е наличен');same=await openUnposted();
    if(same.length!==1)throw Object.assign(Error(same.length?'Намерени са няколко еднакви отчета':'Отчетът изчезна преди отварянето. Обнови статуса.'),{status:409});
   }
   await openFoundFromList();
  }
  setProgress(20,'Стартиране на Осчетоводяване (еквивалент на F9)');s.dialog=null;await p.bringToFront().catch(()=>{});
  await triggerPostingAction(p,s,report,cardFrame,()=>{postAttempted=true});
  setProgress(23,'Чакам потвърждението „Да“');
  await throwPostingProblem(p,report);
  s.postProgress={percent:0,phase:'',open:false,closed:false,seen:false,values:Array(12).fill('')};
  const afterYes=s.serial;setProgress(25,'Натискам „Да“ · BC започва обработката');
  try{await clickDialogButton(p,'Да','Не се появи бутон „Да“ за осчетоводяване',30000,report)}catch(e){if(e.message==='Не се появи бутон „Да“ за осчетоводяване'){await clickDialogButton(p,'Yes','Не се появи бутон „Да“ за осчетоводяване',3000,report)}else throw e}
  await until(async()=>{await throwPostingProblem(p,report);healthy(s);return s.requests.some(r=>r.serial>afterYes&&r.list.some(i=>i.interactionName==='InvokeAction'&&Number(i.params?.systemAction)===380))},'BC не прие потвърждението „Да“',10000);
  setProgress(28,'BC прие „Да“ · проверявам за допълнителни потвърждения');
  await waitPostingStartWithAllowedWarnings(p,s,report,setProgress,rowDifferences);
  await until(async()=>{await throwPostingProblem(p,report);healthy(s);return s.postProgress.closed},'Осчетоводяването не приключи',240000);
  await until(async()=>{await throwPostingProblem(p,report);healthy(s);return await p.locator('div[role="dialog"].progress-dialog:visible').count()===0},'Прозорецът за прогрес още е отворен',15000);
  setProgress(98,'Осчетоводяването приключи · чакам финалния въпрос');
  await throwPostingProblem(p,report);
  setProgress(99,'Натискам „Не“ · изчаквам преди следващия отчет');const afterNo=s.serial;
  try{await clickDialogButton(p,'Не','Не се появи финалният бутон „Не“',30000,report)}catch(e){if(e.message==='Не се появи финалният бутон „Не“'){await clickDialogButton(p,'No','Не се появи финалният бутон „Не“',3000,report)}else throw e}
  await until(async()=>{await throwPostingProblem(p,report);healthy(s);return s.requests.some(r=>r.serial>afterNo&&r.list.some(i=>i.interactionName==='InvokeAction'&&Number(i.params?.systemAction)===390))},'BC не прие бутона „Не“',10000);
  await throwPostingProblem(p,report);healthy(s);
  // Финалният въпрос + приетото „Не“ са достатъчни. Не правим бавна повторна проверка в „Осчетоводени“.
  await sleep(1500);
  finishProgress(true,{postedReport:report,rowDifferences:[...rowDifferences]});console.log('STORE-POST | '+report+' | ГОТОВО | '+sec(start)+(rowDifferences.length?' | разлика в редовете: '+rowDifferences.join(', '):''));
  return{store,date,report,postedReport:report,status:'green',existing:false,rowDifferences:[...rowDifferences]};
 }catch(e){
  if(e?.bcBusiness)console.log('STORE-POST | БИЗНЕС ГРЕШКА · спирам без защитна проверка | '+e.message);
  const old=progress.get(progressKey)||{};progress.set(progressKey,{...old,kind:'post',store,date,report,active:false,error:e.message});console.log('STORE-POST | ГРЕШКА: '+e.message);throw e
 }
 finally{if(p)await p.close().catch(()=>{});activePosts.delete(progressKey);setTimeout(()=>progress.delete(progressKey),60000)}
}

function init(app,busy=()=>false,availability=()=>null){
 const handle=(fn,guard=()=>false)=>async(req,res)=>{if(guard())return res.status(409).json({error:'Изчакай текущата проверка, създаване или осчетоводяване'});try{res.json(await fn(req.body,req))}catch(e){console.log('STORE-STATUS | '+e.message);res.status(e.status||500).json({error:e.message})}};
 app.get('/store-status',handle(check,()=>busy()||checking||activeCreates.size>0||activePosts.size>0));
 app.post('/store-status/create',handle(createReport,()=>busy()||checking||activePosts.size>0));
 app.post('/store-status/post',handle(body=>postReport(body,availability()),()=>busy()||checking||activeCreates.size>0));
 app.get('/store-status/progress',handle(()=>[...progress.values()]));
 app.get('/stores',handle(()=>listStores()));
 const storeGuard=()=>busy()||checking||activeCreates.size>0||activePosts.size>0;
 app.post('/stores/add',handle(addStore,storeGuard));app.post('/stores/active',handle(setActive,storeGuard));app.post('/stores/delete',handle(deleteStore,storeGuard));
}
module.exports={init,isBusy:()=>checking||activeCreates.size>0||activePosts.size>0};