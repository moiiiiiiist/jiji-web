let database;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('jiji-refresh') : null;
export let tabID = sessionStorage.getItem('jiji-tab') ?? crypto.randomUUID();
sessionStorage.setItem('jiji-tab',tabID);
export function blank() { return {notes:[],drafts:{},bases:{},config:{owner:'moiiiiiiist',repo:'jiji-sync-data',branch:'main'},preferences:{name:'自记',placeholder:'记点什么…',textSize:16}}; }
export async function openStore() {
  // Duplicate browser tabs inherit sessionStorage. Claim ownership before using a draft.
  if(navigator.locks) await new Promise((resolve,reject) => {
    const claim = () => navigator.locks.request('jiji-draft:'+tabID,{ifAvailable:true}, lock => {
      if(!lock) { tabID=crypto.randomUUID();sessionStorage.setItem('jiji-tab',tabID);claim().catch(reject);return; }
      resolve();return new Promise(()=>{}); // The browser releases it when this page closes.
    });
    claim().catch(reject);
  });
  database = await new Promise((resolve,reject) => {
    const request = indexedDB.open('jiji-web',1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭旧版自记网页后重试'));
  });
  database.onversionchange = () => database.close();
  return mutate(s => {
    s.drafts ??= {}; s.preferences ??= blank().preferences;
    if(s.draft) { s.drafts[tabID] ??= {text:s.draft,versions:[],id:crypto.randomUUID()}; delete s.draft; }
  });
}
export async function read() { return new Promise((resolve,reject) => {
  const tx=database.transaction('state','readonly'), r=tx.objectStore('state').get('main');
  r.onsuccess=() => resolve(r.result ?? blank()); r.onerror=() => reject(r.error);
}); }
export async function mutate(fn) { return new Promise((resolve,reject) => {
  const tx=database.transaction('state','readwrite'), store=tx.objectStore('state'), r=store.get('main'); let next, failure;
  r.onsuccess=() => { try { next=r.result ?? blank(); fn(next); store.put(next,'main'); } catch(e) { failure=e; tx.abort(); } };
  tx.oncomplete=() => { channel?.postMessage('changed'); resolve(next); };
  tx.onerror=() => reject(failure ?? tx.error); tx.onabort=() => reject(failure ?? tx.error ?? new Error('未能保存，请重试'));
}); }
export function onExternalChange(fn) { if(channel) channel.onmessage=() => fn(); }
export async function lockSync(key, fn) {
  if(!navigator.locks) throw new Error('请使用新版 Safari 或 Chrome 进行同步');
  return navigator.locks.request('jiji-sync:'+key,{ifAvailable:true},lock => {
    if(!lock) throw new Error('另一个自记页面正在同步，请稍候'); return fn();
  });
}
