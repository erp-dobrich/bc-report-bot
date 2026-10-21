const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const ALLOWED=new Set(['871700205','871700229','871700383','871700392','8900203','8900240','8900251','8900253','8900270','99601098','99601099']);
const SCRIPT=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
if([string]::IsNullOrWhiteSpace($env:BC_USER) -or [string]::IsNullOrWhiteSpace($env:BC_PASSWORD)){throw 'NAV credentials missing'}
$cred=[System.Management.Automation.PSCredential]::new($env:BC_USER,(ConvertTo-SecureString $env:BC_PASSWORD -AsPlainText -Force))
$root="http://ovcharovols.isystems.cloud:42148/OVCHAROVO/ODataV4/Company('Ovcharovo_EUR')"
$prefix='http://ovcharovols.isystems.cloud:42148/OVCHAROVO/ODataV4/'
$services=@{
 dTest2='РегистърТранзакцииДамян'
 dTest='РедовеПродажбиДамян'
 MyTest='НаличностиАртикулиДамян'
}
$store=[string]$env:NAV_SHORTAGE_STORE
$reports=@([string]$env:NAV_SHORTAGE_REPORTS -split ',')
if($store -notmatch '^[0-9]{6}$' -or $reports.Count -lt 1 -or $reports.Count -gt 50){throw 'Invalid OData batch'}
$unique=@{}
foreach($rep in $reports){if($rep -notmatch '^[0-9]{6}S[0-9]+$' -or -not $rep.StartsWith($store+'S') -or $unique.ContainsKey($rep)){throw 'Invalid OData report list'};$unique[$rep]=$true}
function Quote([string]$v){return $v.Replace("'","''")}
function Num([decimal]$v){return $v.ToString('0.############################',[System.Globalization.CultureInfo]::InvariantCulture)}
function Rows([string]$service,[string]$filter,[string]$select){
 $next=$root+'/'+$services[$service]+'?$filter='+[uri]::EscapeDataString($filter)+'&$select='+[uri]::EscapeDataString($select)
 $seen=@{}
 $out=New-Object 'System.Collections.Generic.List[object]'
 while($next){
  if($seen.ContainsKey($next)){throw "Repeated OData page: $service"}
  $seen[$next]=$true
  $uri=[uri]$next
  if(-not $uri.AbsoluteUri.StartsWith($prefix,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected OData destination'}
  $reply=Invoke-RestMethod -Uri $uri.AbsoluteUri -Method Get -Credential $cred -Headers @{Accept='application/json'} -TimeoutSec 90 -MaximumRedirection 0 -ErrorAction Stop
  if(-not ($reply.PSObject.Properties.Name -contains 'value')){throw "Missing OData value: $service"}
  foreach($row in @($reply.value)){
   if($null -ne $row){$out.Add($row)}
   if($out.Count -gt 60000){throw "Too many OData rows: $service"}
  }
  $link=[string]$reply.'@odata.nextLink'
  $next=if($link){([uri]::new($uri,$link)).AbsoluteUri}else{''}
 }
 return $out.ToArray()
}
$started=[datetime]::UtcNow
$stats=@{}
foreach($rep in $reports){$stats[$rep]=[pscustomobject]@{transactions=0;lines=0}}
$headers=New-Object 'System.Collections.Generic.List[object]'
foreach($rep in $reports){
 $found=@(Rows 'dTest2' "Statement_No eq '$(Quote $rep)'" 'Store_No,POS_Terminal_No,Transaction_No,Transaction_Type,Statement_No')
 foreach($row in $found){
  if([string]$row.Statement_No -ne $rep -or [string]$row.Store_No -ne $store){throw "Inconsistent NAV statement headers: $rep"}
  $headers.Add($row)
 }
}
$keys=@{}
$posNums=@{}
foreach($h in $headers){
 $rep=[string]$h.Statement_No
 if([string]$h.Store_No -ne $store -or -not $unique.ContainsKey($rep)){throw 'OData transaction filter mismatch'}
 if([string]$h.Transaction_Type -ne 'Sales'){continue}
 $pos=[string]$h.POS_Terminal_No
 if([string]::IsNullOrWhiteSpace($pos) -or $null -eq $h.Transaction_No){throw "Invalid POS transaction: $rep"}
 $number=[int64]$h.Transaction_No
 $key=$store+'|'+$pos+'|'+$number
 if($keys.ContainsKey($key)){throw 'Duplicate OData transaction header'}
 $keys[$key]=$rep
 $stats[$rep].transactions++
 if(-not $posNums.ContainsKey($pos)){$posNums[$pos]=New-Object 'System.Collections.Generic.List[long]'}
 $posNums[$pos].Add($number)
}
$items=@{}
$lineKeys=@{}
foreach($pos in @($posNums.Keys)){
 $numbers=@($posNums[$pos] | Sort-Object -Unique)
 for($i=0;$i -lt $numbers.Count;){
  $lo=[int64]$numbers[$i]
  $hi=$lo
  $j=$i+1
  while($j -lt $numbers.Count -and $j-$i -lt 500 -and [int64]$numbers[$j]-$lo -le 800){$hi=[int64]$numbers[$j];$j++}
  $filter="Store_No eq '$(Quote $store)' and POS_Terminal_No eq '$(Quote $pos)' and Transaction_No ge $lo and Transaction_No le $hi"
  foreach($line in @(Rows 'dTest' $filter 'Store_No,POS_Terminal_No,Transaction_No,Line_No,Item_No,Item_Description,Quantity')){
   if([string]$line.Store_No -ne $store -or [string]$line.POS_Terminal_No -ne $pos -or $null -eq $line.Transaction_No){throw 'OData sales line filter mismatch'}
   $key=$store+'|'+$pos+'|'+([int64]$line.Transaction_No)
   if(-not $keys.ContainsKey($key)){continue}
   $rep=[string]$keys[$key]
   if($null -eq $line.Line_No){throw "Missing NAV line number: $rep"}
   $lineKey=$key+'|'+([int64]$line.Line_No)
   if($lineKeys.ContainsKey($lineKey)){throw "Duplicate NAV sales line: $rep"}
   $lineKeys[$lineKey]=$true
   $item=[string]$line.Item_No
   if([string]::IsNullOrWhiteSpace($item)){throw "Missing NAV item number: $rep"}
   if($null -eq $line.Quantity){throw "Missing sales quantity for $rep / $item"}
   $stats[$rep].lines++
   $qty=[decimal]$line.Quantity
   if($qty -ge 0){continue}
   $ik=$rep+'|'+$item
   if(-not $items.ContainsKey($ik)){$items[$ik]=[pscustomobject]@{report=$rep;item=$item;description=[string]$line.Item_Description;sold=[decimal]0}}
   $items[$ik].sold=[decimal]$items[$ik].sold-$qty
  }
  $i=$j
 }
}
$stock=@{}
$stockErrors=@{}
$byItem=@{}
foreach($x in $items.Values){$byItem[$x.item]=$true}
$allItems=@($byItem.Keys | Sort-Object)
function SaveStock([string]$item,[object[]]$result){
 $matches=@($result | Where-Object {[string]$_.No -eq $item -and [string]$_.Location_Filter -eq $store -and $null -ne $_.InventoryField})
 if($matches.Count -ne 1){throw "Missing or ambiguous inventory for $store / $item"}
 $stock[$item]=[decimal]$matches[0].InventoryField
}
$parallel=$true
$client=$null
$handler=$null
try{
 Add-Type -AssemblyName System.Net.Http
 $handler=New-Object System.Net.Http.HttpClientHandler
 $handler.Credentials=$cred.GetNetworkCredential()
 $handler.PreAuthenticate=$true
 $handler.AllowAutoRedirect=$false
 $handler.MaxConnectionsPerServer=6
 $client=[System.Net.Http.HttpClient]::new($handler)
 $client.Timeout=[TimeSpan]::FromSeconds(90)
 $client.DefaultRequestHeaders.Accept.ParseAdd('application/json')
}catch{$parallel=$false}
$limit=5
if($env:NAV_SHORTAGE_ITEM_CONCURRENCY -match '^[1-9][0-9]?$'){$limit=[Math]::Min(8,[Math]::Max(1,[int]$env:NAV_SHORTAGE_ITEM_CONCURRENCY))}
for($i=0;$i -lt $allItems.Count;$i+=$limit){
 $last=[Math]::Min($i+$limit-1,$allItems.Count-1)
 $batch=@($allItems[$i..$last])
 $pending=New-Object 'System.Collections.Generic.List[object]'
 if($parallel){
  foreach($item in $batch){
   $filter="No eq '$(Quote $item)' and Location_Filter eq '$(Quote $store)'"
   $url=$root+'/'+$services['MyTest']+'?$filter='+[uri]::EscapeDataString($filter)+'&$select='+[uri]::EscapeDataString('No,InventoryField,Location_Filter')
   try{$pending.Add([pscustomobject]@{item=$item;task=$client.GetAsync($url)})}catch{$pending.Add([pscustomobject]@{item=$item;task=$null})}
  }
 }
 foreach($item in $batch){
  $done=$false
  if($parallel){
   $p=@($pending | Where-Object {$_.item -eq $item})[0]
   $response=$null
   try{
    if($null -eq $p.task){throw 'No HTTP task'}
    $response=$p.task.GetAwaiter().GetResult()
    if(-not $response.IsSuccessStatusCode){throw 'NAV HTTP '+[int]$response.StatusCode}
    $json=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    if(-not ($json.PSObject.Properties.Name -contains 'value') -or $json.'@odata.nextLink'){throw 'Incomplete stock response'}
    SaveStock $item @($json.value)
    $done=$true
   }catch{}finally{if($null -ne $response){$response.Dispose()}}
  }
  if(-not $done){
   try{
    $filter="No eq '$(Quote $item)' and Location_Filter eq '$(Quote $store)'"
    $result=@(Rows 'MyTest' $filter 'No,InventoryField,Location_Filter')
    SaveStock $item $result
   }catch{$stockErrors[$item]=[string]$_.Exception.Message}
  }
 }
}
if($null -ne $client){$client.Dispose()}
if($null -ne $handler){$handler.Dispose()}
$out=New-Object 'System.Collections.Generic.List[object]'
foreach($rep in $reports){
 $rs=@($items.Values | Where-Object {$_.report -eq $rep} | Sort-Object item)
 $errText=''
 if($stats[$rep].transactions -lt 1){$errText='Няма транзакции за продажби'}
 elseif($stats[$rep].lines -lt 1 -or $rs.Count -lt 1){$errText='Няма редове с продадени артикули'}
 $missing=New-Object 'System.Collections.Generic.List[object]'
 if(-not $errText){
  foreach($entry in $rs){
   $item=[string]$entry.item
   if($stockErrors.ContainsKey($item)){$errText="Наличността за $($item): "+$stockErrors[$item];break}
   if(-not $stock.ContainsKey($item)){$errText="Липсва наличност за $item";break}
   $sold=[decimal]$entry.sold
   $inventory=[decimal]$stock[$item]
   $deficiency=[Math]::Max([decimal]0,($sold-$inventory))
   if($deficiency -gt 0){$missing.Add([pscustomobject]@{item=$item;description=[string]$entry.description;store=$store;sold=(Num $sold);inventory=(Num $inventory);deficiency=(Num $deficiency)})}
  }
 }
 $out.Add([pscustomobject]@{statement=$rep;store=$store;transactions=$stats[$rep].transactions;lines=$stats[$rep].lines;articles=$rs.Count;missing=$missing.Count;rows=$missing.ToArray();error=$errText})
}
$elapsed=[int]([datetime]::UtcNow-$started).TotalMilliseconds
[Console]::Out.Write((@{store=$store;reports=$out.ToArray();elapsedMs=$elapsed} | ConvertTo-Json -Depth 12 -Compress))
`;
const COMMAND=Buffer.from(SCRIPT,'utf16le').toString('base64');
const CODE=/^\d{6}S\d+$/;
function enabled(){return process.platform==='win32'&&!!String(process.env.BC_USER||'').trim()&&!!String(process.env.BC_PASSWORD||'').trim()}
function validate(reports){if(!Array.isArray(reports)||!reports.length||reports.length>50)throw Error('Невалидна група отчети');const codes=reports.map(x=>String(x||'').trim()),store=codes[0].split('S')[0];if(new Set(codes).size!==codes.length||codes.some(x=>!CODE.test(x)||!x.startsWith(store+'S')))throw Error('Отчетите трябва да са уникални и от един магазин');return{codes,store}}
function readReport(x,code,store,ms){if(!x||x.statement!==code||x.store!==store||!Number.isInteger(x.transactions)||x.transactions<0||!Number.isInteger(x.lines)||x.lines<0||!Number.isInteger(x.articles)||x.articles<0||!Number.isInteger(x.missing)||x.missing<0||!Array.isArray(x.rows))throw Error('Невалидни данни за отчет '+code);if(x.error){return{report:code,store,status:'error',error:String(x.error).slice(0,600),errorKind:'technical',items:[],bad:[],source:'odata-strict',checkedAt:Date.now(),totalMs:ms}}if(x.transactions<1||x.lines<1||x.articles<1||x.rows.length!==x.missing||x.missing>x.articles)throw Error('Непълни API данни за '+code);const seen=new Set(),items=[];for(const r of x.rows){const item=String(r.item||''),sold=Number(r.sold),inventory=Number(r.inventory),deficiency=Number(r.deficiency);if(!item||seen.has(item)||r.store!==store||![sold,inventory,deficiency].every(Number.isFinite)||deficiency<=0||Math.abs(deficiency-Math.max(0,sold-inventory))>0.000001)throw Error('Невалидна липса от API за '+code);seen.add(item);items.push({item,description:String(r.description||''),location:store,sold:String(r.sold),inventory:String(r.inventory),deficiency:String(r.deficiency)})}items.sort((a,b)=>a.item.localeCompare(b.item,'bg'));const bad=items.filter(r=>!ALLOWED.has(r.item));return{report:code,store,transactions:x.transactions,lines:x.lines,articles:x.articles,items,bad,status:bad.length?'bad':items.length?'ok':'empty',source:'odata-strict',checkedAt:Date.now(),totalMs:ms}}
async function calculateBatch(reports,{signal}={}){const{codes,store}=validate(reports);if(!enabled())throw Error('OData проверката изисква Windows, BC_USER и BC_PASSWORD');const started=Date.now();let stdout;try{({stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',COMMAND],{env:{...process.env,NAV_SHORTAGE_STORE:store,NAV_SHORTAGE_REPORTS:codes.join(',')},windowsHide:true,signal,timeout:360000,maxBuffer:24*1024*1024,encoding:'utf8'}))}catch(e){if(signal?.aborted)throw Error('Проверката е спряна');throw Error('NAV OData: '+String(e.stderr||e.message||e).trim().slice(0,900))}let data;try{data=JSON.parse(stdout)}catch{throw Error('NAV OData върна невалиден JSON')}if(!data||data.store!==store||!Array.isArray(data.reports)||data.reports.length!==codes.length||!Number.isFinite(data.elapsedMs))throw Error('Непълен OData групов резултат');const result=new Map();for(const x of data.reports){if(!x||!codes.includes(x.statement)||result.has(x.statement))throw Error('OData върна друг или повторен отчет');result.set(x.statement,readReport(x,x.statement,store,Date.now()-started))}if(result.size!==codes.length)throw Error('OData пропусна отчет');return{store,reports:codes.map(code=>result.get(code)),elapsedMs:Date.now()-started,queryMs:data.elapsedMs}}
async function calculate(statement,options={}){const batch=await calculateBatch([statement],options);const result=batch.reports[0];if(result.status==='error')throw Error(result.error);return{...result,elapsedMs:batch.elapsedMs,queryMs:batch.queryMs}}
module.exports={enabled,calculate,calculateBatch};