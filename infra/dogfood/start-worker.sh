#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"
load_env

mkdir -p "${CODEORACLE_RUN}"

n="$(count_preflight_workers)"
if [[ "${n}" -gt 0 ]]; then
  echo "ERROR: ${n} worker already running — refuse to start a duplicate." >&2
  echo "Run: ${SCRIPT_DIR}/stop-worker.sh   then retry." >&2
  exit 1
fi

if [[ ! -d "${CODEORACLE_REPO}" ]]; then
  echo "ERROR: CODEORACLE_REPO not found: ${CODEORACLE_REPO}" >&2
  exit 1
fi

cd "${CODEORACLE_REPO}"
: > "${CODEORACLE_RUN}/worker.log"
nohup bash -c "
  export PATH=\"${HOME}/.local/bin:\${PATH}\"
  cd \"${CODEORACLE_REPO}\"
  set -a
  source .env
  set +a
  exec pnpm worker
" >> "${CODEORACLE_RUN}/worker.log" 2>&1 &
echo $! > "${CODEORACLE_RUN}/worker.pid"

# Wait for preflight worker + listening line
for _ in $(seq 1 30); do
  sleep 1
  n="$(count_preflight_workers)"
  if [[ "${n}" -ge 1 ]] && grep -q "Worker listening for jobs" "${CODEORACLE_RUN}/worker.log" 2>/dev/null; then
    wpid="$(pids_for_cwd "${WORKER_CWD}" | head -n1)"
    echo "worker started pid=${wpid} (launcher=$(cat "${CODEORACLE_RUN}/worker.pid"))"
    if [[ "${n}" -gt 1 ]]; then
      echo "ERROR: started but count=${n} — aborting mindset; stop and investigate" >&2
      exit 2
    fi
    exit 0
  fi
done

echo "ERROR: worker did not become ready — see ${CODEORACLE_RUN}/worker.log" >&2
exit 1
