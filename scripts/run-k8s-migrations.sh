#!/usr/bin/env bash
# Run the release image against the target namespace's database secret.
set -euo pipefail

namespace=${1:?Usage: run-k8s-migrations.sh namespace image}
image=${2:?Usage: run-k8s-migrations.sh namespace image}
job="migration-${GITHUB_SHA:0:12}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT

kubectl create job "$job" --namespace "$namespace" --image="$image" \
  --dry-run=client -o json -- node dist/migrate.js |
  node --input-type=commonjs -e '
    const fs = require("node:fs");
    const job = JSON.parse(fs.readFileSync(0, "utf8"));
    job.spec.backoffLimit = 0;
    job.spec.activeDeadlineSeconds = 600;
    job.spec.ttlSecondsAfterFinished = 86400;
    job.spec.template.spec.containers[0].env = [
      { name: "NODE_ENV", value: "production" },
      { name: "DATABASE_URL", valueFrom: {
        secretKeyRef: { name: "oddjob-secrets", key: "DATABASE_URL" }
      }}
    ];
    process.stdout.write(JSON.stringify(job));
  ' > "$manifest"

kubectl apply --namespace "$namespace" -f "$manifest"
if ! kubectl wait --namespace "$namespace" --for=condition=complete \
  "job/$job" --timeout=610s; then
  kubectl logs --namespace "$namespace" "job/$job" --all-containers=true || true
  kubectl describe job --namespace "$namespace" "$job" || true
  exit 1
fi
kubectl logs --namespace "$namespace" "job/$job" --all-containers=true
