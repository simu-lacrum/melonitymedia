#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MelonityMedia — First-time VPS Setup Script
# Run as root on AlmaLinux 8
#
# Usage:
#   chmod +x scripts/setup-vps.sh
#   ./scripts/setup-vps.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

echo "══════════════════════════════════════════════════════════"
echo "  MelonityMedia — VPS Setup (AlmaLinux 8)"
echo "══════════════════════════════════════════════════════════"

# ── 1. System update ─────────────────────────────────────────
echo ""
echo "► [1/6] Updating system packages..."
dnf update -y -q

# ── 2. Install Docker ────────────────────────────────────────
echo ""
echo "► [2/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
    dnf install -y -q dnf-plugins-core
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "  ✓ Docker installed"
else
    echo "  ✓ Docker already installed"
fi

# ── 3. Install Git ───────────────────────────────────────────
echo ""
echo "► [3/6] Installing Git..."
if ! command -v git &> /dev/null; then
    dnf install -y -q git
    echo "  ✓ Git installed"
else
    echo "  ✓ Git already installed"
fi

# ── 4. Clone repository ─────────────────────────────────────
echo ""
echo "► [4/6] Setting up project..."
PROJECT_DIR="/opt/melonitymedia"

if [ -d "$PROJECT_DIR" ]; then
    echo "  ✓ Project directory already exists"
    cd "$PROJECT_DIR"
    git pull origin main
else
    git clone https://github.com/simu-lacrum/melonitymedia.git "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    echo "  ✓ Repository cloned"
fi

# ── 5. Create .env file ─────────────────────────────────────
echo ""
echo "► [5/6] Setting up environment..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "  ⚠ No .env file found! Creating from .env.example..."
    echo "  ⚠ You MUST edit /opt/melonitymedia/.env with your secrets!"
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
else
    echo "  ✓ .env file exists"
fi

# ── 6. Open firewall ports ───────────────────────────────────
echo ""
echo "► [6/6] Configuring firewall..."
if command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=80/tcp   2>/dev/null || true
    firewall-cmd --permanent --add-port=443/tcp  2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    echo "  ✓ Ports 80, 443 opened"
else
    echo "  ✓ No firewall-cmd found, skipping"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✓ Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit .env:    nano /opt/melonitymedia/.env"
echo "  2. Start:        cd /opt/melonitymedia && docker compose up -d --build"
echo "  3. Run migrations: docker compose exec api npx prisma migrate deploy"
echo "══════════════════════════════════════════════════════════"
