import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL schema, RPC invariants and RLS permissions',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(await fs.readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.exec(await fs.readFile(new URL('../supabase/parks.sql',import.meta.url),'utf8'));
  const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
  for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
  const as=async id=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
  const data={title:'Integration walk',park_id:'park-01',starts_at:new Date(Date.now()+86400000).toISOString(),capacity:2,meeting_point:'Entrance',note:'',type:'一般'};
  await as(ids[0]);const {rows}=await db.query('select public.jhg_save_walk(null,$1::jsonb) as id',[JSON.stringify(data)]);const id=rows[0].id;
  await t.test('host membership is created and direct forged writes are denied',async()=>{
   assert.equal((await db.query('select count(*)::int as n from public.jhg_members')).rows[0].n,1);
   await assert.rejects(db.query('insert into public.jhg_members(walk_id,user_id) values($1,$2)',[id,ids[1]]),/permission denied/);
   await assert.rejects(db.query('insert into public.jhg_notifications(user_id,body) values($1,$2)',[ids[1],'forged']),/permission denied/);
  });
  await t.test('atomic join is idempotent and enforces capacity',async()=>{
   await as(ids[1]);await db.query("select public.jhg_walk_action($1,'joinWalk')",[id]);await db.query("select public.jhg_walk_action($1,'joinWalk')",[id]);
   await as(ids[2]);await assert.rejects(db.query("select public.jhg_walk_action($1,'joinWalk')",[id]),/額滿/);
  });
  await t.test('other user cannot cancel/update activity or expose private pets',async()=>{
   await as(ids[1]);await assert.rejects(db.query("select public.jhg_walk_action($1,'cancelWalk')",[id]),/權限/);
   await assert.rejects(db.query('select public.jhg_save_walk($1,$2::jsonb)',[id,JSON.stringify(data)]),/權限/);
   await as(ids[0]);await db.query("insert into public.jhg_pets(owner_id,name,type) values($1,'Private dog','狗')",[ids[0]]);
   await as(ids[1]);assert.equal((await db.query('select * from public.jhg_pets')).rows.length,0);
   await assert.rejects(db.query("insert into public.jhg_pets(owner_id,name,type) values($1,'Forged','狗')",[ids[0]]),/row-level security/);
  });
  await t.test('profile nickname updates work but user IDs are immutable',async()=>{
   await as(ids[0]);await db.query("update public.jhg_profiles set display_name='Host' where id=$1",[ids[0]]);
   await assert.rejects(db.query('update public.jhg_profiles set id=$1 where id=$2',[ids[2],ids[0]]),/permission denied/);
  });
  await t.test('cancellation creates private notification and prohibits later joins',async()=>{
   await as(ids[0]);await db.query("select public.jhg_walk_action($1,'cancelWalk')",[id]);
   await as(ids[1]);const notices=(await db.query('select * from public.jhg_notifications')).rows;assert(notices.some(n=>n.body.includes('取消')));assert(notices.every(n=>n.user_id===ids[1]));
   await db.query('update public.jhg_notifications set read=true');await assert.rejects(db.query("update public.jhg_notifications set body='forged'"),/permission denied/);
   await as(ids[2]);await assert.rejects(db.query("select public.jhg_walk_action($1,'joinWalk')",[id]),/取消/);
  });
  await t.test('anonymous users have no table or mutating RPC access',async()=>{
   await db.exec('reset role;set role anon');await db.query("select set_config('request.jwt.claim.sub','',false)");
   await assert.rejects(db.query('select * from public.jhg_profiles'),/permission denied/);
   await assert.rejects(db.query("select public.jhg_walk_action($1,'joinWalk')",[id]),/permission denied/);
  });
  await t.test('mutual likes create notifications exactly once; swipes and blocks enforce privacy',async()=>{
   await as(ids[0]);await db.query('update public.jhg_pets set discoverable=true where owner_id=$1',[ids[0]]);
   await as(ids[1]);await db.query("insert into public.jhg_pets(owner_id,name,type,discoverable) values($1,'Public dog','狗',true)",[ids[1]]);
   assert.equal((await db.query("select public.jhg_swipe($1,'like') as matched",[ids[0]])).rows[0].matched,false);
   await as(ids[0]);assert.equal((await db.query("select public.jhg_swipe($1,'like') as matched",[ids[1]])).rows[0].matched,true);
   const before=(await db.query('select count(*)::int as n from public.jhg_notifications')).rows[0].n;
   await db.query("select public.jhg_swipe($1,'like')",[ids[1]]);assert.equal((await db.query('select count(*)::int as n from public.jhg_notifications')).rows[0].n,before);
   assert((await db.query('select * from public.jhg_swipes')).rows.every(s=>s.owner_id===ids[0]));
   await db.query('insert into public.jhg_blocks(owner_id,target_id) values($1,$2)',[ids[0],ids[1]]);
   assert.equal((await db.query('select * from public.jhg_profiles where id=$1',[ids[1]])).rows.length,0);
   await as(ids[1]);await assert.rejects(db.query("select public.jhg_swipe($1,'like')",[ids[0]]),/配對/);
  });
  await t.test('account deletion requires confirmation, deletes only the caller and cascades their data',async()=>{
   await as(ids[1]);await assert.rejects(db.query("select public.jhg_delete_account('WRONG')"),/確認/);
   await db.exec('reset role');
   assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1',[ids[1]])).rows[0].n,1);
   await as(ids[1]);
   await db.query("select public.jhg_delete_account('DELETE')");
   await db.exec('reset role');
   assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1',[ids[1]])).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int as n from public.jhg_profiles where id=$1',[ids[1]])).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1',[ids[0]])).rows[0].n,1);
  });
 }finally{await db.close();}
});
