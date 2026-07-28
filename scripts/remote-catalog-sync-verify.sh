#!/usr/bin/env bash
#
# remote-catalog-sync-verify.sh — Runsheet §8 remote catalog down-sync + verification.
#
# PURPOSE
#   Run this ON a store's server (via SSH) during the item-server absorption
#   cutover, when nobody can physically stand at the till to press the POS
#   app's 동기화 (sync) button. It triggers the exact same down-sync the
#   button triggers, then verifies it against GATE 11 / GATE 12 of the
#   runsheet.
#
# WHAT IT DOES (in order)
#   1. Records a BEFORE baseline from the local Postgres: Item count,
#      max(updatedAt), duplicate-barcode group count.
#   2. Triggers POST /api/cloud/migrate/item on the local retail_pos_server
#      (the same call SyncButton makes) with the ip-address header of a
#      registered terminal, so it passes terminalMiddleware.
#   3. Polls the local DB (synchronous sleep loop, no background jobs) until
#      the Item table's row count and max(updatedAt) both stop moving across
#      two consecutive polls, or a timeout is hit.
#   4. Evaluates GATE 11 (received data) and GATE 12 (duplicate barcodes
#      unchanged), prints brand/category counts for eyeball comparison, and
#      exits non-zero with a loud FAIL line if anything failed.
#
# READ-ONLY ON THE DB. The only mutating action this script performs is
# triggering the sync endpoint itself (POST /api/cloud/migrate/item) — a
# normal daily operation, not something special to this script.
#
# USAGE
#   ./remote-catalog-sync-verify.sh [EXPECTED_ITEM_COUNT]
#
#   EXPECTED_ITEM_COUNT   optional. If given, GATE 11 also requires the
#                         post-sync Item count to equal this number exactly.
#                         If omitted, the count is just printed for eyeball
#                         comparison against the cloud figure.
#
# ENV OVERRIDES (all optional — auto-derived from retail_pos_server/.env and
# docker-compose.yml; override any of these if a particular store's box
# differs from the standard layout)
#   REPO_DIR            path to the ktpv5-pos-retail checkout
#                        (default: parent directory of this script)
#   PG_CONTAINER         docker container name for local postgres
#                        (default: retail_pos_local_postgres)
#   DB_USER DB_PASSWORD DB_NAME
#                        local postgres credentials/db name
#                        (default: parsed from retail_pos_server/.env
#                        DATABASE_URL, falling back to the docker-compose.yml
#                        defaults: ktpv5 / 510935 / retail_pos_local_dev)
#   SERVER_URL           base URL of the local retail_pos_server
#                        (default: http://localhost:2200)
#   TRIGGER_MAX_TIME_SEC  max seconds to wait on the trigger HTTP call itself
#                        before giving up on it and falling back to DB
#                        polling (default: 120)
#   POLL_INTERVAL_SEC    seconds between DB polls (default: 10)
#   POLL_TIMEOUT_SEC     overall timeout for the wait step (default: 600 = 10 min)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SERVER_DIR="$REPO_DIR/retail_pos_server"
ENV_FILE="$SERVER_DIR/.env"

EXPECTED_ITEM_COUNT="${1:-}"

PG_CONTAINER="${PG_CONTAINER:-retail_pos_local_postgres}"
SERVER_URL="${SERVER_URL:-http://localhost:2200}"
TRIGGER_MAX_TIME_SEC="${TRIGGER_MAX_TIME_SEC:-120}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-10}"
POLL_TIMEOUT_SEC="${POLL_TIMEOUT_SEC:-600}"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$LOG_DIR/catalog-sync-verify_${STAMP}.log"

log() {
  echo "$@" | tee -a "$LOG_FILE"
}

log "===================================================================="
log " Runsheet §8 remote catalog sync verification — $(date -Iseconds)"
log " repo:   $REPO_DIR"
log " log:    $LOG_FILE"
log "===================================================================="

# ---------------------------------------------------------------------------
# Derive local Postgres connection details.
#
# Store machines use the same docker layout/addresses/credentials as this
# repo's dev setup (docker-compose.yml: container retail_pos_local_postgres,
# host port 5555, db retail_pos_local_dev, user ktpv5). We read
# retail_pos_server/.env's DATABASE_URL for the same values so an override
# there (different password, different db name) is picked up automatically,
# and fall back to the docker-compose.yml defaults if .env is missing or the
# URL doesn't parse.
# ---------------------------------------------------------------------------

DB_USER_DEFAULT="ktpv5"
DB_PASSWORD_DEFAULT="510935"
DB_NAME_DEFAULT="retail_pos_local_dev"

PARSED_USER=""
PARSED_PASSWORD=""
PARSED_NAME=""

if [[ -f "$ENV_FILE" ]]; then
  DATABASE_URL_RAW="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"'"'"'')"
  if [[ "$DATABASE_URL_RAW" =~ ^postgresql://([^:]+):([^@]+)@[^/]+/([^?]+) ]]; then
    PARSED_USER="${BASH_REMATCH[1]}"
    PARSED_PASSWORD="${BASH_REMATCH[2]}"
    PARSED_NAME="${BASH_REMATCH[3]}"
  fi
fi

DB_USER="${DB_USER:-${PARSED_USER:-$DB_USER_DEFAULT}}"
DB_PASSWORD="${DB_PASSWORD:-${PARSED_PASSWORD:-$DB_PASSWORD_DEFAULT}}"
DB_NAME="${DB_NAME:-${PARSED_NAME:-$DB_NAME_DEFAULT}}"

log "DB target: container=$PG_CONTAINER db=$DB_NAME user=$DB_USER"

if ! command -v docker >/dev/null 2>&1; then
  log "FATAL: docker command not found on this host."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  log "FATAL: container '$PG_CONTAINER' is not running (docker ps found no match)."
  log "       Check PG_CONTAINER env override or 'docker ps' on this host."
  exit 1
fi

# pg <sql>  — run a single read-only scalar/row query, tuples-only, unaligned.
pg() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -tAc "$1"
}

# ---------------------------------------------------------------------------
# Step 1 — Pre-sync baseline (GATE 12 needs a BEFORE measurement)
# ---------------------------------------------------------------------------

log ""
log "---- [1/4] Pre-sync baseline ----"

PRE_COUNT="$(pg 'SELECT count(*) FROM "Item";')"
PRE_MAX_UPDATED="$(pg 'SELECT COALESCE(max("updatedAt")::text, '"'"'(none)'"'"') FROM "Item";')"
PRE_MAX_EPOCH="$(pg 'SELECT COALESCE(extract(epoch from max("updatedAt")), 0) FROM "Item";')"
PRE_DUP="$(pg 'SELECT count(*) FROM (SELECT barcode FROM "Item" WHERE archived=false AND barcode IS NOT NULL AND barcode<>'"'"''"'"' GROUP BY barcode HAVING count(*)>1) t;')"

log "  Item count           : $PRE_COUNT"
log "  Item max(updatedAt)   : $PRE_MAX_UPDATED"
log "  Duplicate-barcode groups (baseline, GATE 12): $PRE_DUP"

# ---------------------------------------------------------------------------
# Step 2 — Trigger the catalog down-sync
#
# This is exactly what the POS app's SyncButton does
# (retail_pos_app/src/renderer/src/service/cloud.service.ts):
#   apiService.post("/api/cloud/migrate/item")
# which hits retail_pos_server's POST /api/cloud/migrate/item
# (src/v1/cloud/cloud.router.ts -> cloud.migrate.controller.ts), running
# company -> category -> brand -> item -> price -> promo-price ->
# barcode-normalise -> hotkey sequentially against api-server's
# /device/migrate/* endpoints, entirely server-side (device key lives only
# in retail_pos_server/.env, never sent by us here).
#
# The ONLY auth this local route needs is terminalMiddleware, which trusts a
# client-supplied `ip-address` header matched against an existing, non-
# archived Terminal row (src/v1/terminal.middleware.ts) — no user/scope
# auth is applied to /api/cloud/*. We read a valid terminal ip straight out
# of the local DB so we don't have to know it in advance.
# ---------------------------------------------------------------------------

log ""
log "---- [2/4] Trigger catalog down-sync ----"

TERMINAL_IP="$(pg 'SELECT "ipAddress" FROM "Terminal" WHERE archived=false ORDER BY id LIMIT 1;')"

if [[ -z "$TERMINAL_IP" ]]; then
  log "FATAL: no non-archived Terminal row found locally — cannot pass terminalMiddleware."
  log "       (POST /api/cloud/migrate/item requires an 'ip-address' header matching a"
  log "       registered Terminal; this store has none.)"
  exit 1
fi

log "  Using ip-address: $TERMINAL_IP (from local Terminal table)"
log "  POST $SERVER_URL/api/cloud/migrate/item (max ${TRIGGER_MAX_TIME_SEC}s wait on the HTTP call itself)"

TRIGGER_HTTP_CODE="0"
TRIGGER_BODY=""
set +e
TRIGGER_RESPONSE="$(curl -sS -X POST "$SERVER_URL/api/cloud/migrate/item" \
  -H "ip-address: $TERMINAL_IP" \
  -H "Content-Type: application/json" \
  --max-time "$TRIGGER_MAX_TIME_SEC" \
  -w $'\n__HTTP_STATUS__:%{http_code}' 2>&1)"
CURL_EXIT=$?
set -e

if [[ $CURL_EXIT -eq 0 ]]; then
  TRIGGER_HTTP_CODE="$(echo "$TRIGGER_RESPONSE" | grep -o '__HTTP_STATUS__:[0-9]*' | cut -d: -f2)"
  TRIGGER_BODY="$(echo "$TRIGGER_RESPONSE" | sed 's/__HTTP_STATUS__:[0-9]*$//')"
  log "  Trigger call returned HTTP $TRIGGER_HTTP_CODE: $TRIGGER_BODY"
else
  log "  WARNING: trigger HTTP call did not complete within ${TRIGGER_MAX_TIME_SEC}s (curl exit $CURL_EXIT)."
  log "  This is NOT necessarily a failure — the migrate controller keeps running"
  log "  server-side even if our curl gives up waiting on the response. Falling"
  log "  through to DB polling to determine real completion."
fi

# ---------------------------------------------------------------------------
# Step 3 — Wait for completion: poll local DB (synchronous, no background jobs)
#
# The migrate controller writes Item rows in two passes (upsert, then a
# parentId-fixup pass over every item) before moving on to price/promo-price/
# hotkey stages that do not touch the Item table further. So Item count +
# max(updatedAt) settling is a reliable "item stage done" signal even if the
# HTTP call above is still open or timed out.
# ---------------------------------------------------------------------------

log ""
log "---- [3/4] Poll local DB until stable (timeout ${POLL_TIMEOUT_SEC}s) ----"

PREV_COUNT="-1"
PREV_EPOCH="-1"
ELAPSED=0
STABLE="false"

while [[ $ELAPSED -le $POLL_TIMEOUT_SEC ]]; do
  CUR_COUNT="$(pg 'SELECT count(*) FROM "Item";')"
  CUR_EPOCH="$(pg 'SELECT COALESCE(extract(epoch from max("updatedAt")), 0) FROM "Item";')"

  log "  [t=${ELAPSED}s] Item count=$CUR_COUNT max(updatedAt)_epoch=$CUR_EPOCH"

  ADVANCED="$(awk -v a="$CUR_EPOCH" -v b="$PRE_MAX_EPOCH" 'BEGIN{print (a>b)?1:0}')"

  if [[ "$PREV_COUNT" == "$CUR_COUNT" && "$PREV_EPOCH" == "$CUR_EPOCH" && "$ADVANCED" == "1" ]]; then
    STABLE="true"
    break
  fi

  PREV_COUNT="$CUR_COUNT"
  PREV_EPOCH="$CUR_EPOCH"
  sleep "$POLL_INTERVAL_SEC"
  ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))
done

if [[ "$STABLE" == "true" ]]; then
  log "  Stable: Item count and max(updatedAt) unchanged across two consecutive polls, and advanced past baseline."
else
  log "  WARNING: did not observe a stable, advanced state within ${POLL_TIMEOUT_SEC}s. Proceeding to gates with current values — investigate this store manually."
fi

# ---------------------------------------------------------------------------
# Step 4 — Post-sync gates
# ---------------------------------------------------------------------------

log ""
log "---- [4/4] Post-sync gates ----"

POST_COUNT="$(pg 'SELECT count(*) FROM "Item";')"
POST_MAX_UPDATED="$(pg 'SELECT COALESCE(max("updatedAt")::text, '"'"'(none)'"'"') FROM "Item";')"
POST_MAX_EPOCH="$(pg 'SELECT COALESCE(extract(epoch from max("updatedAt")), 0) FROM "Item";')"
POST_DUP="$(pg 'SELECT count(*) FROM (SELECT barcode FROM "Item" WHERE archived=false AND barcode IS NOT NULL AND barcode<>'"'"''"'"' GROUP BY barcode HAVING count(*)>1) t;')"
BRAND_COUNT="$(pg 'SELECT count(*) FROM "Brand";')"
CATEGORY_COUNT="$(pg 'SELECT count(*) FROM "Category";')"

GATE11_PASS="true"
GATE11_REASON=""

if [[ "$POST_COUNT" -le 0 ]]; then
  GATE11_PASS="false"
  GATE11_REASON="post-sync Item count is $POST_COUNT (expected > 0)"
fi

ADVANCED_FINAL="$(awk -v a="$POST_MAX_EPOCH" -v b="$PRE_MAX_EPOCH" 'BEGIN{print (a>b)?1:0}')"
if [[ "$ADVANCED_FINAL" != "1" ]]; then
  GATE11_PASS="false"
  GATE11_REASON="${GATE11_REASON:+$GATE11_REASON; }max(updatedAt) did not advance past baseline ($PRE_MAX_UPDATED -> $POST_MAX_UPDATED)"
fi

if [[ -n "$EXPECTED_ITEM_COUNT" ]]; then
  if [[ "$POST_COUNT" != "$EXPECTED_ITEM_COUNT" ]]; then
    GATE11_PASS="false"
    GATE11_REASON="${GATE11_REASON:+$GATE11_REASON; }count $POST_COUNT != expected $EXPECTED_ITEM_COUNT"
  fi
fi

GATE12_PASS="true"
if [[ "$POST_DUP" != "$PRE_DUP" ]]; then
  GATE12_PASS="false"
fi

log ""
log "GATE 11 (수신 데이터 검증 — Item count > 0, cloud와 비교, updatedAt 갱신 확인)"
log "  post-sync Item count  : $POST_COUNT$( [[ -n "$EXPECTED_ITEM_COUNT" ]] && echo " (expected: $EXPECTED_ITEM_COUNT)" || echo " (no expected count given — eyeball against cloud figure)" )"
log "  pre-sync max(updatedAt) : $PRE_MAX_UPDATED"
log "  post-sync max(updatedAt): $POST_MAX_UPDATED"
if [[ "$GATE11_PASS" == "true" ]]; then
  log "  GATE 11: PASS ✅"
else
  log "  GATE 11: FAIL ❌ — $GATE11_REASON"
fi

log ""
log "GATE 12 (중복 바코드 그룹 수 — 동기화 전후 동일해야 함)"
log "  pre-sync duplicate-barcode groups : $PRE_DUP"
log "  post-sync duplicate-barcode groups: $POST_DUP"
if [[ "$GATE12_PASS" == "true" ]]; then
  log "  GATE 12: PASS ✅"
else
  log "  GATE 12: FAIL ❌ — pre=$PRE_DUP post=$POST_DUP (should be equal)"
fi

log ""
log "Eyeball reference:"
log "  Brand count    : $BRAND_COUNT"
log "  Category count : $CATEGORY_COUNT"

log ""
log "===================================================================="
if [[ "$GATE11_PASS" == "true" && "$GATE12_PASS" == "true" ]]; then
  log "✅ ALL GATES PASS — catalog down-sync verified for this store."
  log "===================================================================="
  exit 0
else
  log "❌ GATE FAILURE — catalog down-sync verification FAILED for this store."
  log "   Review the log above and investigate before clearing this store for open."
  log "===================================================================="
  exit 1
fi
