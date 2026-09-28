require('dotenv').config();
const express=require('express'),cors=require('cors');
const bc=require('./bc'),checker=require('./checker'),storeStatus=require('./store-status'),tunnel=require('./tunnel');

const app=express(),PORT=Number(process.env.PORT||9922)||9922,BOT_TOKEN=String(process.env.BOT_TOKEN||'').trim(),LATEST_EXTENSION_VERSION=String(process.env.LATEST_EXTENSION_VERSION||'1.0.1').trim();
app.use(cors());
app.use(express.json());

app.get('/health',(req,res)=>res.json({ok:true,running:checker.status().running}));

app.use((req,res,next)=>{
 if(!BOT_TOKEN)return next();
 if(req.get('X-Bot-Token')===BOT_TOKEN)return next();
 res.status(401).json({ok:false,error:'Невалиден достъп до backend-а'});
});

app.use((req,res,next)=>{
 const current=String(req.get('X-Client-Version')||'').trim();
 if(current===LATEST_EXTENSION_VERSION)return next();
 res.status(426).json({ok:false,error:`Нужна е последната версия ${LATEST_EXTENSION_VERSION}.`,code:'UPDATE_REQUIRED',currentVersion:current||null,latestVersion:LATEST_EXTENSION_VERSION});
});

app.post('/run/start',(req,res)=>{
 if(storeStatus.isBusy())return res.status(409).json({ok:false,error:'Изчакай проверката по магазини или създаването на отчета'});
 const r=checker.start(req.body||{});
 res.status(r.ok?200:409).json(r);
});

app.post('/run/stop',(req,res)=>res.json(checker.stop()));

app.post('/run/clear',(req,res)=>{
 const r=checker.clear();
 res.status(r.ok?200:409).json(r);
});

app.get('/run/status',(req,res)=>res.json(checker.status()));
app.get('/run/wait',async(req,res)=>res.json(await checker.waitStatus(req.query.since,25000)));

storeStatus.init(app,()=>checker.status().running,()=>checker.status());

(async()=>{
 await bc.start(checker.handleSocketFrame);
 app.listen(PORT,'127.0.0.1',()=>{
  console.log(`Backend: http://127.0.0.1:${PORT}`);
  if(!BOT_TOKEN)console.log('ВНИМАНИЕ: BOT_TOKEN липсва. Backend-ът е само локален и tunnel няма да се стартира.');
  tunnel.start({port:PORT});
 });
})().catch(e=>console.log('ГРЕШКА:',e.message));

let closing=false;
async function close(){
 if(closing)return;closing=true;
 await tunnel.stop();
 await bc.close();
 process.exit();
}
process.on('SIGINT',close);
process.on('SIGTERM',close);