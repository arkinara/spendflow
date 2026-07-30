#!/usr/bin/env bash
# Post a SpendFlow cycle status update to Telegram.
# Reads TELEGRAM_BOT_TOKEN + TELEGRAM_HOME_CHANNEL from ~/.hermes/.env (already sourced by the orchestrator).
# Usage:
#   spendflow-tg.sh "<title>" "<body>"
# Example:
#   spendflow-tg.sh "Ticket #1 ✓ Done" "QA PASS. Commit 9bba07d. Next: #2 Employee Dashboard."
set -u

TITLE="${1:-}"
BODY="${2:-}"

if [ -z "$TITLE" ] || [ -z "$BODY" ]; then
  echo "usage: spendflow-tg.sh <title> <body>" >&2
  exit 2
fi

# Source hermes env if vars not already present
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_HOME_CHANNEL:-}" ]; then
  ENV_FILE="${HERMES_HOME:-$HOME/.hermes}/.env"
  if [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
  fi
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_HOME_CHANNEL:-}" ]; then
  echo "spendflow-tg: TELEGRAM_BOT_TOKEN or TELEGRAM_HOME_CHANNEL missing" >&2
  exit 3
fi

# Telegram message limit is 4096 chars; keep title + body reasonable
TEXT="*${TITLE}*

${BODY}"

# Truncate defensively
if [ "${#TEXT}" -gt 3800 ]; then
  TEXT="${TEXT:0:3750}…"
fi

export TEXT
PAYLOAD=$(TEXT="$TEXT" python3 -c "
import json, os
print(json.dumps({
  'chat_id': os.environ['TELEGRAM_HOME_CHANNEL'],
  'text': os.environ['TEXT'],
  'parse_mode': 'Markdown',
  'disable_web_page_preview': True,
}))
")

curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /dev/null || {
    echo "spendflow-tg: curl failed" >&2
    exit 4
  }
