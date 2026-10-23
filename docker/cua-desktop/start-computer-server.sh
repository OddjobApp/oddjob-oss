#!/bin/sh
set -eu
export DISPLAY="${DISPLAY:-:1}"
for attempt in $(seq 1 120); do
    if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
    sleep 1
done
exec /opt/oddjob-computer/bin/python -m computer_server --port 8000
