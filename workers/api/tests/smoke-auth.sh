#!/usr/bin/env bash
set -euo pipefail
API_BASE="${API_BASE:-https://domainhub-api.chulingli1988.workers.dev}"
export EMAIL="${TEST_EMAIL:-domainhub-smoke-$(date +%s)@example.net}"
export PASSWORD="${TEST_PASSWORD:-ChangeMe-OnlyFor-Smoke-2026!}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
request(){ local n="$1"; shift; local c; c="$(curl -sS -o "$tmp/$n.json" -w '%{http_code}' "$@")"; echo "$n HTTP $c"; cat "$tmp/$n.json"; echo; [[ "$c" == 2* ]] || exit 1; }
request health "$API_BASE/health"
request register -X POST "$API_BASE/auth/register" -H 'Content-Type: application/json' --data "$(python3 -c 'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"],"displayName":"DomainHub smoke"}))')"
TOKEN="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["token"])' "$tmp/register.json")"
request me "$API_BASE/auth/me" -H "Authorization: Bearer $TOKEN"
request inventory "$API_BASE/domains" -H "Authorization: Bearer $TOKEN"
DOMAIN_ID="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1])).get("domains",[]);print(d[0]["id"] if d else "")' "$tmp/inventory.json")"
if [[ -n "$DOMAIN_ID" ]]; then
 export DOMAIN_ID
 request claim "$API_BASE/domains/claim" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$(python3 -c 'import json,os;print(json.dumps({"inventoryId":os.environ["DOMAIN_ID"]}))')"
 request mine "$API_BASE/domains/mine" -H "Authorization: Bearer $TOKEN"
 echo "CLAIM_FLOW=PASS"
else
 echo "CLAIM_FLOW=SKIP (D1 inventory is empty; run admin DNSHE inventory sync after configuring DNSHE_API_TOKEN)"
fi
request logout -X POST "$API_BASE/auth/logout" -H "Authorization: Bearer $TOKEN"
echo "AUTH_FLOW=PASS"
echo "TEST_EMAIL=$EMAIL"
