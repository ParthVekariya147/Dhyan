-- Fields the learning journey tracks that 0001 did not carry over from Firestore.
--
-- `session_id` is the deterministic round id (§15) — derived from the user and the round
-- number, so a retried submit computes the same id the first attempt used instead of
-- creating a second session row.

alter table public.learning_state
  add column if not exists session_id      text,
  add column if not exists total_at_submit integer not null default 0
    check (total_at_submit >= 0);

alter table public.learning_sessions
  add column if not exists submitted_at timestamptz,
  add column if not exists completed_at timestamptz;
