import http from 'k6/http';
import { check, sleep } from 'k6';

// Peak-time simulation: 400 students hitting the mobile app's real endpoints
// simultaneously (not the web/admin endpoints tested earlier). Three
// scenarios run sequentially, each firing all 400 VUs at once via
// per-vu-iterations (1 iteration each) to approximate a synchronized burst
// (e.g. everyone opening the app right after a notice is posted) rather
// than a sustained ramp.
//
// All requests reuse ONE real Asgardeo access token (a warden account,
// since that's what was available) rather than 400 distinct student logins:
// - Actual login (Asgardeo OAuth) is a third-party IdP concern, not ours to
//   load-test.
// - The gateway performs a full RS256 signature verification per request
//   regardless of which token is used, so CPU cost under load is realistic
//   even though the business identity is the same for every VU.
// - GET /accommodation/students/me is EXPECTED to return 404 with this
//   token (no email claim -> no linkable Student record) -- 404 is treated
//   as the expected status here, since the goal is measuring the auth+DB
//   lookup code path's performance under load, not exercising the success
//   business outcome.
// - POST /operations/visitors and /operations/maintenance DO succeed (201)
//   and create real rows, tagged with LOADTEST_DELETE_ME so they can be
//   found and removed afterward.
//
// Run with:
//   docker run --rm -i -e TOKEN="$TOKEN" -e ROOM_ID="$ROOM_ID" \
//     -e BASE_URL="https://34.54.94.62.nip.io" \
//     grafana/k6 run - < peak-400-mobile-test.js

const BASE_URL = __ENV.BASE_URL || 'https://34.54.94.62.nip.io';
const TOKEN = __ENV.TOKEN;
const ROOM_ID = __ENV.ROOM_ID;

if (!TOKEN) throw new Error('TOKEN env var is required');
if (!ROOM_ID) throw new Error('ROOM_ID env var is required');

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

export const options = {
  scenarios: {
    dashboard_open_400: {
      executor: 'per-vu-iterations',
      vus: 400,
      iterations: 1,
      maxDuration: '30s',
      exec: 'openDashboard',
      startTime: '0s',
    },
    visitor_request_400: {
      executor: 'per-vu-iterations',
      vus: 400,
      iterations: 1,
      maxDuration: '30s',
      exec: 'submitVisitorRequest',
      startTime: '35s',
    },
    maintenance_request_400: {
      executor: 'per-vu-iterations',
      vus: 400,
      iterations: 1,
      maxDuration: '30s',
      exec: 'submitMaintenanceRequest',
      startTime: '70s',
    },
  },
  thresholds: {
    checks: ['rate>0.5'],
  },
};

export function openDashboard() {
  const res = http.get(`${BASE_URL}/api/v1/accommodation/students/me`, {
    headers,
    tags: { scenario: 'dashboard_open' },
  });
  check(res, { 'dashboard responds (200 or 404)': (r) => r.status === 200 || r.status === 404 });
}

export function submitVisitorRequest() {
  const body = JSON.stringify({
    roomId: ROOM_ID,
    visitorName: 'LOADTEST_DELETE_ME',
    visitorContact: '0000000000',
    purpose: 'LOADTEST_DELETE_ME',
    visitDate: '2026-10-01',
    visitTime: '10:00',
  });
  const res = http.post(`${BASE_URL}/api/v1/operations/visitors`, body, {
    headers,
    tags: { scenario: 'visitor_request' },
  });
  check(res, { 'visitor request created (201)': (r) => r.status === 201 });
}

export function submitMaintenanceRequest() {
  const body = JSON.stringify({
    category: 'Other',
    title: 'LOADTEST_DELETE_ME',
    description: 'LOADTEST_DELETE_ME',
    roomId: ROOM_ID,
    priority: 'Low',
  });
  const res = http.post(`${BASE_URL}/api/v1/operations/maintenance`, body, {
    headers,
    tags: { scenario: 'maintenance_request' },
  });
  check(res, { 'maintenance request created (201)': (r) => r.status === 201 });
}
