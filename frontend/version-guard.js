(()=>{
 if(top!==window)return;

 const send=type=>new Promise(resolve=>chrome.runtime.sendMessage({type},r=>{
  resolve(chrome.runtime.lastError
   ?{ok:false,error:chrome.runtime.lastError.message,code:'RUNTIME_ERROR'}
   :(r||{ok:false,error:'Няма отговор от разширението'}));
 }));

 let host=null,busy=false,lastState=null;

 function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({
   '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
 }

 function remove(){
  host?.remove();
  host=null;
 }

 function show(result){
  lastState=result;
  remove();

  host=document.createElement('div');
  host.id='bc-version-guard';
  host.style.cssText='position:fixed;inset:0;z-index:2147483647';

  const root=host.attachShadow({mode:'closed'});
  const data=result?.data||{};
  const outdated=result?.code==='UPDATE_REQUIRED';

  root.innerHTML=`
   <style>
    :host{all:initial}
    .mask{position:fixed;inset:0;background:#132b3ed9;backdrop-filter:blur(5px);display:grid;place-items:center;font:14px/1.45 Segoe UI,Arial,sans-serif;color:#183237}
    .card{width:min(520px,calc(100vw - 32px));background:#fff;border:1px solid #d9e4e5;border-radius:18px;box-shadow:0 28px 90px #071c2666;padding:26px}
    .badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#fff0f1;color:#b53542;font-size:11px;font-weight:800}
    .title{font-size:22px;font-weight:850;margin:12px 0 7px}
    .text{color:#60736f}
    .versions{margin:18px 0;padding:12px 14px;border:1px solid #e1e9e8;border-radius:12px;background:#f7f9f9;display:grid;gap:7px}
    .row{display:flex;justify-content:space-between;gap:20px}
    .row b{color:#173d35}
    .actions{display:flex;gap:9px;margin-top:18px}
    .btn{height:42px;border-radius:10px;padding:0 16px;font:800 14px Segoe UI,Arial,sans-serif;cursor:pointer}
    .primary{border:1px solid #087a60;background:#078564;color:#fff}
    .secondary{border:1px solid #d8e4e2;background:#fff;color:#2d6559}
    .btn:disabled{cursor:wait;opacity:.65}
    .msg{min-height:19px;margin-top:12px;color:#697e79;font-size:12px}
    .err{color:#b53542}
   </style>

   <div class="mask">
    <div class="card">
     <span class="badge">${outdated?'АКТУАЛИЗАЦИЯ ЗАДЪЛЖИТЕЛНА':'ДОСТЪПЪТ Е ВРЕМЕННО ЗАКЛЮЧЕН'}</span>
     <div class="title">${outdated?'Има нова версия':'Не може да се провери версията'}</div>
     <div class="text">${outdated
      ?'Тази версия не може да се използва. Натисни „Актуализиране“.'
      :'За сигурност екстеншънът не стартира без успешна проверка на версията.'}
     </div>

     ${outdated?`
      <div class="versions">
       <div class="row"><span>Текуща версия</span><b>${esc(data.currentVersion||'—')}</b></div>
       <div class="row"><span>Последна версия</span><b>${esc(data.latestVersion||'—')}</b></div>
      </div>`:''}

     <div class="actions">
      ${outdated?'<button class="btn primary" data-action="update">Актуализиране</button>':''}
      <button class="btn secondary" data-action="retry">Провери отново</button>
     </div>

     <div class="msg ${outdated?'':'err'}">${esc(result?.error||'')}</div>
    </div>
   </div>`;

  root.addEventListener('click',async e=>{
   const b=e.target.closest('[data-action]');
   if(!b||busy)return;

   busy=true;
   for(const x of root.querySelectorAll('button'))x.disabled=true;
   const msg=root.querySelector('.msg');

   try{
    if(b.dataset.action==='retry'){
     msg.textContent='Проверявам…';
     const r=await send('VERSION');

     if(r?.ok){
      remove();
      location.reload();
      return;
     }

     show(r);
     return;
    }

    msg.classList.remove('err');
    msg.textContent='Проверявам за актуализация…';

    const r=await send('UPDATE');
    if(!r.ok)throw Error(r.error||'Актуализацията не е достъпна');

    if(r.data?.status==='update_available'){
     msg.textContent='Новата версия е намерена. Chrome я инсталира автоматично…';
    }else if(r.data?.status==='manual_opened'){
     msg.textContent='Отворена е страницата с последната версия.';
    }else if(r.data?.status==='throttled'){
     msg.textContent='Chrome вече е проверявал скоро. Актуализацията ще се приложи автоматично.';
    }else if(r.data?.status==='current'){
     location.reload();
    }else{
     msg.textContent='Проверката приключи.';
    }
   }catch(err){
    msg.classList.add('err');
    msg.textContent=err.message||String(err);
   }finally{
    busy=false;
    for(const x of root.querySelectorAll('button'))x.disabled=false;
   }
  });

  document.documentElement.append(host);
 }

 async function check(){
  const r=await send('VERSION');
  if(r?.ok){
   remove();
   return true;
  }
  show(r);
  return false;
 }

 globalThis.__BC_VERSION_GATE__=check();
 globalThis.__BC_FORCE_VERSION_CHECK__=check;

 /* Ако версията бъде сменена докато страницата е отворена. */
 setInterval(check,30000);
})();