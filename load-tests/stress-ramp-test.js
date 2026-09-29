import http from 'k6/http';
import { check, group, sleep } from 'k6';

// Stress ramp: finds the concurrency level where the gateway's per-request
// RS256 JWT verification (CPU-bound) starts to saturate its 500m CPU limit
// (see: authenticated-load-test.js's 30-VU run already hit 289m/500m on the
// gateway pod alone, well above accommodation/db). Each stage is its own
// k6 scenario so p95/error-rate can be read per concurrency level from the
// summary's per-scenario breakdown, instead of one blended number.
//
// Safe to run against the live deployment: memory headroom is enormous
// (all pods <100Mi of a 512Mi limit), so the failure mode under CPU pressure
// is slower responses/timeouts, not OOM crashes or pod restarts.
//
// Run with:
//   docker run --rm -i -e TOKEN="$TOKEN" -e BASE_URL="https://34.54.94.62.nip.io" \
//     grafana/k6 run - < stress-ramp-test.js

const BASE_URL = __ENV.BASE_URL || 'https://34.54.94.62.nip.io';
const TOKEN = __ENV.TOKEN;

if (!TOKEN) {
  throw new Error('TOKEN env var is required (a valid Asgardeo access token)');
}

function stage(name, target, startTime) {
  return {
    executor: 'ramping-vus',
    startVUs: 0,
    startTime,
    stages: [
      { duration: '10s', target },
      { duration: '20s', target },
      { duration: '5s', target: 0 },
    ],
    exec: 'browseAuthenticated',
  };
}

export const options = {
  scenarios: {
    vu_20: stage('vu_20', 20, '0s'),
    vu_50: stage('vu_50', 50, '35s'),
    vu_80: stage('vu_80', 80, '70s'),
    vu_120: stage('vu_120', 120, '105s'),
  },
  thresholds: {
    checks: ['rate>0.5'], // deliberately loose — we WANT to see where it breaks, not fail fast
  },
};

export function browseAuthenticated() {
  group('authenticated reads under increasing concurrency', () => {
    const endpoints = [
      '/api/v1/accommodation/rooms',
      '/api/v1/finance/invoices',
      '/api/v1/operations/notices',
    ];
    for (const path of endpoints) {
      const res = http.get(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        tags: { endpoint: path },
      });
      check(res, { [`${path} returns 200`]: (r) => r.status === 200 });
    }
  });
  sleep(0.5);
}
