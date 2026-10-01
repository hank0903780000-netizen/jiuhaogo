export const TABLES = ['profiles','pets','walks','members','posts','likes','comments','swipes','notifications','blocks','reports'];
export const uuid = () => globalThis.crypto.randomUUID();
export const emptyState = () => Object.fromEntries(TABLES.map(t => [t, []]));
export const text = (v,max=2000) => String(v ?? '').trim().slice(0,max);
export function requireValue(condition, message){ if(!condition) throw new Error(message); }
export function safePhoto(value){
  if(!value) return '';
  const v=String(value);
  if(/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(v) && v.length<1800000) return v;
  if(/^assets\/[a-z0-9-]+\.png$/.test(v)) return v;
  return '';
}
export function validatePet(data){
  requireValue(text(data.name,60), '請填寫毛孩名字');
  requireValue(['狗','貓','其他'].includes(data.type),'請選擇毛孩類型');
  return {name:text(data.name,60),type:data.type,breed:text(data.breed,160),photo:safePhoto(data.photo),discoverable:!!data.discoverable};
}
export function validateWalk(data,now=Date.now()){
  requireValue(text(data.title,100),'請填寫活動標題');
  requireValue(text(data.park_id,60),'請選擇公園');
  requireValue(Number.isFinite(Date.parse(data.starts_at)) && Date.parse(data.starts_at)>now,'活動時間必須在未來');
  const capacity=Number(data.capacity);
  requireValue(Number.isInteger(capacity)&&capacity>=2&&capacity<=20,'人數上限需為 2–20 人（含主揪）');
  requireValue(text(data.meeting_point,200),'請填寫確切集合位置');
  return {title:text(data.title,100),park_id:text(data.park_id,60),starts_at:new Date(data.starts_at).toISOString(),capacity,meeting_point:text(data.meeting_point,200),note:text(data.note,1000),type:text(data.type,30)||'一般'};
}
export function membersOf(state,id){ return state.members.filter(m=>m.walk_id===id); }
export function blocked(state,a,b){return state.blocks.some(r=>(r.owner_id===a&&r.target_id===b)||(r.owner_id===b&&r.target_id===a));}
export function applyAction(input,action,actor,now=Date.now()){
  requireValue(actor,'請先登入');
  const s=structuredClone(input), d=action.data||{}, stamp=new Date(now).toISOString();
  const notify=(user_id,body)=>s.notifications.push({id:uuid(),user_id,body,created_at:stamp,read:false});
  const owned=(table,id)=>{const row=s[table].find(r=>r.id===id);requireValue(row&&row.owner_id===actor,'找不到資料或沒有操作權限');return row;};
  switch(action.type){
    case 'profile': {
      const display_name=text(d.display_name,60);requireValue(display_name,'請填寫暱稱');
      const p=s.profiles.find(p=>p.id===actor); if(p)p.display_name=display_name;else s.profiles.push({id:actor,display_name}); break;
    }
    case 'savePet': {const v=validatePet(d);if(d.id)Object.assign(owned('pets',d.id),v);else s.pets.push({id:uuid(),owner_id:actor,...v,created_at:stamp});break;}
    case 'removePet': owned('pets',d.id);s.pets=s.pets.filter(p=>p.id!==d.id);break;
    case 'saveWalk': {
      const v=validateWalk(d,now);const id=d.id||uuid();
      if(d.id){const w=owned('walks',d.id);requireValue(w.status==='open'&&Date.parse(w.starts_at)>now,'活動已結束或取消');requireValue(v.capacity>=membersOf(s,id).length,'上限不能少於已報名人數');Object.assign(w,v);membersOf(s,id).filter(m=>m.user_id!==actor).forEach(m=>notify(m.user_id,'活動「'+w.title+'」已更新，請確認集合資訊。'));}
      else{s.walks.push({id,owner_id:actor,...v,status:'open',created_at:stamp});s.members.push({walk_id:id,user_id:actor,created_at:stamp});}break;
    }
    case 'joinWalk': {
      const w=s.walks.find(w=>w.id===d.id);requireValue(w&&w.status==='open'&&Date.parse(w.starts_at)>now,'活動已結束或取消');requireValue(!blocked(s,actor,w.owner_id),'無法加入此活動');
      if(s.members.some(m=>m.walk_id===w.id&&m.user_id===actor))break;
      requireValue(membersOf(s,w.id).length<w.capacity,'活動已額滿');s.members.push({walk_id:w.id,user_id:actor,created_at:stamp});notify(w.owner_id,'有人加入「'+w.title+'」。');break;
    }
    case 'leaveWalk': {
      const w=s.walks.find(w=>w.id===d.id);requireValue(w,'找不到活動');requireValue(w.owner_id!==actor,'主揪請使用取消活動');requireValue(w.status==='open'&&Date.parse(w.starts_at)>now,'活動已結束或取消');s.members=s.members.filter(m=>!(m.walk_id===d.id&&m.user_id===actor));notify(w.owner_id,'有人退出「'+w.title+'」。');break;
    }
    case 'cancelWalk': {const w=owned('walks',d.id);requireValue(w.status==='open'&&Date.parse(w.starts_at)>now,'活動已結束或取消');w.status='cancelled';membersOf(s,w.id).filter(m=>m.user_id!==actor).forEach(m=>notify(m.user_id,'活動「'+w.title+'」已取消。'));break;}
    case 'addPost': {requireValue(text(d.caption)||safePhoto(d.photo),'請寫下內容或選擇照片');s.posts.unshift({id:uuid(),owner_id:actor,caption:text(d.caption),photo:safePhoto(d.photo),created_at:stamp});break;}
    case 'removePost': {owned('posts',d.id);s.posts=s.posts.filter(p=>p.id!==d.id);s.likes=s.likes.filter(p=>p.post_id!==d.id);s.comments=s.comments.filter(p=>p.post_id!==d.id);break;}
    case 'likePost': {const p=s.posts.find(p=>p.id===d.id);requireValue(p&&!blocked(s,actor,p.owner_id),'找不到貼文');const exists=s.likes.some(l=>l.post_id===d.id&&l.user_id===actor);s.likes=s.likes.filter(l=>!(l.post_id===d.id&&l.user_id===actor));if(!exists)s.likes.push({post_id:d.id,user_id:actor});break;}
    case 'addComment': {const p=s.posts.find(p=>p.id===d.post_id);requireValue(p&&!blocked(s,actor,p.owner_id),'找不到貼文');requireValue(text(d.body,500),'請輸入留言');s.comments.push({id:uuid(),post_id:d.post_id,owner_id:actor,body:text(d.body,500),created_at:stamp});break;}
    case 'removeComment': owned('comments',d.id);s.comments=s.comments.filter(c=>c.id!==d.id);break;
    case 'swipe': {
      const target=s.profiles.find(p=>p.id===d.target_id);requireValue(target&&target.id!==actor&&!blocked(s,actor,target.id),'無法配對此用戶');
      requireValue(['like','pass'].includes(d.decision),'無效操作');const previous=s.swipes.find(r=>r.owner_id===actor&&r.target_id===target.id)?.decision;s.swipes=s.swipes.filter(r=>!(r.owner_id===actor&&r.target_id===target.id));s.swipes.push({owner_id:actor,target_id:target.id,decision:d.decision});
      if(d.decision==='like'&&previous!=='like'&&s.swipes.some(r=>r.owner_id===target.id&&r.target_id===actor&&r.decision==='like')){notify(actor,'你和 '+target.display_name+' 互相喜歡，可以一起揪團！');notify(target.id,'你有新的狗友配對！');}break;
    }
    case 'undoSwipe': s.swipes=s.swipes.filter(r=>!(r.owner_id===actor&&r.target_id===d.target_id));break;
    case 'block': requireValue(d.target_id!==actor&&s.profiles.some(p=>p.id===d.target_id),'無法封鎖此用戶');if(!s.blocks.some(b=>b.owner_id===actor&&b.target_id===d.target_id))s.blocks.push({owner_id:actor,target_id:d.target_id});break;
    case 'unblock':s.blocks=s.blocks.filter(b=>!(b.owner_id===actor&&b.target_id===d.target_id));break;
    case 'report': requireValue(text(d.reason,500),'請填寫檢舉原因');s.reports.push({id:uuid(),owner_id:actor,target_id:text(d.target_id,60),reason:text(d.reason,500),created_at:stamp});break;
    case 'readNotifications': s.notifications.filter(n=>n.user_id===actor).forEach(n=>n.read=true);break;
    default: throw new Error('不支援的操作');
  }
  return s;
}
