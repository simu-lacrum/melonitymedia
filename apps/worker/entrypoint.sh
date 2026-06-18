#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MelonityMedia Worker — Entrypoint
#
# Starts Xvfb virtual display before launching the Node.js
# BullMQ worker process. This is REQUIRED for anti-fraud
# bypassing — Chrome runs with headless: false inside Xvfb.
# ─────────────────────────────────────────────────────────────

set -e

echo "[Worker] Starting Xvfb virtual display :99 (1920x1080x24)..."
# Clean stale lock files from previous container runs
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
Xvfb :99 -screen 0 1920x1080x24 -ac &
XVFB_PID=$!
export DISPLAY=:99

# Wait for Xvfb to be ready — verify the display is accessible
for i in 1 2 3 4 5; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    break
  fi
  echo "[Worker] Waiting for Xvfb to start (attempt $i/5)..."
  sleep 1
done

if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "[Worker] ERROR: Xvfb failed to start on :99" >&2
  exit 1
fi

echo "[Worker] Xvfb started. DISPLAY=$DISPLAY (PID=$XVFB_PID)"

echo "[Worker] Starting fluxbox window manager..."
fluxbox &

echo "[Worker] Setting up VNC password..."
mkdir -p ~/.vnc
x11vnc -storepasswd "${VNC_PASSWORD:-melonity}" ~/.vnc/passwd

echo "[Worker] Starting x11vnc..."
x11vnc -display :99 -rfbauth ~/.vnc/passwd -forever -shared -bg

echo "[Worker] Starting noVNC on port 6080..."
websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "[Worker] Starting BullMQ worker process..."
cd /app/apps/worker
exec node dist/index.js
