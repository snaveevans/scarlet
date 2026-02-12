#!/usr/bin/env bash
set -euo pipefail

SCARLET_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="${1:-scarlet}"
CONFIG_PATH_INPUT="${2:-}"

CONFIG_DIR="/etc/scarlet"
CONFIG_PATH="${CONFIG_DIR}/${SERVICE_NAME}.json"
ENV_PATH="${CONFIG_DIR}/${SERVICE_NAME}.env"
STATE_DIR="/var/lib/scarlet"
LOG_DIR="/var/log/scarlet"
SERVICE_FILE="/etc/systemd/system/scarlet@.service"
SERVICE_TEMPLATE="${SCARLET_DIR}/systemd/scarlet@.service"

echo "=== Scarlet Install ==="
echo "Install directory: ${SCARLET_DIR}"

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required (v20+). Install it first."
  exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required, found v$(node -v)"
  exit 1
fi

echo "Installing dependencies..."
npm ci --prefix "${SCARLET_DIR}"

echo "Preparing service account and directories..."
if ! id -u scarlet >/dev/null 2>&1; then
  sudo useradd --system --create-home --home-dir "${STATE_DIR}" --shell /usr/sbin/nologin scarlet
  echo "  -> Created system user: scarlet"
fi

sudo mkdir -p "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}"
sudo chown -R scarlet:scarlet "${STATE_DIR}" "${LOG_DIR}"
sudo chmod 750 "${STATE_DIR}" "${LOG_DIR}"

if [ -n "${CONFIG_PATH_INPUT}" ] && [ "${CONFIG_PATH_INPUT}" != "${CONFIG_PATH}" ]; then
  echo "Copying provided config into instance path: ${CONFIG_PATH}"
  sudo cp "${CONFIG_PATH_INPUT}" "${CONFIG_PATH}"
fi

if [ ! -f "${CONFIG_PATH}" ]; then
  echo ""
  echo "No config found at ${CONFIG_PATH}"
  echo "Creating from template — you MUST edit this before starting."
  sudo cp "${SCARLET_DIR}/configs/example.json" "${CONFIG_PATH}"
fi

sudo chown root:scarlet "${CONFIG_PATH}"
sudo chmod 640 "${CONFIG_PATH}"

if [ ! -f "${ENV_PATH}" ]; then
  echo "Creating environment file: ${ENV_PATH}"
  sudo touch "${ENV_PATH}"
fi
sudo chown root:scarlet "${ENV_PATH}"
sudo chmod 640 "${ENV_PATH}"

if [ ! -f "${SERVICE_TEMPLATE}" ]; then
  echo "ERROR: Missing systemd template: ${SERVICE_TEMPLATE}"
  exit 1
fi

if command -v systemctl &>/dev/null; then
  echo ""
  echo "Installing systemd service template..."

  node -e "const fs=require('fs'); const template=fs.readFileSync(process.argv[1],'utf8'); const rendered=template.replace(/__SCARLET_DIR__/g, process.argv[2]); process.stdout.write(rendered);" "${SERVICE_TEMPLATE}" "${SCARLET_DIR}" | sudo tee "${SERVICE_FILE}" >/dev/null

  if command -v systemd-analyze &>/dev/null; then
    sudo systemd-analyze verify "${SERVICE_FILE}"
  fi

  sudo systemctl daemon-reload

  TARGET_REPO_PATH=$(sudo node -e "const fs=require('fs'); try { const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(c?.targetRepo?.localPath || ''); } catch { process.stdout.write(''); }" "${CONFIG_PATH}")
  if [ -n "${TARGET_REPO_PATH}" ] && [ -d "${TARGET_REPO_PATH}" ]; then
    if sudo -u scarlet test -w "${TARGET_REPO_PATH}"; then
      echo "  -> scarlet user can write target repo: ${TARGET_REPO_PATH}"
    else
      echo "  !! WARNING: scarlet user cannot write target repo: ${TARGET_REPO_PATH}"
      echo "     Grant permissions before starting service (e.g. ACL or group write)."
    fi
  fi

  echo "  -> Service installed: scarlet@${SERVICE_NAME}"
  echo ""
  echo "=== Next steps ==="
  echo "1. Edit config:         sudo vi ${CONFIG_PATH}"
  echo "2. Set env vars:        sudo vi ${ENV_PATH}"
  echo "3. Enable & start:      sudo systemctl enable --now scarlet@${SERVICE_NAME}"
  echo "4. Check status:        sudo systemctl status scarlet@${SERVICE_NAME}"
  echo "5. View logs:           journalctl -u scarlet@${SERVICE_NAME} -f"
else
  echo ""
  echo "systemd not found — skipping service install."
  echo ""
  echo "=== Next steps ==="
  echo "1. Edit config:    vi ${CONFIG_PATH}"
  echo "2. Run manually:   node ${SCARLET_DIR}/src/index.mjs --config ${CONFIG_PATH}"
  echo "3. Run once:       node ${SCARLET_DIR}/src/index.mjs --config ${CONFIG_PATH} --once"
fi

echo ""
echo "Done."
