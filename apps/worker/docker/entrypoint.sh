#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MelonityMedia Worker Entrypoint
# Starts Xvfb (virtual display) before launching Node.js
# This creates a fake monitor at :99 so Chrome can run with
# headless:false — the key anti-detection technique.
# ─────────────────────────────────────────────────────────────

# Start virtual display at :99, resolution 1920x1080, 24-bit color
# -ac disables access control (no auth needed for display)
Xvfb :99 -screen 0 1920x1080x24 -ac &

# Tell all child processes to use display :99
export DISPLAY=:99

# Wait a moment for Xvfb to initialize
sleep 1

echo "[Worker] Xvfb started on display :99"
echo "[Worker] Starting BullMQ job processor..."

# Launch the actual worker process
npm run start:worker
