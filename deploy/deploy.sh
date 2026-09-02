#!/usr/bin/env bash
# Ship app/ to the target container and restart the service.
# Usage: ./deploy/deploy.sh [--config]
#   MODBUS_CT   - container id on the hypervisor (default: 419)
#   MODBUS_HOST - ssh alias of the hypervisor  (default: pve)
set -euo pipefail
CT="${MODBUS_CT:-419}"
HOST="${MODBUS_HOST:-pve}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> pakowanie"
tar -C "$SRC" -czf /tmp/modbus-ui.tgz app

echo "==> wysylka na $HOST -> LXC $CT"
scp -q /tmp/modbus-ui.tgz "$HOST":/tmp/modbus-ui.tgz
ssh "$HOST" "pct push $CT /tmp/modbus-ui.tgz /tmp/modbus-ui.tgz"
# tar --overwrite zastepuje pliki w miejscu, bez kasowania katalogu
ssh "$HOST" "pct exec $CT -- bash -c 'mkdir -p /opt/modbus-ui && tar -C /opt/modbus-ui --overwrite -xzf /tmp/modbus-ui.tgz && chown -R modbus:modbus /opt/modbus-ui'"

if [[ "${1:-}" == "--config" ]]; then
  echo "==> config.json"
  scp -q "$SRC/deploy/config.json" "$HOST":/tmp/modbus-config.json
  ssh "$HOST" "pct push $CT /tmp/modbus-config.json /etc/modbus-ui/config.json"
fi

echo "==> restart"
ssh "$HOST" "pct exec $CT -- systemctl restart modbus-ui"
sleep 2
ssh "$HOST" "pct exec $CT -- systemctl is-active modbus-ui"
