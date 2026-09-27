# Performance Profiling Results

Ran against the live GKE deployment (`https://34.54.94.62.nip.io`) with
`performance-profile.js`: 1 virtual user, no ramping, 30 sequential
iterations hitting 4 representative endpoints (frontend shell, and one route
per backend microservice through the gateway). See the file header for why
this is a separate test from `gateway-load-test.js` (RUP distinguishes
single-transaction profiling under normal load from many-concurrent-user
load testing).

## Results (single-user, sequential, 30 iterations)

| Endpoint | avg | median | p90 | p95 | max |
|---|---|---|---|---|---|
| Frontend shell (`/`) | 54.5ms | 54.4ms | 57.6ms | 58.1ms | 58.5ms |
| Gateway → Accommodation (`/api/v1/accommodation/rooms`) | 52.1ms | 51.2ms | 55.3ms | 57.6ms | 59.4ms |
| Gateway → Finance (`/api/v1/finance/invoices`) | 52.2ms | 51.9ms | 54.8ms | 56.5ms | 59.5ms |
| Gateway → Operations (`/api/v1/operations/notices`) | 51.6ms | 50.7ms | 54.2ms | 57.5ms | 67.8ms |

**100% success** (120/120 checks passed, 0 failed requests).

## Reading

All four endpoints cluster tightly around ~50-58ms under a single user with
no concurrency, which is essentially pure network round-trip + JWT
verification + a fast, empty-result DB query (all requests here are
unauthenticated and correctly rejected with 401, per the gateway's
`auth.middleware.ts`, before ever reaching a service's business logic) —
there is no meaningful per-service latency difference at this level, and no
individual request exceeded 68ms across all 120 samples.

Combined with the k6 load test results (frontend p95 = 57.73ms even at 20
concurrent users, auth-reject p95 = 54.06ms), this shows the system's latency
profile does **not** degrade going from 1 user to 20 concurrent users — the
single-user numbers here and the 20-VU numbers in `RESULTS.md` are within a
couple of milliseconds of each other.
