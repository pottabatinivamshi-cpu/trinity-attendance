-- ============================================================
-- Trinity Attendance Letters: events
-- Run this after setup.sql and idpt.sql. Safe to run again.
-- Turns the IDPT list into one event among many. Core can add any
-- event by name, and each event gets its own list, QR sign-up and letter.
-- Existing IDPT data stays as the event "idpt".
-- ============================================================

create table if not exists public.events (
  slug       text primary key,
  name       text not null,
  kind       text not null default 'general' check (kind in ('idpt', 'general')),
  join_open  boolean not null default true,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
drop policy if exists "Anyone can read events" on public.events;
create policy "Anyone can read events" on public.events for select to anon, authenticated using (true);
grant select on public.events to anon, authenticated;

insert into public.events (slug, name, kind, join_open)
values ('idpt', 'IDPT Sports', 'idpt', coalesce((select join_open from private.settings where id = 1), true))
on conflict (slug) do nothing;

-- Every list entry and section now belongs to an event.
alter table public.idpt_entries  add column if not exists event text not null default 'idpt';
alter table public.idpt_sections add column if not exists event text not null default 'idpt';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'idpt_entries_event_fkey') then
    alter table public.idpt_entries add constraint idpt_entries_event_fkey
      foreign key (event) references public.events(slug) on update cascade;
  end if;
  if exists (select 1 from pg_constraint where conname = 'idpt_sections_pkey' and array_length(conkey, 1) = 1) then
    alter table public.idpt_sections drop constraint idpt_sections_pkey;
    alter table public.idpt_sections add primary key (event, name);
  end if;
end $$;
create index if not exists idpt_entries_event_sap on public.idpt_entries (event, sap) where deleted_at is null;

-- ---------- Helpers ----------
create or replace function private.ev_ensure_section(p_event text, p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.idpt_sections (event, name, position)
  select p_event, p_name, coalesce(max(position), -1) + 1 from public.idpt_sections where event = p_event
  on conflict (event, name) do nothing;
$$;
revoke all on function private.ev_ensure_section(text, text) from public, anon, authenticated;

-- The sub-group a person goes in. IDPT needs a sport; other events default to "Participants".
create or replace function private.ev_section(p_event text, p_section text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.clean(p_section, 40) <> '' then private.clean(p_section, 40)
    when (select kind from public.events where slug = p_event) = 'idpt' then ''
    else 'Participants' end;
$$;
revoke all on function private.ev_section(text, text) from public, anon, authenticated;

-- ---------- Public: QR sign-up ----------
create or replace function public.ev_join_info(p_event text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select case when e.slug is null then jsonb_build_object('exists', false)
  else jsonb_build_object(
    'exists', true, 'name', e.name, 'kind', e.kind,
    'open', e.join_open and not e.archived,
    'sections', coalesce((select jsonb_agg(s.name order by s.position) from public.idpt_sections s where s.event = e.slug), '[]'::jsonb))
  end
  from (select 1) one left join public.events e on e.slug = p_event;
$$;

create or replace function public.ev_join(
  p_event text, p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean(p_name, 80);
  v_sap text := private.clean(p_sap, 20);
  v_section text := private.ev_section(p_event, p_section);
  ev public.events;
  recent int;
begin
  select * into ev from public.events where slug = p_event;
  if not found or not ev.join_open or ev.archived then
    return jsonb_build_object('status', 'closed');
  end if;
  if length(v_name) < 2 or v_sap !~ '^[0-9]{11}$' or v_section = ''
     or coalesce(p_branch, '') not in ('COMPS', 'IT', 'CSE-DS', 'CSE-ICB', 'AIML', 'AIDS', 'EXTC', 'MECH')
     or coalesce(p_year, '') not in ('FE', 'SE', 'TE', 'BE') then
    return jsonb_build_object('status', 'invalid');
  end if;
  delete from private.join_log where at < now() - interval '1 hour';
  select count(*) into recent from private.join_log where at > now() - interval '1 minute';
  if recent >= 60 then
    return jsonb_build_object('status', 'busy');
  end if;
  insert into private.join_log default values;
  if (select count(*) from public.idpt_entries where event = p_event and status = 'pending' and deleted_at is null) >= 500 then
    return jsonb_build_object('status', 'full');
  end if;
  if exists (select 1 from public.idpt_entries where event = p_event and sap = v_sap and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  insert into public.idpt_entries (event, section, name, branch, roll, sap, division, year, status, source)
  values (p_event, v_section, v_name, p_branch, private.clean(p_roll, 12), v_sap, private.clean(p_division, 10), p_year, 'pending', 'qr');
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- Core only (PIN) ----------
create or replace function public.ev_create(p_pin text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_name text := private.clean(p_name, 60);
  base text; v_slug text; n int := 1;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if length(v_name) < 2 then return jsonb_build_object('status', 'invalid'); end if;
  base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  if base = '' then base := 'event'; end if;
  if base like '%-letter' or base in ('idpt', 'events', 'trinity', 'quick') then base := base || '-event'; end if;
  v_slug := base;
  while exists (select 1 from public.events where slug = v_slug) loop
    n := n + 1; v_slug := base || '-' || n;
  end loop;
  insert into public.events (slug, name, kind) values (v_slug, v_name, 'general');
  return jsonb_build_object('status', 'ok', 'slug', v_slug);
end;
$$;

create or replace function public.ev_rename(p_pin text, p_event text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_name text := private.clean(p_name, 60);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if length(v_name) < 2 then return jsonb_build_object('status', 'invalid'); end if;
  update public.events set name = v_name where slug = p_event;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Archiving hides an event and closes its sign-ups. Nothing is deleted. IDPT can't be archived.
create or replace function public.ev_archive(p_pin text, p_event text, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if p_event = 'idpt' then return jsonb_build_object('status', 'invalid'); end if;
  update public.events set archived = coalesce(p_archived, false) where slug = p_event;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.ev_set_join(p_pin text, p_event text, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  update public.events set join_open = coalesce(p_open, false) where slug = p_event;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'open', coalesce(p_open, false));
end;
$$;

create or replace function public.ev_add(
  p_pin text, p_event text, p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_name text := private.clean(p_name, 80);
  v_sap text := private.clean(p_sap, 20);
  v_section text := private.ev_section(p_event, p_section);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if not exists (select 1 from public.events where slug = p_event) then return jsonb_build_object('status', 'not_found'); end if;
  if length(v_name) < 2 or v_sap !~ '^[0-9]{11}$' or v_section = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.idpt_entries where event = p_event and sap = v_sap and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  perform private.ev_ensure_section(p_event, v_section);
  insert into public.idpt_entries (event, section, name, branch, roll, sap, division, year, status, source, position)
  values (p_event, v_section, v_name, private.clean(p_branch, 12), private.clean(p_roll, 12), v_sap,
          private.clean(p_division, 10), private.clean(p_year, 4), 'approved', 'desk',
          (select coalesce(max(position), -1) + 1 from public.idpt_entries where event = p_event and section = v_section));
  return jsonb_build_object('status', 'ok');
end;
$$;

-- rows: [{"section","name","branch","roll","sap","division","year"}, ...]
create or replace function public.ev_import(p_pin text, p_event text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  r jsonb;
  v_name text; v_sap text; v_section text;
  fallback text;
  added int := 0; skipped int := 0;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if not exists (select 1 from public.events where slug = p_event) then return jsonb_build_object('status', 'not_found'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  fallback := case when p_event = 'idpt' then 'IDPT' else 'Participants' end;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_name := private.clean(r->>'name', 80);
    v_sap := private.clean(r->>'sap', 20);
    v_section := coalesce(nullif(private.clean(r->>'section', 40), ''), fallback);
    if length(v_name) < 2
       or (v_sap <> '' and exists (select 1 from public.idpt_entries where event = p_event and sap = v_sap and deleted_at is null))
       or (v_sap = '' and exists (select 1 from public.idpt_entries where event = p_event and sap = ''
                                   and lower(name) = lower(v_name) and section = v_section and deleted_at is null)) then
      skipped := skipped + 1;
      continue;
    end if;
    perform private.ev_ensure_section(p_event, v_section);
    insert into public.idpt_entries (event, section, name, branch, roll, sap, division, year, status, source, position)
    values (p_event, v_section, v_name, private.clean(r->>'branch', 12), private.clean(r->>'roll', 12), v_sap,
            private.clean(r->>'division', 10), private.clean(r->>'year', 4), 'approved', 'csv',
            (select coalesce(max(position), -1) + 1 from public.idpt_entries where event = p_event and section = v_section));
    added := added + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'added', added, 'skipped', skipped);
end;
$$;

create or replace function public.ev_pending(p_pin text, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object(
    'status', 'ok',
    'open', coalesce((select join_open and not archived from public.events where slug = p_event), false),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'section', e.section, 'name', e.name, 'branch', e.branch,
               'roll', e.roll, 'sap', e.sap, 'division', e.division, 'year', e.year, 'created_at', e.created_at)
             order by e.created_at)
        from public.idpt_entries e where e.event = p_event and e.status = 'pending' and e.deleted_at is null), '[]'::jsonb));
end;
$$;

create or replace function public.ev_bin(p_pin text, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  return jsonb_build_object(
    'status', 'ok',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'section', e.section, 'name', e.name, 'branch', e.branch,
               'roll', e.roll, 'sap', e.sap, 'state', e.status, 'deleted_at', e.deleted_at, 'deleted_by', e.deleted_by)
             order by e.deleted_at desc)
        from public.idpt_entries e where e.event = p_event and e.deleted_at is not null), '[]'::jsonb));
end;
$$;

-- These work on entry ids, so they cover every event.
create or replace function public.idpt_approve(p_pin text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  x record;
  n int;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  for x in select distinct event, section from public.idpt_entries
            where id = any(p_ids) and status = 'pending' and deleted_at is null loop
    perform private.ev_ensure_section(x.event, x.section);
  end loop;
  with todo as (
    select id, event, section, row_number() over (partition by event, section order by created_at) as rn
      from public.idpt_entries where id = any(p_ids) and status = 'pending' and deleted_at is null)
  update public.idpt_entries e
     set status = 'approved',
         position = (select coalesce(max(position), -1) from public.idpt_entries y
                      where y.event = todo.event and y.section = todo.section and y.status = 'approved') + todo.rn
    from todo where e.id = todo.id;
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'ok', 'approved', n);
end;
$$;

create or replace function public.idpt_restore(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_sap text; v_event text;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  select sap, event into v_sap, v_event from public.idpt_entries where id = p_id and deleted_at is not null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_sap <> '' and exists (select 1 from public.idpt_entries where event = v_event and sap = v_sap and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  update public.idpt_entries set deleted_at = null, deleted_by = null where id = p_id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- Older IDPT-only calls, kept for pages that haven't reloaded yet ----------
create or replace function public.idpt_join_info() returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_join_info('idpt'); $$;
create or replace function public.idpt_join(p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_join('idpt', p_name, p_sap, p_branch, p_year, p_roll, p_division, p_section); $$;
create or replace function public.idpt_add(p_pin text, p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_add(p_pin, 'idpt', p_name, p_sap, p_branch, p_year, p_roll, p_division, p_section); $$;
create or replace function public.idpt_import(p_pin text, p_rows jsonb) returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_import(p_pin, 'idpt', p_rows); $$;
create or replace function public.idpt_pending(p_pin text) returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_pending(p_pin, 'idpt'); $$;
create or replace function public.idpt_bin(p_pin text) returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_bin(p_pin, 'idpt'); $$;
create or replace function public.idpt_set_join(p_pin text, p_open boolean) returns jsonb language sql security definer set search_path = ''
as $$ select public.ev_set_join(p_pin, 'idpt', p_open); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ev_join_info(text)',
    'ev_join(text, text, text, text, text, text, text, text)',
    'ev_create(text, text)',
    'ev_rename(text, text, text)',
    'ev_archive(text, text, boolean)',
    'ev_set_join(text, text, boolean)',
    'ev_add(text, text, text, text, text, text, text, text, text)',
    'ev_import(text, text, jsonb)',
    'ev_pending(text, text)',
    'ev_bin(text, text)',
    'idpt_approve(text, uuid[])',
    'idpt_restore(text, uuid)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
