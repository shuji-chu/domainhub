#!/usr/bin/env bash
set -euo pipefail
API_BASE="${API_BASE:-https://domainhub-api.chulingli1988.workers.dev}"
EMAIL="${TEST_EMAIL:-domainhub-smoke-$(date +%s)@example.net}"
PASSWORD="${TEST_PASSWORD:-ChangeMe-OnlyFor-Smoke-2026!}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
call(){ local name="$1" expected="$2"; shift 2; local code; code="$(curl -sS -o "$tmp/$name.json" -w '%{http_code}' "$@")"; echo "$name HTTP $code"; cat "$tmp/$name.json"; echo; [[ "$code" == "$expected" ]] || { echo "Expected HTTP $expected, got $code" >&2; exit 1; }; }
call health 200 "$API_BASE/health"
call register 200 -X POST "$API_BASE/auth/register" -H 'Content-Type: application/json' --data "$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -c 'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"],"displayName":"DomainHub smoke"}))')"
call unverified_login 401 -X POST "$API_BASE/auth/login" -H 'Content-Type: application/json' --data "$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -c 'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"]}))')"
call forgot_password 200 -X POST "$API_BASE/auth/password/forgot" -H 'Content-Type: application/json' --data "$(EMAIL="$EMAIL" python3 -c 'import json,os;print(json.dumps({"email":os.environ["EMAIL"]}))')"
call invalid_verify 400 "$API_BASE/auth/email/verify?token=invalid-token-for-smoke-test"
call invalid_reset 400 -X POST "$API_BASE/auth/password/reset" -H 'Content-Type: application/json' --data '{"token":"invalid-token-for-smoke-test","password":"ChangeMe-OnlyFor-Smoke-2026!"}'
# Optional complete flow: set TEST_VERIFY_TOKEN to the raw token from the verification email.
if [[ -n "${TEST_VERIFY_TOKEN:-}" ]]; then
  call verify 200 "$API_BASE/auth/email/verify?token=$TEST_VERIFY_TOKEN"
  call login 200 -X POST "$API_BASE/auth/login" -H 'Content-Type: application/json' --data "$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -c 'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"]}))')"
  TOKEN="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["token"])' "$tmp/login.json")"
  call me 200 "$API_BASE/auth/me" -H "Authorization: Bearer $TOKEN"
  call inventory 200 "$API_BASE/domains" -H "Authorization: Bearer $TOKEN"
  call logout 200 -X POST "$API_BASE/auth/logout" -H "Authorization: Bearer $TOKEN"
  echo "AUTH_COMPLETE_FLOW=PASS"
else
  echo "AUTH_COMPLETE_FLOW=SKIP (set TEST_VERIFY_TOKEN after receiving the email)"
fi
echo "PUBLIC_AUTH_FLOW=PASS"
