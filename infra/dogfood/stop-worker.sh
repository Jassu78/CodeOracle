#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

# Kill by pidfile launcher tree first, then any leftover worker cwd processes.
if [[ -f "${CODEORACLE_RUN}/worker.pid" ]]; then
  launcher="$(cat "${CODEORACLE_RUN}/worker.pid")"
  if [[ -n "${launcher}" ]] && [[ -d "/proc/${launcher}" ]]; then
    echo "stopping launcher tree pid=${launcher}"
    # Kill process group if possible; otherwise TERM the launcher (children often die with it).
    kill -TERM "-${launcher}" 2>/dev/null || kill -TERM "${launcher}" 2>/dev/null || true
    sleep 2
    kill -KILL "-${launcher}" 2>/dev/null || kill -KILL "${launcher}" 2>/dev/null || true
  fi
fi

pids="$(all_worker_related_pids | sort -u | tr '\n' ' ')"
pids="${pids%" "}"
if [[ -n "${pids}" ]]; then
  echo "stopping remaining worker-cwd pids: ${pids}"
  # shellcheck disable=SC2086
  kill -TERM ${pids} 2>/dev/null || true
  sleep 2
  # shellcheck disable=SC2086
  for p in ${pids}; do
    if [[ -d "/proc/${p}" ]]; then
      kill -KILL "${p}" 2>/dev/null || true
    fi
  done
fi

rm -f "${CODEORACLE_RUN}/worker.pid"
echo "worker stopped"
