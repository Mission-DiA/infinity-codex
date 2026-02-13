#!/bin/bash
# Infinity Codex - Infrastructure Setup Script
# Run this to create all required GCP resources

set -e

PROJECT_ID="kf-dev-ops-p001"
REGION="asia-south1"
ARTIFACT_REPO="helicarrier"

echo "=================================="
echo "Infinity Codex - Infrastructure Setup"
echo "=================================="

# ----------------------------------------
# 1. Create GCS Buckets
# ----------------------------------------
echo ""
echo "[1/4] Creating GCS Buckets..."

# UAT Bucket
if gsutil ls -b gs://axiom-docs-development 2>/dev/null; then
  echo "  ✓ UAT bucket already exists: axiom-docs-development"
else
  gsutil mb -p $PROJECT_ID -l $REGION gs://axiom-docs-development
  echo "  ✓ Created UAT bucket: axiom-docs-development"
fi

# Production Bucket
if gsutil ls -b gs://axiom-docs-production 2>/dev/null; then
  echo "  ✓ Production bucket already exists: axiom-docs-production"
else
  gsutil mb -p $PROJECT_ID -l $REGION gs://axiom-docs-production
  echo "  ✓ Created Production bucket: axiom-docs-production"
fi

# ----------------------------------------
# 2. Grant Cloud Run Service Account Access
# ----------------------------------------
echo ""
echo "[2/4] Configuring IAM..."

# Get the default compute service account
SA_EMAIL="${PROJECT_ID}@appspot.gserviceaccount.com"
COMPUTE_SA="444146736897-compute@developer.gserviceaccount.com"

# Grant bucket read access to Cloud Run SA
gsutil iam ch serviceAccount:$COMPUTE_SA:objectViewer gs://axiom-docs-development
gsutil iam ch serviceAccount:$COMPUTE_SA:objectViewer gs://axiom-docs-production
echo "  ✓ Granted objectViewer to Cloud Run service account"

# ----------------------------------------
# 3. Register App in Helicarrier Platform
# ----------------------------------------
echo ""
echo "[3/4] App Registration..."
echo "  → Register app manually in Helicarrier Firestore:"
echo "    - Database: helicarrier-development (UAT) / helicarrier-production (Prod)"
echo "    - Collection: apps"
echo "    - Document ID: infinity-codex"
echo "    - Fields:"
echo "      name: 'Infinity Codex'"
echo "      slug: 'infinity-codex'"
echo "      url: 'https://axiom-docs-development-du7mptaktq-el.a.run.app' (UAT)"
echo "      description: 'Documentation Portal'"
echo "      isActive: true"
echo "      authRequired: true"

# ----------------------------------------
# 4. Cloud Build Triggers
# ----------------------------------------
echo ""
echo "[4/4] Cloud Build Triggers..."
echo "  → Connect repo first: https://console.cloud.google.com/cloud-build/triggers;region=global/connect?project=444146736897"
echo "  → Then run:"
echo "    gcloud builds triggers create github --name='infinity-codex-development' --repo-owner='Mission-DiA' --repo-name='infinity-codex' --branch-pattern='^development\$' --build-config='cloudbuild-development.yaml' --project=$PROJECT_ID"
echo "    gcloud builds triggers create github --name='infinity-codex-production' --repo-owner='Mission-DiA' --repo-name='infinity-codex' --branch-pattern='^main\$' --build-config='cloudbuild-production.yaml' --project=$PROJECT_ID"

echo ""
echo "=================================="
echo "Infrastructure setup complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Connect repo to Cloud Build (link above)"
echo "2. Create triggers (commands above)"
echo "3. Register app in Firestore"
echo "4. Push to development branch to trigger first deployment"
