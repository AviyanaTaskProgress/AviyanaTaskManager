#!/bin/bash
# Rebuilds the aviyana_harness database from scratch and applies every
# migration in the exact order they'd run against a real Supabase
# project, unmodified. Fails fast (set -e) so a broken migration stops
# the run instead of masking the error.
set -e

DB=aviyana_harness
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DBDIR="$HERE/db"

echo "== Dropping + recreating $DB =="
su postgres -c "psql -c 'DROP DATABASE IF EXISTS $DB;'"
su postgres -c "psql -c 'CREATE DATABASE $DB;'"

run() {
  echo "-- applying $1"
  su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f '$DBDIR/$1'"
}

run 00_supabase_mocks.sql
run schema.sql

for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38; do
  f=$(ls "$DBDIR" | grep -E "^${n}_.*\.sql$" | head -1)
  if [ -z "$f" ]; then
    echo "!! no migration file found for prefix $n — aborting"
    exit 1
  fi
  run "$f"
done

run 90_seed_test_users.sql
run 99_test_helpers.sql

echo "== All migrations applied cleanly =="

echo ""
echo "== Running 91_new_feature_tests.sql =="
run 91_new_feature_tests.sql
