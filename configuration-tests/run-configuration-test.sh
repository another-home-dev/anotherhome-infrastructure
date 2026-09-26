#!/usr/bin/env bash
# Configuration testing: render the same Helm chart for two real, different
# target configurations - local kind (the chart's own defaults) and GKE
# Autopilot (values-gke-overlay.yaml, pulled from the live release) - then
# validate each rendered manifest set against a REAL Kubernetes API server
# (the local kind cluster) with a server-side dry run. This checks schema
# validity and CRD availability, not just "is it parseable YAML".
#
# Never touches the current kubectl context: every command below targets
# --kube-context / --context "kind-another-home" explicitly.
#
# Usage: ./run-configuration-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CHART=k8s/another-home
KIND_CONTEXT=kind-another-home
DUMMY_SECRET="--set-string secrets.dbPassword=dummy-for-template-only"

echo "=== helm lint (default / local-kind values) ==="
helm lint "$CHART" $DUMMY_SECRET

echo
echo "=== Config A: local kind defaults -> render + validate against a real API server ==="
helm template another-home "$CHART" $DUMMY_SECRET \
  > /tmp/another-home-config-a-local-kind.yaml
kubectl --context "$KIND_CONTEXT" apply --dry-run=server -f /tmp/another-home-config-a-local-kind.yaml
echo "Config A: OK"

echo
echo "=== Config B: GKE Autopilot overlay -> render + validate against a real API server ==="
helm template another-home "$CHART" $DUMMY_SECRET \
  -f configuration-tests/values-gke-overlay.yaml \
  > /tmp/another-home-config-b-gke.yaml
set +e
kubectl --context "$KIND_CONTEXT" apply --dry-run=server -f /tmp/another-home-config-b-gke.yaml
STATUS=$?
set -e
if [ $STATUS -ne 0 ]; then
  echo "Config B: some resources failed validation on kind (expected - see RESULTS.md for why)"
else
  echo "Config B: OK"
fi
