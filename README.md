# YouTube Clip Extractor — Flujo completo

Extrae múltiples clips de un video de YouTube. **3 pasos**: escanear → anotar → extraer.

---

## 📋 Flujo de trabajo

```
  scan.sh          →   clip.conf      →   run.sh
 (explorar)           (anotar)            (extraer)
```

### Paso 1 — Escanear el video visualmente

```bash
./scan.sh
```

- Descarga los **storyboards** de YouTube (~176 grids de miniaturas, ~30MB)
- Genera un **HTML interactivo** con **todas las miniaturas del video**
- Lo abre en tu navegador
- Pasás el mouse → ves el timestamp de cada thumbnail
- Hacés clic → se copia al portapapeles

### Paso 2 — Anotar los timestamps en clip.conf

```bash
nano clip.conf
```

```
URL="https://www.youtube.com/watch?v=b4WMy9H4nUI"
MODO="sections"

CLIPS=(
  "9158 60 intro"
  "10500 45 escena_clave"
  "12000 90 final"
  "3000 30 tu_clip_4"
)
```

### Paso 3 — Extraer todos los clips

```bash
./run.sh
```

---

## ⚡ Setup inicial (solo la primera vez)

```bash
./setup.sh
```

---

## 📁 Archivos

| Script | Qué hace |
|--------|----------|
| `setup.sh` | Instala dependencias (brew, ffmpeg, yt-dlp) |
| `scan.sh` | Descarga storyboards + genera explorador HTML visual |
| `clip.conf` | Configuración: URL, modo, lista de clips |
| `run.sh` | Extrae todos los clips definidos en clip.conf |
| `clip.sh` | Herramienta manual para un solo clip |

---

## 🗂 Salida

```
~/Desktop/clip-youtube/
├── storyboards/          ← grids descargados por scan.sh
│   ├── grid_000.jpg
│   ├── ...
│   └── grid_175.jpg
├── scan.html             ← explorador visual (abrilo con ./scan.sh --html-only)
├── 20260702_100000_1_intro.mp4
├── 20260702_100000_2_escena_clave.mp4
├── 20260702_100000_3_final.mp4
└── 20260702_100000_4_tu_clip_4.mp4
```
