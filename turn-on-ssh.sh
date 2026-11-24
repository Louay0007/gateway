#!/bin/sh
# Grants the Claude desktop app (3p deployment) permission to open SSH
# sessions to the hosts you name. Without it the app refuses every SSH
# connect with "SSH connections are disabled by your organization's
# managed settings".
#
# Run with:  sudo sh /tmp/turn-on-ssh.sh
# Undo with: sudo rm "/Library/Application Support/ClaudeCode/managed-settings.json"
set -e

DIR="/Library/Application Support/ClaudeCode"
FILE="$DIR/managed-settings.json"

mkdir -p "$DIR"

if [ -f "$FILE" ]; then
  echo "Refusing to touch an existing managed-settings file: $FILE" >&2
  echo "It may be managed by your organization. Showing it instead:" >&2
  cat "$FILE" >&2
  exit 1
fi

cat > "$FILE" <<'JSON'
{
  "sshHostAllowlist": ["db", "event-toolbox-db", "197.5.133.66", "gateway", "ssh-gateway", "15.224.52.176"]
}
JSON

chmod 644 "$FILE"
echo "Wrote $FILE"
cat "$FILE"
