import {MARKS} from './sync.mjs';

const MAX_BYTES=32*1024*1024;
const validTime=t=>Number.isSafeInteger(t)&&t>0&&t<32503680000000;
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const id=v=>typeof v==='string'&&v.trim().length>0&&v.length<=500;
const string=(v,max=2000000)=>typeof v==='string'&&v.length<=max;
function check(ok,message){if(!ok)throw Error(message);}
function version(v){check(v&&id(v.id)&&string(v.text)&&validTime(v.createdAt)&&string(v.label??'',100)&&(v.restoredFrom==null||id(v.restoredFrom)),'备份版本无效');return {id:v.id,text:v.text,createdAt:v.createdAt,label:v.label??'',restoredFrom:v.restoredFrom??null};}
function note(n){
 check(n&&id(n.id)&&string(n.text)&&validTime(n.createdAt)&&validTime(n.updatedAt)&&validDay(n.localDate)&&string(n.zoneId,100),'备份记录无效');
 try{new Intl.DateTimeFormat('en',{timeZone:n.zoneId}).format();}catch{throw Error('备份时区无效');}
 const versions=(n.versions??[]).map(version),candidates=(n.candidates??[]).map(version),syncConflicts=(n.syncConflicts??[]).map(version),pendingRecovery=!!n.pendingRecovery;
 check(pendingRecovery?candidates.length>0&&versions.length===0&&candidates.every(v=>v.text.trim()):!!n.text.trim()&&versions.length>0&&versions[0].text===n.text&&candidates.length===0,'备份版本关系不完整');
 check((n.deletedAt==null||validTime(n.deletedAt))&&(n.recoveredAt==null||validTime(n.recoveredAt))&&(n.sourceDraftId==null||id(n.sourceDraftId)),'备份记录状态无效');
 const marks=n.marks??[];check(Array.isArray(marks)&&marks.length<=MARKS.length&&new Set(marks).size===marks.length&&marks.every(m=>MARKS.includes(m)),'备份标记无效');
 check(syncConflicts.every(v=>versions.some(h=>h.id===v.id&&h.text===v.text)&&v.text!==n.text),'备份同步冲突无效');
 const editDraft=n.editDraft==null?null:n.editDraft;check(!editDraft||string(editDraft.text)&&validTime(editDraft.updatedAt),'备份编辑草稿无效');
 return {...n,versions,candidates,syncConflicts,marks,editDraft,pendingRecovery,deletedAt:n.deletedAt??null,recoveredAt:n.recoveredAt??null,sourceDraftId:n.sourceDraftId??null};
}
function draft(d){check(d&&id(d.id)&&string(d.text)&&Array.isArray(d.versions)&&(d.localDate===''||validDay(d.localDate))&&string(d.zoneId,100),'备份草稿无效');try{new Intl.DateTimeFormat('en',{timeZone:d.zoneId}).format();}catch{throw Error('备份草稿时区无效');}const versions=d.versions.map(version);check(versions.every(v=>v.text.trim())&&new Set(versions.map(v=>v.id)).size===versions.length,'备份草稿版本无效');check(d.updatedAt===0&&d.text===''&&versions.length===0||validTime(d.updatedAt),'备份草稿时间无效');return {...d,versions};}
function preferences(p){check(p&&string(p.displayName,48)&&p.displayName.trim()&&string(p.subtitle,200)&&string(p.placeholder,240)&&Number.isInteger(p.textSize)&&p.textSize>=14&&p.textSize<=24&&Number.isInteger(p.opacity)&&p.opacity>=20&&p.opacity<=100,'备份设置无效');return p;}
export function encodeBackup(state,tabID){
 const now=Date.now(),local=state.drafts[tabID]??{id:crypto.randomUUID(),text:'',updatedAt:0,versions:[]},p=state.preferences;
 const d=new Date(local.updatedAt||now),localDate=local.updatedAt?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';
 const backup={format:'jiji-backup',schemaVersion:3,exportedAt:now,notes:state.notes,draft:{id:local.id??crypto.randomUUID(),text:local.text??'',updatedAt:local.updatedAt??0,localDate,zoneId:Intl.DateTimeFormat().resolvedOptions().timeZone,selectionStart:local.selectionStart??0,selectionEnd:local.selectionEnd??0,lastEditKind:local.lastEditKind??'',versions:local.versions??[]},preferences:{displayName:(p.name??'自记').slice(0,12)||'自记',subtitle:(p.subtitle??'').slice(0,48),placeholder:(p.placeholder??'').slice(0,60),opacity:70,textSize:Math.max(14,Math.min(24,p.textSize??16)),overlayEnabled:false,collapseAfterSend:false,overlaySide:'right',overlayY:.3,inputX:1,inputY:.3}};
 const data=JSON.stringify(backup,null,2);check(new TextEncoder().encode(data).byteLength<=MAX_BYTES,'备份文件超过 32 MB');return data;
}
export function decodeBackup(data){
 check(new TextEncoder().encode(data).byteLength<=MAX_BYTES,'备份文件超过 32 MB');let raw;try{raw=JSON.parse(data);}catch{throw Error('备份文件格式不完整或已损坏');}
 check(raw?.format==='jiji-backup','请选择自记的完整备份文件');check(Number.isInteger(raw.schemaVersion)&&raw.schemaVersion>=1&&raw.schemaVersion<=3,'不支持此备份版本');
 check(Array.isArray(raw.notes)&&raw.notes.length<=100000,'备份记录数量过多');const notes=raw.notes.map(note),draftData=draft(raw.draft),p=preferences(raw.preferences);
 check(new Set(notes.map(n=>n.id)).size===notes.length,'备份中有重复记录标识');const allVersions=notes.flatMap(n=>[...n.versions,...n.candidates]).concat(draftData.versions);check(new Set(allVersions.map(v=>v.id)).size===allVersions.length,'备份中有重复版本标识');
 check(validTime(raw.exportedAt),'备份时间无效');return {notes,draft:draftData,preferences:p};
}
