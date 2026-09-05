#!/usr/bin/env bash
# Shared helpers for dogfood process scripts. Source only — do not exec.

set -euo pipefail

CODEORACLE_REPO="${CODEORACLE_REPO:-$HOME/codeoracle/repo}"
CODEORACLE_RUN="${CODEORACLE_RUN:-$HOME/codeoracle/run}"
WORKER_CWD="${CODEORACLE_REPO}/apps/worker"
API_CWD="${CODEORACLE_REPO}/apps/api"
MCP_CWD="${CODEORACLE_REPO}/apps/mcp-server"

export PATH="${HOME}/.local/bin:${PATH}"

load_env() {
  if [[ -f "${CODEORACLE_REPO}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${CODEORACLE_REPO}/.env"
    set +a
  fi
}

# PIDs whose cwd matches the given absolute path (tsx/node main workers).
pids_for_cwd() {
  local want="$1"
  local p cwd
  for p in $(pgrep -f "src/main.ts" 2>/dev/null || true); do
    cwd="$(readlink "/proc/${p}/cwd" 2>/dev/null || true)"
    if [[ "${cwd}" == "${want}" ]]; then
      # Prefer the real node preflight child over sh/tsx wrappers when both match.
      if tr "\0" " " < "/proc/${p}/cmdline" 2>/dev/null | grep -q "preflight"; then
        echo "${p}"
      fi
    fi
  done
}

# All PIDs whose cwd is apps/worker (wrappers + preflight) — used for stop.
all_worker_related_pids() {
  local p cwd
  for p in $(pgrep -f "node|tsx|pnpm" 2>/dev/null || true); do
    cwd="$(readlink "/proc/${p}/cwd" 2>/dev/null || true)"
    if [[ "${cwd}" == "${WORKER_CWD}" ]]; then
      echo "${p}"
    fi
  done | sort -u
}

count_preflight_workers() {
  local n=0
  local _p
  for _p in $(pids_for_cwd "${WORKER_CWD}"); do
    n=$((n + 1))
  done
  echo "${n}"
}

redis_cli() {
  if command -v redis-cli >/dev/null 2>&1; then
    if [[ -n "${REDIS_URL:-}" ]]; then
      redis-cli -u "${REDIS_URL}" "$@"
    else
      redis-cli "$@"
    fi
    return
  fi
  if docker ps --format "{{.Names}}" 2>/dev/null | grep -qx "codeoracle-redis-1"; then
    docker exec codeoracle-redis-1 redis-cli "$@"
    return
  fi
  echo "redis-cli not found and codeoracle-redis-1 container missing" >&2
  return 1
}
