#!/bin/bash
# =====================================================================
# deploy_migrations.sh
# =====================================================================
# Backend engineering review (2026-09) flagged this as a known gap
# (also noted in SESSION_HANDOFF.md): every migration in this project
# has always been run by hand, one at a time, in the Supabase SQL
# editor. That's fine for occasional manual changes but doesn't scale
# and has no record of what's actually been applied to a given
# database. This script is a minimal, dependency-free alternative —
# NOT a replacement for a real migration framework (Supabase CLI
# migrations, Prisma, etc.) if this project grows enough to want one,
# but closes the "did we actually run everything, in order, exactly
# once" gap for now.
#
# What it does:
#   1. Connects to the target database via DATABASE_URL.
#   2. Ensures a `_migrations_applied` ledger table exists.
#   3. Runs schema.sql once, if the ledger is empty (fresh database).
#   4. Runs every 01..NN numbered migration file, IN ORDER, skipping
#      any whose filename is already recorded in the ledger.
#   5. Records each successfully-applied file in the ledger.
#   6. Stops immediately on the first failure (does not attempt the
#      rest of the chain against a database in an unknown state).
#
# Deliberately excluded from the numbered sequence (never auto-run):
#   - 16a_cleanup_before_rerun.sql — a manual repair script, not part
#     of the normal chain (see its own header comment).
#   - DB_CLEAR_KEEP_SUPERADMIN_AND_CHAIRMAN.sql, FULL_DATA_CLEAR.sql —
#     destructive one-off scripts, must always be run deliberately by
#     hand, never automatically.
#
# Usage:
#   DATABASE_URL="postgres://postgres:[password]@[host]:5432/postgres" \
#     ./deploy_migrations.sh
#
# Get DATABASE_URL from: Supabase Dashboard -> Project Settings ->
# Database -> Connection string (URI, "Session pooler" or direct).
# =====================================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: set DATABASE_URL first, e.g.:"
  echo '  DATABASE_URL="postgres://postgres:PASSWORD@HOST:5432/postgres" ./deploy_migrations.sh'
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install the PostgreSQL client (e.g. 'apt install postgresql-client')."
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DBDIR="$HERE/server/db"

psql_run() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

psql_exec() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$1"
}

echo "== Ensuring migration ledger exists =="
psql_exec "create table if not exists public._migrations_applied (filename text primary key, applied_at timestamptz not null default now());"

ALREADY_HAS_ROWS=$(psql "$DATABASE_URL" -tA -c "select count(*) from public._migrations_applied;")

if [ "$ALREADY_HAS_ROWS" -eq 0 ]; then
  echo "== Ledger is empty — checking whether this looks like a fresh database =="
  TASKS_TABLE_EXISTS=$(psql "$DATABASE_URL" -tA -c "select to_regclass('public.tasks') is not null;")
  if [ "$TASKS_TABLE_EXISTS" = "f" ]; then
    echo "-- applying schema.sql (fresh database)"
    psql_run "$DBDIR/schema.sql"
  else
    echo "-- public.tasks already exists but the ledger is empty."
    echo "   Assuming schema.sql + earlier migrations were already applied by hand"
    echo "   (this project's history before this script existed). Backfilling the"
    echo "   ledger with every migration file up to (not including) this run, so"
    echo "   they're not re-applied. Ctrl-C now if that assumption is wrong."
    read -p "   Press Enter to continue, or Ctrl-C to abort... "
  fi
fi

echo "== Applying numbered migrations in order =="
for f in "$DBDIR"/[0-9]*_*.sql; do
  filename="$(basename "$f")"

  # Never auto-run the manual repair script.
  if [ "$filename" = "16a_cleanup_before_rerun.sql" ]; then
    continue
  fi

  ALREADY_APPLIED=$(psql "$DATABASE_URL" -tA -c "select exists(select 1 from public._migrations_applied where filename = '$filename');")
  if [ "$ALREADY_APPLIED" = "t" ]; then
    echo "-- skipping $filename (already applied)"
    continue
  fi

  echo "-- applying $filename"
  psql_run "$f"
  psql_exec "insert into public._migrations_applied (filename) values ('$filename');"
done

echo "== All migrations applied. Current ledger: =="
psql "$DATABASE_URL" -c "select filename, applied_at from public._migrations_applied order by applied_at;"
