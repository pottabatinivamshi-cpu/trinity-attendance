-- ============================================================
-- Trinity Attendance Letters: delete forever from the bins
-- Run this after events.sql. Safe to run again.
-- Only names already in a bin can be deleted forever. This can't be undone.
-- ============================================================

-- Trinity Team bin: one department entry
create or replace function public.purge_member(p_pin text, p_dept text, p_grp text, p_member text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  delete from public.memberships
   where dept = p_dept and grp = p_grp and member_id = p_member and deleted_at is not null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Trinity Team bin: everything in it
create or replace function public.empty_bin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  n int;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  delete from public.memberships where deleted_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'ok', 'deleted', n);
end;
$$;

-- IDPT / event bin: one entry
create or replace function public.ev_purge(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  delete from public.idpt_entries where id = p_id and deleted_at is not null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- IDPT / event bin: everything in it for one event
create or replace function public.ev_empty_bin(p_pin text, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := private.check_pin(p_pin);
  n int;
begin
  if s <> 'ok' then return jsonb_build_object('status', s); end if;
  delete from public.idpt_entries where event = p_event and deleted_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'ok', 'deleted', n);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'purge_member(text, text, text, text)',
    'empty_bin(text)',
    'ev_purge(text, uuid)',
    'ev_empty_bin(text, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
