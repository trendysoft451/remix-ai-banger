#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:=http://localhost:3000}"
: "${GPT_ACTION_API_KEY:?Définissez GPT_ACTION_API_KEY}"
: "${AUDIO_URL:?Définissez AUDIO_URL vers un fichier audio accessible}"

curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/v1/remixes/professional" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $GPT_ACTION_API_KEY" \
  -d "$(cat <<JSON
{
  "openaiFileIdRefs": ["$AUDIO_URL"],
  "style": "melodic techno festival",
  "bpm": 126,
  "intensity": 8,
  "preserveVocals": true,
  "notes": "Intro courte, montée progressive et drop puissant."
}
JSON
)"
echo
