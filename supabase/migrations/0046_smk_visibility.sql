-- વર્ણી ધ્યાન — the SMK becomes something a role may or may not be shown.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR
-- ════════════════════════════════════════════════════════════════════════════
--
-- The SMK is a યુવક's membership number. It appears as a column in seven of the panel's
-- tables — the યુવક list, Progress, the Point Ledger, Daily Activity, Daily Records, the
-- લેવલ ૩ report and the Leaderboard — and in two Excel exports. Every one of those is a
-- *bulk* view: one screen hands somebody two thousand membership numbers, and every export
-- puts them in a file that leaves the panel and is not governed after that.
--
-- Whether a particular સંચાલક needs that is a decision about him, not about the schema. A
-- person given the panel to watch the leaderboard has no business holding the roll; the
-- person running રજિસ્ટ્રેશન plainly does. Until now it was neither — everybody who could
-- open a list saw every number on it, and there was no way to say otherwise.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IT IS NOT
-- ════════════════════════════════════════════════════════════════════════════
--
-- **This is a display permission, and it is not a security boundary.** It has to be said
-- plainly, here, because a permission that looks like one and is not is worse than no
-- permission at all.
--
-- `users.read` is what governs `public.profiles`, and `smk` is a column of that table. Anyone
-- holding `users.read` can read it over PostgREST directly, with or without this permission —
-- the RLS policy is per row, not per column, and adding column-level masking would mean
-- rewriting `public.yuvaks` and the nine reporting functions 0040 re-issued to read it, to
-- withhold a number from people who are already trusted with the name, the mobile number and
-- the entire learning record beside it.
--
-- So what this governs is exposure in bulk on a screen and in a file, which is the thing that
-- was actually asked for and the thing that actually leaks. It sits with `users.export`,
-- `video.update` and the rest of the list in scripts/test-permission-catalogue.mjs's UI_ONLY
-- — permissions whose enforcement is a broader one on the same table, recorded as such rather
-- than left to look like something they are not.
--
-- ── One place it deliberately does not apply ────────────────────────────────
--
-- The single-user detail page. Opening one person, by name, having already found him, is the
-- opposite of bulk: he was deliberately looked up by somebody who can already see his name,
-- his number, his zone and every દર્શન he has done. Hiding one field there would be a
-- ceremony rather than a control, and it would make the panel unable to answer "which SMK is
-- this?" for the one person it is being asked about.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE PERMISSION
-- ════════════════════════════════════════════════════════════════════════════

insert into public.permissions (key, resource, verb, label, description, is_section, sort) values
  ('users.smk.read', 'users', 'smk.read', 'See SMK numbers in lists',
   'Show the SMK column in the યુવક list, the reports and the exports. Without it those tables '
   'simply have no SMK column. One person opened on his own page still shows his.',
   false, 145)
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. GRANTED TO EVERYONE WHO CAN SEE THE LIST TODAY
-- ════════════════════════════════════════════════════════════════════════════
--
-- Same rule 0043 seeded its twenty-seven splits by: a new permission goes to exactly the roles
-- that already held the coarse one it was carved out of, so nobody gains or loses anything on
-- the day it ships. Here that is `users.read` — the permission that opens the list the column
-- is in.
--
-- Which is to say this migration changes nothing on its own, deliberately. It makes the column
-- *controllable*; deciding that a Viewer should not see it is a decision for the person running
-- the panel, made on the Roles screen, and it takes one tick.

insert into public.role_permissions (role_key, permission)
select rp.role_key, 'users.smk.read'
from public.role_permissions rp
where rp.permission = 'users.read'
on conflict do nothing;

-- SUPER_ADMIN holds the whole catalogue by definition, and role_permissions_guard() enforces
-- that from here on — but the row has to exist for the guard's own statement to be true.
insert into public.role_permissions (role_key, permission)
values ('SUPER_ADMIN', 'users.smk.read')
on conflict do nothing;

do $$
declare
  r record;
begin
  raise notice '[0046] users.smk.read added. It hides the SMK *column* in lists and exports;';
  raise notice '[0046] it is not column security - users.read still reads the column over the API.';
  raise notice '[0046]';
  raise notice '[0046] Granted to every role that already holds users.read, so nothing changes today:';
  for r in
    select role_key from public.role_permissions
    where permission = 'users.smk.read' order by role_key
  loop
    raise notice '[0046]   %', r.role_key;
  end loop;
  raise notice '[0046]';
  raise notice '[0046] To hide it from a role, untick "See SMK numbers in lists" on Access -> Roles.';
end
$$;
