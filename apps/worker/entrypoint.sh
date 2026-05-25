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
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 1
echo "[Worker] Xvfb started. DISPLAY=$DISPLAY"

echo "[Worker] Starting BullMQ worker process..."
cd /app/apps/worker
exec npm run start:worker
