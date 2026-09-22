let database, opening, initialization, draftClaim;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('jiji-refresh') : null;
export let tabID = sessionStorage.getItem('jiji-tab') ?? crypto.randomUUID();
sessionStorage.setItem('jiji-tab',tabID);
export function blank() { return {notes:[],drafts:{},bases:{},config:{owner:'moiiiiiiist',repo:'jiji-sync-data',branch:'main'},preferences:{name:'自记',subtitle:'',placeholder:'记点什么…',textSize:16}}; }
function forget(db) { if(database===db) database=null; }
function connect() {
  if(database) return Promise.resolve(database);
  if(opening) return opening;
  opening=new Promise((resolve,reject) => {
    let settled=false;
    const request=indexedDB.open('jiji-web',1);
    request.onupgradeneeded=() => request.result.createObjectStore('state');
    request.onsuccess=() => {
      const db=request.result;
      // A blocked request may still succeed after we have reported its failure.
      if(settled) { db.close();return; }
      settled=true;
      db.onversionchange=() => { forget(db);db.close(); };
      db.onclose=() => forget(db);
      database=db;resolve(db);
    };
    request.onerror=() => { settled=true;reject(request.error); };
    request.onblocked=() => { settled=true;reject(new Error('请关闭旧版自记网页后重试')); };
  }).finally(() => { opening=null; });
  return opening;
}
async function transaction(mode, run) {
  for(let attempt=0;attempt<2;attempt++) {
    const db=await connect();let tx;
    try { tx=db.transaction('state',mode); }
    catch(error) {
      if(error.name!=='InvalidStateError') throw error;
      forget(db);db.close();
      if(attempt===1) throw error;
      continue;
    }
    // Retry only transaction creation. Never replay a mutation after it has begun.
    return run(tx);
  }
}
export function openStore() {
  initialization ??= initialize().catch(error => { initialization=null;throw error; });
  return initialization;
}
async function initialize() {
  // Duplicate browser tabs inherit sessionStorage. Claim ownership once per page,
  // independently of the database connection, so reconnecting keeps the same draft.
  if(navigator.locks) {
    draftClaim ??= new Promise((resolve,reject) => {
      const claim=() => navigator.locks.request('jiji-draft:'+tabID,{ifAvailable:true},lock => {
        if(!lock) { tabID=crypto.randomUUID();sessionStorage.setItem('jiji-tab',tabID);claim().catch(reject);return; }
        resolve();return new Promise(()=>{}); // Released when this page closes.
      });
      claim().catch(reject);
    }).catch(error => { draftClaim=null;throw error; });
    await draftClaim;
  }
  return mutate(s => {
    s.drafts ??= {};s.preferences ??= blank().preferences;
    if(s.draft) { s.drafts[tabID] ??= {text:s.draft,versions:[],id:crypto.randomUUID()};delete s.draft; }
  });
}
export function read() { return transaction('readonly',tx => new Promise((resolve,reject) => {
  const r=tx.objectStore('state').get('main');let result;
  r.onsuccess=() => { result=r.result ?? blank(); };
  tx.oncomplete=() => resolve(result);
  tx.onerror=() => reject(tx.error ?? r.error ?? new Error('未能读取，请重试'));
  tx.onabort=() => reject(tx.error ?? r.error ?? new Error('未能读取，请重试'));
})); }
export function mutate(fn) { return transaction('readwrite',tx => new Promise((resolve,reject) => {
  const store=tx.objectStore('state'),r=store.get('main');let next,failure;
  r.onsuccess=() => { try { next=r.result ?? blank();fn(next);store.put(next,'main'); } catch(e) { failure=e;tx.abort(); } };
  tx.oncomplete=() => { channel?.postMessage('changed');resolve(next); };
  tx.onerror=() => reject(failure ?? tx.error);
  tx.onabort=() => reject(failure ?? tx.error ?? new Error('未能保存，请重试'));
})); }
export function onExternalChange(fn) { if(channel) channel.onmessage=() => fn(); }
export async function lockSync(key, fn) {
  if(!navigator.locks) throw new Error('请使用新版 Safari 或 Chrome 进行同步');
  return navigator.locks.request('jiji-sync:'+key,{ifAvailable:true},lock => {
    if(!lock) throw new Error('另一个自记页面正在同步，请稍候'); return fn();
  });
}
