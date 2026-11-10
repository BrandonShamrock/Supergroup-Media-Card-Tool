begin;
create table public.authorized_users (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.authorized_users enable row level security;
revoke all on public.authorized_users from anon,authenticated;
create function public.is_authorized() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from authorized_users where user_id = auth.uid()) $$;
revoke all on function public.is_authorized() from public;
grant execute on function public.is_authorized() to authenticated;
create table public.dealerships (
 id uuid primary key default gen_random_uuid(), name text not null unique,
 dealeros_id text, postx_group_id integer not null check(postx_group_id>0),
 template_name text not null default '', card_count integer not null default 2 check(card_count between 2 and 10),
 variable_mapping jsonb not null default '{"recipient":{},"card":{}}',
 active boolean not null default false, mapping_verified boolean not null default false,
 template_verified boolean not null default false, updated_at timestamptz not null default now()
);
create unique index dealerships_source_unique on public.dealerships(dealeros_id) where dealeros_id is not null;
create table public.vehicle_stock (
 source_id text primary key, dealership_id text not null, dealership_name text not null,
 make text not null, model text not null, derivative text not null, title text not null,
 year integer not null, mileage numeric not null check(mileage>=0), retail_price numeric not null check(retail_price>=0),
 new_used text not null, stock_number text not null, colour text not null, primary_image_url text,
 updated_at timestamptz not null default now()
);
create index stock_dealership on public.vehicle_stock(dealership_id);
create table public.stock_sync (
 id boolean primary key default true check(id), last_success_at timestamptz, vehicle_count integer not null default 0,
 key_strategy text, lease uuid, lease_until timestamptz, error text
);
insert into public.stock_sync(id) values(true);
create table public.campaigns (
 id uuid primary key, created_by uuid not null references auth.users(id), dealership_id uuid not null references public.dealerships(id),
 request_fingerprint text not null unique, name text not null check(length(name) between 1 and 120), created_at timestamptz not null default now(),
 config_snapshot jsonb not null, vehicle_count integer not null, recipient_count integer not null,
 batch_count integer not null, accepted_count integer not null default 0, failed_count integer not null default 0,
 unknown_count integer not null default 0, status text not null default 'queued'
);
create index campaigns_created on public.campaigns(created_at desc);
create table public.campaign_vehicle_snapshots (
 campaign_id uuid primary key references public.campaigns(id) on delete cascade, vehicles jsonb not null
);
create table public.campaign_batches (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 position integer not null, status text not null default 'queued' check(status in ('queued','processing','completed','unknown','failed')),
 recipients jsonb, recipient_references jsonb not null, recipient_count integer not null, started_at timestamptz, finished_at timestamptz, error text,
 unique(campaign_id,position)
);
create index pending_batches on public.campaign_batches(status,position);
create table public.recipient_results (
 batch_id uuid not null references public.campaign_batches(id) on delete cascade,
 external_reference text not null, status text not null check(status in ('accepted','failed','unknown')),
 conversation_id text, error text, primary key(batch_id,external_reference)
);
-- Browser clients have no access to queued recipient names or phone numbers.
do $$ declare t text; begin
 foreach t in array array['dealerships','vehicle_stock','stock_sync','campaigns','campaign_vehicle_snapshots','campaign_batches','recipient_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
 foreach t in array array['dealerships','vehicle_stock','stock_sync','campaigns','campaign_vehicle_snapshots','recipient_results'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy authorized_read on public.%I for select to authenticated using (public.is_authorized())',t);
 end loop;
end $$;
-- All writes run through authenticated server functions using the service role.
create function public.acquire_stock_sync(p_lease uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare s stock_sync; begin
 select * into s from stock_sync where id=true for update;
 if s.lease_until > now() then raise exception 'Stock refresh already running'; end if;
 update stock_sync set lease=p_lease,lease_until=now()+interval '3 minutes',error=null where id=true;
 return jsonb_build_object('key_strategy',s.key_strategy);
end $$;
create function public.apply_stock_sync(p_lease uuid,p_strategy text,p_vehicles jsonb) returns void language plpgsql security definer set search_path=public as $$
declare s stock_sync; n integer; begin
 select * into s from stock_sync where id=true for update;
 if s.lease is distinct from p_lease or s.lease_until < now() then raise exception 'Stock lease expired'; end if;
 n := jsonb_array_length(p_vehicles);
 if n<1 or (s.vehicle_count>0 and n < ceil(s.vehicle_count*0.8)) then raise exception 'Suspicious stock reduction; existing stock retained'; end if;
 if p_strategy not in ('stock_id','id') or (s.key_strategy is not null and s.key_strategy<>p_strategy) then raise exception 'Stock identifier strategy changed'; end if;
 create temporary table stock_stage (like vehicle_stock including defaults) on commit drop;
 insert into stock_stage select r.*,now() from jsonb_to_recordset(p_vehicles) as r(source_id text,dealership_id text,dealership_name text,make text,model text,derivative text,title text,year integer,mileage numeric,retail_price numeric,new_used text,stock_number text,colour text,primary_image_url text);
 if (select count(distinct source_id) from stock_stage)<>n then raise exception 'Duplicate stock identifiers'; end if;
 insert into vehicle_stock select * from stock_stage on conflict(source_id) do update set
 dealership_id=excluded.dealership_id,dealership_name=excluded.dealership_name,make=excluded.make,model=excluded.model,
 derivative=excluded.derivative,title=excluded.title,year=excluded.year,mileage=excluded.mileage,retail_price=excluded.retail_price,
 new_used=excluded.new_used,stock_number=excluded.stock_number,colour=excluded.colour,primary_image_url=excluded.primary_image_url,updated_at=excluded.updated_at
 where (vehicle_stock.dealership_id,vehicle_stock.dealership_name,vehicle_stock.make,vehicle_stock.model,vehicle_stock.derivative,vehicle_stock.title,vehicle_stock.year,vehicle_stock.mileage,vehicle_stock.retail_price,vehicle_stock.new_used,vehicle_stock.stock_number,vehicle_stock.colour,vehicle_stock.primary_image_url) is distinct from
 (excluded.dealership_id,excluded.dealership_name,excluded.make,excluded.model,excluded.derivative,excluded.title,excluded.year,excluded.mileage,excluded.retail_price,excluded.new_used,excluded.stock_number,excluded.colour,excluded.primary_image_url);
 delete from vehicle_stock where source_id not in (select source_id from stock_stage);
 update stock_sync set last_success_at=now(),vehicle_count=n,key_strategy=p_strategy,lease=null,lease_until=null,error=null where id=true;
end $$;
create function public.queue_campaign(p_campaign jsonb,p_vehicles jsonb,p_batches jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid := (p_campaign->>'id')::uuid; b jsonb; i integer:=0; existing campaigns; begin
 perform pg_advisory_xact_lock(hashtextextended(p_campaign->>'request_fingerprint',0));
 perform pg_advisory_xact_lock(hashtextextended(cid::text,0));
 select * into existing from campaigns where id=cid or request_fingerprint=p_campaign->>'request_fingerprint';
 if found then
  if existing.created_by<>(p_campaign->>'created_by')::uuid then raise exception 'Campaign reference conflict'; end if;
  return existing.id;
 end if;
 insert into campaigns(id,created_by,dealership_id,request_fingerprint,name,config_snapshot,vehicle_count,recipient_count,batch_count)
 values(cid,(p_campaign->>'created_by')::uuid,(p_campaign->>'dealership_id')::uuid,p_campaign->>'request_fingerprint',p_campaign->>'name',p_campaign->'config_snapshot',jsonb_array_length(p_vehicles),(p_campaign->>'recipient_count')::int,jsonb_array_length(p_batches));
 insert into campaign_vehicle_snapshots values(cid,p_vehicles);
 for b in select value from jsonb_array_elements(p_batches) loop
  insert into campaign_batches(campaign_id,position,recipients,recipient_references,recipient_count) values(cid,i,b,(select jsonb_agg(value->>'external_reference') from jsonb_array_elements(b)),jsonb_array_length(b)); i:=i+1;
 end loop;
 return cid;
end $$;
create function public.recount_campaign(p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 update campaigns set
 accepted_count=(select count(*) from recipient_results r join campaign_batches b on b.id=r.batch_id where b.campaign_id=p_id and r.status='accepted'),
 failed_count=coalesce((select sum(recipient_count) from campaign_batches where campaign_id=p_id and status='failed'),0)+(select count(*) from recipient_results r join campaign_batches b on b.id=r.batch_id where b.campaign_id=p_id and r.status='failed'),
 unknown_count=coalesce((select sum(recipient_count) from campaign_batches where campaign_id=p_id and status='unknown'),0)+(select count(*) from recipient_results r join campaign_batches b on b.id=r.batch_id where b.campaign_id=p_id and r.status='unknown'),
 status=case when exists(select 1 from campaign_batches where campaign_id=p_id and status='processing') then 'processing'
 when exists(select 1 from campaign_batches where campaign_id=p_id and status='queued') then 'queued'
 when exists(select 1 from campaign_batches where campaign_id=p_id and status='unknown') or exists(select 1 from recipient_results r join campaign_batches b on b.id=r.batch_id where b.campaign_id=p_id and r.status='unknown') then 'needs_review' else 'completed' end
 where id=p_id;
end $$;
create function public.claim_batch() returns jsonb language plpgsql security definer set search_path=public as $$
declare b campaign_batches; stale uuid; begin
 -- A crashed/expired attempt is uncertain: never automatically resend it.
 for stale in update campaign_batches set status='unknown',recipients=null,finished_at=now(),error='Worker interrupted; reconcile in PostX before any manual recovery.' where status='processing' and started_at<now()-interval '3 minutes' returning campaign_id loop
  perform recount_campaign(stale);
 end loop;
 select * into b from campaign_batches where status='queued' order by campaign_id,position for update skip locked limit 1;
 if not found then return null; end if;
 update campaign_batches set status='processing',started_at=now() where id=b.id;
 update campaigns set status='processing' where id=b.campaign_id;
 return to_jsonb(b);
end $$;
create function public.finish_batch(p_id uuid,p_status text,p_results jsonb,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare b campaign_batches; begin
 select * into b from campaign_batches where id=p_id for update;
 if b.status<>'processing' then raise exception 'Batch already finalized'; end if;
 if p_status not in ('completed','failed','unknown') then raise exception 'Invalid outcome'; end if;
 if p_status='completed' and jsonb_array_length(p_results)<>b.recipient_count then raise exception 'Incomplete outcome'; end if;
 insert into recipient_results select p_id,r.* from jsonb_to_recordset(p_results) as r(external_reference text,status text,conversation_id text,error text);
 update campaign_batches set status=p_status,recipients=null,finished_at=now(),error=p_error where id=p_id;
 perform recount_campaign(b.campaign_id);
end $$;
create function public.cleanup_campaigns() returns void language plpgsql security definer set search_path=public as $$ begin
 -- Uncertain attempts retain correlation references, never names/numbers.
 update campaign_batches set status='unknown',recipients=null,finished_at=now(),error='Worker interrupted; reconcile in PostX before recovery.' where status='processing' and started_at<now()-interval '3 minutes';
 -- Pending recipients remain private until processing or explicit cancellation.
 perform recount_campaign(id) from campaigns where status in ('queued','processing');
 delete from recipient_results r using campaign_batches b where r.batch_id=b.id and b.finished_at<now()-interval '90 days';
end $$;
create function public.cancel_campaign(p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 update campaign_batches set status='failed',recipients=null,finished_at=now(),error='Pending batch cancelled by an authorized operator.' where campaign_id=p_id and status='queued';
 perform recount_campaign(p_id);
end $$;
-- Lock all privileged RPCs to server-only credentials.
do $$ declare f text; begin
 foreach f in array array['acquire_stock_sync(uuid)','apply_stock_sync(uuid,text,jsonb)','queue_campaign(jsonb,jsonb,jsonb)','recount_campaign(uuid)','claim_batch()','finish_batch(uuid,text,jsonb,text)','cleanup_campaigns()','cancel_campaign(uuid)'] loop
 execute 'revoke all on function public.'||f||' from public, anon, authenticated';
 execute 'grant execute on function public.'||f||' to service_role';
 end loop;
end $$;
grant all on public.authorized_users,public.dealerships,public.vehicle_stock,public.stock_sync,public.campaigns,public.campaign_vehicle_snapshots,public.campaign_batches,public.recipient_results to service_role;
commit;
