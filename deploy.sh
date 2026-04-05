#!/bin/bash
# SF Learning Platform — Deployment Script for Linux
# Usage: bash deploy.sh
#
# Prerequisites:
#   - Python 3.10+
#   - Node.js 18+ (for building frontend)
#   - opam (OCaml package manager, for Coq)
#   - nginx (reverse proxy)

set -e

INSTALL_DIR="${INSTALL_DIR:-/var/www/sfwebsite}"
USER="${APP_USER:-$(whoami)}"

echo "================================================"
echo "  SF Learning Platform — Deployment"
echo "  Install dir: $INSTALL_DIR"
echo "  User: $USER"
echo "================================================"

# --- 1. Install Coq via opam (if not already installed) ---
if ! command -v vscoqtop &> /dev/null; then
    echo ""
    echo "[1/7] Installing Coq and vscoq-language-server via opam..."
    if ! command -v opam &> /dev/null; then
        echo "ERROR: opam not found. Install it first:"
        echo "  sudo apt install opam"
        echo "  opam init --auto-setup"
        exit 1
    fi
    opam install coq.8.20.0 vscoq-language-server coq-serapi -y
    eval $(opam env)
else
    echo "[1/7] Coq already installed: $(which vscoqtop)"
fi

# --- 2. Clone/update repo ---
echo ""
echo "[2/7] Setting up project files..."
if [ ! -d "$INSTALL_DIR" ]; then
    echo "  Cloning repository..."
    git clone https://github.com/yezhuoyang/SFWebsite.git "$INSTALL_DIR"
else
    echo "  Updating existing installation..."
    cd "$INSTALL_DIR" && git pull --ff-only || true
fi
cd "$INSTALL_DIR"

# --- 3. Python environment ---
echo ""
echo "[3/7] Setting up Python environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r server/requirements.txt

# --- 4. Build frontend ---
echo ""
echo "[4/7] Building React frontend..."
cd client
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run build
cd "$INSTALL_DIR"

# --- 5. Patch Stdlib imports + compile .vo files ---
echo ""
echo "[5/7] Patching Stdlib imports and compiling Coq files..."
python3 setup.py

# --- 6. Seed database ---
echo ""
echo "[6/7] Seeding exercise database..."
python3 -m server.seed_db

# --- 7. Environment file ---
echo ""
echo "[7/7] Setting up environment..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    # Generate random JWT secret
    JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i "s/JWT_SECRET=change-me-to-a-random-string/JWT_SECRET=$JWT_SECRET/" .env
    echo "  Created .env — EDIT IT to add your OPENAI_API_KEY and CORS_ORIGINS"
else
    echo "  .env already exists, skipping"
fi

echo ""
echo "================================================"
echo "  Deployment complete!"
echo ""
echo "  Next steps:"
echo "    1. Edit $INSTALL_DIR/.env"
echo "    2. Install systemd service:"
echo "       sudo cp sfwebsite.service /etc/systemd/system/"
echo "       sudo systemctl enable sfwebsite"
echo "       sudo systemctl start sfwebsite"
echo "    3. Configure nginx (see nginx.conf)"
echo "    4. Test: curl http://localhost:8100/api/volumes"
echo "================================================"
