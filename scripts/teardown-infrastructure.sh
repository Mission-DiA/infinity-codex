#!/bin/bash
# Infinity Codex - Infrastructure Teardown Script
# Run this to remove all GCP resources (USE WITH CAUTION)

set -e

PROJECT_ID="kf-dev-ops-p001"
REGION="asia-south1"

echo "=================================="
echo "Infinity Codex - Infrastructure Teardown"
echo "=================================="
echo ""
echo "⚠️  WARNING: This will delete all Infinity Codex resources!"
echo ""
read -p "Type 'DELETE' to confirm: " CONFIRM

if [ "$CONFIRM" != "DELETE" ]; then
  echo "Aborted."
  exit 1
fi

# ----------------------------------------
# 1. Delete Cloud Run Services
# ----------------------------------------
echo ""
echo "[1/4] Deleting Cloud Run Services..."

gcloud run services delete axiom-docs-development --region=$REGION --project=$PROJECT_ID --quiet 2>/dev/null || echo "  - UAT service not found or already deleted"
gcloud run services delete axiom-docs-production --region=$REGION --project=$PROJECT_ID --quiet 2>/dev/null || echo "  - Production service not found or already deleted"

echo "  ✓ Cloud Run services deleted"

# ----------------------------------------
# 2. Delete Cloud Build Triggers
# ----------------------------------------
echo ""
echo "[2/4] Deleting Cloud Build Triggers..."

gcloud builds triggers delete infinity-codex-development --project=$PROJECT_ID --quiet 2>/dev/null || echo "  - UAT trigger not found"
gcloud builds triggers delete infinity-codex-production --project=$PROJECT_ID --quiet 2>/dev/null || echo "  - Production trigger not found"

echo "  ✓ Cloud Build triggers deleted"

# ----------------------------------------
# 3. Delete GCS Buckets
# ----------------------------------------
echo ""
echo "[3/4] Deleting GCS Buckets..."

gsutil -m rm -r gs://axiom-docs-development/** 2>/dev/null || true
gsutil rb gs://axiom-docs-development 2>/dev/null || echo "  - UAT bucket not found"

gsutil -m rm -r gs://axiom-docs-production/** 2>/dev/null || true
gsutil rb gs://axiom-docs-production 2>/dev/null || echo "  - Production bucket not found"

echo "  ✓ GCS buckets deleted"

# ----------------------------------------
# 4. Remove App from Firestore
# ----------------------------------------
echo ""
echo "[4/4] Firestore Cleanup..."
echo "  → Manually delete app document from Firestore:"
echo "    - Database: helicarrier-development, helicarrier-production"
echo "    - Collection: apps"
echo "    - Document ID: infinity-codex"

echo ""
echo "=================================="
echo "Teardown complete!"
echo "=================================="
