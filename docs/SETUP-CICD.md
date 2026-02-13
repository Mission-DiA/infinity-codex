# Infinity Codex — CI/CD Setup Guide

## Step 1: Connect Repository to Cloud Build (Manual)

The repository needs to be connected to Cloud Build via the GCP Console:

1. Go to: https://console.cloud.google.com/cloud-build/triggers;region=global/connect?project=444146736897
2. Select **GitHub** as the source
3. Authenticate and select **Mission-DiA/infinity-codex**
4. Complete the connection

## Step 2: Create Triggers (After Connecting)

Once the repo is connected, run these commands:

### UAT Trigger (development branch)
```bash
gcloud builds triggers create github \
  --name="infinity-codex-development" \
  --repo-owner="Mission-DiA" \
  --repo-name="infinity-codex" \
  --branch-pattern="^development$" \
  --build-config="cloudbuild-development.yaml" \
  --description="Infinity Codex development branch - deploys to UAT" \
  --project=kf-dev-ops-p001
```

### Production Trigger (main branch)
```bash
gcloud builds triggers create github \
  --name="infinity-codex-production" \
  --repo-owner="Mission-DiA" \
  --repo-name="infinity-codex" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild-production.yaml" \
  --description="Infinity Codex main branch - deploys to Production" \
  --project=kf-dev-ops-p001
```

## Trigger Summary

| Trigger | Branch | Config | Environment |
|---------|--------|--------|-------------|
| `infinity-codex-development` | `^development$` | `cloudbuild-development.yaml` | UAT |
| `infinity-codex-production` | `^main$` | `cloudbuild-production.yaml` | Production |

## Verification

After creating triggers:
```bash
gcloud builds triggers list --project=kf-dev-ops-p001 --filter="name~infinity-codex"
```
