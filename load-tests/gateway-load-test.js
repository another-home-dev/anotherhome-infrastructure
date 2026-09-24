import http from 'k6/http';
import { check, group, sleep } from 'k6';

// Load test for the deployed Another Home gateway/frontend (GKE Autopilot,
// https://34.54.94.62.nip.io). Deliberately modest VU counts: each backend
// pod is capped at 250m CPU / 400Mi memory (see another-home-infra/k8s
// values.yaml) to keep hosting costs down, so a heavy load test would risk
// taking down the live system before the demo rather than just measuring it.
// For a genuine worst-case/breaking-point run, point BASE_URL at a local
// `skaffold dev` (kind) cluster instead, where resource limits can be raised
// safely — see another-home-infra/README.md.
//
// Run with:
//   docker run --rm -i grafana/k6 run - < gateway-load-test.js
// or, for the live system report numbers used in the test plan:
//   docker run --rm -i grafana/k6 run --summary-export=/dev/stdout - \
//     < gateway-load-test.js > results.json

const BASE_URL = __ENV.BASE_URL || 'https://34.54.94.62.nip.io';

// Note: the gateway's own unauthenticated root route (GET /) only exists at
// the gateway's own "/", but the ingress forwards paths unchanged (no
// rewrite-target), so nothing outside /api/v1/* ever reaches the gateway
// through the public URL — GET https://HOST/api is a 404, not the gateway's
// hello route. Confirmed with curl before writing this script. Not a bug
// (nothing depends on that bare route being public), but worth documenting:
// there is no publicly reachable, unauthenticated gateway health check.

export const options = {
  scenarios: {
    // "Normal anticipated workload" per the test plan template (3.1.4/3.1.5):
    // a small, steady number of concurrent users browsing the app.
    normal_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '20s', target: 10 },
        { duration: '5s', target: 0 },
      ],
      exec: 'browseApp',
    },
    // "Anticipated worst-case workload": a short spike well above normal use,
    // to see whether latency degrades gracefully rather than failing outright.
    peak_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      startTime: '40s', // runs after normal_load finishes
      stages: [
        { duration: '10s', target: 20 },
        { duration: '20s', target: 20 },
        { duration: '5s', target: 0 },
      ],
      exec: 'browseApp',
    },
  },
  thresholds: {
    // The frontend shell should stay responsive even at peak load.
    'http_req_duration{endpoint:frontend}': ['p(95)<2000'],
    // The gateway's own auth check (JWT verify + reject) is cheap and should
    // stay fast regardless of load — if this creeps up, the JWKS lookup or
    // the auth middleware itself is becoming a bottleneck.
    'http_req_duration{endpoint:gateway_auth_reject}': ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

export function browseApp() {
  group('frontend shell loads', () => {
    const res = http.get(`${BASE_URL}/`, { tags: { endpoint: 'frontend' } });
    check(res, { 'frontend responds 200': (r) => r.status === 200 });
  });

  group('protected API correctly rejects requests with no token, even under load', () => {
    // These are EXPECTED to be 401 — the check verifies auth doesn't leak or
    // slow to a crawl under concurrency, not that the request "succeeds".
    const endpoints = ['/api/v1/operations/notices', '/api/v1/accommodation/rooms', '/api/v1/finance/invoices'];
    for (const path of endpoints) {
      const res = http.get(`${BASE_URL}${path}`, {
        tags: { endpoint: 'gateway_auth_reject' },
        responseCallback: http.expectedStatuses(401),
      });
      check(res, { [`${path} rejects with 401`]: (r) => r.status === 401 });
    }
  });

  sleep(1);
}
