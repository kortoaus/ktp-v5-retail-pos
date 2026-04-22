#!/usr/bin/env bash
# Safe DB reset: backup data → prisma migrate reset → restore data.
#
# Needed when migration files were edited post-apply (checksum drift) but we
# don't want to lose local dev data.
#
# Skips:
#   - _prisma_migrations  (reset rebuilds it with fresh checksums)
#   - prisma seed         (data restore covers it)
#
# Requires: pg_dump, psql, node, npx in PATH.

set -euo pipefail

cd "$(dirname "$0")/.."  # → retail_pos_server/

if [[ ! -f .env ]]; then
  echo "Missing .env" >&2
  exit 1
fi
set -o allexport
# shellcheck disable=SC1091
source .env
set +o allexport

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL not set in .env" >&2
  exit 1
fi

# libpq-only URL — keep only the query params libpq recognises. Prisma adds its
# own (connection_limit, pool_timeout, uselibpqcompat, pgbouncer, schema, ...)
# which pg_dump/psql reject as "invalid URI query parameter".
LIBPQ_URL=$(node -e "
const LIBPQ = new Set([
  'host','hostaddr','port','dbname','user','password','passfile','channel_binding',
  'connect_timeout','client_encoding','options','application_name','fallback_application_name',
  'keepalives','keepalives_idle','keepalives_interval','keepalives_count','tcp_user_timeout',
  'replication','gssencmode','sslmode','sslcompression','sslcert','sslkey','sslpassword',
  'sslcertmode','sslrootcert','sslcrl','sslcrldir','sslsni','requirepeer','requiressl',
  'ssl_min_protocol_version','ssl_max_protocol_version','krbsrvname','gsslib',
  'gssdelegation','service','target_session_attrs','load_balance_hosts',
]);
const u = new URL(process.env.DATABASE_URL);
for (const k of [...u.searchParams.keys()]) {
  if (!LIBPQ.has(k)) u.searchParams.delete(k);
}
console.log(u.toString());
")
export LIBPQ_URL

BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/data_${STAMP}.sql"

echo "[1/3] Dumping data → $BACKUP_FILE"
pg_dump "$LIBPQ_URL" \
  --data-only \
  --disable-triggers \
  --exclude-table=_prisma_migrations \
  > "$BACKUP_FILE"
echo "      size: $(wc -c < "$BACKUP_FILE") bytes"

echo "[2/4] prisma migrate reset (rebuild schema + migration history)"
npx prisma migrate reset --force

echo "[3/4] Truncating user tables (clears any seed data pre-restore)"
psql "$LIBPQ_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  ) LOOP
    EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', r.tablename);
  END LOOP;
END $$;
SQL

echo "[4/4] Restoring data"
psql "$LIBPQ_URL" -v ON_ERROR_STOP=1 -f "$BACKUP_FILE"

echo "Done. Backup kept at: $BACKUP_FILE"
echo "Next: npx prisma migrate dev --name add_voucher"
