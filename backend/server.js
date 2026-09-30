require('dotenv').config();
const express=require('express'),cors=require('cors');
const bc=require('./bc'),checker=require('./checker'),storeStatus=require('./store-status'),tunnel=require('./tunnel');
const clients=require('./clients-db'),activity=require('./activity-db'),jobs=require('./jobs-db');

const app=express(),controlApp=express();
const PORT=Number(process.env.PORT||9922)||9922,CONTROL_PORT=Number(process.env.CONTROL_PORT||9923)||9923;
const BOT_TOKEN=String(process.env.BOT_TOKEN||'').trim(),BUILD_VERSION=String(require('../version.json').version||'').trim();
if(CONTROL_PORT===PORT)throw new Error('CONTROL_PORT трябва да е различен от PORT');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let draining=false,apiServer=null,controlServer=null,shutdownPromise=null;
const SHUTDOWN_TIMEOUT_MS=Math.max(60000,Number(process.env.SHUTDOWN_TIMEOUT_MS||30*60*1000)||30*60*1000);
const ACTIONS=new Map([
 ['GET /store-status','STATUS_REFRESH'],['POST /run/start','CHECK_START'],['POST /run/stop','CHECK_STOP'],['POST /run/clear','CHECK_CLEAR'],
 ['POST /store-status/create','REPORT_CREATE'],['POST /store-status/post','REPORT_POST'],
 ['POST /stores/add','STORE_ADD'],['POST /stores/active','STORE_ACTIVE'],['POST /stores/delete','STORE_DELETE']
]);
const LONG=new Set(['POST /store-status/create','POST /store-status/post']);
const reqKey=req=>`${req.method.toUpperCase()} ${req.path}`,actionOf=req=>ACTIONS.get(reqKey(req))||'',storeOf=req=>{const s=String(req.body?.store||req.body?.code||req.query?.store||'').trim();return /^\d{6}$/.test(s)?s:''};
const dec=v=>{try{return decodeURIComponent(String(v||''))}catch{return String(v||'')}};
function meta(req,action=''){return{deviceId:req.get('X-Device-Id')||'',version:req.get('X-Client-Version')||'',storeCode:storeOf(req),ip:req.get('X-Client-IP')||'',country:dec(req.get('X-Client-Country')),region:dec(req.get('X-Client-Region')),city:dec(req.get('X-Client-City')),userAgent:req.get('X-Client-UA')||req.get('User-Agent')||'',action}}
function busy(){return checker.status().running||storeStatus.isBusy()||jobs.activeCount()>0}

/* PUBLIC/API APP - this is the only app exposed through the Cloudflare tunnel. */
app.use(cors());app.use(express.json());
app.get('/health',(req,res)=>res.json({ok:true,buildVersion:BUILD_VERSION,running:checker.status().running,storeBusy:storeStatus.isBusy(),activeJobs:jobs.activeCount(),draining,tunnel:tunnel.status()}));

app.use((req,res,next)=>{if(!BOT_TOKEN)return next();if(req.get('X-Bot-Token')===BOT_TOKEN)return next();res.status(401).json({ok:false,error:'Невалиден достъп до backend-а'})});
app.use((req,res,next)=>{
 const key=reqKey(req),action=actionOf(req),m=meta(req,action);clients.touch(m);
 if(draining&&ACTIONS.has(key))return res.status(503).json({ok:false,error:'Backend-ът изчаква активните операции преди рестарт',code:'BACKEND_DRAINING'});
 if(!action)return next();
 const started=Date.now(),orig=res.json.bind(res);let body=null,jobId=null;res.json=x=>{body=x;return orig(x)};
 if(LONG.has(key))jobId=jobs.start(m);
 res.on('finish',()=>{const ok=res.statusCode<400,error=ok?'':String(body?.error||body?.message||'');if(jobId)jobs.finish(jobId,ok?'OK':'ERROR',error);activity.add({...m,method:req.method,path:req.originalUrl,statusCode:res.statusCode,ok,durationMs:Date.now()-started,error})});next();
});

app.post('/client/heartbeat',(req,res)=>res.json({ok:true,buildVersion:BUILD_VERSION}));
app.post('/run/start',(req,res)=>{
 if(storeStatus.isBusy())return res.status(409).json({ok:false,error:'Изчакай проверката по магазини или създаването на отчета'});
 const r=checker.start(req.body||{});if(r.ok){const id=jobs.start({...meta(req,'CHECK_RUN'),storeCode:storeOf(req)});const timer=setInterval(()=>{const s=checker.status();if(s.running)return;clearInterval(timer);jobs.finish(id,s.error?'ERROR':s.stop?'STOPPED':'OK',s.error||'')},500);timer.unref?.()}res.status(r.ok?200:409).json(r);
});
app.post('/run/stop',(req,res)=>res.json(checker.stop()));
app.post('/run/clear',(req,res)=>{const r=checker.clear();res.status(r.ok?200:409).json(r)});
app.get('/run/status',(req,res)=>res.json(checker.status()));
app.get('/run/wait',async(req,res)=>res.json(await checker.waitStatus(req.query.since,25000)));

storeStatus.init(app,()=>checker.status().running,()=>checker.status());

/* LOCAL CONTROL APP - separate port, bound only to 127.0.0.1 and never sent to the tunnel. */
controlApp.disable('x-powered-by');
controlApp.use(express.json({limit:'64kb'}));
controlApp.get('/status',(req,res)=>res.json({ok:true,buildVersion:BUILD_VERSION,draining,busy:busy(),checker:checker.status(),storeBusy:storeStatus.isBusy(),activeJobs:jobs.active(),tunnel:tunnel.status()}));
controlApp.get('/clients',(req,res)=>res.json({ok:true,data:clients.list(req.query.limit)}));
controlApp.get('/activity',(req,res)=>res.json({ok:true,data:activity.list(req.query.limit)}));
controlApp.get('/jobs',(req,res)=>res.json({ok:true,data:jobs.list(req.query.limit)}));
controlApp.post('/drain',(req,res)=>{draining=!!req.body?.enabled;res.json({ok:true,draining,busy:busy(),activeJobs:jobs.activeCount()})});
controlApp.post('/shutdown',(req,res)=>{
 if(shutdownPromise)return res.status(409).json({ok:false,error:'Shutdown already requested',draining:true,busy:busy(),activeJobs:jobs.activeCount()});
 draining=true;
 const info={ok:true,accepted:true,draining:true,busy:busy(),activeJobs:jobs.activeCount(),message:'Backend will stop after active operations finish'};
 res.json(info);
 setTimeout(()=>{void requestClose('LOCAL_CONTROL')},100);
});
controlApp.use((req,res)=>res.status(404).json({ok:false,error:'Not found'}));

(async()=>{
 const stale=jobs.interruptStale();if(stale)console.log(`JOBS | прекъснати от предишен backend: ${stale}`);
 await bc.start(checker.handleSocketFrame);
 apiServer=app.listen(PORT,'127.0.0.1',()=>{
  console.log(`Backend: http://127.0.0.1:${PORT} | build ${BUILD_VERSION}`);
  if(!BOT_TOKEN)console.log('ВНИМАНИЕ: BOT_TOKEN липсва. Backend-ът е само локален и tunnel няма да се стартира.');
  tunnel.start({port:PORT});
 });
 controlServer=controlApp.listen(CONTROL_PORT,'127.0.0.1',()=>console.log(`Control: http://127.0.0.1:${CONTROL_PORT} | LOCAL ONLY`));
})().catch(e=>console.log('ГРЕШКА:',e.message));

function stopServer(server){return new Promise(resolve=>{if(!server)return resolve();server.close(()=>resolve());setTimeout(resolve,2000).unref?.()})}
function busyState(){
 let checkerRunning=false,storeBusy=false,activeJobs=0;
 try{checkerRunning=!!checker.status().running}catch{}
 try{storeBusy=!!storeStatus.isBusy()}catch{}
 try{activeJobs=jobs.activeCount()}catch(e){console.log('JOBS | activeCount error: '+e.message);activeJobs=1}
 return{checkerRunning,storeBusy,activeJobs,busy:checkerRunning||storeBusy||activeJobs>0};
}
async function close(reason='CONTROL'){
 draining=true;
 const end=Date.now()+SHUTDOWN_TIMEOUT_MS;let lastLog=0;
 console.log(`BACKEND | graceful stop (${reason}): изчаквам активните операции...`);
 for(;;){
  const st=busyState();
  if(!st.busy)break;
  if(Date.now()>=end){console.log(`BACKEND | timeout after ${Math.round(SHUTDOWN_TIMEOUT_MS/60000)} min: спирам принудително`);break}
  if(Date.now()-lastLog>=10000){console.log(`BACKEND | waiting: checker=${st.checkerRunning?'yes':'no'} store=${st.storeBusy?'yes':'no'} jobs=${st.activeJobs}`);lastLog=Date.now()}
  await sleep(500);
 }
 await tunnel.stop();
 await stopServer(controlServer);
 await stopServer(apiServer);
 await bc.close();
 console.log('BACKEND | stopped safely');
 process.exit(0);
}
function requestClose(reason){
 if(!shutdownPromise)shutdownPromise=close(reason).catch(e=>{console.log('BACKEND | shutdown error: '+e.message);process.exitCode=1});
 return shutdownPromise;
}
process.on('SIGINT',()=>{
 const st=busyState();
 if(st.busy){
  console.log(`BACKEND | Ctrl+C BLOCKED while busy: checker=${st.checkerRunning?'yes':'no'} store=${st.storeBusy?'yes':'no'} jobs=${st.activeJobs}`);
  console.log(`BACKEND | use safe local stop: POST http://127.0.0.1:${CONTROL_PORT}/shutdown`);
  return;
 }
 void requestClose('SIGINT');
});
process.on('SIGTERM',()=>{void requestClose('SIGTERM')});