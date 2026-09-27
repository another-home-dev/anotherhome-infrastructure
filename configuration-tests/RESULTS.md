# Configuration Test Results

Verifies the one Helm chart (`k8s/another-home`) actually works across the
two real platform configurations this project runs on, per
`run-configuration-test.sh`. Each configuration is rendered with `helm
template` and then validated with `kubectl apply --dry-run=server` against a
real Kubernetes API server (the local `kind-another-home` cluster) — this
checks schema/CRD validity, not just "is it parseable YAML". Nothing is
persisted (server-side dry run) and the ambient `kubectl` context is never
touched — every command targets `kind-another-home` explicitly, even though
the currently-active context is the live GKE cluster.

## `helm lint`

```
1 chart(s) linted, 0 chart(s) failed
```

## Config A — local `kind` (the chart's own defaults: `ingress.className: nginx`, `managedCertificate: false`, local image tags — matches what `skaffold.yaml` deploys)

**All 19 rendered resources validated successfully** against the real kind
API server: `Namespace`, `Secret`, 2 `ConfigMap`s, `PersistentVolumeClaim`,
7 `Service`s, 6 `Deployment`s, and the `Ingress` (rendered with
`ingressClassName: nginx` and no GKE-only annotations).

## Config B — GKE Autopilot (`configuration-tests/values-gke-overlay.yaml`, pulled from the actual live release's non-secret values)

**18 of 19 resources validated successfully.** The one failure:

```
error: resource mapping not found for name: "another-home-cert" namespace: "another-home"
  from ".../another-home-config-b-gke.yaml": no matches for kind "ManagedCertificate" in version "networking.gke.io/v1"
ensure CRDs are installed first
```

**This is expected, not a bug.** `templates/managed-certificate.yaml` only
renders when `ingress.managedCertificate: true` (true for GKE, false for
local kind), and it creates a `ManagedCertificate` — a Custom Resource Definition
that only exists on GKE clusters running Google's own ingress controller. A
generic `kind` cluster has no such CRD, so it correctly can't validate that
one resource. Every other resource in the GKE configuration — including the
differently-rendered `Ingress` (no `ingressClassName`, the
`kubernetes.io/ingress.global-static-ip-name` annotation, no
`nginx.ingress.kubernetes.io/*` annotations) — rendered and validated
correctly.

## Conclusion

The same Helm chart correctly parameterizes for both target platforms this
project actually deploys to. The single expected gap (a GKE-only CRD not
existing on a non-GKE cluster) is exactly the kind of platform difference
Configuration Testing exists to surface and explain, not something to
"fix" — the template already guards it behind `ingress.managedCertificate`,
so it simply doesn't render on platforms that can't use it.
