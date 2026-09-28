const {spawn}=require('child_process'),https=require('https');

let child=null,restartTimer=null,stopping=false,currentUrl='',publishedUrl='',port=9922,tail='',probing=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const enabled=()=>String(process.env.TUNNEL_AUTO_START??'1')!=='0';
const token=()=>String(process.env.BOT_TOKEN||'').trim();
const configBase=()=>String(process.env.BOT_CONFIG_URL||'https://bot-config.erp-admin.workers.dev').replace(/\/+$/,'');
const cloudflared=()=>String(process.env.CLOUDFLARED_PATH||'cloudflared').trim()||'cloudflared';

function request(url,{method='GET',headers={},body='',timeout=10000}={}){
 return new Promise((resolve,reject)=>{
  const u=new URL(url),req=https.request({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method,headers},res=>{
   let data='';res.setEncoding('utf8');res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode||0,body:data}));
  });
  req.setTimeout(timeout,()=>req.destroy(Error('timeout')));req.on('error',reject);if(body)req.write(body);req.end();
 });
}

async function healthReady(url){
 try{
  const r=await request(`${url}/health`,{timeout:5000});
  if(r.status!==200)return false;
  const x=JSON.parse(r.body);return !!x?.ok;
 }catch{return false}
}

async function publish(url){
 if(!token())throw Error('BOT_TOKEN липсва');
 const body=JSON.stringify({backend:url});
 for(let i=1;i<=6&&!stopping;i++){
  try{
   const r=await request(`${configBase()}/config`,{method:'PUT',headers:{Authorization:`Bearer ${token()}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},body,timeout:12000});
   let x={};try{x=JSON.parse(r.body)}catch{}
   if(r.status>=200&&r.status<300&&x?.ok){publishedUrl=url;console.log(`TUNNEL | Worker обновен: ${url}`);return true}
   throw Error(x?.error||`HTTP ${r.status}`);
  }catch(e){console.log(`TUNNEL | Worker update опит ${i}/6: ${e.message}`);if(i<6)await sleep(Math.min(1000*i,4000))}
 }
 return false;
}

async function ensurePublished(url){
 if(probing||!url||stopping||url!==currentUrl||url===publishedUrl)return;
 probing=true;
 let attempt=0;
 try{
  while(!stopping&&child&&currentUrl===url&&publishedUrl!==url){
   attempt++;
   if(await healthReady(url)){
    console.log('TUNNEL | /health е достъпен');
    if(await publish(url))return;
   }else if(attempt===1||attempt%10===0){
    console.log(`TUNNEL | чакам публичния /health... опит ${attempt}`);
   }
   await sleep(2000);
  }
 }finally{
  probing=false;
  if(!stopping&&child&&currentUrl===url&&publishedUrl!==url)setTimeout(()=>ensurePublished(url).catch(e=>console.log('TUNNEL | '+e.message)),2000);
 }
}

function onUrl(url){
 if(!url)return;
 if(url!==currentUrl){currentUrl=url;publishedUrl='';console.log(`TUNNEL | ${url}`)}
 ensurePublished(url).catch(e=>console.log('TUNNEL | '+e.message));
}

function parse(chunk){
 const text=tail+String(chunk||'');tail=text.slice(-2000);
 const m=text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
 if(m)onUrl(m[0]);
}

function launch(){
 if(stopping||child||!enabled())return;
 if(!token()){console.log('TUNNEL | не стартирам: липсва BOT_TOKEN в backend/.env');return}
 console.log(`TUNNEL | стартирам cloudflared -> http://127.0.0.1:${port}`);
 try{child=spawn(cloudflared(),['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${port}`],{windowsHide:true,stdio:['ignore','pipe','pipe']})}catch(e){console.log('TUNNEL | не успях да стартирам cloudflared: '+e.message);return}
 child.stdout?.on('data',parse);child.stderr?.on('data',parse);
 child.on('error',e=>console.log('TUNNEL | cloudflared грешка: '+e.message));
 child.on('exit',(code,signal)=>{
  child=null;currentUrl='';publishedUrl='';tail='';probing=false;
  if(stopping)return;
  console.log(`TUNNEL | cloudflared спря (${code??signal??'?'}) -> нов опит след 3 сек.`);
  restartTimer=setTimeout(launch,3000);
 });
}

function start(opts={}){
 port=Number(opts.port||process.env.PORT||9922)||9922;stopping=false;
 if(!enabled()){console.log('TUNNEL | TUNNEL_AUTO_START=0');return}
 launch();
}

async function stop(){
 stopping=true;if(restartTimer){clearTimeout(restartTimer);restartTimer=null}
 const p=child;child=null;if(p){try{p.kill()}catch{}await sleep(250)}
}

function status(){return{enabled:enabled(),running:!!child,url:currentUrl||null,published:publishedUrl||null}}

module.exports={start,stop,status};