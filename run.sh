#!/bin/bash
# ============================================================
# run.sh — Batch extractor de clips
# Lee clip.conf y extrae todos los clips definidos.
#
# Uso:
#   ./run.sh              → extrae todos los clips de clip.conf
#   ./run.sh --dry-run    → muestra qué clips se extraerían sin ejecutar
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step()  { echo -e "${CYAN}[▶]${NC} $1"; }
print_ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
print_warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
print_err()   { echo -e "${RED}[✗]${NC} $1"; }
print_info()  { echo -e "${BLUE}[i]${NC} $1"; }

DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
    DRY_RUN=true
fi

# --- Cargar configuración ---
if [ ! -f "./clip.conf" ]; then
    print_err "No se encontró clip.conf. Creá uno con tus clips."
    echo "  Formato:"
    echo "    URL=\"https://...\""
    echo "    MODO=\"sections\"  # o \"full\""
    echo "    CLIPS=("
    echo "      \"9158 60 intro\""
    echo "      \"10500 45 escena_clave\""
    echo "    )"
    exit 1
fi

source ./clip.conf

if [ -z "$URL" ]; then
    print_err "clip.conf no define URL."
    exit 1
fi

if [ ${#CLIPS[@]} -eq 0 ]; then
    print_err "No hay clips definidos en CLIPS=()."
    exit 1
fi

MODO="${MODO:-sections}"

# --- Verificar dependencias ---
print_step "Verificando dependencias..."
for cmd in brew ffmpeg yt-dlp; do
    if ! command -v "$cmd" &> /dev/null; then
        print_err "No se encontró '$cmd'. Ejecutá ./setup.sh primero."
        exit 1
    fi
done
print_ok "Dependencias OK."

# --- Helper: convertir h:mm:ss a segundos ---
to_seconds() {
    local t="$1"
    if [[ "$t" =~ ^([0-9]+):([0-9]+):([0-9]+)$ ]]; then
        echo $(( ${BASH_REMATCH[1]} * 3600 + ${BASH_REMATCH[2]} * 60 + ${BASH_REMATCH[3]} ))
    else
        echo "$t"
    fi
}

# --- Mostrar plan ---
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  PLAN DE EXTRACCIÓN                                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  URL:     ${URL}"
echo -e "  Modo:    ${MODO}"
echo -e "  Clips:   ${#CLIPS[@]}"
echo ""

for i in "${!CLIPS[@]}"; do
    read -r START DUR LABEL <<< "${CLIPS[$i]}"
    START_SEC=$(to_seconds "$START")
    END_SEC=$(( START_SEC + DUR ))
    echo -e "  ${BLUE}[$((i+1))]${NC} ${LABEL}  →  ${START} +${DUR}s  (${START_SEC}s–${END_SEC}s)"
done

if $DRY_RUN; then
    echo ""
    print_info "Dry run — no se descargó nada. Editá clip.conf y ejecutá ./run.sh"
    exit 0
fi

echo ""
read -p "¿Proceder con la extracción? [S/n] " CONFIRM
if [ "$CONFIRM" = "n" ] || [ "$CONFIRM" = "N" ]; then
    echo "Cancelado."
    exit 0
fi

# --- Crear carpeta de salida ---
OUTPUT_DIR="$HOME/Desktop/clip-youtube"
BATCH_ID=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$OUTPUT_DIR"

SUCCESS=0
FAIL=0

# ============================================================
# MODO: full — descargar video completo una sola vez y cortar
# ============================================================
if [ "$MODO" = "full" ]; then

    FULL_VIDEO="$OUTPUT_DIR/.full_video_${BATCH_ID}.mp4"

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  PASO 1: Descargando video completo...             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    print_step "Esto puede tardar bastante según la duración del video..."
    yt-dlp \
        -f "bestvideo+bestaudio" \
        --merge-output-format mp4 \
        -o "$FULL_VIDEO" \
        --no-playlist \
        "$URL"

    FULL_SIZE=$(du -h "$FULL_VIDEO" | cut -f1)
    print_ok "Video completo descargado (${FULL_SIZE})"

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  PASO 2: Cortando ${#CLIPS[@]} clips con ffmpeg...            ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    for i in "${!CLIPS[@]}"; do
        read -r START DUR LABEL <<< "${CLIPS[$i]}"
        START_SEC=$(to_seconds "$START")
        NUM=$((i+1))
        OUTFILE="$OUTPUT_DIR/${BATCH_ID}_${NUM}_${LABEL}.mp4"

        echo -e "${CYAN}── Clip ${NUM}/${#CLIPS[@]}: ${LABEL} ──${NC}"
        print_step "Cortando desde ${START_SEC}s, duración ${DUR}s..."

        ffmpeg -y -ss "$START_SEC" -i "$FULL_VIDEO" -t "$DUR" -c copy "$OUTFILE" 2>&1 | tail -1

        if [ -f "$OUTFILE" ] && [ -s "$OUTFILE" ]; then
            SIZE=$(du -h "$OUTFILE" | cut -f1)
            print_ok "→ ${OUTFILE} (${SIZE})"
            SUCCESS=$((SUCCESS + 1))
        else
            print_err "Falló el clip: ${LABEL}"
            FAIL=$((FAIL + 1))
        fi
        echo ""
    done

    # Limpiar video completo
    print_step "Eliminando video temporal..."
    rm -f "$FULL_VIDEO"
    print_ok "Limpieza hecha."

# ============================================================
# MODO: sections — descargar cada fragmento por separado
# ============================================================
else

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  Extrayendo ${#CLIPS[@]} clips (modo sections)...             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    for i in "${!CLIPS[@]}"; do
        read -r START DUR LABEL <<< "${CLIPS[$i]}"
        START_SEC=$(to_seconds "$START")
        END_SEC=$(( START_SEC + DUR ))
        NUM=$((i+1))
        OUTFILE="$OUTPUT_DIR/${BATCH_ID}_${NUM}_${LABEL}.mp4"

        echo -e "${CYAN}── Clip ${NUM}/${#CLIPS[@]}: ${LABEL} (${START_SEC}s–${END_SEC}s) ──${NC}"

        print_step "Descargando..."

        yt-dlp \
            --download-sections "*${START_SEC}-${END_SEC}" \
            -f "bestvideo+bestaudio" \
            --merge-output-format mp4 \
            -o "$OUTFILE" \
            --no-playlist \
            "$URL" 2>&1 | tail -3

        if [ -f "$OUTFILE" ] && [ -s "$OUTFILE" ]; then
            SIZE=$(du -h "$OUTFILE" | cut -f1)
            print_ok "→ ${OUTFILE} (${SIZE})"
            SUCCESS=$((SUCCESS + 1))
        else
            print_err "Falló el clip: ${LABEL}"
            FAIL=$((FAIL + 1))
        fi
        echo ""
    done

fi

# --- Resumen final ---
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  RESUMEN                                           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Extraídos:${NC} ${SUCCESS}/${#CLIPS[@]}"
if [ $FAIL -gt 0 ]; then
    echo -e "  ${RED}Fallidos:${NC}  ${FAIL}"
fi
echo -e "  ${GREEN}Carpeta:${NC}  ${OUTPUT_DIR}"
echo ""

print_step "Abriendo carpeta..."
open "$OUTPUT_DIR"
