export const MARKS = ['check', 'heart', 'star', 'exclamation'];
export const MAX_BYTES = 32 * 1024 * 1024;
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
export const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const eq = (a, b) => stable(a) === stable(b);
const version = v => ({id:v.id, text:v.text, createdAt:v.createdAt, label:v.label ?? '', restoredFrom:v.restoredFrom ?? null});
export const normal = n => ({id:n.id, text:n.text, createdAt:n.createdAt, localDate:n.localDate, zoneId:n.zoneId,
  updatedAt:n.updatedAt, deletedAt:n.deletedAt ?? null, recoveredAt:n.recoveredAt ?? null,
  pendingRecovery:n.pendingRecovery ?? false, sourceDraftId:n.sourceDraftId ?? null,
  versions:(n.versions ?? []).map(version), candidates:(n.candidates ?? []).map(version), editDraft:n.editDraft ?? null,
  marks:MARKS.filter(m => (n.marks ?? []).includes(m)), syncConflicts:(n.syncConflicts ?? []).map(version).sort((a,b) => cmp(a.id,b.id))});
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const empty = () => ({format:'jiji-sync', schemaVersion:1, notes:[]});
export function project(notes) {
  return {...empty(), notes:notes.filter(n => !n.pendingRecovery).map(n => normal({...n,
    sourceDraftId:null, editDraft:null, candidates:[]})).sort((a,b) => cmp(a.id,b.id))};
}
const goodID = v => typeof v === 'string' && v.trim() && v.length <= 500;
const goodTime = t => Number.isSafeInteger(t) && t > 0 && t < 32503680000000;
const goodText = t => typeof t === 'string' && t.length <= 2000000;
export function validate(d) {
  if (!d || d.format !== 'jiji-sync' || d.schemaVersion !== 1 || !Array.isArray(d.notes) || d.notes.length > 100000) fail('不支持或不完整的同步文件');
  const ids = new Set(), versions = new Set();
  for (const raw of d.notes) {
    if (!raw || !Array.isArray(raw.versions) || !Array.isArray(raw.candidates) || !Array.isArray(raw.marks ?? []) ||
      !Array.isArray(raw.syncConflicts ?? []) || raw.pendingRecovery !== false || raw.candidates.length ||
      raw.editDraft != null || raw.sourceDraftId != null) fail('同步文件包含未发送内容或无效字段');
    if ((raw.marks ?? []).some(m => !MARKS.includes(m)) || new Set(raw.marks ?? []).size !== (raw.marks ?? []).length) fail('同步标记无效');
    const n = normal(raw);
    if (!goodID(n.id) || ids.has(n.id) || !goodText(n.text) || !n.text.trim() || !goodTime(n.createdAt) || !goodTime(n.updatedAt) ||
      (n.deletedAt != null && !goodTime(n.deletedAt)) || (n.recoveredAt != null && !goodTime(n.recoveredAt)) ||
      n.versions[0]?.text !== n.text || typeof n.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(n.localDate) ||
      Number.isNaN(Date.parse(n.localDate)) || new Date(n.localDate).toISOString().slice(0,10) !== n.localDate) fail('同步记录无效');
    try { new Intl.DateTimeFormat('en', {timeZone:n.zoneId}).format(); } catch { fail('同步时区无效'); }
    ids.add(n.id);
    for (const v of n.versions) {
      if (!goodID(v.id) || versions.has(v.id) || !goodText(v.text) || !goodTime(v.createdAt) ||
        typeof v.label !== 'string' || v.label.length > 100 || (v.restoredFrom != null && !goodID(v.restoredFrom))) fail('同步历史版本无效');
      versions.add(v.id);
    }
    if (new Set(n.syncConflicts.map(v => v.id)).size !== n.syncConflicts.length ||
      n.syncConflicts.some(v => v.text === n.text || !n.versions.some(h => eq(h,v)))) fail('同步冲突版本无效');
  }
  return d;
}
export function decode(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) fail('同步文件超过 32 MB');
  let d; try { d = JSON.parse(text); } catch { fail('同步文件损坏，请检查仓库文件'); }
  validate(d); return project(d.notes);
}
export const encode = d => stable(validate(d));
export function pending(local, base) {
  const known = new Map(base.notes.map(n => [n.id, normal(n)]));
  return local.notes.filter(n => !eq(normal(n),known.get(n.id))).length;
}
const pick = (b,l,r) => eq(l,r) || eq(r,b) ? l : r;
export function merge(base, local, remote) {
  [base,local,remote].forEach(validate);
  const [b,l,r] = [base,local,remote].map(d => new Map(d.notes.map(n => [n.id,normal(n)])));
  const notes = [...new Set([...b.keys(),...l.keys(),...r.keys()])].sort().map(id => {
    const left = l.get(id) ?? b.get(id), right = r.get(id) ?? b.get(id), old = b.get(id);
    if (!left || !right) return clone(left ?? right);
    if (['createdAt','localDate','zoneId'].some(k => left[k] !== right[k])) fail('记录编号相同但来源不一致，已停止同步');
    const versions = new Map();
    for (const v of [...left.versions,...right.versions]) {
      if (versions.has(v.id) && !eq(versions.get(v.id),v)) fail('同步版本编号冲突，已停止同步');
      versions.set(v.id,v);
    }
    let text = pick(old?.text,left.text,right.text);
    const [bc,lc,rc] = [old,left,right].map(n => new Map((n?.syncConflicts ?? []).map(v => [v.id,v])));
    const conflicts = new Map();
    for (const id of new Set([...lc.keys(),...rc.keys()])) {
      if (bc.has(id) && (!lc.has(id) || !rc.has(id))) continue;
      conflicts.set(id,lc.get(id) ?? rc.get(id));
    }
    if (left.text !== right.text && left.text !== old?.text && right.text !== old?.text) {
      const heads = [left.versions[0],right.versions[0]].sort((a,b) => cmp(a.id,b.id));
      text = heads[0].text; heads.forEach(v => conflicts.set(v.id,v));
    }
    const seen = new Set();
    const choices = [...conflicts.values()].sort((a,b) => cmp(a.id,b.id)).filter(v => {
      if (v.text === text || seen.has(v.text)) return false; seen.add(v.text); return true;
    });
    const history = [...versions.values()].sort((a,b) => Number(b.text === text)-Number(a.text === text) || b.createdAt-a.createdAt || cmp(a.id,b.id));
    const deleted = pick(old ? old.deletedAt != null : false,left.deletedAt != null,right.deletedAt != null);
    const recovered = [left.recoveredAt,right.recoveredAt].filter(t => t != null);
    return {...right, text, versions:history, syncConflicts:choices,
      marks:MARKS.filter(m => pick(old?.marks.includes(m) ?? false,left.marks.includes(m),right.marks.includes(m))),
      deletedAt:deleted ? Math.max(left.deletedAt ?? 0,right.deletedAt ?? 0) : null,
      updatedAt:Math.max(left.updatedAt,right.updatedAt), recoveredAt:recovered.length ? Math.min(...recovered) : null};
  });
  return validate(project(notes));
}
export function connection(c) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(c.owner) || !/^[a-z\d_.-]{1,100}$/i.test(c.repo) || ['.','..'].includes(c.repo) ||
      !c.branch || c.branch.length > 200 || /[\x00-\x20\x7f]/.test(c.branch)) fail('请填写正确的 GitHub 用户、仓库和分支');
  return `${c.owner.toLowerCase()}/${c.repo.toLowerCase()}/${c.branch}`;
}
const toBase64 = text => {
  const bytes = new TextEncoder().encode(text); let bin = '';
  for (let i=0;i<bytes.length;i+=8192) bin += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(bin);
};
const fromBase64 = text => new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c => c.charCodeAt(0)));
export async function syncGitHub(config, captured, fetcher = fetch, phase = () => {}) {
  connection(config);
  if (!config.token?.trim()) fail('请填写 GitHub 访问令牌');
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const url = `${root}/contents/jiji-sync-v1.json`;
  async function request(path, method='GET', body) {
    const response = await fetcher(path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),
      headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${config.token.trim()}`,'X-GitHub-Api-Version':'2022-11-28',...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    if (response.status === 404 && method === 'GET' && path.startsWith(url+'?')) return null;
    if (response.status === 409) { const e = new Error('远端刚有更新，正在重新合并'); e.conflict = true; throw e; }
    if (!response.ok) fail(response.status === 401 ? '访问令牌已失效，请重新填写' : response.status === 403 ? 'GitHub 拒绝访问，请检查仓库权限或稍后重试' : response.status === 404 ? '仓库不存在或无权访问' : `GitHub 暂未完成同步（${response.status}）`);
    const text = await response.text(); if (text.length > MAX_BYTES*1.5) fail('远端响应过大');
    return JSON.parse(text);
  }
  phase('连接仓库');
  const repository = await request(root);
  if (repository.private !== true) fail('笔记只能同步到私有仓库，请先修改仓库可见性');
  for (let attempt=0;attempt<3;attempt++) {
    phase('获取更新');
    const file = await request(url+`?ref=${encodeURIComponent(config.branch)}`);
    let remote = empty();
    if (file) {
      if (file.type !== 'file' || !/^[a-f0-9]{40,64}$/.test(file.sha) || file.size > MAX_BYTES) fail('远端同步文件无效或过大');
      const blob = file.encoding === 'base64' ? file : await request(`${root}/git/blobs/${file.sha}`);
      if (blob.encoding !== 'base64') fail('不支持的远端文件编码');
      remote = decode(fromBase64(blob.content));
    }
    const merged = merge(captured.state.base,captured.document,remote), text = encode(merged);
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) fail('同步文件超过 32 MB');
    if (file && eq(merged,remote)) return merged;
    phase('上传修改');
    try {
      await request(url,'PUT',{message:'Sync Jiji notes',branch:config.branch,content:toBase64(text),...(file ? {sha:file.sha} : {})});
      return merged;
    } catch(e) { if (!e.conflict || attempt === 2) throw e; }
  }
}
