-- Run once in a new Supabase project. Public browser key only; all writes use auth.uid().
begin;
create table public.jhg_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (length(btrim(display_name)) between 1 and 60)
);
create table public.jhg_parks (
 id text primary key, name text not null, district text not null,
 lat double precision not null check(lat between -90 and 90),
 lng double precision not null check(lng between -180 and 180),
 verification text not null default 'unverified' check(verification in ('unverified','verified'))
);
create table public.jhg_pets (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.jhg_profiles on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 60), type text not null check(type in ('狗','貓','其他')),
 breed text not null default '' check(length(breed)<=160), photo text not null default '' check(length(photo)<1800000),
 discoverable boolean not null default false, created_at timestamptz not null default now()
);
create table public.jhg_walks (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.jhg_profiles on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 100),park_id text not null references public.jhg_parks,
 starts_at timestamptz not null,capacity integer not null check(capacity between 2 and 20),
 meeting_point text not null check(length(btrim(meeting_point)) between 1 and 200),note text not null default '' check(length(note)<=1000),
 type text not null default '一般' check(length(type)<=30),status text not null default 'open' check(status in ('open','cancelled')),
 created_at timestamptz not null default now()
);
create table public.jhg_members (
 walk_id uuid not null references public.jhg_walks on delete cascade,user_id uuid not null references public.jhg_profiles on delete cascade,
 created_at timestamptz not null default now(),primary key(walk_id,user_id)
);
create table public.jhg_posts (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.jhg_profiles on delete cascade,
 caption text not null default '' check(length(caption)<=2000),photo text not null default '' check(length(photo)<1800000),
 created_at timestamptz not null default now(), check(length(btrim(caption))>0 or length(photo)>0)
);
create table public.jhg_likes (
 post_id uuid not null references public.jhg_posts on delete cascade,user_id uuid not null references public.jhg_profiles on delete cascade,
 primary key(post_id,user_id)
);
create table public.jhg_comments (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.jhg_posts on delete cascade,
 owner_id uuid not null references public.jhg_profiles on delete cascade,body text not null check(length(btrim(body)) between 1 and 500),
 created_at timestamptz not null default now()
);
create table public.jhg_swipes (
 owner_id uuid not null references public.jhg_profiles on delete cascade,target_id uuid not null references public.jhg_profiles on delete cascade,
 decision text not null check(decision in ('like','pass')),primary key(owner_id,target_id),check(owner_id<>target_id)
);
create table public.jhg_notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.jhg_profiles on delete cascade,
 body text not null,read boolean not null default false,created_at timestamptz not null default now()
);
create table public.jhg_blocks (
 owner_id uuid not null references public.jhg_profiles on delete cascade,target_id uuid not null references public.jhg_profiles on delete cascade,
 primary key(owner_id,target_id),check(owner_id<>target_id)
);
create table public.jhg_reports (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.jhg_profiles on delete cascade,
 target_id uuid not null references public.jhg_profiles on delete cascade,
 reason text not null check(length(btrim(reason)) between 1 and 500),created_at timestamptz not null default now()
);
create index jhg_walk_date on public.jhg_walks(starts_at);
create index jhg_posts_date on public.jhg_posts(created_at desc);
create index jhg_pet_owner on public.jhg_pets(owner_id);
create index jhg_comment_post on public.jhg_comments(post_id);
create index jhg_notice_user on public.jhg_notifications(user_id,created_at desc);

create function public.jhg_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.jhg_profiles(id,display_name) values(new.id,'毛孩朋友') on conflict do nothing;
 return new;
end;$$;
create trigger jhg_auth_user_created after insert on auth.users for each row execute function public.jhg_new_user();
insert into public.jhg_profiles(id,display_name) select id,'毛孩朋友' from auth.users on conflict do nothing;

create function public.jhg_blocked(other uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.jhg_blocks where (owner_id=auth.uid() and target_id=other) or (target_id=auth.uid() and owner_id=other));
$$;
alter table public.jhg_profiles enable row level security;
alter table public.jhg_parks enable row level security;
alter table public.jhg_pets enable row level security;
alter table public.jhg_walks enable row level security;
alter table public.jhg_members enable row level security;
alter table public.jhg_posts enable row level security;
alter table public.jhg_likes enable row level security;
alter table public.jhg_comments enable row level security;
alter table public.jhg_swipes enable row level security;
alter table public.jhg_notifications enable row level security;
alter table public.jhg_blocks enable row level security;
alter table public.jhg_reports enable row level security;

create policy profiles_read on public.jhg_profiles for select to authenticated using (id=auth.uid() or not public.jhg_blocked(id));
create policy profiles_write on public.jhg_profiles for update to authenticated using (id=auth.uid()) with check(id=auth.uid());
create policy parks_read on public.jhg_parks for select to authenticated using(true);
create policy pets_read on public.jhg_pets for select to authenticated using(owner_id=auth.uid() or (discoverable and not public.jhg_blocked(owner_id)));
create policy pets_insert on public.jhg_pets for insert to authenticated with check(owner_id=auth.uid());
create policy pets_update on public.jhg_pets for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy pets_delete on public.jhg_pets for delete to authenticated using(owner_id=auth.uid());
create policy walks_read on public.jhg_walks for select to authenticated using(not public.jhg_blocked(owner_id));
create policy members_read on public.jhg_members for select to authenticated using(exists(select 1 from public.jhg_walks w where w.id=walk_id));
create policy posts_read on public.jhg_posts for select to authenticated using(not public.jhg_blocked(owner_id));
create policy posts_insert on public.jhg_posts for insert to authenticated with check(owner_id=auth.uid());
create policy posts_delete on public.jhg_posts for delete to authenticated using(owner_id=auth.uid());
create policy likes_read on public.jhg_likes for select to authenticated using(exists(select 1 from public.jhg_posts p where p.id=post_id));
create policy comments_read on public.jhg_comments for select to authenticated using(not public.jhg_blocked(owner_id) and exists(select 1 from public.jhg_posts p where p.id=post_id));
create policy comments_insert on public.jhg_comments for insert to authenticated with check(owner_id=auth.uid() and exists(select 1 from public.jhg_posts p where p.id=post_id));
create policy comments_delete on public.jhg_comments for delete to authenticated using(owner_id=auth.uid());
create policy swipes_read on public.jhg_swipes for select to authenticated using(owner_id=auth.uid());
create policy swipes_delete on public.jhg_swipes for delete to authenticated using(owner_id=auth.uid());
create policy notices_read on public.jhg_notifications for select to authenticated using(user_id=auth.uid());
create policy notices_update on public.jhg_notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy blocks_read on public.jhg_blocks for select to authenticated using(owner_id=auth.uid());
create policy blocks_insert on public.jhg_blocks for insert to authenticated with check(owner_id=auth.uid());
create policy blocks_delete on public.jhg_blocks for delete to authenticated using(owner_id=auth.uid());
create policy reports_read on public.jhg_reports for select to authenticated using(owner_id=auth.uid());
create policy reports_insert on public.jhg_reports for insert to authenticated with check(owner_id=auth.uid());

create function public.jhg_save_walk(p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); wid uuid:=coalesce(p_id,gen_random_uuid()); w public.jhg_walks; cap integer:=(p_data->>'capacity')::integer; starts timestamptz:=(p_data->>'starts_at')::timestamptz;
begin
 if uid is null then raise exception '請先登入'; end if;
 if starts is null or starts<=now() then raise exception '活動時間必須在未來'; end if;
 if cap is null or cap<2 or cap>20 then raise exception '人數上限需為2至20人'; end if;
 if p_id is not null then
  select * into w from public.jhg_walks where id=p_id for update;
  if not found or w.owner_id<>uid then raise exception '沒有操作權限'; end if;
  if w.status<>'open' or w.starts_at<=now() then raise exception '活動已結束或取消'; end if;
  if cap<(select count(*) from public.jhg_members where walk_id=p_id) then raise exception '上限不能少於報名人數'; end if;
  update public.jhg_walks set title=btrim(p_data->>'title'),park_id=p_data->>'park_id',starts_at=starts,capacity=cap,meeting_point=btrim(p_data->>'meeting_point'),note=coalesce(p_data->>'note',''),type=coalesce(p_data->>'type','一般') where id=p_id;
  insert into public.jhg_notifications(user_id,body) select user_id,'活動「'||w.title||'」已更新，請確認集合資訊。' from public.jhg_members where walk_id=p_id and user_id<>uid;
 else
  insert into public.jhg_walks(id,owner_id,title,park_id,starts_at,capacity,meeting_point,note,type) values(wid,uid,btrim(p_data->>'title'),p_data->>'park_id',starts,cap,btrim(p_data->>'meeting_point'),coalesce(p_data->>'note',''),coalesce(p_data->>'type','一般'));
  insert into public.jhg_members(walk_id,user_id) values(wid,uid);
 end if;
 return wid;
end;$$;

create function public.jhg_walk_action(p_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();w public.jhg_walks;changed integer;
begin
 if uid is null then raise exception '請先登入'; end if;
 select * into w from public.jhg_walks where id=p_id for update;
 if not found or public.jhg_blocked(w.owner_id) then raise exception '找不到活動'; end if;
 if w.status<>'open' or w.starts_at<=now() then raise exception '活動已結束或取消'; end if;
 if p_action='joinWalk' then
  if exists(select 1 from public.jhg_members where walk_id=p_id and user_id=uid) then return;end if;
  if (select count(*) from public.jhg_members where walk_id=p_id)>=w.capacity then raise exception '活動已額滿';end if;
  insert into public.jhg_members(walk_id,user_id) values(p_id,uid);
  insert into public.jhg_notifications(user_id,body) values(w.owner_id,'有人加入「'||w.title||'」。');
 elsif p_action='leaveWalk' then
  if w.owner_id=uid then raise exception '主揪請取消活動';end if;
  delete from public.jhg_members where walk_id=p_id and user_id=uid;
  get diagnostics changed=row_count;
  if changed>0 then insert into public.jhg_notifications(user_id,body) values(w.owner_id,'有人退出「'||w.title||'」。');end if;
 elsif p_action='cancelWalk' then
  if w.owner_id<>uid then raise exception '沒有操作權限';end if;
  update public.jhg_walks set status='cancelled' where id=p_id;
  insert into public.jhg_notifications(user_id,body) select user_id,'活動「'||w.title||'」已取消。' from public.jhg_members where walk_id=p_id and user_id<>uid;
 else raise exception '無效活動操作';end if;
end;$$;

create function public.jhg_like_post(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();p public.jhg_posts;
begin
 if uid is null then raise exception '請先登入';end if;
 select * into p from public.jhg_posts where id=p_id for update;
 if not found or public.jhg_blocked(p.owner_id) then raise exception '找不到貼文';end if;
 if exists(select 1 from public.jhg_likes where post_id=p_id and user_id=uid) then delete from public.jhg_likes where post_id=p_id and user_id=uid;
 else insert into public.jhg_likes(post_id,user_id) values(p_id,uid);end if;
end;$$;

create function public.jhg_swipe(p_target uuid,p_decision text) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();matched boolean;old_decision text;
begin
 if uid is null then raise exception '請先登入';end if;
 if uid=p_target or public.jhg_blocked(p_target) or not exists(select 1 from public.jhg_pets where owner_id=p_target and discoverable) then raise exception '無法配對此用戶';end if;
 if p_decision not in ('like','pass') or p_decision is null then raise exception '無效操作';end if;
 perform pg_advisory_xact_lock(hashtextextended(least(uid::text,p_target::text)||greatest(uid::text,p_target::text),0));
 select decision into old_decision from public.jhg_swipes where owner_id=uid and target_id=p_target;
 insert into public.jhg_swipes(owner_id,target_id,decision) values(uid,p_target,p_decision) on conflict(owner_id,target_id) do update set decision=excluded.decision;
 matched:=p_decision='like' and exists(select 1 from public.jhg_swipes where owner_id=p_target and target_id=uid and decision='like');
 if matched and old_decision is distinct from 'like' then
  insert into public.jhg_notifications(user_id,body) values(uid,'你和 '||(select display_name from public.jhg_profiles where id=p_target)||' 互相喜歡，可以一起揪團！'),(p_target,'你有新的狗友配對！');
 end if;
 return matched;
end;$$;

-- Deletes the authenticated account and every row connected through ON DELETE CASCADE.
-- A fixed confirmation value prevents accidental calls from generic RPC clients.
create function public.jhg_delete_account(p_confirmation text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception '請先登入';end if;
 if p_confirmation is distinct from 'DELETE' then raise exception '請確認刪除帳號';end if;
 delete from auth.users where id=uid;
 if not found then raise exception '找不到帳號';end if;
end;$$;

-- Explicit least-privilege grants; no direct membership/walk/notification injection.
revoke all on public.jhg_profiles,public.jhg_parks,public.jhg_pets,public.jhg_walks,public.jhg_members,public.jhg_posts,public.jhg_likes,public.jhg_comments,public.jhg_swipes,public.jhg_notifications,public.jhg_blocks,public.jhg_reports from anon,authenticated;
grant select on public.jhg_profiles,public.jhg_parks,public.jhg_pets,public.jhg_walks,public.jhg_members,public.jhg_posts,public.jhg_likes,public.jhg_comments,public.jhg_swipes,public.jhg_notifications,public.jhg_blocks,public.jhg_reports to authenticated;
grant update(display_name) on public.jhg_profiles to authenticated;
grant insert,delete on public.jhg_pets to authenticated;
grant update(name,type,breed,photo,discoverable) on public.jhg_pets to authenticated;
grant insert,delete on public.jhg_posts,public.jhg_comments,public.jhg_blocks to authenticated;
grant insert on public.jhg_reports to authenticated;
grant delete on public.jhg_swipes to authenticated;
grant update(read) on public.jhg_notifications to authenticated;
revoke all on function public.jhg_new_user() from public;
revoke all on function public.jhg_blocked(uuid),public.jhg_save_walk(uuid,jsonb),public.jhg_walk_action(uuid,text),public.jhg_like_post(uuid),public.jhg_swipe(uuid,text),public.jhg_delete_account(text) from public;
grant execute on function public.jhg_blocked(uuid),public.jhg_save_walk(uuid,jsonb),public.jhg_walk_action(uuid,text),public.jhg_like_post(uuid),public.jhg_swipe(uuid,text),public.jhg_delete_account(text) to authenticated;
commit;
