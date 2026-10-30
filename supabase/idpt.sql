-- ============================================================
-- Trinity Attendance Letters: IDPT Sports lists
-- Run this after setup.sql. Safe to run again.
-- Kept fully separate from the Core / Co-Com tables.
-- ============================================================

create table if not exists public.idpt_sections (
  name     text primary key,
  position int  not null default 0
);

create table if not exists public.idpt_entries (
  id         uuid primary key default gen_random_uuid(),
  section    text not null,
  name       text not null,
  branch     text not null default '',
  roll       text not null default '',
  sap        text not null default '',
  division   text not null default '',
  year       text not null default '',
  status     text not null default 'approved' check (status in ('approved', 'pending')),
  source     text not null default 'desk' check (source in ('csv', 'desk', 'qr')),
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);
create index if not exists idpt_entries_sap on public.idpt_entries (sap) where deleted_at is null;

alter table public.idpt_sections enable row level security;
alter table public.idpt_entries  enable row level security;

-- Anyone can read approved entries. Pending sign-ups stay hidden until core approves them.
drop policy if exists "Anyone can read approved IDPT entries" on public.idpt_entries;
create policy "Anyone can read approved IDPT entries" on public.idpt_entries
  for select to anon, authenticated using (status = 'approved' and deleted_at is null);

drop policy if exists "Anyone can read IDPT sections" on public.idpt_sections;
create policy "Anyone can read IDPT sections" on public.idpt_sections
  for select to anon, authenticated using (true);

grant select on public.idpt_sections, public.idpt_entries to anon, authenticated;

-- ---------- Private settings ----------
create table if not exists private.settings (
  id        int primary key default 1 check (id = 1),
  join_open boolean not null default true
);
insert into private.settings (id) values (1) on conflict (id) do nothing;

create table if not exists private.join_log (
  at timestamptz not null default now()
);

-- Adds a section to the end of the list if it isn't there yet.
create or replace function private.idpt_ensure_section(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.idpt_sections (name, position)
  select p_name, coalesce(max(position), -1) + 1 from public.idpt_sections
  on conflict (name) do nothing;
$$;
revoke all on function private.idpt_ensure_section(text) from public, anon, authenticated;

create or replace function private.clean(p text, p_max int)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), p_max);
$$;
revoke all on function private.clean(text, int) from public, anon, authenticated;

-- ---------- Public: QR registration ----------
create or replace function public.idpt_join_info()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open', (select join_open from private.settings where id = 1),
    'sections', coalesce((select jsonb_agg(name order by position) from public.idpt_sections), '[]'::jsonb));
$$;

create or replace function public.idpt_join(
  p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean(p_name, 80);
  v_sap text := private.clean(p_sap, 20);
  v_section text := private.clean(p_section, 40);
  recent int;
begin
  if not (select join_open from private.settings where id = 1) then
    return jsonb_build_object('status', 'closed');
  end if;
  if length(v_name) < 2 or v_sap !~ '^[0-9]{11}$' or length(v_section) < 1
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
  if (select count(*) from public.idpt_entries where status = 'pending' and deleted_at is null) >= 500 then
    return jsonb_build_object('status', 'full');
  end if;
  if exists (select 1 from public.idpt_entries where sap = v_sap and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  insert into public.idpt_entries (section, name, branch, roll, sap, division, year, status, source)
  values (v_section, v_name, p_branch, private.clean(p_roll, 12), v_sap, private.clean(p_division, 10), p_year, 'pending', 'qr');
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- Core only (PIN) ----------
create or replace function public.idpt_add(
  p_pin text, p_name text, p_sap text, p_branch text, p_year text, p_roll text, p_division text, p_section text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_name text := private.clean(p_name, 80);
  v_sap text := private.clean(p_sap, 20);
  v_section text := private.clean(p_section, 40);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if length(v_name) < 2 or v_sap !~ '^[0-9]{11}$' or length(v_section) < 1 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.idpt_entries where sap = v_sap and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  perform private.idpt_ensure_section(v_section);
  insert into public.idpt_entries (section, name, branch, roll, sap, division, year, status, source, position)
  values (v_section, v_name, private.clean(p_branch, 12), private.clean(p_roll, 12), v_sap,
          private.clean(p_division, 10), private.clean(p_year, 4), 'approved', 'desk',
          (select coalesce(max(position), -1) + 1 from public.idpt_entries where section = v_section));
  return jsonb_build_object('status', 'ok');
end;
$$;

-- rows: [{"section","name","branch","roll","sap","division","year"}, ...]
create or replace function public.idpt_import(p_pin text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  r jsonb;
  v_name text; v_sap text; v_section text;
  added int := 0; skipped int := 0;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_name := private.clean(r->>'name', 80);
    v_sap := private.clean(r->>'sap', 20);
    v_section := coalesce(nullif(private.clean(r->>'section', 40), ''), 'IDPT');
    if length(v_name) < 2
       or (v_sap <> '' and exists (select 1 from public.idpt_entries where sap = v_sap and deleted_at is null))
       or (v_sap = '' and exists (select 1 from public.idpt_entries
                                   where sap = '' and lower(name) = lower(v_name) and section = v_section and deleted_at is null)) then
      skipped := skipped + 1;
      continue;
    end if;
    perform private.idpt_ensure_section(v_section);
    insert into public.idpt_entries (section, name, branch, roll, sap, division, year, status, source, position)
    values (v_section, v_name, private.clean(r->>'branch', 12), private.clean(r->>'roll', 12), v_sap,
            private.clean(r->>'division', 10), private.clean(r->>'year', 4), 'approved', 'csv',
            (select coalesce(max(position), -1) + 1 from public.idpt_entries where section = v_section));
    added := added + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'added', added, 'skipped', skipped);
end;
$$;

create or replace function public.idpt_pending(p_pin text)
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
    'open', (select join_open from private.settings where id = 1),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'section', e.section, 'name', e.name, 'branch', e.branch,
               'roll', e.roll, 'sap', e.sap, 'division', e.division, 'year', e.year, 'created_at', e.created_at)
             order by e.created_at)
        from public.idpt_entries e where e.status = 'pending' and e.deleted_at is null), '[]'::jsonb));
end;
$$;

create or replace function public.idpt_approve(p_pin text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  sec text;
  n int;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  for sec in select distinct section from public.idpt_entries
              where id = any(p_ids) and status = 'pending' and deleted_at is null loop
    perform private.idpt_ensure_section(sec);
  end loop;
  with todo as (
    select id, section, row_number() over (partition by section order by created_at) as rn
      from public.idpt_entries where id = any(p_ids) and status = 'pending' and deleted_at is null)
  update public.idpt_entries e
     set status = 'approved',
         position = (select coalesce(max(position), -1) from public.idpt_entries x
                      where x.section = todo.section and x.status = 'approved') + todo.rn
    from todo where e.id = todo.id;
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'ok', 'approved', n);
end;
$$;

-- Deleting an approved entry, or rejecting a pending one, sends it to the bin.
create or replace function public.idpt_delete(p_pin text, p_id uuid, p_by text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  update public.idpt_entries
     set deleted_at = now(), deleted_by = nullif(private.clean(p_by, 60), '')
   where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Restoring puts an entry back where it was: approved ones back on the list, rejected ones back in Pending.
create or replace function public.idpt_restore(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  v_sap text;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  select sap into v_sap from public.idpt_entries where id = p_id and deleted_at is not null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_sap <> '' and exists (select 1 from public.idpt_entries where sap = v_sap and deleted_at is null) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  update public.idpt_entries set deleted_at = null, deleted_by = null where id = p_id;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.idpt_bin(p_pin text)
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
        from public.idpt_entries e where e.deleted_at is not null), '[]'::jsonb));
end;
$$;

create or replace function public.idpt_set_join(p_pin text, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  update private.settings set join_open = coalesce(p_open, false) where id = 1;
  return jsonb_build_object('status', 'ok', 'open', coalesce(p_open, false));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'idpt_join_info()',
    'idpt_join(text, text, text, text, text, text, text)',
    'idpt_add(text, text, text, text, text, text, text, text)',
    'idpt_import(text, jsonb)',
    'idpt_pending(text)',
    'idpt_approve(text, uuid[])',
    'idpt_delete(text, uuid, text)',
    'idpt_restore(text, uuid)',
    'idpt_bin(text)',
    'idpt_set_join(text, boolean)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
