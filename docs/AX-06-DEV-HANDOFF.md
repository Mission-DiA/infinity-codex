# Infinity Codex — Developer Handoff Guide

> **For:** External development team (Axiom docs maintainers)
> **From:** Helicarrier Platform Team
> **Date:** 2026-02-13

---

## Overview

The **Infinity Codex** is a documentation portal hosted on the Helicarrier Platform. Your team will publish HTML documentation to a Google Cloud Storage (GCS) bucket, and the platform will automatically render it for authenticated users.

**You push HTML files → We serve them securely.**

---

## GCS Bucket Information

| Environment | Bucket Name | Purpose |
|-------------|-------------|---------|
| **UAT** | `axiom-docs-development` | Testing & validation |
| **Production** | `axiom-docs-production` | Live documentation |

**GCP Project:** `kf-dev-ops-p001`
**Region:** `asia-south1`

---

## Required Folder Structure

```
gs://axiom-docs-development/
├── index.html              ← Portal landing page (we manage this)
├── axiom/                  ← Your Axiom framework docs go here
│   ├── index.html          ← Axiom docs landing page
│   ├── getting_started.html
│   ├── installation.html
│   ├── api/
│   │   └── *.html
│   ├── user_guide/
│   │   └── *.html
│   └── _static/            ← CSS, JS, images
│       └── ...
└── mongodb/                ← MongoDB schema docs (if applicable)
    └── *.html
```

**Important:**
- Push your docs to the `axiom/` folder (not the root)
- The root `index.html` is the portal — don't overwrite it
- Maintain your existing Sphinx output structure

---

## How to Sync Files to GCS

### Option 1: gsutil (Recommended for CI/CD)

```bash
# Sync your Sphinx HTML output to the axiom/ folder
gsutil -m rsync -r -d ./html/ gs://axiom-docs-development/axiom/
```

**Flags:**
- `-m` — Parallel upload (faster)
- `-r` — Recursive
- `-d` — Delete files in destination that don't exist in source (keeps bucket clean)

### Option 2: gcloud storage (Alternative)

```bash
gcloud storage rsync ./html/ gs://axiom-docs-development/axiom/ --recursive --delete-unmatched-destination-objects
```

### CI/CD Integration Example

```yaml
# Example GitHub Actions step
- name: Deploy docs to GCS
  run: |
    gsutil -m rsync -r -d ./docs/_build/html/ gs://axiom-docs-development/axiom/
```

---

## Authentication & Access

### Service Account Requirements

Your CI/CD pipeline needs a service account with the following role:

| Role | Purpose |
|------|---------|
| `roles/storage.objectAdmin` | Read/write/delete objects in the bucket |

**To grant access (Platform team will do this):**
```bash
gsutil iam ch serviceAccount:YOUR_SA@PROJECT.iam.gserviceaccount.com:objectAdmin gs://axiom-docs-development
```

**Provide us:**
- Your service account email (e.g., `github-actions@your-project.iam.gserviceaccount.com`)

---

## What the Platform Does

1. **Serves your HTML** — All files in the bucket are served via Cloud Run
2. **Injects Platform integration** — Handles authentication handshake
3. **Adds navigation** — "Back to Portal" button on all doc pages
4. **Handles auth** — Only authenticated Helicarrier users can access

**You don't need to:**
- Add any authentication code
- Modify your HTML output
- Worry about CORS or security headers

---

## Testing Your Deployment

After syncing to UAT bucket:

1. Go to: https://helicarrier-dev.zingworks.com
2. Log in with your Helicarrier account
3. Open the **Infinity Codex** app
4. Click on **Axiom** card
5. Verify your docs render correctly

---

## Production Deployment

Once UAT is validated:

1. Sync to production bucket:
   ```bash
   gsutil -m rsync -r -d ./html/ gs://axiom-docs-production/axiom/
   ```

2. Notify Platform team to verify

**Production URL:** https://helicarrier.zingworks.com → Infinity Codex

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 errors | Check file exists in bucket: `gsutil ls gs://axiom-docs-development/axiom/` |
| Stale content | Clear browser cache or wait 1-2 minutes for CDN |
| Permission denied | Verify service account has `objectAdmin` role |
| Broken links | Ensure relative paths in your HTML (not absolute) |

---

## Contact

For access requests or issues:
- **Platform Team:** [Your contact info]
- **Slack:** #helicarrier-platform

---

*"Your docs, our platform, secure access."*
