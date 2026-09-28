(()=>{
 if(top!==window)return;
 function docs(d=document,a=[]){if(!d||a.includes(d))return a;a.push(d);for(const f of d.querySelectorAll('iframe,frame'))try{if(f.contentDocument)docs(f.contentDocument,a)}catch{}return a}
 function cleanup(){for(const d of docs()){for(const e of d.querySelectorAll('#bc-report-controls,#bc-report-result-panel'))e.remove();for(const e of d.querySelectorAll('[data-bc-paint]')){e.style.removeProperty('color');e.style.removeProperty('font-weight');delete e.dataset.bcPaint}}}
 cleanup();setInterval(cleanup,1000);
})();
