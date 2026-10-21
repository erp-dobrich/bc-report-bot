const {chromium}=require('playwright'),path=require('path');

const HOST='https://ovcharovols.isystems.cloud:41118/OVCHAROVO/';
let ctx,page;

async function start(){
 ctx=await chromium.launchPersistentContext(path.join(__dirname,'..','bot-profile'),{
  channel:'chrome',headless:true,viewport:{width:1600,height:1000},ignoreHTTPSErrors:true,
  httpCredentials:{username:process.env.BC_USER,password:process.env.BC_PASSWORD},
  args:['--profile-directory=Profile 3']
 });
 page=ctx.pages()[0]||await ctx.newPage();
 console.log('BC ботът е готов.');
}

async function ensurePage(){if(!page||page.isClosed())page=await ctx.newPage();return page}
function getContext(){return ctx}
function setPage(p){page=p}
async function close(){try{await ctx?.close()}catch{}}

module.exports={HOST,start,ensurePage,getContext,setPage,close};