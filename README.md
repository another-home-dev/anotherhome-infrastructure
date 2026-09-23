# another-home-infra

Deployment config for the Another Home system: the Helm chart, local
docker-compose / kind / Skaffold setups, and the Cloud Build pipeline that
deploys the chart to GKE.

Clone this repo **next to** the service repos; the compose and Skaffold files
build from `../another-home-*`:

```
another-home/
├── another-home-infra/          ← this repo
├── another-home-gateway/
├── another-home-accommodation/
├── another-home-finance/
├── another-home-operations/operations/
├── another-home-notification/
└── another-home-frontend/
```

## Secrets

Real values never go in git. Copy `.env.example` to `.env` and fill it in
(it's gitignored). `.env` feeds docker-compose, and Skaffold reads
`DB_PASSWORD` from it for local kind.

On GKE the secrets are stored in the Helm release itself. They were set once
with `--set-string`, and every later upgrade uses `--reuse-values`, so they
carry over. `DB_PASSWORD` is also MySQL's root password, and MySQL only reads
it when its data volume is first created, so don't change it on a running
cluster.

## Running it

| Where | Command |
|---|---|
| Docker Compose | `docker compose up --build` |
| Local kind | `kind create cluster --config kind-config.yaml`, then `skaffold dev` |
| GKE, by hand | `helm upgrade another-home k8s/another-home -n default --reuse-values` |

Live at <https://34.54.94.62.nip.io> (GKE Autopilot cluster `another-home`,
region `asia-southeast1`, project `another-home-sep25`).

## CI/CD (Cloud Build)

There are two kinds of pipeline:

| Pipeline | File | Runs on | Does |
|---|---|---|---|
| Service | `cloudbuild.yaml` in each service repo | push to `main` | `npm test` → docker build (tag = commit SHA) → push to Artifact Registry → `kubectl set image` + wait for rollout |
| Infra | `cloudbuild.yaml` here | push to `main` touching `k8s/**` | `helm upgrade --reuse-values --wait` |

A failing test stops the pipeline before anything is built. A new pod that
never becomes healthy fails the rollout step. In both cases the previous
version keeps serving traffic.

Images are tagged with the commit SHA, as well as `latest`. To roll back:

```
kubectl -n another-home set image deployment/<svc> <svc>=asia-southeast1-docker.pkg.dev/another-home-sep25/another-home-repo/another-home-<svc>:<older-sha>
```

Or use `kubectl -n another-home rollout undo deployment/<svc>`.

Builds run as the project's default compute service account, which has Editor.
A dedicated service account with only `artifactregistry.writer` and
`container.developer` would be tighter.

### One-time setup: connect GitHub

This step needs a browser and an owner of the `another-home-dev` GitHub
organisation:

1. Open GCP Console → Cloud Build → **Repositories** → **2nd gen** →
   **Create host connection** → GitHub. Region `asia-southeast1`,
   name `another-home-github`.
2. Authorise it, and install the Cloud Build GitHub App on the
   `another-home-dev` organisation, for the repos below.
3. Click **Link repositories** and add each repo.

### Create the triggers

```bash
REGION=asia-southeast1
CONN=another-home-github
SA=projects/another-home-sep25/serviceAccounts/951013866519-compute@developer.gserviceaccount.com

# <trigger name>:<linked repository name>
for pair in \
  gateway:another-home-gateway \
  accommodation:another-home-backend \
  finance:another-home-finance \
  operations:operations \
  notification:another-home-notifications \
  frontend:another-home-fronntend
do
  name=${pair%%:*}; repo=${pair##*:}
  gcloud builds triggers create github --region=$REGION --name=deploy-$name \
    --repository=projects/another-home-sep25/locations/$REGION/connections/$CONN/repositories/$repo \
    --branch-pattern='^main$' --build-config=cloudbuild.yaml --service-account=$SA
done

gcloud builds triggers create github --region=$REGION --name=deploy-infra \
  --repository=projects/another-home-sep25/locations/$REGION/connections/$CONN/repositories/another-home-infra \
  --branch-pattern='^main$' --build-config=cloudbuild.yaml --included-files='k8s/**' \
  --service-account=$SA
```

To run a pipeline without a push (for example, from a local checkout), run
this from the repo's root:

```
gcloud builds submit --region asia-southeast1 --config cloudbuild.yaml .
```

The image is then tagged `manual-<build id>`.
