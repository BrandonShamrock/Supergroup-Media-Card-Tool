begin;
-- One small private metadata row, no diagnostic bodies, addresses, tokens or URLs.
create table public.dealeros_diagnostic (
 id boolean primary key default true check(id), diagnostic_id uuid,
 requested_by uuid references auth.users(id) on delete set null,
 requested_at timestamptz, claimed boolean not null default false
);
insert into public.dealeros_diagnostic(id) values(true);
alter table public.dealeros_diagnostic enable row level security;
revoke all on public.dealeros_diagnostic from anon,authenticated;
grant all on public.dealeros_diagnostic to service_role;
create function public.request_dealeros_diagnostic(p_id uuid,p_user uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare s dealeros_diagnostic; begin
 if not exists(select 1 from authorized_users where user_id=p_user) then raise exception 'Unauthorized'; end if;
 select * into s from dealeros_diagnostic where id=true for update;
 if s.requested_at>now()-interval '2 minutes' then return false; end if;
 update dealeros_diagnostic set diagnostic_id=p_id,requested_by=p_user,requested_at=now(),claimed=false where id=true;
 return true;
end $$;
create function public.claim_dealeros_diagnostic(p_id uuid,p_user uuid) returns boolean language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from authorized_users where user_id=p_user) then return false; end if;
 update dealeros_diagnostic set claimed=true where id=true and diagnostic_id=p_id and requested_by=p_user and not claimed and requested_at>now()-interval '2 minutes';
 return found;
end $$;
revoke all on function public.request_dealeros_diagnostic(uuid,uuid),public.claim_dealeros_diagnostic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_dealeros_diagnostic(uuid,uuid),public.claim_dealeros_diagnostic(uuid,uuid) to service_role;
commit;
