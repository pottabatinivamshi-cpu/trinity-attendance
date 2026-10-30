-- ============================================================
-- Trinity Attendance Letters: database setup for Supabase
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Then run set-pin.sql with your own PIN.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Public tables (anyone can read the current lists) ----------
create table if not exists public.departments (
  name     text primary key,
  position int  not null default 0
);

create table if not exists public.members (
  id          text primary key,
  name        text not null,
  branch      text not null default '',
  roll        text not null default '',
  sap         text not null default '',
  division    text not null default '',
  year        text not null check (year in ('TE', 'SE')),
  has_details boolean not null default true
);

create table if not exists public.memberships (
  dept       text not null references public.departments(name) on update cascade,
  grp        text not null check (grp in ('core', 'cocom')),
  member_id  text not null references public.members(id) on delete cascade,
  position   int  not null default 0,
  deleted_at timestamptz,
  deleted_by text,
  primary key (dept, grp, member_id)
);

alter table public.departments enable row level security;
alter table public.members     enable row level security;
alter table public.memberships enable row level security;

drop policy if exists "Anyone can read departments" on public.departments;
create policy "Anyone can read departments" on public.departments
  for select to anon, authenticated using (true);

drop policy if exists "Anyone can read members" on public.members;
create policy "Anyone can read members" on public.members
  for select to anon, authenticated using (true);

-- Deleted entries stay hidden. They're only listed through the PIN-protected bin.
drop policy if exists "Anyone can read current memberships" on public.memberships;
create policy "Anyone can read current memberships" on public.memberships
  for select to anon, authenticated using (deleted_at is null);

-- No insert/update/delete policies: the site can't change tables directly.
-- Every change goes through the functions below, which check the PIN.

-- ---------- Private schema (not reachable from the website) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin (
  id       int primary key default 1 check (id = 1),
  pin_hash text not null
);

create table if not exists private.pin_failures (
  at timestamptz not null default now()
);

-- Returns 'ok', 'wrong_pin', 'locked' or 'pin_not_set'.
-- After 10 wrong PINs in 15 minutes, every PIN is refused for the rest of that window.
create or replace function private.check_pin(p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text;
  recent int;
begin
  delete from private.pin_failures where at < now() - interval '1 day';
  select count(*) into recent from private.pin_failures where at > now() - interval '15 minutes';
  if recent >= 10 then
    return 'locked';
  end if;
  select pin_hash into h from private.admin where id = 1;
  if h is null then
    return 'pin_not_set';
  end if;
  if extensions.crypt(coalesce(p_pin, ''), h) = h then
    return 'ok';
  end if;
  insert into private.pin_failures default values;
  return 'wrong_pin';
end;
$$;
revoke all on function private.check_pin(text) from public, anon, authenticated;

-- ---------- Functions the website calls ----------
create or replace function public.unlock(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('status', private.check_pin(p_pin));
end;
$$;

create or replace function public.delete_member(p_pin text, p_dept text, p_grp text, p_member text, p_by text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then
    return jsonb_build_object('status', s);
  end if;
  update public.memberships
     set deleted_at = now(),
         deleted_by = nullif(left(btrim(coalesce(p_by, '')), 60), '')
   where dept = p_dept and grp = p_grp and member_id = p_member and deleted_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.restore_member(p_pin text, p_dept text, p_grp text, p_member text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then
    return jsonb_build_object('status', s);
  end if;
  update public.memberships
     set deleted_at = null, deleted_by = null
   where dept = p_dept and grp = p_grp and member_id = p_member and deleted_at is not null;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.list_bin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then
    return jsonb_build_object('status', s);
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dept', m.dept, 'grp', m.grp, 'member_id', m.member_id,
               'deleted_at', m.deleted_at, 'deleted_by', m.deleted_by)
             order by m.deleted_at desc)
        from public.memberships m
       where m.deleted_at is not null), '[]'::jsonb));
end;
$$;

revoke all on function public.unlock(text) from public;
revoke all on function public.delete_member(text, text, text, text, text) from public;
revoke all on function public.restore_member(text, text, text, text) from public;
revoke all on function public.list_bin(text) from public;
grant execute on function public.unlock(text) to anon, authenticated;
grant execute on function public.delete_member(text, text, text, text, text) to anon, authenticated;
grant execute on function public.restore_member(text, text, text, text) to anon, authenticated;
grant execute on function public.list_bin(text) to anon, authenticated;

grant select on public.departments, public.members, public.memberships to anon, authenticated;

-- The member lists are not kept in this repo, because they hold students' details.
-- Load them into the tables above from your own CSVs, or ask whoever maintains the site.
