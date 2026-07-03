#!/bin/bash
# ============================================================
# scan.sh — Explorador visual
# Descarga los storyboards de YouTube y genera una página HTML
# para escanear visualmente TODO el video y encontrar timestamps.
#
# Uso:
#   ./scan.sh              → descarga + genera + abre navegador
#   ./scan.sh --html-only  → regenera HTML sin volver a descargar
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

# --- Cargar configuración ---
if [ ! -f "./clip.conf" ]; then
    print_err "No se encontró clip.conf."
    exit 1
fi
source ./clip.conf

# --- Verificar dependencias ---
for cmd in yt-dlp python3; do
    if ! command -v "$cmd" &> /dev/null; then
        print_err "No se encontró '$cmd'."
        exit 1
    fi
done

HTML_ONLY=false
if [ "$1" = "--html-only" ]; then
    HTML_ONLY=true
fi

# --- Configuración ---
OUTPUT_DIR="$HOME/Desktop/clip-youtube"
SB_DIR="$OUTPUT_DIR/storyboards"
HTML_FILE="$OUTPUT_DIR/scan.html"
mkdir -p "$SB_DIR"

VIDEO_DURATION=15770
SB_ROWS=3
SB_COLS=3
THUMBS_PER_GRID=$((SB_ROWS * SB_COLS))
FRAGMENT_DURATION=89.886
GRID_COUNT=176

# --- Extraer URLs de storyboards ---
if ! $HTML_ONLY; then
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  PASO 1: Obteniendo URLs de storyboards...         ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    print_step "Consultando metadatos del video..."
    URLS_FILE="$SB_DIR/urls.txt"

    yt-dlp --dump-json --no-download "$URL" 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
sb0 = [f for f in d['formats'] if f['format_id'] == 'sb0'][0]
for frag in sb0['fragments']:
    print(frag['url'])
" > "$URLS_FILE"

    TOTAL_URLS=$(wc -l < "$URLS_FILE" | tr -d ' ')
    print_ok "$TOTAL_URLS URLs obtenidas."

    # --- Descargar grids ---
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  PASO 2: Descargando ${TOTAL_URLS} grids...               ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    print_step "Descargando (esto puede tardar ~2-3 minutos)..."
    COUNT=0
    while read -r url; do
        OUTFILE="$SB_DIR/grid_$(printf '%03d' $COUNT).jpg"
        if [ ! -f "$OUTFILE" ]; then
            curl -sL "$url" -o "$OUTFILE" &
        fi
        COUNT=$((COUNT + 1))
        # Descargar en lotes de 10 para no saturar
        if [ $((COUNT % 10)) -eq 0 ]; then
            wait
            echo -ne "  Descargados: $COUNT / $TOTAL_URLS\r"
        fi
    done < "$URLS_FILE"
    wait
    echo ""
    print_ok "Descarga completa: $(ls "$SB_DIR"/grid_*.jpg 2>/dev/null | wc -l | tr -d ' ') grids."
fi

# --- Generar HTML ---
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  PASO 3: Generando página HTML...                  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"

# Helper function for timestamp formatting
fmt_time() {
    local secs=$1
    printf "%dh %02dm %02ds" $((secs / 3600)) $(((secs % 3600) / 60)) $((secs % 60))
}

print_step "Escribiendo $HTML_FILE..."

python3 << 'PYEOF'
import os, math

OUTPUT_DIR = os.path.expanduser("~/Desktop/clip-youtube")
SB_DIR = os.path.join(OUTPUT_DIR, "storyboards")
HTML_FILE = os.path.join(OUTPUT_DIR, "scan.html")

VIDEO_DURATION = 15770
SB_ROWS = 3
SB_COLS = 3
THUMBS_PER_GRID = SB_ROWS * SB_COLS  # 9
FRAGMENT_DURATION = 89.886
THUMB_DURATION = FRAGMENT_DURATION / THUMBS_PER_GRID  # ~9.987s per thumb

def fmt_time(secs):
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    return f"{h}h {m:02d}m {s:02d}s"

def fmt_compact(secs):
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    return f"{h}:{m:02d}:{s:02d}"

# Count existing grids
grid_count = 0
while os.path.exists(os.path.join(SB_DIR, f"grid_{grid_count:03d}.jpg")):
    grid_count += 1

if grid_count == 0:
    print("ERROR: No se encontraron grids. Ejecutá ./scan.sh primero.")
    exit(1)

# Generate nav links every 30 minutes
nav_links = []
for t in range(0, VIDEO_DURATION, 1800):
    nav_links.append(f'<a href="#grid-{int(t // FRAGMENT_DURATION)}">{fmt_compact(t)}</a>')

# Generate grids HTML
grids_html = ""
for i in range(grid_count):
    start_sec = i * FRAGMENT_DURATION
    end_sec = min(start_sec + FRAGMENT_DURATION, VIDEO_DURATION)
    filename = f"storyboards/grid_{i:03d}.jpg"
    
    # Calculate individual thumbnail time ranges for title tooltip
    thumb_times = []
    for r in range(SB_ROWS):
        for c in range(SB_COLS):
            thumb_start = start_sec + (r * SB_COLS + c) * THUMB_DURATION
            thumb_end = min(thumb_start + THUMB_DURATION, VIDEO_DURATION)
            thumb_times.append(fmt_compact(thumb_start))
    
    # Build grid overlay with tooltips (CSS positioned)
    overlay_divs = ""
    thumb_w_pct = 100.0 / SB_COLS
    thumb_h_pct = 100.0 / SB_ROWS
    thumb_idx = 0
    for r in range(SB_ROWS):
        for c in range(SB_COLS):
            left = c * thumb_w_pct
            top = r * thumb_h_pct
            ts = thumb_times[thumb_idx]
            overlay_divs += f'<div class="thumb-zone" style="left:{left:.2f}%;top:{top:.2f}%;width:{thumb_w_pct:.2f}%;height:{thumb_h_pct:.2f}%" title="📌 {ts}" onclick="copyTS(\'{ts}\')"></div>\n'
            thumb_idx += 1
    
    grids_html += f'''
    <div class="grid-container" id="grid-{i}">
        <div class="grid-label">
            # {i+1} &nbsp;→&nbsp; 
            <span class="ts" onclick="copyTS('{fmt_compact(start_sec)}')">{fmt_compact(start_sec)}</span>
            &nbsp;—&nbsp;
            <span class="ts" onclick="copyTS('{fmt_compact(end_sec)}')">{fmt_compact(end_sec)}</span>
            &nbsp;({fmt_time(start_sec)} — {fmt_time(end_sec)})
        </div>
        <div class="grid-img-wrap">
            <img src="{filename}" loading="lazy" alt="Grid {i+1}" />
            {overlay_divs}
        </div>
    </div>'''

html = f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🔍 Explorador de Video — {VIDEO_DURATION//3600}h {(VIDEO_DURATION%3600)//60}m</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    background: #0d1117;
    color: #c9d1d9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding-bottom: 60px;
}}
.header {{
    position: sticky; top: 0; z-index: 100;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    padding: 12px 24px;
}}
.header h1 {{
    font-size: 18px; color: #58a6ff;
}}
.header .nav {{
    margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;
}}
.header .nav a {{
    color: #8b949e; text-decoration: none; font-size: 12px;
    padding: 3px 8px; border-radius: 4px; border: 1px solid #30363d;
    transition: all .15s;
}}
.header .nav a:hover {{
    color: #58a6ff; border-color: #58a6ff; background: #1f2937;
}}
.header .copied-toast {{
    position: fixed; top: 20px; right: 20px;
    background: #238636; color: white; 
    padding: 10px 20px; border-radius: 8px;
    font-size: 14px; z-index: 200;
    opacity: 0; transition: opacity 0.2s;
    pointer-events: none;
}}
.header .copied-toast.show {{ opacity: 1; }}
.grid-container {{
    margin: 4px 24px;
    border: 1px solid #21262d;
    border-radius: 6px;
    overflow: hidden;
}}
.grid-label {{
    background: #161b22;
    padding: 6px 14px;
    font-size: 13px;
    color: #8b949e;
    border-bottom: 1px solid #21262d;
}}
.grid-label .ts {{
    color: #58a6ff;
    cursor: pointer;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-weight: bold;
}}
.grid-label .ts:hover {{ text-decoration: underline; }}
.grid-img-wrap {{
    position: relative;
    line-height: 0;
    background: #000;
}}
.grid-img-wrap img {{
    width: 100%;
    display: block;
}}
.thumb-zone {{
    position: absolute;
    cursor: pointer;
    z-index: 10;
}}
.thumb-zone:hover {{
    outline: 2px solid #58a6ff;
    outline-offset: -2px;
    background: rgba(88, 166, 255, 0.12);
}}
.footer {{
    text-align: center; padding: 30px;
    color: #484f58; font-size: 12px;
}}
</style>
</head>
<body>

<div class="header">
    <h1>🔍 Build Showcase de Build 4 Venezuela — 4h 22m</h1>
    <div class="nav">
        <span style="color:#8b949e;font-size:12px;padding:3px 0">Ir a:</span>
        {" ".join(nav_links)}
    </div>
    <div class="copied-toast" id="toast">📋 Copiado: <span id="toast-ts"></span></div>
</div>

<div id="grids">
{grids_html}
</div>

<div class="footer">
    {grid_count} grids · {grid_count * THUMBS_PER_GRID} miniaturas · click en cualquier thumbnail para copiar timestamp
</div>

<script>
function copyTS(ts) {{
    navigator.clipboard.writeText(ts).then(() => {{
        const toast = document.getElementById('toast');
        document.getElementById('toast-ts').textContent = ts;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }});
}}
</script>

</body>
</html>'''

with open(HTML_FILE, 'w') as f:
    f.write(html)

print(f"HTML generado: {HTML_FILE}")
PYEOF

echo ""
print_ok "HTML generado."

# --- Abrir navegador ---
echo ""
print_step "Abriendo explorador visual..."
open "$HTML_FILE"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ¡Explorador listo!                                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Cómo usar:${NC}"
echo "  1. Scrolleá por las miniaturas del video"
echo "  2. Pasá el mouse sobre cualquier miniatura → ves el timestamp"
echo "  3. Clic en un timestamp → se copia al portapapeles"
echo "  4. Pegá los timestamps en clip.conf"
echo ""
echo -e "  ${CYAN}Archivos:${NC}"
echo "  • Storyboards: $SB_DIR/"
echo "  • Visualizador: $HTML_FILE"
echo ""
echo -e "  ${CYAN}Atajo:${NC} ./scan.sh --html-only (regenera HTML sin volver a descargar)"
echo ""
