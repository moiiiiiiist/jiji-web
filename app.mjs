import {MARKS, empty, project, merge, pending, decode, encode, connection, syncGitHub} from './sync.mjs';
import {openStore, read, mutate, tabID, onExternalChange, lockSync} from './store.mjs';

const $ = s => document.querySelector(s), uid = () => crypto.randomUUID();
const el = (tag, text, cls) => { const e=document.createElement(tag); if(text!=null)e.textContent=text; if(cls)e.className=cls; return e; };
const btn = (text, action, cls) => { const e=el('button',text,cls); e.type='button'; e.onclick=()=>Promise.resolve().then(action).catch(report); return e; };
const paths = {check:'<path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',heart:'<path d="M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13" fill="currentColor"/>',star:'<path d="m12 2 3.2 6.3 7 .9-5.1 5 1.2 7-6.3-3.3-6.3 3.3 1.2-7-5.1-5 7-.9Z" fill="currentColor"/>',exclamation:'<path d="M8 5a4 4 0 0 1 8 0l-1.8 10h-4.4Z" fill="currentColor"/><circle cx="12" cy="20" r="2.6" fill="currentColor"/>'};
const names={check:'对勾',heart:'心',star:'星',exclamation:'感叹号'};
function icon(mark){const e=el('span');e.innerHTML=`<svg class="mark-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[mark]}</svg>`;return e;}
let state, filterDate='', query='', selecting=false, anchor=null, chosen=new Set(), token='', busy=false, sending=false, toastTimer;
const input=$('#input'), stream=$('#stream'), dialog=$('#panel'), content=$('#panel-content');
const localDay = t => {const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateTime = t => new Date(t).toLocaleString('zh-CN',{hour12:false});
const notes = () => state.notes.filter(n=>!n.deletedAt && (!filterDate || n.localDate===filterDate) && (!query || n.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a,b)=>a.createdAt-b.createdAt || a.id.localeCompare(b.id));
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function report(e){toast(e.message || '操作未完成，请重试');}
function close(){dialog.close();}
function panel(title){content.replaceChildren();const h=el('div',null,'panel-title');h.append(el('span',title),btn('关闭',close));content.append(h);if(!dialog.open)dialog.showModal();return content;}
function field(parent,label,value,type='text'){const wrap=el('label',label,'field'), e=el(type==='textarea'?'textarea':'input');if(type!=='textarea')e.type=type;e.value=value??'';if(type==='password')e.autocomplete='off';wrap.append(e);parent.append(wrap);return e;}
function actions(parent,...buttons){const row=el('div',null,'actions');row.append(...buttons);parent.append(row);}
function preview(parent,text){parent.append(el('div',text,'note-preview'));}
async function update(fn, bottom=false){state=await mutate(fn);render();if(bottom)stream.scrollTop=stream.scrollHeight;}
function current(id){const n=state.notes.find(n=>n.id===id);if(!n)throw Error('记录不存在');return n;}
function makeVersion(text,label='编辑',restoredFrom=null){return {id:uid(),text,createdAt:Date.now(),label,restoredFrom};}
function changeText(n,text,label='编辑',restoredFrom=null){const v=makeVersion(text,label,restoredFrom);n.text=text;n.updatedAt=v.createdAt;n.versions.unshift(v);n.editDraft=null;n.syncConflicts=(n.syncConflicts??[]).filter(c=>c.text!==text);}
async function copy(list){await navigator.clipboard.writeText(list.map(n=>n.text).join('\n'));toast(`已复制 ${list.length} 条记录`);}
function toggle(id){if(!chosen.size)anchor=id;chosen.has(id)?chosen.delete(id):chosen.add(id);if(!chosen.size)anchor=null;render();}
function range(){if(!anchor)return toast('先选中一条记录');const rows=[...stream.querySelectorAll('.record')],top=stream.getBoundingClientRect().top;const target=rows.find(r=>r.getBoundingClientRect().bottom>top+1);if(!target)return;const all=notes(),a=all.findIndex(n=>n.id===anchor),b=all.findIndex(n=>n.id===target.dataset.id);if(a<0||b<0)return;all.slice(Math.min(a,b),Math.max(a,b)+1).forEach(n=>chosen.add(n.id));render();}
function render(){
 const pos=stream.scrollTop, all=notes();stream.replaceChildren();let day='';
 $('.brand').textContent=state.preferences.name;document.title=state.preferences.name;input.placeholder=state.preferences.placeholder;document.documentElement.style.setProperty('--record-size',`${state.preferences.textSize}px`);
 if(!all.length)stream.append(el('div',filterDate||query?'没有符合条件的记录':'还没有记录','empty'));
 for(const n of all){
  if(day!==n.localDate){day=n.localDate;stream.append(el('div',day,'day'));}
  const row=el('article',null,`record${chosen.has(n.id)?' selected':''}`);row.dataset.id=n.id;
  if(selecting){const box=el('input',null,'check');box.type='checkbox';box.checked=chosen.has(n.id);box.setAttribute('aria-label',`选择 ${n.text.slice(0,24)}`);box.onchange=()=>toggle(n.id);row.append(box);}
  const bubble=el('div',null,'bubble'),text=el('div',n.text,'record-text');text.onclick=()=>selecting?toggle(n.id):copy([n]).catch(report);bubble.append(text);
  const meta=el('div',null,'record-meta'),marks=el('span',null,'marks');for(const m of n.marks){const i=icon(m);i.title=names[m];marks.append(i);}meta.append(marks,el('time',new Date(n.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})));
  if(n.pendingRecovery)meta.append(btn('自动恢复',()=>recover(n.id)));
  if(n.syncConflicts?.length)meta.append(btn('选择版本',()=>conflicts(n.id),'warning'));
  meta.append(btn('•••',()=>options(n.id)));bubble.append(meta);row.append(bubble);stream.append(row);
 }
 stream.scrollTop=pos;
 $('#filter-bar').hidden=!(filterDate||query);$('#filter-bar').replaceChildren(el('span',[filterDate,query&&`搜索：${query}`].filter(Boolean).join(' · '),'toolbar-info'),btn('清除筛选',()=>{filterDate='';query='';render();}));
 $('#select-button').textContent=selecting?'取消':'多选';$('#composer').hidden=selecting;$('#selection-bar').hidden=!selecting;$('#range-bar').hidden=!selecting;
 $('#range-bar').replaceChildren(btn('↓ 选择到这里',range),el('span',`已选择 ${chosen.size} 条`,'toolbar-info'));
 $('#selection-bar').replaceChildren(btn('合并复制',()=>copy(notes().filter(n=>chosen.has(n.id)))),btn('标记',()=>markPanel([...chosen])),btn('删除',()=>remove([...chosen])));
 $('#sync-button').textContent=busy?'同步中…':'同步';
}
function options(id){const n=current(id),p=panel('记录');preview(p,n.text);actions(p,btn('复制',()=>copy([n])),btn('编辑',()=>edit(id)),btn('标记',()=>markPanel([id])),btn('历史',()=>history(id)),btn('多选',()=>{selecting=true;chosen=new Set([id]);anchor=id;close();render();}),btn('删除',()=>remove([id])));}
function edit(id){const n=current(id),p=panel('编辑'),area=field(p,'内容',n.editDraft?.text??n.text,'textarea');area.oninput=()=>update(s=>{const note=s.notes.find(n=>n.id===id);note.editDraft={text:area.value,updatedAt:Date.now(),selectionStart:area.selectionStart,selectionEnd:area.selectionEnd};}).catch(report);actions(p,btn('保存',async()=>{if(!area.value.trim())return toast('内容不能为空');if(area.value.length>2000000)throw Error('内容过长');await update(s=>changeText(s.notes.find(n=>n.id===id),area.value));close();},'primary'));area.focus();}
function history(id){const n=current(id),p=panel('消息历史');for(const v of n.versions){const c=el('div',null,'choice');c.append(el('div',`${dateTime(v.createdAt)} · ${v.label}`,'muted'));preview(c,v.text);c.append(btn(v.id===n.versions[0].id?'当前版本':'恢复此版本',async()=>{await update(s=>changeText(s.notes.find(n=>n.id===id),v.text,'恢复',v.id));close();},'secondary'));p.append(c);}}
function markPanel(ids){if(!ids.length)return toast('先选择记录');const p=panel('标记');for(const mark of MARKS){const active=ids.every(id=>current(id).marks.includes(mark));const b=btn(names[mark],async()=>{await update(s=>{for(const n of s.notes.filter(n=>ids.includes(n.id))){n.marks=active?n.marks.filter(m=>m!==mark):MARKS.filter(m=>m===mark||n.marks.includes(m));n.updatedAt=Date.now();}});markPanel(ids);},`mark-button${active?' active':''}`);b.prepend(icon(mark));p.append(b);}}
async function remove(ids){if(!ids.length)return toast('先选择记录');await update(s=>{s.notes.filter(n=>ids.includes(n.id)).forEach(n=>{n.deletedAt=Date.now();n.updatedAt=n.deletedAt;});});chosen.clear();anchor=null;close();render();toast('已移到回收站');}
function trash(){const p=panel('回收站'),list=state.notes.filter(n=>n.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt);if(!list.length)p.append(el('p','回收站为空','muted'));for(const n of list){const c=el('div',null,'choice');preview(c,n.text);c.append(btn('恢复',async()=>{await update(s=>{const note=s.notes.find(item=>item.id===n.id);note.deletedAt=null;note.updatedAt=Date.now();});trash();}));p.append(c);}}
function conflicts(id){const n=current(id),p=panel('选择保留的版本');for(const [i,v] of [n.versions[0],...(n.syncConflicts??[])].entries()){const c=el('div',null,'choice');c.append(el('div',i===0?'当前显示':dateTime(v.createdAt),'muted'));preview(c,v.text);c.append(btn('保留此版本',async()=>{await update(s=>{const note=s.notes.find(n=>n.id===id);changeText(note,v.text,'同步后选定',v.id);note.syncConflicts=[];});close();},'primary'));p.append(c);}}
function recover(id){const n=current(id),p=panel('自动恢复');for(const v of n.candidates??[]){const c=el('div',null,'choice');preview(c,v.text);c.append(btn('保留此版本',async()=>{await update(s=>{const n=s.notes.find(n=>n.id===id);n.text=v.text;n.versions=[makeVersion(v.text,'自动恢复')];n.candidates=[];n.pendingRecovery=false;n.updatedAt=Date.now();});close();},'primary'));p.append(c);}}
function dates(){const p=panel('日期'),date=field(p,'筛选日期',filterDate||localDay(Date.now()),'date');actions(p,btn('应用',()=>{filterDate=date.value;close();render();},'primary'),btn('今天',()=>{filterDate=localDay(Date.now());close();render();}),btn('所有日期',()=>{filterDate='';close();render();}));}
function search(){const p=panel('搜索'),q=field(p,'内容',query,'search');actions(p,btn('搜索',()=>{query=q.value.trim();close();render();},'primary'));q.onkeydown=e=>{if(e.key==='Enter'){query=q.value.trim();close();render();}};q.focus();}
function drafts(){const p=panel('草稿箱'),list=Object.entries(state.drafts).filter(([,d])=>d.text?.trim());if(!list.length)p.append(el('p','没有未发送草稿','muted'));for(const [key,d] of list){const c=el('div',null,'choice');c.append(el('div',key===tabID?'当前输入':dateTime(d.updatedAt),'muted'));preview(c,d.text);if(key!==tabID)c.append(btn('添加到输入框',async()=>{const text=[input.value,d.text].filter(Boolean).join('\n');await update(s=>{s.drafts[tabID]={text,updatedAt:Date.now()};});input.value=text;close();input.focus();}));p.append(c);}}
function settings(){const p=panel('设置'),name=field(p,'名称',state.preferences.name),placeholder=field(p,'输入提示',state.preferences.placeholder),size=field(p,'文字大小',state.preferences.textSize,'number');size.min=12;size.max=30;
 actions(p,btn('保存',async()=>{await update(s=>{s.preferences={name:name.value.trim()||'自记',placeholder:placeholder.value,textSize:Math.max(12,Math.min(30,Number(size.value)||16))};});close();},'primary'));
 p.append(btn('手动同步',syncPanel,'setting'),btn('草稿箱',drafts,'setting'),btn('回收站',trash,'setting'),btn('导出同步备份',()=>{const blob=new Blob([encode(project(state.notes))],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`jiji-sync-${localDay(Date.now())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'setting'),btn('导入同步备份',()=>{const f=el('input');f.type='file';f.accept='.json,application/json';f.onchange=async()=>{try{const file=f.files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('备份超过 32 MB');const doc=decode(await file.text());await update(s=>{const merged=merge(empty(),project(s.notes),doc);s.notes=preserveLocal(s.notes,merged.notes);});close();toast('已导入');}catch(e){report(e);}};f.click();},'setting'));
 p.append(el('p','同步备份包含已发送记录、标记和历史；草稿只保存在当前浏览器。','muted'));
}
function preserveLocal(local, merged){const byID=new Map(local.map(n=>[n.id,n]));return [...local.filter(n=>n.pendingRecovery),...merged.filter(n=>!byID.get(n.id)?.pendingRecovery).map(n=>({...n,editDraft:byID.get(n.id)?.editDraft??null,sourceDraftId:byID.get(n.id)?.sourceDraftId??null}))];}
function syncPanel(){const p=panel('手动同步'),c=state.config,key=connection(c),last=state.bases[key],count=pending(project(state.notes),last?.base??empty());p.append(el('p',`${count} 条本机更新${last?.lastSuccess?` · 上次 ${dateTime(last.lastSuccess)}`:''}`,'muted'));
 const owner=field(p,'GitHub 用户',c.owner),repo=field(p,'私有仓库',c.repo),branch=field(p,'分支',c.branch),secret=field(p,'访问令牌',token,'password');secret.spellcheck=false;secret.autocapitalize='none';
 const link=el('a','创建仅此仓库的访问令牌');link.href='https://github.com/settings/personal-access-tokens/new';link.target='_blank';link.rel='noopener noreferrer';p.append(link,el('p','令牌仅在本次打开期间使用。选择此私有仓库，并允许 Contents 读写。','muted'));
 const status=el('p','','muted');p.append(status);
 const go=btn(busy?'同步中…':'同步',async()=>{
  if(busy)return;const config={owner:owner.value.trim(),repo:repo.value.trim(),branch:branch.value.trim()};const key=connection(config);token=secret.value.trim();if(!token)throw Error('请填写访问令牌');
  busy=true;go.disabled=true;[owner,repo,branch,secret].forEach(e=>e.disabled=true);render();
  try{await lockSync(key,async()=>{await update(s=>{s.config=config;});const snapshot=await read(),captured={document:project(snapshot.notes),state:snapshot.bases[key]??{base:empty(),lastSuccess:0}};const uploaded=await syncGitHub({...config,token},captured,fetch,t=>status.textContent=t);await update(s=>{const merged=merge(captured.document,project(s.notes),uploaded);s.notes=preserveLocal(s.notes,merged.notes);s.bases[key]={base:uploaded,lastSuccess:Date.now()};});});toast('同步完成');}
  catch(e){status.textContent=`${e.message}。本机内容已保留。`;throw e;}
  finally{busy=false;go.disabled=false;go.textContent='同步';[owner,repo,branch,secret].forEach(e=>e.disabled=false);render();}
  syncPanel();
 },'primary');go.disabled=busy;actions(p,go,btn('清除令牌',()=>{token='';secret.value='';toast('令牌已清除');}));
 for(const n of state.notes.filter(n=>n.syncConflicts?.length))p.append(btn(`选择版本 · ${n.text.slice(0,32)}`,()=>conflicts(n.id),'setting'));
}
$('#date-button').onclick=dates;$('#search-button').onclick=search;$('#settings-button').onclick=settings;$('#sync-button').onclick=syncPanel;
$('#select-button').onclick=()=>{selecting=!selecting;chosen.clear();anchor=null;render();};
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
stream.addEventListener('click',e=>{if(e.target===stream||e.target.classList.contains('day'))input.blur();});
input.oninput=()=>{const text=input.value;$('#save-status').textContent='保存中…';mutate(s=>{s.drafts[tabID]={text,updatedAt:Date.now()};}).then(s=>{state=s;$('#save-status').textContent='已保存到本机';}).catch(()=>{$('#save-status').textContent='保存失败，请保留输入内容';});};
$('#send-button').onclick=async()=>{if(sending||!input.value.trim())return;sending=true;const text=input.value;if(text.length>2000000){sending=false;return toast('内容过长');}try{await update(s=>{const now=Date.now(),v=makeVersion(text,'发送');s.notes.push({id:uid(),text,createdAt:now,localDate:localDay(now),zoneId:Intl.DateTimeFormat().resolvedOptions().timeZone,updatedAt:now,deletedAt:null,recoveredAt:null,pendingRecovery:false,sourceDraftId:null,versions:[v],candidates:[],editDraft:null,marks:[],syncConflicts:[]});if(s.drafts[tabID]?.text===text)delete s.drafts[tabID];},true);if(input.value===text)input.value='';$('#save-status').textContent='已保存到本机';}catch(e){report(e);}finally{sending=false;}};
try{await openStore();state=await read();input.value=state.drafts[tabID]?.text??'';render();stream.scrollTop=stream.scrollHeight;onExternalChange(async()=>{state=await read();render();});if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}catch(e){stream.replaceChildren(el('p','无法打开本机存储，请允许浏览器保存网站数据后重试。','warning'));$('#send-button').disabled=true;report(e);}
