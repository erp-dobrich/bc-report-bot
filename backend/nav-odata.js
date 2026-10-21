const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const ROOT="http://ovcharovols.isystems.cloud:42148/OVCHAROVO/ODataV4/Company('Ovcharovo_EUR')";
const HOST='http://ovcharovols.isystems.cloud:42148/OVCHAROVO/ODataV4/';
const SERVICES={open:'StoreStatementsRead',posted:'ОсчетоводениОтчетиДамян'};
const FIELDS={open:'No,Store_No,Trans_Ending_Date,Calculated_Date',posted:'No,Store_No,Trans_Ending_Date,Posted_Date,Posted_Time,Sales_Amount,VAT_Amount'};
const SCRIPT=[
'$ErrorActionPreference="Stop"',
'$ProgressPreference="SilentlyContinue"',
'[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)',
'if([string]::IsNullOrWhiteSpace($env:BC_USER) -or [string]::IsNullOrWhiteSpace($env:BC_PASSWORD)){throw "NAV credentials missing"}',
'$pass=ConvertTo-SecureString $env:BC_PASSWORD -AsPlainText -Force',
'$cred=[System.Management.Automation.PSCredential]::new($env:BC_USER,$pass)',
'$next=[string]$env:NAV_ODATA_URL',
'$seen=@{}',
'$rows=New-Object System.Collections.Generic.List[object]',
'while($next){',
'if($seen.ContainsKey($next)){throw "Repeated OData nextLink"}',
'$seen[$next]=$true',
'$uri=[uri]$next',
'if(-not $uri.AbsoluteUri.StartsWith("http://ovcharovols.isystems.cloud:42148/OVCHAROVO/ODataV4/",[System.StringComparison]::OrdinalIgnoreCase)){throw "Unexpected OData destination"}',
'$response=Invoke-RestMethod -Uri $uri.AbsoluteUri -Method Get -Credential $cred -Headers @{Accept="application/json"} -TimeoutSec 60 -ErrorAction Stop',
'if($null -eq $response.value){throw "OData value array missing"}',
'foreach($row in @($response.value)){$rows.Add($row);if($rows.Count -gt 50000){throw "Too many OData rows"}}',
'$link=[string]$response."@odata.nextLink"',
'$next=if($link){([uri]::new($uri,$link)).AbsoluteUri}else{""}',
'}',
'$json=@{rows=$rows.ToArray();count=$rows.Count}|ConvertTo-Json -Depth 12 -Compress',
'[Console]::Out.Write($json)'
].join('\n');
const COMMAND=Buffer.from(SCRIPT,'utf16le').toString('base64');
function enabled(){return process.env.NAV_ODATA_MODE!=='browser'&&process.platform==='win32'&&!!String(process.env.BC_USER||'').trim()&&!!String(process.env.BC_PASSWORD||'').trim()}
function iso(s){const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s||''));if(!m)throw Error('Invalid OData date');const day=+m[1],month=+m[2],year=+m[3],d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)throw Error('Invalid OData date');return`${m[3]}-${m[2]}-${m[1]}`}
function bg(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))throw Error('Invalid OData result date');return`${s.slice(8,10)}.${s.slice(5,7)}.${s.slice(0,4)}`}
function storesSet(stores){if(!Array.isArray(stores)||!stores.length||stores.length>250)throw Error('Invalid store list');const out=new Set();for(const x of stores){const s=String(x);if(!/^\d{6}$/.test(s))throw Error('Invalid store number');out.add(s)}return out}
function reportCode(s){return /^\d{6}S\d+$/.test(String(s||''))}
function link(service,filter,select,top){const u=new URL(ROOT+'/'+encodeURIComponent(service));u.searchParams.set('$filter',filter);u.searchParams.set('$select',select);if(top)u.searchParams.set('$top',String(top));return u.toString()}
async function request(url){if(!enabled())throw Error('OData е изключена или липсват BC_USER/BC_PASSWORD на Windows');if(!url.startsWith(HOST))throw Error('Invalid OData URL');const{stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',COMMAND],{env:{...process.env,NAV_ODATA_URL:url},windowsHide:true,timeout:180000,maxBuffer:24*1024*1024,encoding:'utf8'});let data;try{data=JSON.parse(stdout)}catch{throw Error('Невалиден JSON от NAV OData')}if(!data||!Array.isArray(data.rows)||data.count!==data.rows.length)throw Error('Непълен резултат от NAV OData');return data.rows}
function normalize(kind,rows,options){if(!SERVICES[kind])throw Error('Unknown statement type');const allowed=storesSet(options.stores),from=iso(options.from),to=iso(options.to);if(from>to)throw Error('Invalid OData period');if(!Array.isArray(rows))throw Error('Invalid OData rows');const out=[],seen=new Set();for(const row of rows){const store=String(row.Store_No||'');if(!allowed.has(store)){if(options.strictStore)throw Error('NAV OData не приложи филтъра по магазин: '+store);continue}const report=String(row.No||''),date=String(row.Trans_Ending_Date||'');if(!reportCode(report)||!/^\d{6}$/.test(store)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Невалиден отчет в NAV OData: '+report+' / '+store);if(date<from||date>to)throw Error('NAV OData не приложи периода');if(kind==='posted'){const postedDate=String(row.Posted_Date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(postedDate))throw Error('NAV OData няма дата на осчетоводяване');if(!options.allPostedDates&&postedDate<from)continue}const key=store+'|'+report;if(seen.has(key))throw Error('Повторен отчет от NAV OData');seen.add(key);out.push({store,report,date:bg(date),calculated:kind==='open'&&String(row.Calculated_Date||'')!=='0001-01-01'&&row.Calculated_Date?bg(row.Calculated_Date):'',postedDate:kind==='posted'?row.Posted_Date:'',sales:kind==='posted'?row.Sales_Amount:undefined,vat:kind==='posted'?row.VAT_Amount:undefined})}return out}
async function listStatements(kind,options){if(!SERVICES[kind])throw Error('Unknown statement type');const stores=[...storesSet(options.stores)],from=iso(options.from),to=iso(options.to);if(from>to)throw Error('Invalid OData period');const filters=[`Trans_Ending_Date ge ${from}`,`Trans_Ending_Date le ${to}`];if(kind==='posted'&&!options.allPostedDates)filters.push(`Posted_Date ge ${from}`);if(stores.length===1)filters.push(`Store_No eq '${stores[0]}'`);const rows=await request(link(SERVICES[kind],filters.join(' and '),FIELDS[kind]));return normalize(kind,rows,options)}
async function listOpenReports(options){const rows=await listStatements('open',options);for(const r of rows)if(!r.report.startsWith(r.store+'S'))throw Error('Номерът на отворения отчет не съответства на магазина: '+r.report+' / '+r.store);return rows.map(r=>({code:r.report,store:r.store,date:r.date}))}
async function byNumber(kind,report){if(!SERVICES[kind]||!reportCode(report))throw Error('Невалиден номер на отчет');const rows=await request(link(SERVICES[kind],`No eq '${report}'`,FIELDS[kind],2));if(rows.length>1)throw Error('Повторен отчет от NAV OData');if(rows.length&&String(rows[0].No)!==report)throw Error('NAV OData не приложи филтъра по номер');return rows[0]||null}
async function postedByNumber(report){return byNumber('posted',report)}
async function openByNumber(report){return byNumber('open',report)}
module.exports={enabled,listStatements,listOpenReports,postedByNumber,openByNumber,normalize,iso,bg};