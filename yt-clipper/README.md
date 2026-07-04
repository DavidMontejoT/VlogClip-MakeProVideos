<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Inter&weight=800&size=38&duration=2500&pause=800&color=58A6FF&center=true&vCenter=true&random=false&width=600&lines=%E2%9C%82%EF%B8%8F+YT+Clipper;YouTube+%E2%86%92+Clips+%E2%86%92+Magic;%F0%9F%8E%AC+%2B+%F0%9F%A7%A0+%2B+%F0%9F%92%AC" alt="YT Clipper" />
</p>

<p align="center">
  <strong>Extract clips, generate AI subtitles, remove silence, change speed — all by typing in Spanish.</strong>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/⚡-Quick_Start-238636?style=for-the-badge" /></a>
  <a href="#-features"><img src="https://img.shields.io/badge/✨-Features-1f6feb?style=for-the-badge" /></a>
  <a href="#-demo"><img src="https://img.shields.io/badge/🎬-Demo-a371f7?style=for-the-badge" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
  <img src="https://img.shields.io/badge/python-3.9+-blue?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/flask-3.0+-black?style=flat-square&logo=flask&logoColor=white" />
  <img src="https://img.shields.io/badge/Whisper-AI-orange?style=flat-square&logo=openai&logoColor=white" />
  <img src="https://img.shields.io/badge/frontend-vanilla_JS-yellow?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/status-MVP-brightgreen?style=flat-square" />
</p>

<br/>

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   🎬 PASTE URL    ──►   🖼️ STORYBOARD    ──►   📋 QUEUE    ──►   ⚡ EXTRACT  │
│   YouTube link        176 thumbnail grids      Multiple ranges     1080p mp4  │
│                                                                              │
│   🎙️ UPLOAD       ──►   🧠 TRANSCRIBE    ──►   🎨 STYLE     ──►   📼 BURN    │
│   Drag & drop          Whisper AI              Font/Color/Pos     ASS subs    │
│                                                                              │
│   📁 LOAD LOCAL   ──►   🖼️ THUMBNAILS   ──►   ⏱️ TIMELINE  ──►   ✂️ CUT      │
│   Any MP4/MOV          ffmpeg storyboard       Drag to adjust     Stream copy │
│                                                                              │
│   💬 COMMAND      ──►   🤖 PARSE         ──►   ⚙️ EXECUTE   ──►   ✅ DONE     │
│   "quita silencios"    NLP intent match        ffmpeg pipeline    Result      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎬 YouTube Clipper

```
  🔗 paste URL ──► 📊 video info
       │
       ▼
  🖼️ 176 storyboard thumbnails
  ╔═══╦═══╦═══╦═══╦═══╗
  ║ ■ ║ ■ ║ ■ ║ ■ ║ ■ ║  ← click to select range
  ╚═══╝╚═══╝╚═══╝╚═══╝╚═══╝
   🟢 start          🔴 end
       │
       ▼
  📋 Clip Queue ──► ⚡ Batch Extract
```

- Paste any YouTube URL
- Browse **4h+ videos in seconds** with auto-cached storyboard grids
- Click-to-select ranges, queue unlimited clips
- Quality: 1080p / 720p / preview
- Live extraction progress per clip

</td>
<td width="50%">

### 💬 Auto Subtitles

```
  📁 Upload video
       │
       ▼
  🧠 Whisper AI transcribe
  ┌─────────────────────────┐
  │ 0:01  Hola, ¿cómo estás?│
  │ 0:05  Muy bien, gracias │
  │ 0:09  ¿Y tú?           │
  └─────────────────────────┘
       │
       ▼
  🎨 Style editor
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  ▓  Font  ▓ Color ▓ Pos  ▓
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
       │
       ▼
  📼 Burn ASS subtitles → .mp4
```

- **faster-whisper** (tiny → large)
- **Word-by-word karaoke** mode
- Drag subtitle **position on video**
- 6 style presets + custom
- Animations: fade, slide, pop
- Multi-language & inline text editing

</td>
</tr>
<tr>
<td width="50%">

### ✂️ Local Editor + Timeline

```
  📁 Load video
       │
       ▼
  🖼️ Thumbnail grid (every 5s–60s)
  ┌────┐┌────┐┌────┐┌────┐┌────┐
  │ 📷 ││ 📷 ││ 📷 ││ 📷 ││ 📷 │
  └────┘└────┘└────┘└────┘└────┘
   🟢 start               🔴 end
       │
       ▼
  ⏱️ Drag-to-adjust Timeline
  ┌──────────────────────────────────────┐
  │ 0:00   2:00   4:00   6:00   ...      │ ← ruler
  │ ╔══════╗  ╔═══════╗  ╔══════╗       │
  │ ║Clip 1║  ║Clip 2 ║  ║Clip 3║       │ ← draggable
  │ ╚══◄►══╝  ╚═══◄►══╝  ╚══◄►══╝       │
  └──────────────────────────────────────┘
       │
       ▼
  ✂️ Cut → stream copy → ~/Desktop/
```

- **Horizontal timeline** with resize handles
- Drag edges to adjust timing
- Snap to 1-second grid
- 6-color blocks per clip
- Instant cuts (no re-encode)

</td>
<td width="50%">

### 💬 Command Panel (NLP)

```
  💬 "quita los espacios en silencio"
       │
       ▼
  🤖 Parser (regex Spanish NLP)
       │
       ▼
  ⚙️ ffmpeg silenceremove
       │
       ▼
  ✅ Done: 45s removed, new file saved
```

**Speak Spanish, it executes:**
| Comando | Resultado |
|---------|-----------|
| `quita los silencios` | 🔇 Silence removed |
| `recorta de 30 a 90` | ✂️ Clip extracted |
| `cambia velocidad a 2x` | ⏩ Speed changed |
| `genera subtítulos` | 💬 Whisper transcribe |
| `busca mejores momentos` | 🧠 AI smart picks |
| `invierte el video` | 🔄 Reversed |

</td>
</tr>
</table>

---

## 🧠 Smart Picks

```
  📁 Video ──► 🧠 Whisper transcribe ──► 📊 Score segments
                                               │
                    ┌──────────────────────────┘
                    ▼
  🔑 Keyword matches  │  ⚡ Energy patterns  │  🎬 Scene changes
  "increíble"  +2     │  "¡WOW!"  +3        │  cut detection +2
                    │                       │
                    └──────────┬────────────┘
                               ▼
                    ⭐ Engagement Score
                               │
                               ▼
              ┌────────────────────────────────┐
              │ #1 ⭐92  0:45 → 1:30  (45s)    │
              │   "y entonces descubrí que..." │
              │ #2 ⭐78  2:15 → 3:00  (45s)    │
              │   "¡es absolutamente incre..." │
              └────────────────────────────────┘
                               │
                               ▼
                        ✂️ One-click cut
```

---

## 🚀 Quick Start

```bash
git clone https://github.com/your-username/yt-clipper.git
cd yt-clipper
./setup.sh          # Installs ffmpeg-full + yt-dlp + Python deps
python3 app.py      # → http://localhost:5001
```

```
  ╔══════════════════════════════════════════════╗
  ║           YT Clipper ready ✂️                ║
  ║                                              ║
  ║   🌐 http://localhost:5001                    ║
  ║   📁 Output: ~/Desktop/yt-clipper-output/    ║
  ║                                              ║
  ║   yt-dlp: ✓     ffmpeg: ✓                    ║
  ╚══════════════════════════════════════════════╝
```

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER :5001                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 🎬 YT    │  │ 💬 Subs  │  │ ✂️ Editor│  │ 💬 Commands   │  │
│  │ Storyboard│  │Karaoke   │  │Timeline  │  │ NLP Parser    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │               │          │
│       └──────────────┴──────────────┴───────────────┘          │
│                          │  REST API                           │
└──────────────────────────┼────────────────────────────────────┘
                           │
┌──────────────────────────┼────────────────────────────────────┐
│                    FLASK SERVER                                │
│                          │                                     │
│     ┌────────────────────┼────────────────────┐               │
│     │                    │                    │               │
│     ▼                    ▼                    ▼               │
│  yt-dlp              whisper             ffmpeg               │
│  (metadata,          (speech-to-text,     (cuts, silence,     │
│   download,           small→large          speed, reverse,    │
│   storyboards)        models)              thumbnails)        │
│                                                                │
│  📁 CACHE/          📁 UPLOADS/         📁 OUTPUT/            │
│  storyboard jpgs    user videos         extracted clips        │
└────────────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
yt-clipper/
│
├── app.py                  # Flask server · 40+ API endpoints
├── analyzer.py             # Smart clip scoring (Whisper + keyword)
├── subtitle.py             # ASS subtitle generation + burning
│
├── static/
│   ├── index.html          # 3-tab SPA
│   ├── style.css           # Dark theme · ~850 lines
│   └── app.js              # All frontend · ~1600 lines
│
├── fonts/
│   ├── Inter-Black.ttf     # Primary subtitle font
│   └── EBGaramond-Italic.ttf  # Italic accent font
│
├── setup.sh                # One-click dependency installer
├── requirements.txt        # Python deps
├── ARCHITECTURE.md         # Detailed technical docs
└── README.md               # ← You are here
```

---

## 🛠 Tech Stack

| Layer | Technology |
|:------|:-----------|
| 🖥️ Backend | Python 3.9+ · Flask · REST API |
| 🎬 Video | yt-dlp (YouTube) · ffmpeg (processing) |
| 🧠 AI | faster-whisper (OpenAI Whisper CTranslate2) |
| 🎨 Frontend | Vanilla HTML/CSS/JS · Dark theme · No frameworks |
| ✍️ Fonts | Inter Black · EB Garamond Italic (OFL) |
| 🗣️ NLP | Regex-based Spanish command parser |

---

## 📖 API Endpoints

<details>
<summary><b>🎬 YouTube</b> (5 endpoints)</summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/info` | Video metadata + storyboards |
| `POST` | `/api/storyboard-urls` | Fetch + cache storyboard images |
| `GET` | `/api/storyboard/<id>/<n>.jpg` | Serve cached thumbnail |
| `POST` | `/api/extract` | Batch clip extraction (async) |
| `GET` | `/api/job/<id>` | Poll job progress |

</details>

<details>
<summary><b>💬 Subtitles</b> (2 endpoints)</summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/subtitle/transcribe` | Whisper transcription (async) |
| `POST` | `/api/subtitle/burn` | Transcribe + burn ASS (async) |

</details>

<details>
<summary><b>✂️ Editor</b> (5 endpoints)</summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/upload` | Upload video file |
| `POST` | `/api/local/info` | ffprobe metadata |
| `POST` | `/api/local/thumbnails` | Generate thumbnail grid |
| `POST` | `/api/local/cut` | Cut clip (stream copy) |
| `GET` | `/api/local/thumb/<stem>/<file>` | Serve thumbnail |

</details>

<details>
<summary><b>💬 Commands</b> (2 endpoints)</summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/cmd/parse` | Parse Spanish NLP command |
| `POST` | `/api/cmd/run` | Parse + execute command (async) |

</details>

<details>
<summary><b>🔧 Utility</b> (4 endpoints)</summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/health` | Server + dependency check |
| `GET` | `/api/deps` | Dependency versions |
| `POST` | `/api/analyze` | Smart clip detection (async) |
| `POST` | `/api/open-output` | Open output folder in OS |

</details>

---

## 🎮 Keyboard Shortcuts

| Key | Context | Action |
|:----|:--------|:-------|
| `Enter` | URL input | Load video |
| `Enter` | Command input | Execute command |
| `Click` | Storyboard thumb | Select range start/end |
| `Click` | Timeline block | Drag to shift timing |
| `Click` | Timeline edge ◄► | Drag to resize |
| `Enter` | Subtitle text edit | Finish editing |

---

## 🗺 Roadmap

```
  ✅ YouTube Clipper        ✅ Subtitles + Karaoke
  ✅ Local Editor           ✅ Timeline drag-to-adjust
  ✅ Smart Picks AI         ✅ Command Panel (Spanish NLP)
  ─────────────────────────────────────────────────────
  🔲 Zoom en timeline       🔲 Undo/redo
  🔲 Presets de comandos    🔲 Export vertical (9:16)
  🔲 Audio waveform         🔲 Speaker diarization
  🔲 Docker image           🔲 Electron desktop app
```

---

## 🤝 Contributing

Ideas, issues, and PRs welcome! Check [CONTRIBUTING.md](CONTRIBUTING.md).

Some areas where help would be amazing:

- 🖥️ **Electron wrapper** — turn this into a standalone desktop app
- 🎨 **Subtitle preset gallery** — more font/style combinations
- 🌍 **Multi-language commands** — English, Portuguese, French parsers
- ⚡ **GPU acceleration** — Metal/CUDA for Whisper
- 📱 **Responsive mobile** — polish the mobile experience

---

## 📄 License

MIT — do whatever you want, just keep the attribution.

---

<p align="center">
  <sub>Built with ❤️ using Python · Flask · ffmpeg · Whisper · vanilla JS</sub>
</p>
