-- વર્ણી ધ્યાન — `profiles.status` is the સંચાલક's column, not the યુવક's.
--
-- What was wrong
-- --------------
-- 0004_rbac.sql:175 added `profiles.status` (ACTIVE / SUSPENDED / DISABLED) and gave it
-- teeth: `is_active_user()` reads it, and every write policy on `progress`,
-- `learning_state`, `learning_sessions` requires it (0004_rbac.sql:606-638), as does
-- `level4_submit()` (0010_level4_activities.sql). Suspending a યુવક is therefore a real
-- sanction — the account signs in and reads its history, and writes nothing.
--
-- But the policy that governs the column is "own profile updatable" (0004_rbac.sql:594):
--
--     for update using (id = auth.uid() or public.has_permission('users.update'))
--
-- `id = auth.uid()` is true for the suspended યુવક himself. Nothing else stood in the way:
-- `profiles_guard_immutable()` (0001) covers mobile, email, smk and created_at;
-- `profiles_guard_level4()` (0008) covers level4_unlocked. `status` was covered by nothing.
--
-- So the sanction was one request from being undone, by the only person with a motive:
--
--     PATCH /rest/v1/profiles?id=eq.<self>   {"status": "ACTIVE"}
--
-- No panel is involved and none is needed — the publishable key and the yuvak's own session
-- are enough, and both are in his browser by construction. The suspension would come back
-- ACTIVE, silently, and the સંચાલક's Users list would show a healthy account.
--
-- The fix, and why it corrects rather than raises
-- ----------------------------------------------
-- The same shape as `profiles_guard_level4()`, and for the same reason stated there.
-- `saveGateAnswers()` in src/lib/auth.jsx sends an ordinary UPDATE on this row; so does
-- every future profile edit. Raising here would fail those unrelated, legitimate writes and
-- reach the યુવક as a Gujarati error about something he did not do — §1 rule 4 rules that
-- out. Instead the column is pinned back to what it was: the write succeeds, everything
-- else in it lands, and `status` simply does not move.
--
-- A caller who may actually set it — anyone holding `users.update`, i.e. SUPER_ADMIN and
-- ADMIN — passes through untouched, which is how the panel's suspend/enable buttons keep
-- working. `auth.uid() is null` is a migration or the service_role key: server-side and
-- already trusted, exactly as `admin_profiles_guard()` (0004_rbac.sql:491) treats it.
--
-- Note this is strictly stronger than an RLS WITH CHECK could be. A policy sees the new row
-- and not the old one, so it cannot express "unchanged"; and a policy does not apply to
-- service_role, while a trigger does.

create or replace function public.profiles_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and not public.has_permission('users.update') then
    -- Claimed, not granted. The lifecycle of an account is the સંચાલક's to decide (§7 of
    -- the governance spec), and this is the only column on the row that is his.
    new.status := old.status;
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_status() is
  'Holds profiles.status to what the સંચાલક set. The "own profile updatable" policy lets a '
  'યુવક write his own row, so without this a SUSPENDED account could restore itself with '
  'one PATCH. Callers holding users.update pass through; so does service_role.';

-- Named to sort after `profiles_guard_immutable` and `profiles_guard_level4`: Postgres
-- fires BEFORE ROW triggers in name order, and the immutability guard is the one that must
-- see the row first — it is what stamps `updated_at`.
drop trigger if exists profiles_guard_status on public.profiles;

create trigger profiles_guard_status
  before update on public.profiles
  for each row execute function public.profiles_guard_status();

comment on column public.profiles.status is
  'ACTIVE / SUSPENDED / DISABLED — the સંચાલક''s decision (§7). Enforced by is_active_user() '
  'on every write policy, and held by profiles_guard_status(): no client write to this '
  'column by its own owner has any effect.';
