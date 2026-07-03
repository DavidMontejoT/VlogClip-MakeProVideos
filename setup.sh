#!/bin/bash
# ============================================================
# Setup — Instala las dependencias necesarias para clip.sh
# Ejecutar una sola vez:
#   chmod +x setup.sh && ./setup.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_step()  { echo -e "${CYAN}[▶]${NC} $1"; }
print_ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
print_warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
print_err()   { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Configurando YouTube Clip Extractor            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ─── 1. Verificar Homebrew ───
print_step "Verificando Homebrew..."
if command -v brew &> /dev/null; then
    print_ok "Homebrew ya está instalado: $(brew --version | head -1)"
else
    print_warn "Homebrew no encontrado. Instalando..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Detectar si es Apple Silicon y configurar PATH
    if [ -f /opt/homebrew/bin/brew ]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    print_ok "Homebrew instalado."
fi

# ─── 2. Instalar ffmpeg ───
print_step "Verificando ffmpeg..."
if command -v ffmpeg &> /dev/null; then
    print_ok "ffmpeg ya está instalado."
else
    print_step "Instalando ffmpeg con Homebrew..."
    brew install ffmpeg
    print_ok "ffmpeg instalado."
fi

# ─── 3. Instalar yt-dlp ───
print_step "Verificando yt-dlp..."
if command -v yt-dlp &> /dev/null; then
    print_ok "yt-dlp ya está instalado: $(yt-dlp --version)"
else
    print_step "Instalando yt-dlp con pip3..."
    pip3 install --upgrade yt-dlp

    if ! command -v yt-dlp &> /dev/null; then
        print_warn "Probando con python3 -m pip..."
        python3 -m pip install --upgrade yt-dlp
    fi
    print_ok "yt-dlp instalado: $(yt-dlp --version)"
fi

# ─── 4. Hacer clip.sh ejecutable ───
if [ -f "./clip.sh" ]; then
    chmod +x ./clip.sh
    print_ok "clip.sh está listo."
else
    print_warn "No se encontró clip.sh en el directorio actual."
    print_warn "Asegúrate de estar en la carpeta donde está el script."
fi

# ─── Resumen final ───
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ¡Todo listo!                                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "Para extraer un clip:"
echo ""
echo "  ./clip.sh \"URL\" <INICIO> <FIN>"
echo ""
echo "Ejemplo con tu video:"
echo ""
echo "  ./clip.sh \"https://www.youtube.com/watch?v=b4WMy9H4nUI\" 9158 9218"
echo ""
echo "El clip se guarda en ~/Desktop/clip-youtube/"
echo ""
