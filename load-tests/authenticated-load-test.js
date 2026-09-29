import http from 'k6/http';
import { check, group, sleep } from 'k6';

// Authenticated load test: exercises real, database-backed GET endpoints
// across all three domain services (accommodation, finance, operations),
// unlike gateway-load-test.js (which only proves the 401-rejection path
// stays fast) and performance-profile.js (single-user, no concurrency).
//
// Needs a real Asgardeo access token (warden or student role both work for
// the read endpoints below) passed via the TOKEN env var — never hardcode a
// token in this file or commit one. Tokens are short-lived (~1hr), so get a
// fresh one right before running if you see 401s partway through a run.
//
// Run with:
//   docker run --rm -i -e TOKEN="$TOKEN" grafana/k6 run --summary-export=/dev/stdout - \
//     < authenticated-load-test.js > auth-results.json

const BASE_URL = __ENV.BASE_URL || 'https://34.54.94.62.nip.io';
const TOKEN = __ENV.TOKEN;

if (!TOKEN) {
  throw new Error('TOKEN env var is required (a valid Asgardeo access token)');
}

const authHeaders = { headers: { Authorization: `Bearer ${TOKEN}` } };

export const options = {
  scenarios: {
    // Normal anticipated workload: a handful of wardens/students browsing.
    normal_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '5s', target: 0 },
      ],
      exec: 'browseAuthenticated',
    },
    // Peak/worst-case workload, run after normal_load finishes.
    peak_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      startTime: '50s',
      stages: [
        { duration: '15s', target: 30 },
        { duration: '30s', target: 30 },
        { duration: '5s', target: 0 },
      ],
      exec: 'browseAuthenticated',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:accommodation_rooms}': ['p(95)<1500'],
    'http_req_duration{endpoint:accommodation_students}': ['p(95)<1500'],
    'http_req_duration{endpoint:finance_invoices}': ['p(95)<1500'],
    'http_req_duration{endpoint:operations_notices}': ['p(95)<1500'],
    checks: ['rate>0.95'],
  },
};

export function browseAuthenticated() {
  group('authenticated reads across all three domain services', () => {
    const endpoints = [
      { path: '/api/v1/accommodation/rooms', tag: 'accommodation_rooms' },
      { path: '/api/v1/accommodation/students', tag: 'accommodation_students' },
      { path: '/api/v1/accommodation/buildings', tag: 'accommodation_buildings' },
      { path: '/api/v1/finance/invoices', tag: 'finance_invoices' },
      { path: '/api/v1/operations/notices', tag: 'operations_notices' },
      { path: '/api/v1/operations/maintenance', tag: 'operations_maintenance' },
      { path: '/api/v1/operations/visitors', tag: 'operations_visitors' },
    ];

    for (const ep of endpoints) {
      const res = http.get(`${BASE_URL}${ep.path}`, {
        headers: authHeaders.headers,
        tags: { endpoint: ep.tag },
      });
      check(res, {
        [`${ep.path} returns 200`]: (r) => r.status === 200,
      });
    }
  });

  sleep(1);
}
