'use strict';
const navOData=require('./nav-odata');
const sec=t=>((Date.now()-t)/1000).toFixed(2)+'s';
async function readDayViaOData(store,date,{api=navOData,log=console.log}={}){
 if(!api.enabled())return null;
 const start=Date.now(),options={stores:[store],from:date,to:date,strictStore:true};
 try{
  const [posted,unpostedRows]=await Promise.all([
   api.listStatements('posted',{...options,allPostedDates:true}),
   api.listStatements('open',options)
  ]);
  for(const [kind,rows] of [['posted',posted],['open',unpostedRows]]){
   if(!Array.isArray(rows))throw Error('Непълен OData списък: '+kind);
   const seen=new Set();
   for(const row of rows){
    if(!row||row.store!==store||row.date!==date||
       typeof row.report!=='string'||!/^\d{6}S\d+$/.test(row.report)||!row.report.startsWith(store+'S'))
     throw Error('OData върна отчет извън избрания магазин/ден: '+kind);
    if(seen.has(row.report))throw Error('Дублиран отчет от OData: '+row.report);
    seen.add(row.report);
   }
  }
  log(`STORE-CREATE ODATA | ${store} / ${date} | осчетоводени: ${posted.length} | неосчетоводени: ${unpostedRows.length} | ${sec(start)}`);
  return {posted,unpostedRows};
 }catch(e){
  log('STORE-CREATE ODATA | '+String(e?.message||e).slice(0,300)+' | резервен Playwright');
  return null;
 }
}
module.exports={readDayViaOData};