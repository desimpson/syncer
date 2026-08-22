#!/usr/bin/env bash
# Issue #110 — recreate obsidiansyncer-* GCP projects (idempotent).
# Maintainer-only. obsidiansyncer-dev is not a shared contributor project;
# other developers create their own GCP project + Desktop client locally.
#
# Run from repo root (requires gcloud auth login + billing access):
#   bash scripts/gcp/recreate-projects-110.sh
#
# Optional: export CLOUDSDK_CONFIG="$PWD/.gcloud" for an isolated SDK config
# (copy or re-auth into that directory first).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="${REPO_ROOT}/artifacts/gcp-110"
CONTROL_PROJECT="${CONTROL_PROJECT:-obsidian-syncer-production}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-01CEBD-5351BB-A33BFD}"
PROJECT_IDS=(obsidiansyncer-dev obsidiansyncer-staging obsidiansyncer-prod)
PROJECT_NAMES=("Syncer Dev" "Syncer Staging" "Syncer")
ENV_LABELS=(dev staging prod)
OLD_PROJECT_IDS=(obsidian-syncer-development obsidian-syncer-production)
OAUTH_MODE="${OAUTH_MODE:-auto}"

mkdir -p "${ARTIFACTS}/oauth"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

require_active_account() {
  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)"
  [[ -n "${account}" ]] || die "No active gcloud account. Run: gcloud auth login"
  log "Active account: ${account}"
}

require_billing_open() {
  local open
  open="$(gcloud billing accounts describe "${BILLING_ACCOUNT}" --format='value(open)')"
  [[ "${open}" == "True" ]] || die "Billing account ${BILLING_ACCOUNT} is not open"
  log "Billing account ${BILLING_ACCOUNT}: open"
}

oauth_preflight() {
  local access_token
  access_token="$(gcloud auth print-access-token)"
  curl -sS \
    -H "Authorization: Bearer ${access_token}" \
    "https://cloudresourcemanager.googleapis.com/v1/projects/${CONTROL_PROJECT}" \
    > "${ARTIFACTS}/oauth/probe-crm-project.json"

  python3 - <<'PY' "${ARTIFACTS}/oauth/probe-crm-project.json"
import json, sys
data = json.load(open(sys.argv[1]))
if "projectId" not in data:
    raise SystemExit(f"CRM probe failed: {data}")
print(f"CRM probe OK: {data['projectId']}")
PY

  # Google Auth Platform Desktop client creation has no stable public REST API
  # for new projects (IAP OAuth Admin APIs are deprecated for new projects).
  cat > "${ARTIFACTS}/oauth/mode-decision.txt" <<EOF
OAuth automation probe: Mode B (Console manual)
Reason: no public REST endpoint for Google Auth Platform Desktop client + consent setup
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Operator: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)
EOF
  log "OAuth mode: B (Console manual — see artifacts/gcp-110/manual-step.md)"
}

quota_preflight() {
  gcloud beta quotas info list \
    --project="${CONTROL_PROJECT}" \
    --service=cloudresourcemanager.googleapis.com \
    --format=json > "${ARTIFACTS}/quota-cloudresourcemanager.json" 2>&1 || true
  gcloud projects list --format='value(projectId)' \
    > "${ARTIFACTS}/current-projects-visible.txt"
  log "Quota preflight saved under ${ARTIFACTS}/"
}

create_projects() {
  local i pid pname env
  for i in "${!PROJECT_IDS[@]}"; do
    pid="${PROJECT_IDS[$i]}"
    pname="${PROJECT_NAMES[$i]}"
    env="${ENV_LABELS[$i]}"
    if gcloud projects describe "${pid}" --format=json > "${ARTIFACTS}/${pid}-project.json" 2>/dev/null; then
      log "Project exists: ${pid}"
    else
      gcloud projects create "${pid}" \
        --name="${pname}" \
        --labels="env=${env},managed_by=syncer,issue=110" \
        --format=json > "${ARTIFACTS}/${pid}-create.json"
      gcloud projects describe "${pid}" --format=json > "${ARTIFACTS}/${pid}-project.json"
      log "Project created: ${pid}"
    fi
  done
}

link_billing() {
  local pid enabled
  for pid in "${PROJECT_IDS[@]}"; do
    gcloud billing projects link "${pid}" \
      --billing-account="${BILLING_ACCOUNT}" \
      --format=json > "${ARTIFACTS}/${pid}-billing-link.json" 2>&1 || true
    gcloud billing projects describe "${pid}" \
      --format=json > "${ARTIFACTS}/${pid}-billing.json"
    enabled="$(gcloud billing projects describe "${pid}" --format='value(billingEnabled)')"
    [[ "${enabled}" == "True" ]] || die "Billing not enabled for ${pid}"
    log "Billing enabled: ${pid}"
  done
}

enable_apis() {
  local pid
  for pid in "${PROJECT_IDS[@]}"; do
    gcloud services enable tasks.googleapis.com gmail.googleapis.com --project="${pid}"
    gcloud services list --enabled --project="${pid}" --format=json \
      > "${ARTIFACTS}/${pid}-enabled-services.json"
    gcloud services list --enabled --project="${pid}" \
      --filter='config.name:(tasks.googleapis.com OR gmail.googleapis.com)' \
      --format='value(config.name)' \
      > "${ARTIFACTS}/${pid}-required-apis.txt"
    log "APIs enabled (Tasks + Gmail): ${pid}"
  done
}

verify_old_projects() {
  local pid
  for pid in "${OLD_PROJECT_IDS[@]}"; do
    gcloud projects describe "${pid}" --format=json \
      > "${ARTIFACTS}/${pid}-project.json"
    gcloud services list --enabled --project="${pid}" --format=json \
      > "${ARTIFACTS}/${pid}-enabled-services.json"
    log "Old project preserved: ${pid}"
  done
}

write_manual_oauth_runbook() {
  cat > "${ARTIFACTS}/manual-step.md" <<'EOF'
# Issue #110 — manual OAuth steps (Mode B)

Google Auth Platform Desktop OAuth clients and consent app names cannot be created
reliably via public REST/gcloud for new projects. Complete these steps in Console
for each project, in order:

| Project ID | Consent app name (#130) | Console branding | Console clients |
| --- | --- | --- | --- |
| obsidiansyncer-dev | Syncer Dev | https://console.cloud.google.com/auth/branding?project=obsidiansyncer-dev | https://console.cloud.google.com/auth/clients?project=obsidiansyncer-dev |
| obsidiansyncer-staging | Syncer Staging | https://console.cloud.google.com/auth/branding?project=obsidiansyncer-staging | https://console.cloud.google.com/auth/clients?project=obsidiansyncer-staging |
| obsidiansyncer-prod | Syncer | https://console.cloud.google.com/auth/branding?project=obsidiansyncer-prod | https://console.cloud.google.com/auth/clients?project=obsidiansyncer-prod |

Per project:

1. Open **Branding** → set app name to the value in the table (#130).
2. Complete OAuth consent registration if prompted (External, testing mode is fine for now).
3. Open **Clients** → **Create client** → **Desktop app** → create exactly one client.
4. Save the client ID (not the secret) to `artifacts/gcp-110/oauth/<project-id>-client-id.txt`.

Do **not** create Web application or UWP clients. Secret handling and runtime auth
migration are tracked in #146; client ID cutover in build/release is #184+.

After all three client IDs are captured, re-run verification:

```bash
for pid in obsidiansyncer-dev obsidiansyncer-staging obsidiansyncer-prod; do
  test -s "artifacts/gcp-110/oauth/${pid}-client-id.txt" || echo "MISSING: ${pid}"
done
```
EOF
}

write_summary() {
  cat > "${ARTIFACTS}/summary.md" <<EOF
# Issue #110 automation summary

- Mode: OAuth Mode B (Console manual for consent + Desktop clients)
- Projects: ${PROJECT_IDS[*]}
- Billing account linked: ${BILLING_ACCOUNT}
- APIs enabled: tasks.googleapis.com, gmail.googleapis.com (all three projects)
- Old projects preserved: ${OLD_PROJECT_IDS[*]} (no delete/disable commands run)
- #121 status: Trust & Safety cancellation mail sent 21 Aug 2026 — https://github.com/desimpson/syncer/issues/121#issuecomment-5368972193
- OAuth manual runbook: artifacts/gcp-110/manual-step.md
- Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
  log "Summary written: ${ARTIFACTS}/summary.md"
}

main() {
  cd "${REPO_ROOT}"
  require_active_account
  require_billing_open
  oauth_preflight
  quota_preflight
  create_projects
  link_billing
  enable_apis
  verify_old_projects
  write_manual_oauth_runbook
  write_summary
  log "Automated phases complete. Finish OAuth in Console (see manual-step.md)."
}

main "$@"
