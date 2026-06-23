#!/bin/sh

set -eu

if [ "${IN_DEVCONTAINER:-0}" != "1" ]; then
  echo "This task expects the MMM-LibraryMonitor devcontainer with MagicMirror/PM2 to be running." >&2
  exit 1
fi

exec "$@"