#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLEAR_LOCKS=0
for arg in "$@"; do
  case "${arg}" in
    --clear-locks) CLEAR_LOCKS=1 ;;
    -h|--help)
      echo "Usage: restart-worker.sh [--clear-locks]"
      exit 0
      ;;
    *)
      echo "Unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

"${SCRIPT_DIR}/stop-worker.sh"
if [[ "${CLEAR_LOCKS}" -eq 1 ]]; then
  "${SCRIPT_DIR}/clear-extract-locks.sh"
fi
"${SCRIPT_DIR}/start-worker.sh"
"${SCRIPT_DIR}/worker-status.sh"
