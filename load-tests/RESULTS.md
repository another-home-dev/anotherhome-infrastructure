# Load test results — live GKE deployment

Run against `https://34.54.94.62.nip.io` (GKE Autopilot, project `another-home-sep25`)
on 2026-09-24, using `gateway-load-test.js` via `docker run --rm -i grafana/k6 run - < gateway-load-test.js`.

Profile: ramp 0→10 VUs (35s, "normal" load), then a peak stage ramping 0→20 VUs (35s).
Each iteration loads the frontend shell and hits 3 protected API routes with no token
(verifying the gateway still rejects correctly, and quickly, under concurrency).

## Result: all thresholds passed

| Metric | Threshold | Result |
|---|---|---|
| Checks passing | > 99% | **100%** (2768/2768) |
| Frontend response time (p95) | < 2000ms | **57.73ms** |
| Gateway auth-rejection time (p95) | < 1000ms | **54.06ms** |

- Throughput: 36.6 requests/sec sustained at peak (20 VUs), 9.16 full iterations/sec.
- 0% request failures.
- All three protected endpoints (`/accommodation/rooms`, `/operations/notices`,
  `/finance/invoices`) correctly returned 401 on every single request — auth
  rejection doesn't degrade or leak under load.

## Finding

`GET https://<host>/api` (the gateway's own unauthenticated root route) returns
**404**, not the gateway's hello response. The ingress has no rewrite-target, so
it forwards paths unchanged and only `/api/v1/*` is actually routed to the
gateway's application routes. Not a functional bug (nothing depends on that bare
route being public), but it means **there is no publicly reachable, unauthenticated
health-check endpoint** for the gateway today — worth deciding whether one should
be added before relying on an external uptime monitor.

## Why load was kept modest (max 20 VUs, ~75s total)

Every backend pod is capped at 250m CPU / 400Mi memory (see
`k8s/another-home/values.yaml`) to control GKE Autopilot cost. A heavier test
risks taking the live demo system down rather than just measuring it. For a
genuine worst-case/breaking-point run, point `BASE_URL` at a local `skaffold dev`
(kind) cluster instead, where limits can be raised safely.
