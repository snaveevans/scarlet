#!/usr/bin/env bash
set -euo pipefail

SCARLET_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="${1:-scarlet}"
CONFIG_PATH="${2:-}"

echo "=== Scarlet Install ==="
echo "Install directory: $SCARLET_DIR"

# Check Node.js version
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required (v20+). Install it first."
  exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required, found v$(node -v)"
  exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm ci --prefix "$SCARLET_DIR"

# Create config if not provided
CONFIG_DIR="/etc/scarlet"
if [ -z "$CONFIG_PATH" ]; then
  CONFIG_PATH="$CONFIG_DIR/${SERVICE_NAME}.json"
  if [ ! -f "$CONFIG_PATH" ]; then
    echo ""
    echo "No config found at $CONFIG_PATH"
    echo "Creating from template — you MUST edit this before starting."
    sudo mkdir -p "$CONFIG_DIR"
    sudo cp "$SCARLET_DIR/configs/example.json" "$CONFIG_PATH"
    sudo chmod 644 "$CONFIG_PATH"
    echo "  -> Edit: sudo vi $CONFIG_PATH"
  else
    echo "Config exists: $CONFIG_PATH"
  fi
fi

# Create state directory
STATE_DIR="/var/lib/scarlet"
sudo mkdir -p "$STATE_DIR"
sudo chmod 755 "$STATE_DIR"

# Install systemd service
if command -v systemctl &>/dev/null; then
  echo ""
  echo "Installing systemd service..."

  # Generate the service file with the correct ExecStart path
  SERVICE_FILE="/etc/systemd/system/scarlet@.service"
  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Scarlet Autonomous Coding Agent (instance: %i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${SCARLET_DIR}/src/index.mjs --config /etc/scarlet/%i.json
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=-/etc/scarlet/%i.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/scarlet

# Logging goes to journald; also written to file per config
StandardOutput=journal
StandardError=journal
SyslogIdentifier=scarlet-%i

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  echo "  -> Service installed: scarlet@${SERVICE_NAME}"
  echo ""
  echo "=== Next steps ==="
  echo "1. Edit your config:    sudo vi /etc/scarlet/${SERVICE_NAME}.json"
  echo "2. Set env vars:        sudo vi /etc/scarlet/${SERVICE_NAME}.env"
  echo "3. Enable & start:      sudo systemctl enable --now scarlet@${SERVICE_NAME}"
  echo "4. Check status:        sudo systemctl status scarlet@${SERVICE_NAME}"
  echo "5. View logs:           journalctl -u scarlet@${SERVICE_NAME} -f"
else
  echo ""
  echo "systemd not found — skipping service install."
  echo ""
  echo "=== Next steps ==="
  echo "1. Edit your config:    vi $CONFIG_PATH"
  echo "2. Run manually:        node ${SCARLET_DIR}/src/index.mjs --config $CONFIG_PATH"
  echo "3. Run once:            node ${SCARLET_DIR}/src/index.mjs --config $CONFIG_PATH --once"
fi

echo ""
echo "Done."
