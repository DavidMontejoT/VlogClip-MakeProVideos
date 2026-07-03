#!/bin/bash
# ============================================================
# YouTube Clip Extractor
# Extrae un fragmento de un video de YouTube usando yt-dlp + ffmpeg
#
# Uso:
#   ./clip.sh <URL> <INICIO> <FIN>
#
# Ejemplos:
#   ./clip.sh "https://www.youtube.com/watch?v=b4WMy9H4nUI" 9158 9218
#   ./clip.sh "https://www.youtube.com/watch?v=b4WMy9H4nUI" 2:32:38 2:33:38
#   ./clip.sh "https://www.youtube.com/watch?v=b4WMy9H4nUI" 9158 +60
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_step()  { echo -e "${CYAN}[▶]${NC} $1"; }
print_ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
print_warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
print_err()   { echo -e "${RED}[✗]${NC} $1"; }

usage() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║        YouTube Clip Extractor                    ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Uso:"
    echo "  ./clip.sh <URL> <INICIO> <FIN>"
    echo ""
    echo "Argumentos:"
    echo "  URL      URL del video de YouTube"
    echo "  INICIO   Momento de inicio (segundos o h:mm:ss)"
    echo "  FIN      Momento de fin (segundos, h:mm:ss, o +DURACION)"
    echo ""
    echo "Ejemplos:"
    echo "  # Con segundos:"
    echo "  ./clip.sh \"https://www.youtube.com/watch?v=abc123\" 120 180"
    echo ""
    echo "  # Con formato h:mm:ss:"
    echo "  ./clip.sh \"https://www.youtube.com/watch?v=abc123\" 0:02:00 0:03:00"
    echo ""
    echo "  # Con duración relativa (1 minuto desde inicio):"
    echo "  ./clip.sh \"https://www.youtube.com/watch?v=abc123\" 120 +60"
    echo ""
    exit 0
}

# --- Validar argumentos ---
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
fi

if [ $# -lt 3 ]; then
    print_err "Faltan argumentos. Usa --help para ver las opciones."
    exit 1
fi

URL="$1"
START="$2"
END="$3"

# --- Verificar dependencias ---
print_step "Verificando dependencias..."

check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        print_err "No se encontró '$1'. Ejecuta ./setup.sh primero."
        exit 1
    fi
}

check_cmd brew
check_cmd ffmpeg
check_cmd yt-dlp

print_ok "Todas las dependencias están instaladas."

# --- Parsear FIN si usa formato +DURACION ---
if [[ "$END" =~ ^\+([0-9]+)$ ]]; then
    DURATION="${BASH_REMATCH[1]}"
    # Si START es h:mm:ss, lo convertimos a segundos
    if [[ "$START" =~ ^([0-9]+):([0-9]+):([0-9]+)$ ]]; then
        START_SEC=$(( ${BASH_REMATCH[1]} * 3600 + ${BASH_REMATCH[2]} * 60 + ${BASH_REMATCH[3]} ))
    else
        START_SEC="$START"
    fi
    END="$(( START_SEC + DURATION ))"
    print_step "Duración: ${DURATION}s → Clip: ${START_SEC}s – ${END}s"
fi

# --- Crear carpeta de salida ---
OUTPUT_DIR="$HOME/Desktop/clip-youtube"
mkdir -p "$OUTPUT_DIR"

# Generar nombre de archivo con timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT="$OUTPUT_DIR/clip_${TIMESTAMP}.mp4"

# --- Descargar y cortar el clip ---
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Descargando clip...                            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "  URL:    ${URL}"
echo "  Inicio: ${START}"
echo "  Fin:    ${END}"
echo "  Salida: ${OUTPUT}"
echo ""

print_step "Ejecutando yt-dlp (esto puede tardar unos minutos)..."

yt-dlp \
    --download-sections "*${START}-${END}" \
    -f "bestvideo+bestaudio" \
    --merge-output-format mp4 \
    -o "$OUTPUT" \
    --no-playlist \
    "$URL"

# --- Verificar resultado ---
if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
    SIZE=$(du -h "$OUTPUT" | cut -f1)
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ¡Clip extraído con éxito!                      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${GREEN}Archivo:${NC} ${OUTPUT}"
    echo -e "  ${GREEN}Tamaño:${NC}  ${SIZE}"
    echo ""
    print_step "Abriendo la carpeta de salida..."
    open "$OUTPUT_DIR"
else
    print_err "Algo salió mal. Revisa los mensajes de error arriba."
    exit 1
fi
