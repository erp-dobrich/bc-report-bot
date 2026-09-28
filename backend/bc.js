const {chromium}=require('playwright'),path=require('path');

const HOST='https://ovcharovols.isystems.cloud:41118/OVCHAROVO/';
let ctx,page,onSocketFrame=()=>{};

function watch(p){
 if(p.__watched)return;
 p.__watched=true;
 p.on('websocket',ws=>{
  if(!ws.url().includes('/csh'))return;
  const channel=Symbol('csh');
  ws.on('framesent',e=>onSocketFrame({direction:'sent',payload:e.payload,channel,page:p}));
  ws.on('framereceived',e=>onSocketFrame({direction:'received',payload:e.payload,channel,page:p}));
 });
}

async function start(frameHandler){
 onSocketFrame=frameHandler||(()=>{});
 ctx=await chromium.launchPersistentContext(path.join(__dirname,'..','bot-profile'),{
  channel:'chrome',headless:true,viewport:{width:1600,height:1000},ignoreHTTPSErrors:true,
  httpCredentials:{username:process.env.BC_USER,password:process.env.BC_PASSWORD},
  args:['--profile-directory=Profile 3']
 });
 ctx.on('page',watch);
 page=ctx.pages()[0]||await ctx.newPage();
 watch(page);
 console.log('BC ботът е готов.');
}

async function ensurePage(){if(!page||page.isClosed()){page=await ctx.newPage();watch(page)}return page}
function getContext(){return ctx}
function setPage(p){page=p;watch(p)}
async function close(){try{await ctx?.close()}catch{}}

module.exports={HOST,start,ensurePage,getContext,setPage,close};
