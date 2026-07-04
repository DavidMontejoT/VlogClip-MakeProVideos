# YT Clipper — Architecture & Knowledge Base

> **Purpose:** Extract clips from YouTube, generate AI subtitles, and edit videos locally.
> **Stack:** Python Flask backend + vanilla HTML/CSS/JS frontend + ffmpeg + yt-dlp + faster-whisper
> **State:** MVP — all 4 modules functional

---

## 🗺 Architecture Overview

```
Browser (localhost:5001)
    │
    ├── Tab 1: 🎬 YouTube → Clipboard extraction from YouTube URLs
    ├── Tab 2: 💬 Subtitles → AI transcription + burned-in subtitles
    ├── Tab 3: ✂️ Editor   → Local video trimming with thumbnail timeline
    │                         └── 🧠 Smart Picks → AI finds best moments
    │
    ▼
Flask Server (app.py)
    │
    ├─► yt-dlp          → YouTube metadata + downloads
    ├─► ffmpeg-full      → Video processing, cuts, subtitles burning
    ├─► faster-whisper   → Speech-to-text (small/medium/large models)
    ├─► subtitle.py      → ASS generation + Inter Black / EB Garamond Italic styling
    ├─► analyzer.py      → Smart clip scoring (keyword density + scene detection)
    └─► /api/* endpoints → REST API for all operations
```

---

## 📁 File Map

| File | Purpose | Lines |
|------|---------|-------|
| `app.py` | Flask server, all API endpoints, job queue | ~530 |
| `subtitle.py` | Whisper transcription → ASS file → ffmpeg burn | ~150 |
| `analyzer.py` | Smart clip detection (Whisper + ffmpeg scene detect) | ~280 |
| `static/index.html` | 3-tab frontend UI | ~220 |
| `static/style.css` | Dark theme, responsive layout | ~360 |
| `static/app.js` | All frontend logic (YouTube, Subtitles, Editor, Analyzer) | ~750 |
| `fonts/Inter-Black.ttf` | Primary font for subtitles | 404K |
| `fonts/EBGaramond-Italic.ttf` | Italic font for last word of each phrase | 339K |
| `setup.sh` | One-click dependency installer | ~80 |
| `requirements.txt` | Python dependencies | 4 lines |

---

## 🔌 API Endpoints

### YouTube Module
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/info` | Get video metadata (title, duration, storyboards, chapters) |
| POST | `/api/storyboard-urls` | Get storyboard image URLs + start server-side caching |
| GET | `/api/storyboard/<id>/<n>.jpg` | Serve cached storyboard thumbnail |
| POST | `/api/extract` | Start batch clip extraction (async, returns job_id) |
| GET | `/api/job/<job_id>` | Poll job status/results |

### Subtitles Module
| POST | `/api/subtitle/burn` | Full pipeline: transcribe → ASS → burn (async) |
| POST | `/api/subtitle/transcribe` | Transcribe only, return segments |

### Editor Module
| POST | `/api/upload` | Upload video file from browser (drag & drop) |
| POST | `/api/local/info` | Get local video metadata via ffprobe |
| POST | `/api/local/thumbnails` | Generate thumbnail storyboard via ffmpeg |
| GET | `/api/local/thumb/<stem>/<file>` | Serve thumbnail image |
| POST | `/api/local/cut` | Cut clip from local video (stream copy) |

### Analyzer Module
| POST | `/api/analyze` | AI analysis: transcribe + scene detect → ranked clips (async) |

### Utility
| GET | `/api/health` | Check server + dependencies |
| GET | `/api/deps` | Dependency status |
| POST | `/api/open-output` | Open output folder in OS file manager |

---

## 🧩 Key Technical Decisions & Fixes

### 1. Storyboard loading was slow → Server-side caching
**Problem:** Loading 176 storyboard images directly from YouTube CDN was slow and hit CORS issues.
**Fix:** `/api/storyboard-urls` now spawns a background thread that downloads all images to `cache/sb/<video_id>/`. Frontend loads from `/api/storyboard/<id>/<n>.jpg` (cached, fast, no CORS).

### 2. ffmpeg subtitle burning failed → ffmpeg-full required
**Problem:** Default Homebrew `ffmpeg` lacks `libass` support. `ass` and `subtitles` filters not available.
**Fix:** Install `brew install ffmpeg-full` which includes `--enable-libass`. `subtitle.py` auto-detects `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` and uses it if present.

### 3. Scene detection was extremely slow → Sampling mode
**Problem:** `ffmpeg select='gt(scene,0.4)'` processes every frame. 17-min video = 30,000+ frames = minutes of processing.
**Fix:** Added `fps=0.5` pre-filter to sample at 0.5 fps before scene detection. 60s timeout. Unchanged: Whisper transcription is the primary signal; scene detection is a bonus.

### 4. Port 5000 conflict with macOS AirPlay → Port 5001
**Problem:** macOS AirPlay Receiver uses port 5000.
**Fix:** App runs on port 5001 (`PORT=5001` env var or default in `app.py`).

### 5. Long video URL fetching timeout → Raised to 60s
**Problem:** `yt-dlp --dump-json` for long videos (4h+) returns large JSON (includes all storyboard URLs).
**Fix:** API timeout raised from 30s to 60s for info/storyboard endpoints.

### 6. Upload flow: browser can't access local paths → Server upload
**Problem:** JavaScript `File.path` is deprecated/unavailable in modern browsers.
**Fix:** Files are uploaded to server via `POST /api/upload` → saved to `uploads/` → server path returned for processing.

### 7. Smart Picks progress was invisible → Step-by-step status
**Problem:** Analyzer ran silently for 4-5 minutes with no feedback.
**Fix:** Job `current` field updates to "Transcribing audio..." so the frontend polling shows progress.

---

## 🎨 Subtitle Styling Details

- **Primary font:** Inter Black, 22pt, white with black 2.5px outline
- **Last word effect:** Each phrase's last word rendered in EB Garamond Italic
- **Format:** ASS (Advanced SubStation Alpha) for precise styling
- **Position:** Bottom center, 80px margin
- **Model default:** medium (balanced speed/accuracy), user can change to tiny/base/small/large

---

## 🧠 Smart Analyzer Algorithm

1. **Transcribe** with faster-whisper (small model by default in `analyzer.py`)
2. **Score** each segment:
   - Keyword matches (Spanish/English high-energy word lists)
   - Excitement patterns (!, ALL CAPS, laughter)
   - Word density (>15 words = bonus)
3. **Detect scene changes** via ffmpeg (sampled at 0.5 fps, 60s timeout)
4. **Merge** adjacent high-scoring segments into clips (min 15s, max 120s)
5. **Rank** by combined engagement score:
   - `avg_text_score * 2.0 + keyword_hits * 1.5 + scene_changes * 2.0`
   - Clips under 60s get 1.2x multiplier
6. **Return** top N clips with transcript snippets and reasons

---

## 📦 Dependencies

### System (install via setup.sh)
- **ffmpeg-full** (Homebrew) — with libass, libfreetype, libfontconfig
- **Python 3.9+**

### Python (install via requirements.txt)
- **flask** — web server
- **flask-cors** — CORS headers
- **yt-dlp** — YouTube downloader
- **faster-whisper** — local Whisper inference (CTranslate2)

### Fonts (included in repo)
- Inter Black (SIL Open Font License)
- EB Garamond Italic (SIL Open Font License)

---

## 🚦 Current State (July 2026)

| Module | Status | Notes |
|--------|--------|-------|
| YouTube clipper | ✅ Working | Storyboards cached server-side |
| Subtitles | ✅ Working | Requires ffmpeg-full (libass) |
| Editor | ✅ Working | Drag & drop upload + thumbnail timeline |
| Smart Picks | ✅ Working | ~4 min for 17-min video on CPU |
| Responsive UI | ✅ | Dark theme, 3 tabs, mobile-friendly |
| Setup script | ✅ | One command: `./setup.sh` |

---

## 🔮 Future Roadmap (Contributor Ideas)

- [ ] Drag-to-select range on thumbnail timeline
- [ ] Waveform audio visualization
- [ ] Subtitle style editor (font/size/color/position sliders)
- [ ] Export to vertical format (TikTok/Reels/Shorts)
- [ ] Multi-language subtitle tracks
- [ ] Speaker diarization ("who said what")
- [ ] YouTube chapters auto-import
- [ ] Electron desktop app wrapper
- [ ] Docker image
- [ ] GPU acceleration for Whisper (CUDA/Metal)
- [ ] Real-time preview before burning
- [ ] Undo/redo in editor
- [ ] Batch processing queue with priority

---

## 🏗 How to Start Developing

```bash
git clone <repo>
cd yt-clipper
./setup.sh          # installs ffmpeg-full + Python deps
python3 app.py      # starts on http://localhost:5001
```

### Quick test commands
```bash
# Test YouTube info
curl -X POST localhost:5001/api/info -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# Test subtitle generation
curl -X POST localhost:5001/api/subtitle/burn -H "Content-Type: application/json" \
  -d '{"path":"/path/to/video.mp4","model":"small","language":"es"}'

# Test smart analysis
curl -X POST localhost:5001/api/analyze -H "Content-Type: application/json" \
  -d '{"path":"/path/to/video.mp4","top_n":5}'
```

---

## 📝 Notes for AI Assistants

1. **Always check `ffmpeg-full` is installed** if subtitles don't work — default `ffmpeg` lacks libass
2. **Port 5001** not 5000 (AirPlay conflict on macOS)
3. **Storyboards are cached** in `cache/sb/<video_id>/` — clear this directory if images are stale
4. **Uploads go to** `uploads/` directory — safe to clean periodically
5. **Jobs are async** — use the `/api/job/<id>` polling pattern
6. **Whisper models** download to `~/.cache/huggingface/` on first use
7. **Frontend is vanilla JS** — no frameworks, no build step, no npm
8. **All paths** use absolute paths from `BASE_DIR` in app.py
9. **Production note:** Flask dev server is single-threaded by default — use gunicorn for production
