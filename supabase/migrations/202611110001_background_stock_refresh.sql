begin;
alter table public.stock_sync
 add column job_id uuid,
 add column requested_by uuid references auth.users(id),
 add column status text not null default 'idle' check(status in ('idle','queued','running','succeeded','failed')),
 add column phase text,
 add column error_code text,
 add column queued_at timestamptz,
 add column started_at timestamptz,
 add column finished_at timestamptz,
 add column response_bytes bigint;

-- Keep the original staging, UPSERT, shrink, duplicate and deletion logic unchanged.
alter function public.apply_stock_sync(uuid,text,jsonb) rename to apply_stock_sync_transaction;
create function public.apply_stock_sync(p_lease uuid,p_strategy text,p_vehicles jsonb) returns void
 language plpgsql security definer set search_path=public as $$ begin
 perform apply_stock_sync_transaction(p_lease,p_strategy,p_vehicles);
 update stock_sync set status='succeeded',phase='complete',error_code=null,finished_at=now()
 where id=true and job_id=p_lease;
end $$;

create or replace function public.acquire_stock_sync(p_lease uuid) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare s stock_sync; begin
 select * into s from stock_sync where id=true for update;
 if s.lease_until > now() then raise exception 'Stock refresh already running'; end if;
 update stock_sync set lease=p_lease,lease_until=now()+interval '12 minutes',job_id=p_lease,
 requested_by=null,status='queued',phase='queued',error=null,error_code=null,
 queued_at=now(),started_at=null,finished_at=null,response_bytes=null where id=true;
 return jsonb_build_object('key_strategy',s.key_strategy);
end $$;

create function public.request_stock_sync(p_lease uuid,p_user uuid) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare s stock_sync; begin
 if not exists(select 1 from authorized_users where user_id=p_user) then raise exception 'Unauthorized'; end if;
 select * into s from stock_sync where id=true for update;
 if s.lease_until>now() then
  return jsonb_build_object('job_id',s.job_id,'dispatch',s.status='queued' and s.requested_by=p_user);
 end if;
 perform acquire_stock_sync(p_lease);
 update stock_sync set requested_by=p_user where id=true;
 return jsonb_build_object('job_id',p_lease,'dispatch',true);
end $$;

create function public.claim_stock_sync(p_lease uuid,p_user uuid) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare s stock_sync; begin
 select * into s from stock_sync where id=true for update;
 if s.lease is distinct from p_lease or s.status<>'queued' or s.lease_until<=now()
 or s.requested_by is distinct from p_user then return null; end if;
 if not exists(select 1 from authorized_users where user_id=p_user) then return null; end if;
 update stock_sync set status='running',phase='fetching',started_at=now() where id=true;
 return jsonb_build_object('key_strategy',s.key_strategy);
end $$;

create function public.stock_sync_status() returns jsonb
 language plpgsql security definer set search_path=public as $$
declare s stock_sync; begin
 select * into s from stock_sync where id=true for update;
 if s.status in ('queued','running') and
 (s.lease_until<=now() or (s.status='queued' and s.queued_at<now()-interval '2 minutes')) then
  update stock_sync set status='failed',phase='interrupted',finished_at=now(),lease=null,lease_until=null,
  error_code=case when s.status='queued' then 'DISPATCH_TIMEOUT' else 'WORKER_INTERRUPTED' end,
  error=case when s.status='queued' then 'Background job did not start. Check Background Functions availability, deployment URL and function logs.'
  else 'Background job was interrupted or its lease expired. Existing committed stock is unchanged; retry refresh.' end where id=true;
 end if;
 select * into s from stock_sync where id=true;
 return to_jsonb(s)-'lease'-'requested_by';
end $$;

do $$ declare f text; begin
 foreach f in array array['apply_stock_sync(uuid,text,jsonb)','apply_stock_sync_transaction(uuid,text,jsonb)',
 'acquire_stock_sync(uuid)','request_stock_sync(uuid,uuid)','claim_stock_sync(uuid,uuid)','stock_sync_status()'] loop
 execute 'revoke all on function public.'||f||' from public,anon,authenticated';
 execute 'grant execute on function public.'||f||' to service_role';
 end loop;
end $$;
commit;
