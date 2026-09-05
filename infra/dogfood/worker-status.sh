#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

api_n=0
mcp_n=0
worker_n=0
for p in $(pids_for_cwd "${API_CWD}"); do api_n=$((api_n + 1)); echo "API    pid=${p}"; done
for p in $(pids_for_cwd "${MCP_CWD}"); do mcp_n=$((mcp_n + 1)); echo "MCP    pid=${p}"; done
for p in $(pids_for_cwd "${WORKER_CWD}"); do worker_n=$((worker_n + 1)); echo "WORKER pid=${p}"; done

echo "counts: API=${api_n} MCP=${mcp_n} WORKER=${worker_n}"
if [[ -f "${CODEORACLE_RUN}/worker.pid" ]]; then
  echo "pidfile=${CODEORACLE_RUN}/worker.pid -> $(cat "${CODEORACLE_RUN}/worker.pid")"
fi
if [[ "${worker_n}" -gt 1 ]]; then
  echo "ERROR: more than one worker — stop extras before extract" >&2
  exit 2
fi
if [[ "${worker_n}" -eq 0 ]]; then
  echo "WARN: no worker running" >&2
  exit 1
fi
exit 0
