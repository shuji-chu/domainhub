#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-https://domainhub-api.chulingli1988.workers.dev}"
export EMAIL="${TEST_EMAIL:-domainhub-smoke-$(date +%s)@example.net}"
export PASSWORD="${TEST_PASSWORD:-ChangeMe-OnlyFor-Smoke-2026!}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

request() {
  local name="$1"; shift
  local code
  code="$(curl --silent --show-error --output "$tmp/$name.json" --write-out '%{http_code}' "$@")"
  printf '%s %s\n' "$name" "$code"
  cat "$tmp/$name.json"
  printf '\n'
  [[ "$code" == 2* ]] || { echo "$name failed" >&2; exit 1; }
}

request health "$API_BASE/health"
request register -X POST "$API_BASE/auth/register" -H 'Content-Type: application/json' \
  --data "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"],"displayName":"Worker smoke test"}))')"

TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$tmp/register.json")"
[[ -n "$TOKEN" ]] || { echo "register did not return token" >&2; exit 1; }

request me "$API_BASE/auth/me" -H "Authorization: Bearer $TOKEN"
request logout -X POST "$API_BASE/auth/logout" -H "Authorization: Bearer $TOKEN"

echo "PASS: health, D1 registration, authenticated session lookup, logout"
echo "Test identity: $EMAIL"
