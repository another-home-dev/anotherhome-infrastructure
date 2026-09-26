# Failover and Recovery Test Results

Ran against the live GKE Autopilot deployment at https://34.54.94.62.nip.io on
2026-09-26, using `run-failover-test.sh`. Each run deletes the single running
pod of a service (all services currently run at 1 replica) and polls a real
request path through it every 0.5s, recording every non-expected response so
gaps are visible rather than just the eventual recovery.

## Run 1 — internal service (`operations`), reached via ClusterIP + CoreDNS

```
./run-failover-test.sh another-home app=operations \
  https://34.54.94.62.nip.io/api/v1/operations/notices 401
```

**Result: 0 failed polls out of 100** (20 seconds of polling at 0.2s
intervals) spanning the pod's deletion and full replacement. The new pod
(`operations-85dd6b66f9-7658w`) was already `Running`/`Ready` by the time the
check completed.

**Why**: internal service-to-service calls go through a plain Kubernetes
`Service` (ClusterIP) resolved via CoreDNS (see `k8s/another-home/templates/
services.yaml`), and `kube-proxy` updates the endpoint list fast enough,
combined with the pod's own quick NestJS startup, that no request was ever
routed to a dead or not-yet-ready backend.

## Run 2 — the gateway pod itself, reached via the public GKE Ingress

```
./run-failover-test.sh another-home app=gateway \
  https://34.54.94.62.nip.io/api/v1/accommodation/rooms 401
```

**Result: 38 failed polls out of 90** (45 seconds at 0.5s intervals):

| Time since pod deletion | Observed |
|---|---|
| t+2.0s – t+7.1s | `000` (connection refused — old pod already gone, LB has no live backend) |
| t+7.8s – t+31.0s | `502 Bad Gateway` consistently |
| t+31.7s | first `401` (recovered) |
| t+32.4s | one more `502` (brief flap) |
| after t+32.4s | stable `401` for the rest of the run |

**Total visible downtime: ~32 seconds.**

**Why**: the gateway is the one service reached directly through the GKE
Ingress (a Google Cloud external HTTP(S) Load Balancer), not through
in-cluster CoreDNS. That load balancer's own backend health checks run on a
slower interval than `kube-proxy`'s endpoint updates, so it kept routing to
(or had no ready backend to route to at all) for ~30s after the old pod
disappeared — this matches an unplanned incident observed earlier in this
project (a GKE Autopilot cost-driven eviction produced the same ~30-40s
502 window right after a rollout).

## Conclusion

The system **recovers automatically with no manual intervention** in both
cases (Kubernetes' self-healing `Deployment` behavior), which meets the
baseline success criterion for this test. But single-replica services behind
the public Ingress (currently: just `gateway`) have a real, repeatable
~30-second outage window on any pod replacement — a planned rollout, a node
eviction, or a crash. Internal-only services don't have this problem because
they're reached via CoreDNS/ClusterIP, not the external load balancer.

**Recommendation** (not implemented, to respect current resource/cost
constraints on this Autopilot cluster): run the `gateway` Deployment at 2
replicas. With more than one backend already registered with the load
balancer, deleting one pod would no longer create a window with zero ready
backends.
