import {TABLES,emptyState,requireValue,safePhoto} from './domain.mjs';
const isId=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fields={profiles:['id','display_name'],pets:['id','owner_id','name','type','breed','photo','discoverable','created_at'],walks:['id','owner_id','title','park_id','starts_at','capacity','meeting_point','note','type','status','created_at'],members:['walk_id','user_id','created_at'],posts:['id','owner_id','caption','photo','created_at'],likes:['post_id','user_id'],comments:['id','post_id','owner_id','body','created_at'],swipes:['owner_id','target_id','decision'],notifications:['id','user_id','body','read','created_at'],blocks:['owner_id','target_id'],reports:['id','owner_id','target_id','reason','created_at']};
export function parseBackup(payload,actor){
 requireValue(payload?.version===2&&payload.mode==='local'&&isId(payload.actor)&&isId(actor),'請選擇第二版的本機資料備份');
 const output=emptyState();
 for(const table of TABLES){
  const rows=payload.state?.[table];requireValue(Array.isArray(rows)&&rows.length<=10000,'備份資料表不完整或過大：'+table);
  output[table]=rows.map(row=>{
   requireValue(row&&typeof row==='object'&&!Array.isArray(row),'備份內容格式錯誤');const clean={};
   for(const key of fields[table]){let value=row[key];requireValue(value!==undefined,'備份缺少必要欄位：'+key);
    requireValue(['string','number','boolean'].includes(typeof value),'備份欄位格式錯誤');
    if(key==='id'||key.endsWith('_id')){if(key==='park_id')requireValue(/^park-\d{2}$/.test(value),'公園代碼錯誤');else{requireValue(isId(value),'備份 ID 格式錯誤');if((key==='owner_id'||key==='user_id'||key==='target_id'||(table==='profiles'&&key==='id'))&&value===payload.actor)value=actor;}}
    if(key==='photo')value=safePhoto(value);
    else if(typeof value==='string')requireValue(value.length<=3000,'備份文字過長');
    if(key==='starts_at'||key==='created_at')requireValue(Number.isFinite(Date.parse(value)),'備份日期錯誤');
    if(key==='discoverable'||key==='read')requireValue(typeof value==='boolean','備份開關格式錯誤');
    clean[key]=value;
   }
   return clean;
  });
 }
 const users=new Set(output.profiles.map(p=>p.id)),walks=new Set(output.walks.map(p=>p.id)),posts=new Set(output.posts.map(p=>p.id));
 requireValue(users.has(actor),'備份缺少帳號資料');
 for(const t of TABLES){const ids=output[t].map(r=>r.id||[r.owner_id||r.user_id,r.target_id||r.walk_id||r.post_id].join(':'));requireValue(new Set(ids).size===ids.length,'備份含重複資料');for(const r of output[t]){
  for(const key of ['owner_id','user_id','target_id'])if(key in r)requireValue(users.has(r[key]),'備份引用不存在的用戶');
  if('walk_id'in r)requireValue(walks.has(r.walk_id),'備份活動關聯錯誤');if('post_id'in r)requireValue(posts.has(r.post_id),'備份貼文關聯錯誤');
 }}
 for(const p of output.profiles)requireValue(typeof p.display_name==='string'&&p.display_name.trim().length>0&&p.display_name.length<=60,'暱稱格式錯誤');
 for(const p of output.pets)requireValue(typeof p.name==='string'&&p.name.trim()&&p.name.length<=60&&['狗','貓','其他'].includes(p.type),'毛孩格式錯誤');
 for(const w of output.walks){requireValue(w.id&&w.owner_id&&w.park_id&&w.starts_at&&w.title&&w.meeting_point&&Number.isInteger(w.capacity)&&w.capacity>=2&&w.capacity<=20&&['open','cancelled'].includes(w.status),'活動格式錯誤');requireValue(output.members.filter(m=>m.walk_id===w.id).length<=w.capacity,'備份活動超額');}
 for(const p of output.posts)requireValue(p.id&&p.owner_id&&p.created_at&&typeof p.caption==='string','貼文格式錯誤');
 for(const s of output.swipes)requireValue(['like','pass'].includes(s.decision),'配對格式錯誤');
 return output;
}
