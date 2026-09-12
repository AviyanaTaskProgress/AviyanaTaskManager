# Aviyana RLS Test Harness — rebuilt from scratch (this session)

The previous `rls_test_harness.zip` (from an earlier session) wasn't available
this time, so this is a fresh Postgres 16 harness built to run the real
`server/db/*.sql` files unmodified. It does NOT contain the original 27 tests
from before — only 21 new tests covering this session's 5 new migrations
(27-31: subtasks, task_display_id, payment workflow, assigned_by_id +
tasks_completed counter, staff self-log RLS fix).

## Requirements
- Postgres 16 (`apt install postgresql-16 postgresql-contrib-16`)
- Run as a user that can `sudo`/`su postgres` (script uses `su postgres -c psql ...`)

## One-time setup (only needed once per machine)
The harness needs two dummy extension stubs installed into Postgres's
extension directory, since real `pg_net`/`http` (Supabase-specific
extensions) aren't available outside Supabase Cloud:

```
EXT_DIR=/usr/share/postgresql/16/extension
# pg_net.control / pg_net--0.1.sql / http.control / http--0.1.sql
# — copy these four files (included in db/../pg_net_http_stubs/) into $EXT_DIR
```//placeholder, see db/00_supabase_mocks.sql comments for exactly what each stub needs to provide.

## Running
```
./run_all.sh
```
Rebuilds `aviyana_harness` from a blank database every time: drops it, creates
it, runs `00_supabase_mocks.sql` (Supabase environment shim: auth/storage
schemas, roles, grants, pg_net/http stubs), `schema.sql`, every migration
`01`-`31` in order, seeds 8 test users (one per role + a second Engineering
staff for reassignment tests) via `90_seed_test_users.sql`, installs
`test_act_as()`/`assert_true()` helpers via `99_test_helpers.sql`, then runs
`91_new_feature_tests.sql` (21 assertions).

Exit code 0 + "ALL 91_new_feature_tests.sql ASSERTIONS PASSED" = clean run.
Any FAIL raises immediately (`ON_ERROR_STOP=1`) and stops right at the
failing assertion.

## Files
- `db/00_supabase_mocks.sql` — Supabase environment shim (auth.uid(), storage,
  roles/grants, pg_net/http stubs, storage.foldername()).
- `db/schema.sql`, `db/01..31_*.sql` — the real project migrations, copied
  verbatim from `server/db/`.
- `db/90_seed_test_users.sql` — 8 test users, one per role.
- `db/99_test_helpers.sql` — `test_act_as(email)` / `test_act_as_anon()` /
  `test_reset_role()` procedures + `assert_true(cond, msg)`.
- `db/91_new_feature_tests.sql` — the 21 regression tests for this session.

## Extending this harness
Add a new numbered test file (`92_...sql` etc.) and a `run 92_...sql` line
near the bottom of `run_all.sh`, following the pattern in
`91_new_feature_tests.sql` — `call test_act_as('email@test.local');` to act as
a given role, do the write, `call test_reset_role();`, then assert with
`perform assert_true(condition, 'description');`.
