#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"
load_env

PREFIX="${BULL_PREFIX:-bull:codeoracle}"
DAY="$(date -u +%Y-%m-%d)"

echo "clearing BullMQ transient keys under ${PREFIX}"
redis_cli DEL \
  "${PREFIX}:active" \
  "${PREFIX}:wait" \
  "${PREFIX}:paused" \
  "${PREFIX}:delayed" \
  "${PREFIX}:prioritized" \
  "${PREFIX}:stalled" \
  "${PREFIX}:stalled-check" \
  "${PREFIX}:meta-paused" >/dev/null || true

# lock keys (BullMQ job locks)
while IFS= read -r key; do
  [[ -z "${key}" ]] && continue
  redis_cli DEL "${key}" >/dev/null || true
done < <(redis_cli KEYS "${PREFIX}:*lock*" 2>/dev/null || true)

if [[ -n "${REPO_ID:-}" ]]; then
  budget_key="codeoracle:extract:tokens:${REPO_ID}:${DAY}"
  redis_cli DEL "${budget_key}" >/dev/null || true
  echo "reset token budget key ${budget_key}"
else
  echo "REPO_ID unset — skipped extract token budget reset"
  echo "  export REPO_ID=... and re-run, or: redis-cli DEL codeoracle:extract:tokens:<id>:${DAY}"
fi

echo "locks/budget clear done"
