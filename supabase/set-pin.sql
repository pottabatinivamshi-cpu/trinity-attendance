-- ============================================================
-- Set or change the PIN for deleting and restoring names.
-- 1. Replace CHANGE-ME below with your PIN (8+ characters, letters and numbers).
-- 2. Click Run.
-- Run it again any time to change the PIN.
-- ============================================================

insert into private.admin (id, pin_hash)
values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;

delete from private.pin_failures;
