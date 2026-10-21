'use strict';
require('dotenv').config();
const oldCalculator = require('./nav-shortages');
const fastCalculator = require('./nav-shortages-fast');
const nav = require('./nav-odata');

function bgToday() {
  const pieces = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',year:'numeric'
  }).formatToParts(new Date());
  const p = Object.fromEntries(pieces.map(x => [x.type,x.value]));
  return {from:`01.${p.month}.${p.year}`,to:`${p.day}.${p.month}.${p.year}`};
}
function countRequests(result) {
  const r = result.requests;
  if (!r) return 'няма измерване в стария код';
  const p = result.pages || {};
  return `dTest2=${r.dTest2}, dTest=${r.dTest}, MyTest=${r.MyTest}; физически GET страници: ${Number(p.dTest2||0)+Number(p.dTest||0)+Number(p.MyTest||0)}`;
}
function closeNumber(a,b) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
    Math.abs(Number(a)-Number(b)) <= 0.0000005;
}
function compareOne(a,b) {
  const changes=[];
  for (const key of ['report','store','status','transactions','lines','articles']) {
    if (a[key] !== b[key]) changes.push(`${key}: ${String(a[key])} != ${String(b[key])}`);
  }
  if (a.status === 'error' || b.status === 'error') {
    changes.push('Поне една от проверките има техническа грешка');
  }
  const sa = [...(a.items||[])].sort((x,y)=>x.item.localeCompare(y.item));
  const sb = [...(b.items||[])].sort((x,y)=>x.item.localeCompare(y.item));
  if (sa.length!==sb.length) changes.push(`липси: ${sa.length} != ${sb.length}`);
  for(let i=0;i<Math.min(sa.length,sb.length);i++){
    const x=sa[i],y=sb[i];
    if(x.item!==y.item){changes.push(`артикул ${x.item} != ${y.item}`);continue;}
    for(const k of ['sold','inventory','deficiency']){
      if(!closeNumber(x[k],y[k])) changes.push(`${x.item}/${k}: ${x[k]} != ${y[k]}`);
    }
  }
  if((a.bad||[]).map(x=>x.item).sort().join(',') !== (b.bad||[]).map(x=>x.item).sort().join(',')){
    changes.push('Различен списък с непозволени артикули');
  }
  return changes;
}
async function main(){
  if(process.platform!=='win32') throw Error('Изпълнява се в Windows.');
  let codes=process.argv.slice(2).filter(x=>x.trim());
  if(!codes.length) throw Error('Изпълни: node test-nav-fast-compare.js 840005');
  if(codes.length===1 && /^\d{6}$/.test(codes[0])){
    const store=codes[0];
    const period=bgToday();
    const found=await nav.listOpenReports({stores:[store],...period});
    codes=found.map(x=>x.code);
  }
  if(!codes.length || codes.length>50) throw Error('Няма отчети за сравнение.');
  if(codes.some(x=>!/^\d{6}S\d+$/.test(x)||!x.startsWith(codes[0].slice(0,6)+'S')))
    throw Error('Въведи отчети от един и същ магазин.');
  console.log(`САМО OData GET | ${codes.length} отчета | магазин ${codes[0].slice(0,6)}`);
  console.log('1/2 Новият код: общи GET за dTest2 и MyTest...');
  const fastStart=Date.now();
  const fast=await fastCalculator.calculateBatch(codes);
  const fastMs=Date.now()-fastStart;
  console.log(`Нов код: ${(fastMs/1000).toFixed(2)} сек | ${countRequests(fast)}`);
  if (fast.timings) console.log(`Нова разбивка: dTest2 ${(fast.timings.dTest2/1000).toFixed(2)} сек; dTest ${(fast.timings.dTest/1000).toFixed(2)} сек; MyTest ${(fast.timings.MyTest/1000).toFixed(2)} сек`);
  console.log('2/2 Старият код: измервам референтния резултат...');
  const oldStart=Date.now();
  const reference=await oldCalculator.calculateBatch(codes);
  const oldMs=Date.now()-oldStart;
  console.log(`Стар код: ${(oldMs/1000).toFixed(2)} сек`);
  console.log(`Ускорение в този тест: ${(oldMs/fastMs).toFixed(2)} пъти`);
  let errors=0;
  for(let i=0;i<codes.length;i++){
    const a=reference.reports[i],b=fast.reports[i];
    const differences=compareOne(a,b);
    if(differences.length){errors++;console.log(`РАЗЛИКА ${codes[i]}: ${differences.join(' | ')}`);}
    else console.log(`СЪВПАДА ${codes[i]} | ${a.status.toUpperCase()} | липси ${(a.items||[]).length}`);
  }
  if(errors){
    console.log(`НЕ Е ПОТВЪРДЕНО: ${errors}/${codes.length} отчета с разлика или грешка. НЕ заменяй nav-shortages.js.`);
    process.exitCode=2;
  }else{
    console.log(`ПЪЛНО СЪВПАДЕНИЕ: ${codes.length}/${codes.length} отчета. Можем да обсъдим замяна след резултата.`);
  }
  console.log('Само OData GET. Не са променени файловете за реалната проверка или NAV.');
}
main().catch(e=>{console.error('ГРЕШКА:',String(e?.message||e).slice(0,1400));process.exitCode=1;});