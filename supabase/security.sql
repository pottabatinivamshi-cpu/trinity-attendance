-- ============================================================
-- Trinity Attendance Letters: privacy, editing and letter records
-- Run this after purge.sql. Safe to run again.
--
-- 1. The lists are no longer public. Reading them needs the view PIN
--    (or the core PIN). Core sets the view PIN from the website.
-- 2. Core can edit a person's details.
-- 3. Every downloaded letter is saved in Records with its attendance dates.
-- 4. keepalive() for the scheduled ping that stops the free project pausing.
-- ============================================================

alter table private.admin add column if not exists view_hash text;

-- Accepts the view PIN or the core PIN. Wrong guesses share the 10-per-15-minutes lock.
create or replace function private.check_view(p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a private.admin;
  recent int;
begin
  delete from private.pin_failures where at < now() - interval '1 day';
  select count(*) into recent from private.pin_failures where at > now() - interval '15 minutes';
  if recent >= 10 then return 'locked'; end if;
  select * into a from private.admin where id = 1;
  if not found then return 'pin_not_set'; end if;
  if extensions.crypt(coalesce(p_pin, ''), a.pin_hash) = a.pin_hash
     or (a.view_hash is not null and extensions.crypt(coalesce(p_pin, ''), a.view_hash) = a.view_hash) then
    return 'ok';
  end if;
  insert into private.pin_failures default values;
  return 'wrong_pin';
end;
$$;
revoke all on function private.check_view(text) from public, anon, authenticated;

-- ---------- Lock the tables ----------
drop policy if exists "Anyone can read departments" on public.departments;
drop policy if exists "Anyone can read members" on public.members;
drop policy if exists "Anyone can read current memberships" on public.memberships;
drop policy if exists "Anyone can read approved IDPT entries" on public.idpt_entries;
drop policy if exists "Anyone can read IDPT sections" on public.idpt_sections;
drop policy if exists "Anyone can read events" on public.events;
revoke all on public.departments, public.members, public.memberships,
              public.idpt_entries, public.idpt_sections, public.events from anon, authenticated;

-- ---------- Reading, with a PIN ----------
create or replace function public.view_unlock(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_view(p_pin);
  h text;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  select pin_hash into h from private.admin where id = 1;
  return jsonb_build_object('status', 'ok', 'core', extensions.crypt(p_pin, h) = h);
end;
$$;

create or replace function public.get_trinity(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_view(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object('status', 'ok',
    'departments', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'position', position) order by position) from public.departments), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'branch', branch, 'roll', roll, 'sap', sap,
                 'division', division, 'year', year, 'has_details', has_details)) from public.members), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('dept', dept, 'grp', grp, 'member_id', member_id, 'position', position) order by position)
                 from public.memberships where deleted_at is null), '[]'::jsonb));
end;
$$;

create or replace function public.get_events(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_view(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object('status', 'ok', 'events', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'kind', kind,
           'join_open', join_open, 'archived', archived, 'created_at', created_at) order by created_at) from public.events), '[]'::jsonb));
end;
$$;

create or replace function public.get_event(p_pin text, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_view(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object('status', 'ok',
    'sections', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'position', position) order by position)
                 from public.idpt_sections where event = p_event), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'section', section, 'name', name, 'branch', branch, 'roll', roll,
                 'sap', sap, 'division', division, 'year', year, 'position', position) order by position)
                 from public.idpt_entries where event = p_event and status = 'approved' and deleted_at is null), '[]'::jsonb));
end;
$$;

-- Core sets the PIN other people use to see the lists and make letters.
create or replace function public.set_view_pin(p_pin text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if length(coalesce(p_new, '')) < 4 then return jsonb_build_object('status', 'invalid'); end if;
  update private.admin set view_hash = extensions.crypt(p_new, extensions.gen_salt('bf')) where id = 1;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.view_pin_status(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object('status', 'ok', 'set', (select view_hash is not null from private.admin where id = 1));
end;
$$;

-- ---------- Editing (core) ----------
-- Trinity Team: the change shows everywhere this person is listed.
create or replace function public.member_update(
  p_pin text, p_id text, p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_name text := private.clean(p_name, 80);
  v_sap text := private.clean(p_sap, 20);
  v_branch text := private.clean(p_branch, 12);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if length(v_name) < 2 or (v_sap <> '' and v_sap !~ '^[0-9]{11}$') then return jsonb_build_object('status', 'invalid'); end if;
  update public.members
     set name = v_name, sap = v_sap, branch = v_branch, year = private.clean(p_year, 4),
         roll = private.clean(p_roll, 12), division = private.clean(p_division, 10),
         has_details = (v_sap <> '' and v_branch <> '')
   where id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- IDPT and events
create or replace function public.ev_update(
  p_pin text, p_id uuid, p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_event text;
  v_name text := private.clean(p_name, 80);
  v_sap text := private.clean(p_sap, 20);
  v_section text;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  select event into v_event from public.idpt_entries where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_section := private.ev_section(v_event, p_section);
  if length(v_name) < 2 or v_section = '' or (v_sap <> '' and v_sap !~ '^[0-9]{11}$') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_sap <> '' and exists (select 1 from public.idpt_entries where event = v_event and sap = v_sap and id <> p_id and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  perform private.ev_ensure_section(v_event, v_section);
  update public.idpt_entries
     set name = v_name, sap = v_sap, branch = private.clean(p_branch, 12), year = private.clean(p_year, 4),
         roll = private.clean(p_roll, 12), division = private.clean(p_division, 10), section = v_section
   where id = p_id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- Records of letters ----------
create table if not exists public.letter_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  date_from    date not null,
  date_to      date not null,
  list_name    text not null default '',
  subject      text not null default '',
  letter       jsonb not null default '{}'::jsonb,
  people       jsonb not null default '[]'::jsonb,
  people_count int  not null default 0,
  by_name      text not null default ''
);
alter table public.letter_log enable row level security;
revoke all on public.letter_log from anon, authenticated;
create index if not exists letter_log_dates on public.letter_log (date_from desc, created_at desc);

-- Anyone with the view PIN who downloads a letter adds it to Records.
create or replace function public.log_letter(
  p_pin text, p_from date, p_to date, p_list text, p_subject text, p_letter jsonb, p_people jsonb, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_view(p_pin);
  v_id uuid;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if p_from is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) > 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.letter_log (date_from, date_to, list_name, subject, letter, people, people_count, by_name)
  values (p_from, greatest(p_from, coalesce(p_to, p_from)), private.clean(p_list, 80), left(coalesce(p_subject, ''), 600),
          coalesce(p_letter, '{}'::jsonb), p_people, jsonb_array_length(p_people), private.clean(p_by, 60))
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

-- Records are for core only.
create or replace function public.list_letters(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object('status', 'ok', 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'date_from', date_from, 'date_to', date_to,
             'list_name', list_name, 'subject', subject, 'letter', letter, 'people', people, 'people_count', people_count, 'by_name', by_name)
           order by date_from desc, created_at desc)
      from (select * from public.letter_log order by date_from desc, created_at desc limit 1000) t), '[]'::jsonb));
end;
$$;

create or replace function public.delete_letter(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  delete from public.letter_log where id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- Keep the free project awake ----------
create or replace function public.keepalive()
returns text
language sql
security definer
set search_path = ''
as $$ select 'ok ' || (select count(*) from public.events)::text; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'view_unlock(text)', 'get_trinity(text)', 'get_events(text)', 'get_event(text, text)',
    'set_view_pin(text, text)', 'view_pin_status(text)',
    'member_update(text, text, text, text, text, text, text, text)',
    'ev_update(text, uuid, text, text, text, text, text, text, text)',
    'log_letter(text, date, date, text, text, jsonb, jsonb, text)',
    'list_letters(text)', 'delete_letter(text, uuid)', 'keepalive()'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
