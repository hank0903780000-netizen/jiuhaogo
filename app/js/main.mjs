import {uuid,text,safePhoto,blocked,membersOf,validateWalk,emptyState} from './domain.mjs';
import {LocalRepository,CloudRepository,cloudReady} from './repository.mjs';
import {ParkMap} from './maps.mjs';
import {parseBackup} from './backup.mjs';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,id='',cls='btn-ghost btn-sm')=>`<button class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const empty=(title,copy,action='')=>`<div class="empty-state"><span>🐾</span><h2>${title}</h2><p>${copy}</p>${action}</div>`;
const emoji=t=>t==='貓'?'🐱':t==='其他'?'🐰':'🐶';
const photo=p=>p?.photo&&safePhoto(p.photo)?`<img src="${esc(p.photo)}" alt="${esc(p.name||'毛孩')}的照片" draggable="false">`:p?.atlas?`<div class="pet-atlas" role="img" aria-label="${esc(p.name)}示範照片" style="background-position:${p.atlas}"></div>`:`<span class="pet-placeholder">${emoji(p?.type)}</span>`;
const fmt=d=>new Intl.DateTimeFormat('zh-TW',{month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d));
const day=d=>{const a=new Date(d);return [a.getFullYear(),String(a.getMonth()+1).padStart(2,'0'),String(a.getDate()).padStart(2,'0')].join('-');};
const config=window.JHG_CONFIG||{};
let client=null,repo=null,state=null,parks=[],map=null,current='match',mode=localStorage.getItem('jhg_mode')||'demo';
let parkFilter='',walkFilter='upcoming',parkSearch='',obPhoto='',composePhoto='',editingPetId=null,editingWalkId=null;
let parkDistrict='',parkLocation='',parkCategory='priority',parkLimit=30;
let previousTarget=null,swipeBusy=false,toastTimer,openPostId=null,refreshBusy=false,mutating=false,stateRevision=0,modeRequest=0;
const me=()=>repo?.actor;
const owner=id=>state?.profiles.find(p=>p.id===id)?.display_name||'毛孩朋友';
const minePets=()=>state?.pets.filter(p=>p.owner_id===me())||[];
const visible=id=>!blocked(state,me(),id);
const parkName=id=>parks.find(p=>p.id===id)?.name||'未指定公園';
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3600);}
function errorMessage(e){if(/fetch|network|Failed/i.test(e.message))return '連線失敗，資料尚未儲存。請檢查網路後再試。';return e.message||'操作失敗，請重試';}
async function run(fn){try{return await fn();}catch(e){console.error(e);toast(errorMessage(e));}}
function closeOv(id){$(id).classList.remove('show');$(id).removeAttribute('aria-modal');}
function openOv(id){const node=$(id);node.classList.add('show');node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.querySelector('input:not([type=file]),textarea,button')?.focus();}
function drawer(html){$('profile-body').innerHTML=html+button('關閉','closeDrawer','','btn-ghost drawer-close');openOv('ov-profile');}
function closePop(){$('mpop').classList.remove('show');}
function switchTab(name){
  current=name;for(const n of ['home','walk','map','match','dog','serve']){$('page-'+n).classList.toggle('active',n===name);const t=$('tab-'+n);if(t){const selected=n===name||(name==='serve'&&n==='dog');t.classList.toggle('on',selected);t.setAttribute('aria-current',selected?'page':'false');}}
  $('screen').scrollTop=0;if(name==='walk')map?.show();
}
async function act(type,data={},message='已儲存'){
  if(!repo||!state)throw new Error('資料尚未載入，請重試');
  if(mutating)throw new Error('正在儲存，請稍候');mutating=true;stateRevision++;
  try{state=await repo.dispatch({type,data});render();if(message)toast(message);}finally{mutating=false;}
}
function modeLabel(){return mode==='demo'?'示範體驗':mode==='local'?'本機模式':'雲端模式';}
function render(){
  if(!state)return;
  document.querySelectorAll('.demo-label').forEach(n=>n.textContent=modeLabel());
  $('mode-label').textContent=modeLabel();
  $('mode-description').textContent=mode==='demo'?'示範人物與活動，僅供體驗。':mode==='local'?'資料只保存在此瀏覽器，可匯出備份。':'已連接雲端，資料會同步至帳號。';
  renderWalks();renderParks();renderFeed();renderPets();renderDeck();
  $('notification-count').textContent=state.notifications.filter(n=>n.user_id===me()&&!n.read).length||'';
}
async function refresh(){if(refreshBusy||!repo||mutating)return;refreshBusy=true;const selected=repo,revision=stateRevision;try{const loaded=await selected.snapshot();if(repo===selected&&revision===stateRevision){state=loaded;render();$('load-error').hidden=true;}}finally{refreshBusy=false;}}
async function changeMode(next){
  if(!['demo','local','cloud'].includes(next))return;
  if(mutating)throw new Error('請等儲存完成後再切換模式');
  let selected;const request=++modeRequest;
  if(next==='cloud'){
    if(!client){drawer('<h3>雲端連線尚未設定</h3><p>目前可使用本機完整版。管理者設定 Supabase 專案後，即可登入同步資料。</p>');return;}
    const {data,error}=await client.auth.getSession();if(error)throw error;
    if(!data.session){openAuth();return;}
    selected=new CloudRepository(client,data.session.user);
  }else selected=new LocalRepository(next);
  const loaded=await selected.snapshot();if(request!==modeRequest)return;repo=selected;state=loaded;stateRevision++;
  mode=next;localStorage.setItem('jhg_mode',mode);previousTarget=null;closeOv('ov-profile');closePop();render();$('load-error').hidden=true;
}

function renderWalks(){
  let rows=state.walks.filter(w=>visible(w.owner_id)&&(!parkFilter||w.park_id===parkFilter));
  const now=Date.now();
  if(walkFilter==='upcoming')rows=rows.filter(w=>w.status==='open'&&Date.parse(w.starts_at)>now);
  if(walkFilter==='joined')rows=rows.filter(w=>state.members.some(m=>m.walk_id===w.id&&m.user_id===me()));
  if(walkFilter==='hosted')rows=rows.filter(w=>w.owner_id===me());
  rows.sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
  $('walk-groups').innerHTML=rows.map(w=>{
    const members=membersOf(state,w.id),isMine=w.owner_id===me(),joined=members.some(m=>m.user_id===me()),ended=Date.parse(w.starts_at)<=now,cancelled=w.status==='cancelled';
    const status=cancelled?'已取消':ended?'已結束':members.length>=w.capacity?'已額滿':`${w.capacity-members.length} 個名額`;
    return `<article class="card activity-card ${cancelled?'cancelled':''}"><div class="walk-top"><b>${esc(w.title)}</b><span class="walk-when">${status}</span></div><p class="activity-time">${fmt(w.starts_at)}</p><p class="walk-meta">${esc(parkName(w.park_id))} · ${esc(w.meeting_point)}</p><p class="walk-meta">${esc(w.type)} · 主揪 ${esc(owner(w.owner_id))}</p><div class="walk-foot"><span class="count">${members.length} / ${w.capacity} 人${joined?' · 已加入':''}</span>${button('查看活動','walkDetail',w.id,isMine?'btn-ghost btn-sm':'btn-green btn-sm')}</div></article>`;
  }).join('')||empty('這裡還沒有活動','換個公園看看，或發起第一場散步。',button('發起揪團','newWalk','','btn-green'));
}
function walkDetail(id){
  const w=state.walks.find(w=>w.id===id);if(!w)return;
  const own=w.owner_id===me(),joined=state.members.some(m=>m.walk_id===id&&m.user_id===me()),active=w.status==='open'&&Date.parse(w.starts_at)>Date.now();
  let actions='';if(active){if(own)actions=button('編輯活動','editWalk',id)+button('取消活動','cancelWalk',id);else if(joined)actions=button('退出活動','leaveWalk',id);else if(membersOf(state,id).length<w.capacity)actions=button('加入揪團','joinWalk',id,'btn-green');}
  drawer(`<h3>${esc(w.title)}</h3><p>${fmt(w.starts_at)}</p><p><b>${esc(parkName(w.park_id))}</b></p><p>集合位置：${esc(w.meeting_point)}</p><p class="hint">出發前請與主揪確認集合點及入園規則。</p><p>${esc(w.note||'帶上牽繩、飲水與拾便袋。')}</p><p>主揪：${esc(owner(w.owner_id))} · ${membersOf(state,id).length}/${w.capacity} 人</p><p>狀態：${w.status==='cancelled'?'已取消':Date.parse(w.starts_at)<=Date.now()?'已結束':'開放報名'}</p><div class="action-row">${actions}${button('加入行事曆','calendar',id)}</div>${!own?button('檢舉活動','report',w.owner_id):''}`);
}
function openWalkForm(id=null){
  const w=id?state.walks.find(w=>w.id===id&&w.owner_id===me()):null;editingWalkId=w?.id||null;
  const when=w?new Date(w.starts_at):new Date(Date.now()+3600000);
  $('wf-title').value=w?.title||'';$('wf-park').value=w?.park_id||parkFilter||parks[0]?.id||'';
  $('wf-date').value=day(when);$('wf-date').min=day(Date.now());$('wf-hour').value=when.getHours();$('wf-minute').value=when.getMinutes();
  $('wf-type').value=w?.type||'一般';$('wf-people').value=w?.capacity||6;$('wf-note').value=w?.note||'';$('wf-meeting').value=w?.meeting_point||'';
  $('walk-form-title').textContent=w?'編輯揪團':'發起揪團';$('walk-save').textContent=w?'儲存變更':'發起揪團';closeOv('ov-profile');openOv('ov-walk');
}
async function createWalk(){
  const h=Number($('wf-hour').value),m=Number($('wf-minute').value);
  if(!Number.isInteger(h)||h<0||h>23||!Number.isInteger(m)||m<0||m>59||$('wf-hour').value===''||$('wf-minute').value==='')throw new Error('請輸入正確時間');
  const data={id:editingWalkId,title:$('wf-title').value,park_id:$('wf-park').value,starts_at:$('wf-date').value+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00',capacity:Number($('wf-people').value),type:$('wf-type').value,note:$('wf-note').value,meeting_point:$('wf-meeting').value};
  validateWalk(data);await act('saveWalk',data,mode==='cloud'?'活動已同步':'活動已儲存於'+modeLabel());closeOv('ov-walk');walkFilter='hosted';$('walk-filter').value='hosted';parkFilter='';$('park-filter').value='';renderWalks();switchTab('walk');
}
function gotoPark(id){parkFilter=id;$('park-filter').value=id;walkFilter='upcoming';$('walk-filter').value=walkFilter;renderWalks();switchTab('walk');map?.show(id);}
function renderParks(){
  const q=parkSearch.trim().toLowerCase();
  const list=parks.filter(p=>(parkCategory==='all'||(parkCategory==='pet'?p.pet_area==='official_listed':parkCategory==='large'?p.large:p.priority))&&(p.name+p.district+p.type+p.address).toLowerCase().includes(q)&&(!parkDistrict||p.district===parkDistrict)&&(!parkLocation||(parkLocation==='located'?Number.isFinite(p.lat):!Number.isFinite(p.lat))));
  $('park-list').innerHTML=list.slice(0,parkLimit).map(p=>`<article class="card"><div class="walk-top"><b>${esc(p.name)}</b><span class="verification">${p.verification==='verified'?'官方座標':'座標待補'}</span></div><div class="park-tags">${p.pet_area==='official_listed'?'<span class="park-badge pet">🐾 寵物專區</span>':''}${p.large?'<span class="park-badge large">🌳 大型公園</span>':''}</div><p class="walk-meta">${esc(p.district)} · ${esc(p.type)}</p><p class="walk-meta">${esc(p.address||'地址請查看官方名錄')}</p>${p.large?`<p class="hint">${esc(p.size_note)}約 ${p.area_ha} 公頃 · <a href="${esc(p.size_source)}" target="_blank" rel="noopener">面積來源 ↗</a></p>`:''}${p.pet_area==='official_listed'?`<p class="hint"><a href="${esc(p.pet_source)}" target="_blank" rel="noopener">寵物專區來源 ↗</a></p>`:''}${p.status==='遊戲場修繕中'?'<p class="hint">遊戲場修繕中，請查開放公告。</p>':''}${p.pet_area==='official_listed'?'<p class="hint">設有寵物專區；入口與使用範圍請看現場告示。</p>':''}<div class="action-row">${button(Number.isFinite(p.lat)?'地圖與揪團':'查看揪團','park',p.id)}<a class="external-link" href="${esc(p.source_url)}" target="_blank" rel="noopener">官方來源 ↗</a><a class="external-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' 桃園市'+p.district)}" target="_blank" rel="noopener">查詢位置 ↗</a></div></article>`).join('')||empty('找不到這個公園','試試公園名稱或行政區。');
  if(list.length>parkLimit)$('park-list').insertAdjacentHTML('beforeend',button('顯示更多地點','moreParks','','btn-ghost'));
  $('park-result').textContent=`找到 ${list.length} 筆 · 顯示 ${Math.min(parkLimit,list.length)} 筆 · 全市名錄持續補齊`;
}
function renderFeed(){
  $('stories-row').innerHTML=button('＋ 發布動態','compose','','btn-green')+`<span class="hint">${mode==='demo'?'以下為示範貼文':'分享你和毛孩的日常'}</span>`;
  $('feed').innerHTML=state.posts.filter(p=>visible(p.owner_id)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).map(p=>{
    const pet=state.pets.find(d=>d.owner_id===p.owner_id),liked=state.likes.some(l=>l.post_id===p.id&&l.user_id===me());
    return `<article class="post"><div class="post-head"><span class="pa">${pet?photo(pet):'🐾'}</span><div><b>${esc(owner(p.owner_id))}</b><span class="sub">${fmt(p.created_at)}</span></div>${button('•••','postMenu',p.id,'post-menu')}</div>${p.photo?`<div class="post-photo">${photo(p)}</div>`:''}<div class="post-body"><p>${esc(p.caption).replace(/\n/g,'<br>')}</p><div class="post-actions"><button class="pact" data-action="like" data-id="${p.id}" aria-label="喜歡貼文" aria-pressed="${liked}">${liked?'♥':'♡'}</button>${button('留言 '+state.comments.filter(c=>c.post_id===p.id).length,'comments',p.id,'pact comment-button')}${button('分享','share',p.id,'pact comment-button')}</div><span class="hint">${state.likes.filter(l=>l.post_id===p.id).length} 個喜歡</span></div></article>`;
  }).join('')||empty('第一篇日常，從你開始','照片或幾句話，都值得留下。',button('發布動態','compose','','btn-green'));
}
function openCompose(){composePhoto='';$('compose-caption').value='';$('compose-preview').textContent='點我選照片（可不附照片）';$('compose-pet-row').hidden=true;openOv('ov-compose');}
async function publishPost(){await act('addPost',{caption:$('compose-caption').value,photo:composePhoto},'貼文已發布');closeOv('ov-compose');switchTab('home');}
function showComments(id){
  openPostId=id;const rows=state.comments.filter(c=>c.post_id===id&&visible(c.owner_id));
  drawer(`<h3>留言</h3><div class="comment-list">${rows.map(c=>`<div class="comment"><b>${esc(owner(c.owner_id))}</b><p>${esc(c.body)}</p>${c.owner_id===me()?button('刪除','removeComment',c.id):''}</div>`).join('')||'<p>還沒有留言，來打聲招呼。</p>'}</div><label for="comment-body">你的留言</label><textarea id="comment-body" maxlength="500"></textarea>${button('送出留言','addComment',id,'btn-green')}`);
}
function renderPets(){
  const pets=minePets();$('pet-list').innerHTML=pets.map(p=>`<div class="card dogcard"><div class="dog-photo">${photo(p)}</div><div class="pet-copy"><b>${esc(p.name)}</b><p class="sub">${esc(p.breed||p.type)}</p><span class="hint">${p.discoverable?'顯示於狗友探索':'僅自己的檔案'}</span></div>${button('編輯','editPet',p.id)}</div>`).join('')||empty('先介紹你的毛孩','建立檔案，讓散步有更多故事。');
  $('st-posts').textContent=state.posts.filter(p=>p.owner_id===me()).length;$('st-walks').textContent=state.members.filter(m=>m.user_id===me()).length;$('st-likes').textContent=state.likes.filter(l=>state.posts.some(p=>p.id===l.post_id&&p.owner_id===me())).length;
  $('account-name').textContent=owner(me());$('account-mode').textContent=modeLabel();
}
function openPetForm(id=null){editingPetId=id;const p=state.pets.find(p=>p.id===id&&p.owner_id===me());$('ob-title').textContent=p?'編輯毛孩':'新增毛孩';$('ob-name').value=p?.name||'';$('ob-type').value=p?.type||'狗';$('ob-breed').value=p?.breed||'';$('ob-discoverable').checked=!!p?.discoverable;obPhoto=p?.photo||'';$('ob-preview').innerHTML=obPhoto?photo({photo:obPhoto}):'點我選毛孩照片';$('ob-cancel').hidden=false;$('pet-delete').hidden=!p;openOv('ov-onboard');}
async function savePet(){await act('savePet',{id:editingPetId,name:$('ob-name').value,type:$('ob-type').value,breed:$('ob-breed').value,photo:obPhoto,discoverable:$('ob-discoverable').checked});closeOv('ov-onboard');}
async function pickPhoto(kind){$(kind==='ob'?'ob-file':'compose-file').click();}
async function loadPhoto(input,kind){
  const file=input.files?.[0];if(!file)return;if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>12*1024*1024)throw new Error('請選擇 12MB 以下 JPG、PNG 或 WebP 照片');
  const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,900/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const result=canvas.toDataURL('image/jpeg',.78);if(!safePhoto(result))throw new Error('照片太大，請選擇較小的照片');if(kind==='ob')obPhoto=result;else composePhoto=result;$(kind==='ob'?'ob-preview':'compose-preview').innerHTML=photo({photo:result});}finally{URL.revokeObjectURL(url);input.value='';}
}
function deck(){const ids=new Set();return state.pets.filter(p=>{if(p.owner_id===me()||!p.discoverable||!visible(p.owner_id)||ids.has(p.owner_id)||state.swipes.some(s=>s.owner_id===me()&&s.target_id===p.owner_id))return false;ids.add(p.owner_id);return true;});}
function renderDeck(){
  const list=deck();$('mstack').hidden=!list.length;$('mempty').hidden=!!list.length;$('mbtns').hidden=!list.length;
  $('mempty').innerHTML=empty('暫時沒有新的狗友',mode==='demo'?'示範狗友都看過了。可以重看，或到揪團頁探索。':'有公開毛孩檔案的朋友，會出現在這裡。',mode==='demo'?button('再看一次','resetDeck','','btn-green'):button('切換示範體驗','demo','','btn-green'));
  $('match-undo').disabled=!previousTarget||swipeBusy;
  const card=(p,cls)=>`<div class="mcard ${cls}" ${cls==='back'?'aria-hidden="true"':''}><div class="mphoto">${photo(p)}</div><span class="swipe-label" aria-hidden="true"></span><div class="minfo"><b>${esc(p.name)}</b><div class="sub">${esc(p.breed||p.type)}</div><div class="sub">${esc(owner(p.owner_id))}</div><div class="pet-traits"><span>${mode==='demo'?'示範狗友':'一起散步'}</span><span>友善認識</span></div></div></div>`;
  $('mstack').innerHTML=(list[1]?card(list[1],'back'):'')+(list[0]?card(list[0],'front'):'');
  if(list[0])attachDrag($('mstack').querySelector('.front'));
  $('deck-more').hidden=!list.length;
}
async function swipeCard(dir){
  if(swipeBusy)return;const p=deck()[0];if(!p)return;swipeBusy=true;
  const card=$('mstack').querySelector('.front');card.style.transform=`translateX(${dir*450}px) rotate(${dir*15}deg)`;card.style.opacity='0';
  try{await new Promise(r=>setTimeout(r,180));await act('swipe',{target_id:p.owner_id,decision:dir>0?'like':'pass'},dir>0?'已送出喜歡':'');previousTarget=p.owner_id;
    if(dir>0&&(repo.lastMatch||state.swipes.some(s=>s.owner_id===p.owner_id&&s.target_id===me()&&s.decision==='like'))){$('mpop-me').textContent=minePets()[0]?.name||owner(me());$('mpop-name').textContent=p.name;$('match-result-label').textContent=mode==='demo'?'示範配對結果':'你們互相喜歡';$('mpop').classList.add('show');}
  }finally{swipeBusy=false;renderDeck();}
}
function attachDrag(card){let sx=0,dx=0,active=false;const reset=()=>{active=false;dx=0;card.style.transform='';card.querySelector('.swipe-label').style.opacity='0';};card.onpointerdown=e=>{if(swipeBusy||e.button>0)return;sx=e.clientX;active=true;card.setPointerCapture(e.pointerId);};card.onpointermove=e=>{if(!active)return;dx=e.clientX-sx;card.style.transform=`translateX(${dx}px) rotate(${dx/18}deg)`;const l=card.querySelector('.swipe-label');l.textContent=dx>0?'喜歡':'略過';l.style.opacity=Math.min(1,Math.abs(dx)/90);};card.onpointercancel=reset;card.onpointerup=()=>{if(!active)return;const final=dx;reset();if(Math.abs(final)>90)run(()=>swipeCard(final>0?1:-1));};}
async function undoMatch(){if(swipeBusy||!previousTarget)return;await act('undoSwipe',{target_id:previousTarget},'已返回上一位');previousTarget=null;renderDeck();}
async function resetMatch(){for(const s of state.swipes.filter(s=>s.owner_id===me()))await repo.dispatch({type:'undoSwipe',data:{target_id:s.target_id}});await refresh();}
function matchToWalk(){closePop();switchTab('walk');openWalkForm();}
function openAuth(){drawer(`<h3>登入雲端帳號</h3><p class="hint">本機及示範資料不會自動上傳。</p><label for="auth-email">電子郵件</label><input id="auth-email" type="email" autocomplete="email"><label for="auth-password">密碼</label><input id="auth-password" type="password" autocomplete="current-password" minlength="8"><div class="action-row">${button('登入','login','','btn-green')}${button('建立帳號','signup')}</div>`);}
async function authenticate(signup){
  const email=$('auth-email').value.trim(),password=$('auth-password').value;if(!email||password.length<8)throw new Error('請填寫 Email 及至少 8 碼密碼');
  const {data,error}=await client.auth[signup?'signUp':'signInWithPassword']({email,password});if(error)throw error;$('auth-password').value='';
  if(data.session){await changeMode('cloud');toast('已登入');}else{drawer('<h3>請確認電子郵件</h3><p>請至信箱完成驗證，再回到 App 登入。</p>');}
}
function account(){
  drawer(`<h3>帳號與資料</h3><label for="profile-name">你的暱稱</label><input id="profile-name" maxlength="60" value="${esc(owner(me()))}">${button('儲存暱稱','saveProfile','','btn-green')}<h4>使用模式</h4><div class="action-row">${button('本機模式','local')}${button('示範體驗','demo')}${button('雲端登入','cloud')}</div><p class="hint">本機與示範資料分開儲存；清除瀏覽器資料會遺失本機內容。</p><h4>資料備份</h4>${button('匯出本機備份','export')}${button('還原本機備份','chooseRestore')}${button('復原上次還原','undoRestore')}${button('匯入舊版資料','importLegacy')}<input type="file" id="backup-file" accept="application/json,.json" hidden><p class="hint">只匯入此瀏覽器舊版的毛孩、貼文和揪團；不會上傳至雲端。</p><h4>已封鎖用戶</h4>${state.blocks.filter(b=>b.owner_id===me()).map(b=>`<p>${esc(owner(b.target_id))} ${button('解除封鎖','unblock',b.target_id)}</p>`).join('')||'<p class="hint">尚無封鎖</p>'}${mode==='cloud'?button('登出','logout'):''}`);
}
function notifications(){const rows=state.notifications.filter(n=>n.user_id===me()).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));drawer('<h3>活動與配對通知</h3>'+rows.map(n=>`<div class="comment"><p>${esc(n.body)}</p><small>${fmt(n.created_at)}</small></div>`).join('')+(rows.length?'':'<p>目前沒有新通知。</p>')+button('全部標為已讀','readNotifications'));}
function download(name,body,type){const u=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function calendar(id){const w=state.walks.find(w=>w.id===id);if(!w||w.status!=='open')throw new Error('活動已取消，無法加入行事曆');const date=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const safe=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,'\\$&');download('揪好GO-'+w.id+'.ics',['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//JiuHaoGO//Walks//ZH-TW','BEGIN:VEVENT','UID:'+w.id+'@jiuhaogo','DTSTAMP:'+date(Date.now()),'DTSTART:'+date(w.starts_at),'DTEND:'+date(Date.parse(w.starts_at)+3600000),'SUMMARY:'+safe(w.title),'LOCATION:'+safe(parkName(w.park_id)+' '+w.meeting_point),'DESCRIPTION:'+safe(w.note||''),'END:VEVENT','END:VCALENDAR'].join('\r\n'),'text/calendar;charset=utf-8');}
async function importLegacy(){
  if(mode!=='local')throw new Error('請切換本機模式再匯入');if(localStorage.getItem('jhg_v2_imported'))throw new Error('舊版資料已匯入，避免重複匯入');
  const read=k=>JSON.parse(localStorage.getItem(k)||'[]');const p=read('jhg_pets'),posts=read('jhg_posts'),walks=read('jhg_userwalks');
  const before=await repo.snapshot();let after=structuredClone(before), imported=0,skipped=0;
  const {applyAction}=await import('./domain.mjs');
  for(const pet of p){after=applyAction(after,{type:'savePet',data:{...pet,id:null,discoverable:false}},me());imported++;}
  for(const post of posts){after=applyAction(after,{type:'addPost',data:{caption:post.caption||'',photo:post.photo}},me());imported++;}
  for(const w of walks){if(!w.timestamp||w.timestamp<=Date.now()){skipped++;continue;}const park=parks.find(p=>p.name===w.park);if(!park){skipped++;continue;}after=applyAction(after,{type:'saveWalk',data:{title:w.title,park_id:park.id,starts_at:new Date(w.timestamp).toISOString(),capacity:Math.max(2,Math.min(20,w.people||6)),meeting_point:'請主揪編輯確認集合位置',note:w.meta,type:w.type||'一般'}},me());imported++;}
  repo.write(after);localStorage.setItem('jhg_v2_imported',new Date().toISOString());state=after;render();toast(`已匯入 ${imported} 筆，略過 ${skipped} 筆過期或缺資料活動；舊資料保留。`);
}
const handlers={
  local:()=>changeMode('local'),demo:()=>changeMode('demo'),cloud:()=>changeMode('cloud'),account,notifications,closeDrawer:()=>closeOv('ov-profile'),
  saveProfile:()=>act('profile',{display_name:$('profile-name').value}),login:()=>authenticate(false),signup:()=>authenticate(true),logout:async()=>{const {error}=await client.auth.signOut();if(error)throw error;await changeMode('local');},
  newWalk:()=>openWalkForm(),editWalk:openWalkForm,walkDetail,park:gotoPark,moreParks:()=>{parkLimit+=30;renderParks();},
  joinWalk:async id=>{await act('joinWalk',{id},'已報名');walkDetail(id);},leaveWalk:async id=>{await act('leaveWalk',{id},'已退出');walkDetail(id);},
  cancelWalk:async id=>{if(!confirm('取消此活動？已報名者將在通知中看到取消訊息。'))return;await act('cancelWalk',{id},'活動已取消');walkDetail(id);},calendar,
  compose:openCompose,like:id=>act('likePost',{id},''),comments:showComments,addComment:async id=>{await act('addComment',{post_id:id,body:text($('comment-body').value,500)},'留言已送出');showComments(id);},removeComment:async id=>{await act('removeComment',{id},'已刪除留言');showComments(openPostId);},
  postMenu:id=>{const p=state.posts.find(p=>p.id===id);drawer('<h3>貼文選項</h3>'+(p.owner_id===me()?button('刪除貼文','deletePost',id):button('封鎖作者','block',p.owner_id)+button('檢舉貼文','report',p.owner_id)));},
  deletePost:async id=>{if(!confirm('刪除此貼文與其留言？'))return;await act('removePost',{id},'貼文已刪除');closeOv('ov-profile');},
  share:async id=>{const p=state.posts.find(p=>p.id===id);const content=owner(p.owner_id)+'：'+p.caption;if(navigator.share)await navigator.share({title:'揪好GO',text:content});else{await navigator.clipboard.writeText(content);toast('已複製貼文文字');}},
  editPet:openPetForm,deletePet:async()=>{if(!confirm('刪除此毛孩檔案？'))return;await act('removePet',{id:editingPetId},'檔案已刪除');closeOv('ov-onboard');},
  deckMenu:()=>{const p=deck()[0];if(p)drawer('<h3>'+esc(p.name)+'</h3><p>'+esc(owner(p.owner_id))+'</p>'+button('封鎖用戶','block',p.owner_id)+button('檢舉用戶','report',p.owner_id));},
  block:async id=>{await act('block',{target_id:id},'已封鎖；不再顯示對方內容');closeOv('ov-profile');},unblock:async id=>{await act('unblock',{target_id:id},'已解除封鎖');account();},
  report:id=>drawer('<h3>檢舉內容</h3><p class="hint">'+(mode==='cloud'?'將送交管理者處理。':'本機模式只記錄於本裝置，尚不會送出給管理者。')+'</p><label for="report-reason">原因</label><textarea id="report-reason" maxlength="500"></textarea>'+button('記錄檢舉','submitReport',id,'btn-green')),
  submitReport:async id=>{await act('report',{target_id:id,reason:$('report-reason').value},mode==='cloud'?'已提交檢舉':'檢舉已記錄於本機');closeOv('ov-profile');},
  readNotifications:async()=>{await act('readNotifications',{},'通知已讀');notifications();},resetDeck:resetMatch,
  export:()=>{if(mode==='cloud')throw new Error('此按鈕僅匯出本機資料；請先切換本機模式');download('jiuhaogo-'+mode+'-'+day(Date.now())+'.json',JSON.stringify({version:2,mode,actor:me(),state},null,2),'application/json');},importLegacy,
  chooseRestore:()=>{if(mode!=='local')throw new Error('請切換本機模式再還原');const input=$('backup-file'),selected=repo;input.onchange=()=>run(async()=>{const file=input.files?.[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('備份需小於20MB');const raw=await file.text();if(repo!==selected||mode!=='local'||mutating)throw new Error('模式已變更，請重新選擇備份');const restored=parseBackup(JSON.parse(raw),me());localStorage.setItem('jhg_v2_restore_previous',JSON.stringify(await repo.snapshot()));repo.write(restored);state=restored;render();closeOv('ov-profile');toast('已還原備份，可在設定復原上次還原');});input.click();},
  undoRestore:async()=>{if(mode!=='local')throw new Error('請切換本機模式');const saved=localStorage.getItem('jhg_v2_restore_previous');if(!saved)throw new Error('沒有上次還原紀錄');repo.write(JSON.parse(saved));await refresh();closeOv('ov-profile');toast('已復原還原前資料');},
  allParks:()=>{$('map-category').value='all';map?.all();},locate:async()=>{await map?.locate();toast('地圖已移到你的位置；位置不會儲存或上傳。');},refresh:()=>refresh()
};
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const fn=handlers[b.dataset.action];if(!fn)return;b.disabled=true;run(()=>fn(b.dataset.id)).finally(()=>{b.disabled=false;});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.overlay.show').forEach(n=>closeOv(n.id));closePop();}if((e.key==='Enter'||e.key===' ')&&e.target.matches('.preview[role=button]')){e.preventDefault();e.target.click();}const modal=document.querySelector('.overlay.show,.match-pop.show');if(modal&&e.key==='Tab'){const items=[...modal.querySelectorAll('button:not([disabled]),input:not([hidden]):not([type=file]),select,textarea,a[href]')].filter(n=>n.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
const globals={switchTab,toast,closeOv,openCompose,publishPost,openWalkForm,createWalk,openPetForm,savePet,pickPhoto,pickObPhoto:i=>loadPhoto(i,'ob'),pickComposePhoto:i=>loadPhoto(i,'compose'),swipeCard,undoMatch,resetMatch,closePop,matchToWalk,segServe:which=>{$('serve-gig').hidden=which!=='gig';$('serve-shop').hidden=which!=='shop';$('seg-gig').classList.toggle('on',which==='gig');$('seg-shop').classList.toggle('on',which==='shop');},resetAll:account};
Object.entries(globals).forEach(([name,fn])=>window[name]=(...args)=>run(()=>fn(...args)));
async function init(){
  const r=await fetch('data/parks.json');if(!r.ok)throw new Error('公園資料載入失敗');parks=(await r.json()).parks;
  $('map-data-note').textContent=`先標註 ${parks.filter(p=>p.priority).length} 處重點：${parks.filter(p=>p.large).length} 處大型公園、${parks.filter(p=>p.pet_area==='official_listed').length} 處寵物專區（部分重疊）。可切換全部 ${parks.length} 筆名錄。`;
  $('wf-park').innerHTML=parks.map(p=>`<option value="${p.id}">${esc(p.district+' · '+p.name)}</option>`).join('');$('park-filter').innerHTML='<option value="">全部公園</option>'+$('wf-park').innerHTML;
  $('park-district').innerHTML='<option value="">桃園全市</option>'+[...new Set(parks.map(p=>p.district))].map(d=>`<option>${esc(d)}</option>`).join('');
  $('park-category').onchange=e=>{parkCategory=e.target.value;parkLimit=30;renderParks();};$('map-category').onchange=e=>map?.filter(e.target.value);
  $('park-district').onchange=e=>{parkDistrict=e.target.value;parkLimit=30;renderParks();};$('park-location').onchange=e=>{parkLocation=e.target.value;parkLimit=30;renderParks();};
  $('park-filter').onchange=e=>{parkFilter=e.target.value;renderWalks();if(parkFilter)map?.show(parkFilter);};$('walk-filter').onchange=e=>{walkFilter=e.target.value;renderWalks();};$('park-search').oninput=e=>{parkSearch=e.target.value;parkLimit=30;renderParks();};
  if(cloudReady(config)){if(!window.supabase)throw new Error('雲端元件載入失敗');client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});}
  if(mode==='cloud'&&!client)mode='local';await changeMode(mode);if(!repo){await changeMode('local');openAuth();}
  map=new ParkMap('real-map',parks,gotoPark,msg=>{$('map-error').textContent=msg;$('map-error').hidden=false;});
  $('load-error').hidden=true;
  window.addEventListener('storage',e=>{if(e.key===repo?.key)run(refresh);});
  window.addEventListener('online',()=>{toast('網路已恢復');if(mode==='cloud')run(refresh);});
  window.addEventListener('offline',()=>toast('目前離線；本機資料仍可使用，雲端操作需恢復網路。'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&mode==='cloud')run(refresh);});
  setInterval(()=>{if(mode==='cloud'&&!document.hidden)run(refresh);},30000);
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
init().catch(e=>{$('load-error').hidden=false;$('load-error').textContent='載入失敗：'+errorMessage(e)+'。請重新整理頁面。';console.error(e);});
