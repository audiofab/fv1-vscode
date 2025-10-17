import * as vscode from 'vscode';
export function getSpnBanksHtml(webview: vscode.Webview): string {
  const nonce = (() => { let s = ''; const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); return s; })();
  const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:system-ui;padding:8px} .bank-select{margin-bottom:8px} .slots{display:grid;grid-template-columns:repeat(4,1fr);gap:8px} .slot{border:1px solid #ccc;padding:8px;border-radius:4px;display:flex;flex-direction:column} .slot .actions{margin-top:auto;display:flex;justify-content:space-between;align-items:center} button.icon{background:transparent;border:none;cursor:pointer;font-size:14px} .path{font-size:11px;color:#444;word-break:break-all}</style></head><body>
                    <div class="bank-select">
                      <select id="bankList"></select>
                      <button id="refresh">Refresh</button>
                      <button id="programAll">Program All</button>
                    </div>
                    <div class="slots" id="slots"></div>
                    <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    const bankList = document.getElementById('bankList');
                    const slotsEl = document.getElementById('slots');
                    const refresh = document.getElementById('refresh');
                    const programAll = document.getElementById('programAll');
                    let currentBank = null;
                    function renderSlots(slots){
                        slotsEl.innerHTML='';
                        slots.forEach(s=>{
                            const el=document.createElement('div');el.className='slot';
                            const title=document.createElement('div');title.textContent='Program '+s.slot;el.appendChild(title);
                            const path=document.createElement('div');path.className='path';path.textContent=s.path||'<Unassigned>';el.appendChild(path);
                            const actions=document.createElement('div');actions.className='actions';
                            const assignBtn=document.createElement('button');assignBtn.className='icon';assignBtn.textContent='📁';assignBtn.title='Assign';assignBtn.onclick=(()=>{vscode.postMessage({type:'assign', bankUri:currentBank, slot:s.slot});});
                            const programBtn=document.createElement('button');programBtn.className='icon';programBtn.textContent='⬇';programBtn.title='Program';programBtn.onclick=(()=>{vscode.postMessage({type:'program', bankUri:currentBank, slot:s.slot});});
                            const unassignBtn=document.createElement('button');unassignBtn.className='icon';unassignBtn.textContent='🗑';unassignBtn.title='Unassign';unassignBtn.onclick=(()=>{vscode.postMessage({type:'unassign', bankUri:currentBank, slot:s.slot});});
                            actions.appendChild(assignBtn);actions.appendChild(programBtn);actions.appendChild(unassignBtn);
                            el.appendChild(actions);
                            // allow drop
                            el.addEventListener('dragover',ev=>{ev.preventDefault();el.style.borderColor='#66aaff';});
                            el.addEventListener('dragleave',ev=>{el.style.borderColor='';});
                            el.addEventListener('drop',ev=>{ev.preventDefault();el.style.borderColor=''; const dt=ev.dataTransfer; if(!dt) return; const file=dt.files && dt.files[0]; if(file){ vscode.postMessage({type:'assign', bankUri:currentBank, slot:s.slot, path:file.path}); }});
                            slotsEl.appendChild(el);
                        });
                    }
                    window.addEventListener('message',ev=>{const msg=ev.data; switch(msg.type){
                        case 'banks':{ bankList.innerHTML=''; msg.banks.forEach(b=>{ const o=document.createElement('option'); o.value=b.uri; o.textContent=b.label; bankList.appendChild(o); }); if(bankList.options.length) { bankList.selectedIndex=0; currentBank=bankList.value; vscode.postMessage({type:'loadBank', uri:currentBank}); } break; }
                        case 'slots':{ if(msg.uri===currentBank) renderSlots(msg.slots); break; }
                        case 'program-start':{ /* reserved for UI updates */ break; }
                        case 'program-end':{ /* reserved for UI updates */ break; }
                    }});
                    bankList.addEventListener('change',()=>{ currentBank=bankList.value; vscode.postMessage({type:'loadBank', uri:currentBank}); });
                    refresh.addEventListener('click',()=>{ vscode.postMessage({type:'requestBanks'}); });
                    programAll.addEventListener('click',()=>{ if(currentBank) vscode.postMessage({type:'programAll', bankUri: currentBank}); });
                    vscode.postMessage({type:'requestBanks'});
                    </script></body></html>`;
}

export default getSpnBanksHtml;
