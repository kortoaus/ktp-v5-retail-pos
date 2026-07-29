#!/usr/bin/env bash
#
# store-upsync-backlog.sh — Runsheet §1-2 / GATE 1 store POS upsync-backlog checker.
#
# PURPOSE
#   data-server absorption cutover, GATE 1: "no store has un-synced invoices/
#   shifts before we freeze." Any local retail_pos_server row not yet pushed
#   to the cloud would otherwise arrive AFTER cutover and corrupt the
#   post-migration row-count snapshot (see
#   ktpv5-api-server/docs/superpowers/plans/2026-07-29-data-server-absorption-runsheet.md,
#   step 1-2 / GATE 1). This script answers "is that count zero everywhere?"
#   and lets you watch it drain to zero on cutover night.
#
#   Per retail_pos_server's up-sync design (`cloud.sync.service.ts`,
#   ktpv5-pos-retail/CLAUDE.md "Up-sync mechanics"): `cloudId != null ⟺
#   synced`, there is no `synced`/`syncedAt` column, and failures are
#   SILENT — a row just stays `cloudId = NULL` until the next trigger, with
#   no alert or retry counter. The only two tables the up-sync sweep pushes
#   are `SaleInvoice` and `TerminalShift`
#   (retail_pos_server/prisma/schema.prisma:471,628 — both `cloudId Int?`,
#   both `@@index([cloudId])`). Refunds/repays are child `SaleInvoice` rows
#   (type REFUND / SALE), not a separate table, so they are already covered.
#
# WHAT IT DOES
#   For every store in the store list (see STORE CONFIGURATION below), SSHes
#   in and runs, read-only, against that store's local Postgres — same
#   docker-exec-psql mechanism as
#   scripts/remote-catalog-sync-verify.sh (commit f0f7cd4), just two COUNT
#   queries instead of a catalog-sync trigger+poll:
#
#     SELECT count(*) FROM "SaleInvoice"    WHERE "cloudId" IS NULL;
#     SELECT count(*) FROM "TerminalShift"  WHERE "cloudId" IS NULL;
#
#   Prints one line per store (`store-name  invoices=<n>  shifts=<n>`, or
#   `store-name  UNREACHABLE` / `store-name  ERROR: <reason>` on failure),
#   then a `TOTAL backlog=<n>` line. Exits 0 only when every store answered
#   AND the total is 0 — so a runsheet operator (or a shell `&&`) can gate
#   on the exit code alone.
#
#   READ-ONLY. This script never writes to a store DB — it only counts.
#
# STORE CONFIGURATION
#   No committed store→SSH-host registry exists anywhere in this fleet (that
#   gap is exactly what runsheet §0's "§1-2 는 실제로 어디서/어떻게
#   확인하는가?" owner-confirmation checkbox is about) — remote-catalog-
#   sync-verify.sh sidesteps this by being run manually per-store, once
#   already SSH'd in. This script needs the list up front to loop
#   unattended, so it reads one of, in priority order:
#
#     1. $STORE_HOSTS       — the store list inline, newline-separated
#                              "<name> <ssh-target>" pairs (env var; good for
#                              a one-off override or CI).
#     2. $STORE_HOSTS_FILE  — path to a file in the same format
#                              (default: scripts/store-hosts.txt, sibling of
#                              this script — copy scripts/store-hosts.txt.example
#                              and fill in real values; that file is
#                              deliberately NOT committed with real hosts).
#
#   Format (both sources): one store per line, `#` comments and blank lines
#   ignored, fields whitespace-separated:
#       <store-name> <ssh-target>
#   <ssh-target> is anything `ssh` accepts as a destination — `user@host`,
#   a bare hostname/IP, or a ~/.ssh/config Host alias.
#
# USAGE
#   ./scripts/store-upsync-backlog.sh                  # one pass, all stores
#   ./scripts/store-upsync-backlog.sh --watch           # loop every 10s
#   ./scripts/store-upsync-backlog.sh --watch 5          # loop every 5s
#   watch -n10 ./scripts/store-upsync-backlog.sh         # external watch also works —
#                                                         # single-pass mode is clean
#                                                         # stdout, no persistent state
#   STORE_HOSTS_FILE=./scripts/store-hosts.txt ./scripts/store-upsync-backlog.sh
#   ./scripts/store-upsync-backlog.sh && echo "GATE 1 clear"
#
# ENV OVERRIDES (all optional)
#   STORE_HOSTS            store list inline (see STORE CONFIGURATION above)
#   STORE_HOSTS_FILE       path to the store list file
#                          (default: <this-script's-dir>/store-hosts.txt)
#   SSH_OPTS               options passed to every `ssh` call, word-split
#                          (default: "-o BatchMode=yes -o
#                          ConnectTimeout=$SSH_CONNECT_TIMEOUT_SEC -o
#                          StrictHostKeyChecking=accept-new")
#   SSH_CONNECT_TIMEOUT_SEC  seconds before giving up on a single store's SSH
#                          connection (default: 10)
#   REMOTE_REPO_DIR        path to the ktpv5-pos-retail checkout ON EACH
#                          STORE BOX, used to read retail_pos_server/.env for
#                          non-default DB credentials — same idea as
#                          remote-catalog-sync-verify.sh's REPO_DIR, just
#                          resolved on the remote side since this script
#                          never checks out the repo locally
#                          (default: $HOME/ktpv5-pos-retail, evaluated on the
#                          remote host)
#   PG_CONTAINER            docker container name for local postgres on each
#                          store box (default: retail_pos_local_postgres —
#                          same default as remote-catalog-sync-verify.sh)
#
#   If a store's retail_pos_server/.env is unreadable or absent, DB
#   credentials fall back to the same docker-compose.yml defaults
#   remote-catalog-sync-verify.sh uses: user=ktpv5 password=510935
#   db=retail_pos_local_dev.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STORE_HOSTS_FILE="${STORE_HOSTS_FILE:-$SCRIPT_DIR/store-hosts.txt}"
SSH_CONNECT_TIMEOUT_SEC="${SSH_CONNECT_TIMEOUT_SEC:-10}"
SSH_OPTS="${SSH_OPTS:--o BatchMode=yes -o ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC} -o StrictHostKeyChecking=accept-new}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-\$HOME/ktpv5-pos-retail}"
PG_CONTAINER="${PG_CONTAINER:-retail_pos_local_postgres}"

WATCH=0
WATCH_INTERVAL=10

usage() {
  cat <<'USAGE'
Usage: store-upsync-backlog.sh [--watch [interval_seconds]] [-h|--help]

  (no args)       one pass over all configured stores, exit 0 iff total
                  backlog == 0 and every store answered
  --watch [N]     loop in-place every N seconds (default 10) until
                  interrupted (Ctrl-C) — for watching the backlog drain to
                  zero on cutover night
  -h, --help      this message

See the header of this script for STORE CONFIGURATION and env overrides.
USAGE
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)
      WATCH=1
      shift
      if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
        WATCH_INTERVAL="$1"
        shift
      fi
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Store list loading
#
# Populates the global array STORE_LINES with raw "<name> <ssh-target>"
# lines, comments/blanks stripped. Bash-3.2-safe (plain indexed array, no
# mapfile/readarray).
# ---------------------------------------------------------------------------

load_stores() {
  STORE_LINES=()
  local src=""

  if [[ -n "${STORE_HOSTS:-}" ]]; then
    src="$STORE_HOSTS"
  elif [[ -f "$STORE_HOSTS_FILE" ]]; then
    src="$(cat "$STORE_HOSTS_FILE")"
  else
    return 0
  fi

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    # strip trailing CR in case the file was edited on Windows
    line="${line%$'\r'}"
    # trim leading whitespace
    while [[ "$line" == [[:space:]]* ]]; do line="${line# }"; line="${line#	}"; done
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    STORE_LINES+=("$line")
  done <<< "$src"
}

# ---------------------------------------------------------------------------
# Per-store check
#
# Sets globals LAST_OK (1/0), LAST_INV, LAST_SHIFT on success; always prints
# exactly one result line for the store. Returns 0 on success, 1 otherwise —
# callers must invoke this inside an `if` (set -e is active) so one store's
# failure never aborts the loop.
# ---------------------------------------------------------------------------

check_one_store() {
  local name="$1"
  local target="$2"
  local remote_cmd="PG_CONTAINER='$PG_CONTAINER' REMOTE_REPO_DIR='$REMOTE_REPO_DIR' bash -s"
  local out=""
  local ssh_exit=0

  # shellcheck disable=SC2086  # SSH_OPTS is an intentionally word-split flag list
  out=$(ssh $SSH_OPTS "$target" "$remote_cmd" <<'REMOTE_SCRIPT' 2>&1
set -u

PG_CONTAINER="${PG_CONTAINER:-retail_pos_local_postgres}"
REPO_DIR="${REMOTE_REPO_DIR:-$HOME/ktpv5-pos-retail}"
ENV_FILE="$REPO_DIR/retail_pos_server/.env"

DB_USER_DEFAULT="ktpv5"
DB_PASSWORD_DEFAULT="510935"
DB_NAME_DEFAULT="retail_pos_local_dev"

PARSED_USER=""
PARSED_PASSWORD=""
PARSED_NAME=""

if [ -f "$ENV_FILE" ]; then
  DATABASE_URL_RAW=$(grep -E '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"\047')
  # NOTE: deliberately not a `case` statement — a `case ... pattern)` inside a
  # heredoc that itself sits inside a `$( ... )` command substitution (as this
  # whole REMOTE_SCRIPT block does, from check_one_store()) trips a bash
  # parser bug where the bare `)` after the pattern is mistaken for the
  # substitution's closing paren. Confirmed on bash 3.2.57 (this repo's
  # target). Prefix-strip-and-compare avoids the problem entirely.
  rest="${DATABASE_URL_RAW#postgresql://}"
  if [ "$rest" != "$DATABASE_URL_RAW" ]; then
    userpass=${rest%%@*}
    PARSED_USER=${userpass%%:*}
    PARSED_PASSWORD=${userpass#*:}
    hostpart=${rest#*@}
    pathpart=${hostpart#*/}
    PARSED_NAME=${pathpart%%\?*}
  fi
fi

DB_USER="${PARSED_USER:-$DB_USER_DEFAULT}"
DB_PASSWORD="${PARSED_PASSWORD:-$DB_PASSWORD_DEFAULT}"
DB_NAME="${PARSED_NAME:-$DB_NAME_DEFAULT}"

if [ -z "$DB_USER" ]; then DB_USER="$DB_USER_DEFAULT"; fi
if [ -z "$DB_PASSWORD" ]; then DB_PASSWORD="$DB_PASSWORD_DEFAULT"; fi
if [ -z "$DB_NAME" ]; then DB_NAME="$DB_NAME_DEFAULT"; fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERR docker command not found on store host"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  echo "ERR container '$PG_CONTAINER' is not running"
  exit 1
fi

RESULT=$(docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT (SELECT count(*) FROM \"SaleInvoice\" WHERE \"cloudId\" IS NULL) || '|' || (SELECT count(*) FROM \"TerminalShift\" WHERE \"cloudId\" IS NULL);" 2>&1)
rc=$?

if [ $rc -ne 0 ]; then
  echo "ERR psql query failed: $RESULT"
  exit 1
fi

echo "OK $RESULT"
REMOTE_SCRIPT
) || ssh_exit=$?

  local last_line
  last_line="$(printf '%s\n' "$out" | tail -n1)"

  case "$last_line" in
    "OK "*)
      local counts="${last_line#OK }"
      local inv="${counts%%|*}"
      local shf="${counts#*|}"
      if [[ "$inv" =~ ^[0-9]+$ && "$shf" =~ ^[0-9]+$ ]]; then
        printf '%-20s invoices=%-6s shifts=%-6s\n' "$name" "$inv" "$shf"
        LAST_OK=1
        LAST_INV=$inv
        LAST_SHIFT=$shf
        return 0
      fi
      printf '%-20s ERROR: malformed response (%s)\n' "$name" "$last_line"
      LAST_OK=0
      return 1
      ;;
    "ERR "*)
      printf '%-20s ERROR: %s\n' "$name" "${last_line#ERR }"
      LAST_OK=0
      return 1
      ;;
    *)
      printf '%-20s UNREACHABLE (ssh exit %s)\n' "$name" "$ssh_exit"
      LAST_OK=0
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# One pass over every configured store
# ---------------------------------------------------------------------------

run_once() {
  load_stores

  if [[ ${#STORE_LINES[@]} -eq 0 ]]; then
    echo "FATAL: no stores configured." >&2
    echo "  Set \$STORE_HOSTS, or create $STORE_HOSTS_FILE" >&2
    echo "  (copy $SCRIPT_DIR/store-hosts.txt.example and fill in real ssh targets)." >&2
    return 2
  fi

  local ts
  ts="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
  echo "===================================================================="
  echo " Store upsync backlog — runsheet §1-2 / GATE 1 — $ts"
  echo "===================================================================="

  local total=0
  local any_fail=0
  local name target rest

  for line in "${STORE_LINES[@]}"; do
    name="${line%%[[:space:]]*}"
    rest="${line#"$name"}"
    # trim leading whitespace left after removing the name
    while [[ "$rest" == [[:space:]]* ]]; do rest="${rest# }"; rest="${rest#	}"; done
    target="$rest"

    if [[ -z "$name" || -z "$target" ]]; then
      echo "FATAL: malformed store-hosts line (need 'name ssh-target'): $line" >&2
      any_fail=1
      continue
    fi

    if check_one_store "$name" "$target"; then
      total=$((total + LAST_INV + LAST_SHIFT))
    else
      any_fail=1
    fi
  done

  echo "--------------------------------------------------------------------"
  echo "TOTAL backlog=$total"
  echo "===================================================================="

  if [[ $any_fail -ne 0 ]]; then
    return 1
  fi
  if [[ $total -ne 0 ]]; then
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Watch mode
# ---------------------------------------------------------------------------

clear_screen() {
  if command -v clear >/dev/null 2>&1; then
    clear
  else
    printf '\033[2J\033[H'
  fi
}

watch_loop() {
  trap 'echo; echo "Stopped watching."; exit 130' INT TERM

  while true; do
    clear_screen
    echo "store-upsync-backlog.sh --watch (every ${WATCH_INTERVAL}s, Ctrl-C to stop)"
    echo ""
    run_once || true
    sleep "$WATCH_INTERVAL"
  done
}

# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

if [[ "$WATCH" == "1" ]]; then
  watch_loop
else
  run_once
fi
