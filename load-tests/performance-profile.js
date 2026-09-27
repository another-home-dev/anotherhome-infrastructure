import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// Performance PROFILING (RUP 3.1.4) is deliberately distinct from the k6 Load
// Test (gateway-load-test.js / RUP 3.1.5): this measures single-transaction
// response time under NORMAL, non-concurrent conditions (1 virtual user, no
// ramping) so per-endpoint latency is visible on its own, not blended into a
// concurrency curve. Load testing already covers "what happens under many
// simultaneous users" - this covers "how fast is one request, by itself,
// repeated enough times to get a stable median/p95".
//
// Run with:
//   docker run --rm -i grafana/k6 run --summary-export=/dev/stdout - \
//     < performance-profile.js > results.json

const BASE_URL = __ENV.BASE_URL || 'https://34.54.94.62.nip.io';
const ITERATIONS = 30;

const trends = {
  frontend: new Trend('profile_frontend', true),
  accommodation: new Trend('profile_accommodation_rooms', true),
  finance: new Trend('profile_finance_invoices', true),
  operations: new Trend('profile_operations_notices', true),
};

export const options = {
  scenarios: {
    profile: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: ITERATIONS,
      maxDuration: '2m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
  },
};

export default function () {
  const targets = [
    { name: 'frontend', url: `${BASE_URL}/` },
    { name: 'accommodation', url: `${BASE_URL}/api/v1/accommodation/rooms` },
    { name: 'finance', url: `${BASE_URL}/api/v1/finance/invoices` },
    { name: 'operations', url: `${BASE_URL}/api/v1/operations/notices` },
  ];

  for (const t of targets) {
    const res = http.get(t.url, { responseCallback: http.expectedStatuses(200, 401) });
    trends[t.name].add(res.timings.duration);
    check(res, { [`${t.name} responded`]: (r) => r.status === 200 || r.status === 401 });
  }

  sleep(0.2);
}
