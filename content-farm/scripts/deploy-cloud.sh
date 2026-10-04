#!/usr/bin/env bash
# Deploys the content farm to Google Cloud: one Cloud Run Job + two Cloud Scheduler triggers.
#   bash content-farm/scripts/deploy-cloud.sh            (needs gcloud logged in, project set)
# Keys are read from content-farm/.env into the job's env vars (never printed).
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-europe-west1}"
JOB="seal-farm"
SA_NAME="seal-farm-scheduler"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
FARM="$(cd "$(dirname "$0")/.." && pwd)"
cd "$FARM"

echo "→ project $PROJECT, region $REGION"

# 1) Sílі's renders live in the site's public dir; bake a copy into the image.
rm -rf assets/mascot3d && cp -r ../public/mascot3d assets/mascot3d

# 2) Env vars file from .env (only the keys the farm reads), removed right after deploy.
ENVFILE="$(mktemp)"
trap 'rm -f "$ENVFILE"' EXIT
while IFS='=' read -r key value; do
  case "$key" in
    SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS_API_KEY|GEMINI_API_KEY|YOUTUBE_API_KEY|FARM_NOTIFY_CHAT_ID)
      [ -n "$value" ] && printf '%s: "%s"\n' "$key" "${value//\"/\\\"}" >> "$ENVFILE" ;;
  esac
done < <(grep -E '^[A-Z_]+=' .env | tr -d '\r')

# 3) Build from source (Cloud Build, Dockerfile) and create/update the job.
#    2 vCPU / 4 GiB keeps a ~45 s video render around 3–5 minutes.
gcloud run jobs deploy "$JOB" \
  --source . \
  --region "$REGION" \
  --cpu 2 --memory 4Gi \
  --task-timeout 60m --max-retries 0 \
  --env-vars-file "$ENVFILE" \
  --quiet

# 4) Scheduler identity allowed to start the job (with argument overrides).
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name "Seal content farm scheduler"
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member "serviceAccount:$SA" --role roles/run.developer --quiet >/dev/null

RUN_URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
schedule() { # name, cron, body
  local args=(--location "$REGION" --schedule "$2" --time-zone "Europe/Kyiv" --uri "$RUN_URI" --http-method POST
    --oauth-service-account-email "$SA" --message-body "$3")
  # create and update spell the headers flag differently.
  if gcloud scheduler jobs describe "$1" --location "$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$1" "${args[@]}" --update-headers "Content-Type=application/json" --quiet >/dev/null
  else
    gcloud scheduler jobs create http "$1" "${args[@]}" --headers "Content-Type=application/json" --quiet >/dev/null
  fi
}
# Pack: the job wakes at 06:00 Kyiv every day and skips when the last pack is under 30 h old
# (src/cli.ts), so packs are a true 48 hours apart and ready by the morning.
schedule seal-farm-pack "0 6 * * *" '{"overrides":{"containerOverrides":[{"args":["pack"]}]}}'
# Work: an approval starts the job at once (farm-kick Edge Function); this tick is the safety net
# and what retries items after a provider outage. Idle runs exit in seconds.
schedule seal-farm-work "0 6-23 * * *" '{}'
# Backup: every Monday night the school's tables are exported to Google Drive (src/backup.ts).
schedule seal-farm-backup "0 4 * * 1" '{"overrides":{"containerOverrides":[{"args":["backup"]}]}}'

rm -rf assets/mascot3d
echo "✔ Deployed. Manual run: gcloud run jobs execute $JOB --region $REGION --args=pack"
