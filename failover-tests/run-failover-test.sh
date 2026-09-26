#!/usr/bin/env bash
# Failover/recovery test: delete a running pod on the live GKE deployment and
# poll a request path through it until service is consistently restored,
# recording every poll so gaps (connection refused / 502) are visible, not
# just the final "it recovered" moment.
#
# Usage:
#   ./run-failover-test.sh <namespace> <pod-label-selector> <url-to-poll> [expected-status]
#
# Example (tests the gateway's own pod, polled through the public ingress):
#   ./run-failover-test.sh another-home app=gateway \
#     https://34.54.94.62.nip.io/api/v1/accommodation/rooms 401
#
# Requires: kubectl configured against the target cluster, curl, bc.
set -euo pipefail

NAMESPACE="$1"
LABEL="$2"
URL="$3"
EXPECTED_STATUS="${4:-401}"
POLL_INTERVAL="${5:-0.5}"
MAX_POLLS="${6:-90}"

OLD_POD=$(kubectl get pods -n "$NAMESPACE" -l "$LABEL" -o jsonpath='{.items[0].metadata.name}')
echo "Baseline check before failover:"
curl -s -o /dev/null -w "  status=%{http_code} time=%{time_total}s\n" "$URL"

echo "Deleting pod: $OLD_POD"
kubectl delete pod "$OLD_POD" -n "$NAMESPACE" --wait=false
T0=$(date +%s.%N)

FAIL_COUNT=0
LAST_FAILED_AT=""
for i in $(seq 1 "$MAX_POLLS"); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$URL" || echo "000")
  T=$(echo "$(date +%s.%N) - $T0" | bc)
  if [ "$CODE" != "$EXPECTED_STATUS" ]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    LAST_FAILED_AT="$T"
    echo "t+${T}s  code=$CODE  <-- FAILURE"
  fi
  sleep "$POLL_INTERVAL"
done

echo "=== summary ==="
echo "failed polls: $FAIL_COUNT / $MAX_POLLS"
if [ -n "$LAST_FAILED_AT" ]; then
  echo "last failure observed at t+${LAST_FAILED_AT}s (recovery time is approximately this)"
else
  echo "no failed polls observed - failover was transparent at this poll resolution"
fi
kubectl get pods -n "$NAMESPACE" -l "$LABEL" -o wide
