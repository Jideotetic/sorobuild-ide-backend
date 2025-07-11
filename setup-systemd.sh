#!/bin/bash

# This script sets up your Docker Compose app to run as a systemd service

SERVICE_NAME="sorobuild-ide-backend"
APP_DIR="/home/jideotetic/sorobuild-ide-backend"
REPO_URL="git@github.com:Jideotetic/sorobuild-ide-backend.git"
DOCKER_COMPOSE_BIN="/usr/bin/docker compose"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ ! -d "$APP_DIR" ]; then
  echo "❌ Error: App directory $APP_DIR does not exist."
  exit 1
fi

if [ -z "$DOCKER_COMPOSE_BIN" ]; then
  echo "❌ Error: Docker Compose not found. Is Docker installed?"
  exit 1
fi

echo "🧼 Cleaning up unused Docker resources..."
docker system prune -f

echo "🔄 Pulling latest changes..."
cd "$APP_DIR"
git pull origin main || echo "⚠️ Git pull failed or not a git repo, continuing..."

echo "🔧 Creating systemd service file at $SERVICE_FILE..."

# Properly write the service file with variables expanded
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Docker Compose App - $SERVICE_NAME
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=$APP_DIR
ExecStart=$DOCKER_COMPOSE_BIN up -d --build
ExecStop=$DOCKER_COMPOSE_BIN down --volumes --remove-orphans
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "🔄 Reloading systemd and enabling service..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.service

echo "✅ Systemd service '$SERVICE_NAME' has been created and enabled."
read -p "🚀 Do you want to start the app now? (y/n): " choice

if [[ "$choice" =~ ^[Yy]$ ]]; then
  sudo systemctl start ${SERVICE_NAME}.service
  echo "✅ Service started. You can run: sudo systemctl status ${SERVICE_NAME}.service"
else
  echo "ℹ️ You can start it manually with: sudo systemctl start ${SERVICE_NAME}.service"
fi
