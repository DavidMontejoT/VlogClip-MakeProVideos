#!/bin/bash
# ═══════════════════════════════════════════════════════════
# YT Clipper — One-click setup
# Installs all dependencies: Homebrew, ffmpeg, Python deps
# ═══════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

print_step() { echo -e "${CYAN}[▶]${NC} $1"; }
print_ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
print_err()  { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  YT Clipper — Setup                                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# 1. Check Python
print_step "Checking Python..."
if command -v python3 &>/dev/null; then
    print_ok "Python: $(python3 --version)"
else
    print_err "Python 3 is required. Install from https://python.org"
    exit 1
fi

# 2. Check/install Homebrew (macOS) or apt (Linux)
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
    if ! command -v brew &>/dev/null; then
        print_step "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
    print_ok "Homebrew: $(brew --version | head -1)"

    # 3. Install ffmpeg (with libass subtitle support)
    if ! command -v ffmpeg &>/dev/null || ! ffmpeg -filters 2>&1 | grep -q libass; then
        print_step "Installing ffmpeg with subtitle support..."
        brew install ffmpeg-full
    fi
    print_ok "ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"

elif [ "$OS" = "Linux" ]; then
    print_step "Installing ffmpeg..."
    sudo apt-get update -qq && sudo apt-get install -y ffmpeg
    print_ok "ffmpeg installed"
fi

# 4. Install Python deps
print_step "Installing Python dependencies..."
pip3 install -r requirements.txt --quiet
print_ok "Python packages installed"

# 5. Verify yt-dlp
if command -v yt-dlp &>/dev/null; then
    print_ok "yt-dlp: $(yt-dlp --version)"
else
    print_step "Installing yt-dlp..."
    pip3 install --upgrade yt-dlp
    print_ok "yt-dlp installed"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup complete!                                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Start the app:"
echo "    python3 app.py"
echo ""
echo "  Then open:  http://localhost:5000"
echo ""
