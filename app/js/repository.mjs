import {emptyState,applyAction,uuid,TABLES} from './domain.mjs';
const actorKey='jhg_v2_actor';
export function localActor(storage=localStorage){let id=storage.getItem(actorKey);if(!id){id=uuid();storage.setItem(actorKey,id);}return id;}
export function demoState(actor,now=Date.now()){
  const s=emptyState();s.profiles.push({id:actor,display_name:'我的毛孩之家'});
  const names=['柴柴爸','蛋捲媽','布丁姐','黑糖爸','米魯媽'];
  const dogs=['柴柴','蛋捲','拿鐵','OREO','米魯'];
  names.forEach((n,i)=>{const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');s.profiles.push({id,display_name:n});s.pets.push({id:uuid(),owner_id:id,name:dogs[i],type:'狗',breed:['柴犬・2歲','柯基・3歲','貴賓・4歲','柴犬・1歲','黃金獵犬・2歲'][i],photo:i===0?'assets/shiba-portrait.png':'',atlas:i?['0% 0%','100% 0%','0% 100%','100% 100%'][i-1]:null,discoverable:true});});
  s.profiles.slice(1,4).forEach((p,i)=>{const id=uuid();s.walks.push({id,owner_id:p.id,title:['風禾公園傍晚散步','慢慢走，認識新朋友','毛孩週末放電團'][i],park_id:['park-01','park-03','park-02'][i],starts_at:new Date(now+(i+1)*86400000).toISOString(),capacity:6,type:'一般',meeting_point:'公園入口旁（示範集合點）',note:'示範活動，請勿依此資訊赴約。',status:'open',created_at:new Date(now).toISOString()});s.members.push({walk_id:id,user_id:p.id,created_at:new Date(now).toISOString()});});
  s.posts=[{id:uuid(),owner_id:s.profiles[1].id,caption:'今天在草地上跑到不想回家！下次散步一起走吧。',photo:'assets/shiba-portrait.png',created_at:new Date(now).toISOString()},{id:uuid(),owner_id:s.profiles[2].id,caption:'毛孩的日常：睡飽了才有力氣玩。',photo:'assets/cat-nap.png',created_at:new Date(now-3600000).toISOString()}];
  s.swipes.push({owner_id:s.profiles[2].id,target_id:actor,decision:'like'});
  return s;
}
export class LocalRepository {
  constructor(mode='local',storage=localStorage){this.mode=mode;this.storage=storage;this.actor=localActor(storage);this.key='jhg_v2_'+mode;}
  async snapshot(){
    const raw=this.storage.getItem(this.key);
    if(!raw){const s=this.mode==='demo'?demoState(this.actor):emptyState();if(this.mode!=='demo')s.profiles.push({id:this.actor,display_name:'我的毛孩之家'});this.write(s);return s;}
    let s;try{s=JSON.parse(raw);}catch{throw new Error('本機資料格式損壞，請先匯出備份，勿清除瀏覽器資料');}
    for(const t of TABLES)if(!Array.isArray(s[t]))throw new Error('本機資料缺少 '+t+'，請先備份');
    return s;
  }
  write(state){try{this.storage.setItem(this.key,JSON.stringify(state));}catch{throw new Error('本機儲存空間不足；請先匯出備份或減少照片');}}
  async dispatch(action){
    const change=async()=>{const s=applyAction(await this.snapshot(),action,this.actor);this.write(s);return s;};
    return globalThis.navigator?.locks ? navigator.locks.request(this.key,change) : change();
  }
}
export function cloudReady(config){
  const key=config.supabasePublishableKey||'';let publicKey=key.startsWith('sb_publishable_');
  if(key.split('.').length===3){try{publicKey=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{publicKey=false;}}
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl||'') && publicKey;
}
export class CloudRepository {
  constructor(client,user){this.client=client;this.actor=user.id;this.mode='cloud';}
  async result(query){const {data,error}=await query;if(error)throw new Error(error.message);return data;}
  async snapshot(){const rows=await Promise.all(TABLES.map(t=>this.result(this.client.from('jhg_'+t).select('*'))));return Object.fromEntries(TABLES.map((t,i)=>[t,rows[i]||[]]));}
  async dispatch(action){
    const d=action.data||{}, c=this.client, uid=this.actor;
    const insert=(table,row)=>this.result(c.from('jhg_'+table).insert(row));
    const ownDelete=(table,id)=>this.result(c.from('jhg_'+table).delete().eq('id',id).eq('owner_id',uid));
    switch(action.type){
      case 'profile':await this.result(c.from('jhg_profiles').update({display_name:d.display_name}).eq('id',uid));break;
      case 'savePet':{const {validatePet}=await import('./domain.mjs');const row=validatePet(d);if(d.id)await this.result(c.from('jhg_pets').update(row).eq('id',d.id).eq('owner_id',uid));else await insert('pets',{...row,owner_id:uid});break;}
      case 'removePet':await ownDelete('pets',d.id);break;
      case 'saveWalk':{const {validateWalk}=await import('./domain.mjs');await this.result(c.rpc('jhg_save_walk',{p_id:d.id||null,p_data:validateWalk(d)}));break;}
      case 'joinWalk':case 'leaveWalk':case 'cancelWalk':await this.result(c.rpc('jhg_walk_action',{p_id:d.id,p_action:action.type}));break;
      case 'addPost':{const {text,safePhoto,requireValue}=await import('./domain.mjs');requireValue(text(d.caption)||safePhoto(d.photo),'請填寫貼文或選照片');await insert('posts',{owner_id:uid,caption:text(d.caption),photo:safePhoto(d.photo)});break;}
      case 'removePost':await ownDelete('posts',d.id);break;
      case 'likePost':await this.result(c.rpc('jhg_like_post',{p_id:d.id}));break;
      case 'addComment':await insert('comments',{owner_id:uid,post_id:d.post_id,body:d.body});break;
      case 'removeComment':await ownDelete('comments',d.id);break;
      case 'swipe':this.lastMatch=await this.result(c.rpc('jhg_swipe',{p_target:d.target_id,p_decision:d.decision}));break;
      case 'undoSwipe':await this.result(c.from('jhg_swipes').delete().eq('owner_id',uid).eq('target_id',d.target_id));break;
      case 'block':await this.result(c.from('jhg_blocks').upsert({owner_id:uid,target_id:d.target_id},{ignoreDuplicates:true}));break;
      case 'unblock':await this.result(c.from('jhg_blocks').delete().eq('owner_id',uid).eq('target_id',d.target_id));break;
      case 'report':await insert('reports',{owner_id:uid,target_id:d.target_id,reason:d.reason});break;
      case 'readNotifications':await this.result(c.from('jhg_notifications').update({read:true}).eq('user_id',uid));break;
      default:throw new Error('不支援的操作');
    }
    return this.snapshot();
  }
}
