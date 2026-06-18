#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MelonityMedia Worker — Entrypoint
#
# Starts the Node.js BullMQ worker process.
# Xvfb, VNC, and Fluxbox are now spawned dynamically per-job
# in patchright-launcher.ts to ensure isolated displays.
# ─────────────────────────────────────────────────────────────

set -e

# Clean stale lock files from previous container runs
rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || true

echo "[Worker] Setting up VNC password..."
mkdir -p ~/.vnc
x11vnc -storepasswd "${VNC_PASSWORD:-melonity}" ~/.vnc/passwd

echo "[Worker] Starting BullMQ worker process..."
cd /app/apps/worker
exec node dist/index.js
