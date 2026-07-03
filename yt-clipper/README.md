# YT Clipper ✂️

**Extract clips, generate AI subtitles, and edit videos — all in one tool.**

Three modules in a single local web app:

| 🎬 YouTube | 💬 Subtitles | ✂️ Editor |
|:--|:--|:--|
| Paste URL → storyboard browser → queue clips → batch extract | Auto-transcribe with Whisper AI → burn Inter Black + EB Garamond Italic subtitles | Load local video → thumbnail timeline → cut clips with ffmpeg |

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Python: 3.9+](https://img.shields.io/badge/python-3.9+-blue)
![Status: MVP](https://img.shields.io/badge/status-MVP-orange)

---

## ✨ Features

### 🎬 YouTube Clipper
- Paste any YouTube URL, auto-fetch video info
- **Visual storyboard timeline** — browse 4h+ videos in seconds using YouTube's own thumbnail strips
- Click to select ranges, queue multiple clips, batch extract
- Quality options: 1080p, 720p, fast preview
- Download progress with live status

### 💬 Auto Subtitles
- **Whisper AI** transcription (tiny → large models)
- **Inter Black** + **EB Garamond Italic** burned-in subtitles
- Last word of each phrase in italic (stylish title style)
- Multi-language: Spanish, English, Portuguese, French, auto-detect
- Live transcript preview in the app

### ✂️ Local Editor
- Load any downloaded video (MP4, etc.)
- Generate **thumbnail timeline** at configurable intervals (5s–60s)
- Click to set in/out points, cut sub-clips with ffmpeg
- Instant cuts (stream copy, no re-encoding)
- Output saved to `~/Desktop/yt-clipper-output/`

## 🚀 Quick Start

```bash
git clone https://github.com/your-username/yt-clipper.git
cd yt-clipper
./setup.sh          # one-click: installs ffmpeg, yt-dlp, Python deps
python3 app.py      # start the app
# → http://localhost:5001
```

## 📋 Requirements

- Python 3.9+
- ffmpeg (auto-installed by setup.sh)
- yt-dlp (auto-installed)
- faster-whisper (auto-installed)

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python + Flask |
| Video | yt-dlp + ffmpeg |
| Transcription | faster-whisper (OpenAI Whisper) |
| Fonts | Inter Black + EB Garamond Italic |
| Frontend | Vanilla HTML/CSS/JS, dark theme |

## 📁 Project Structure

```
yt-clipper/
├── app.py              # Flask API (3 modules)
├── subtitle.py         # Subtitle pipeline (Whisper + ASS + ffmpeg)
├── fonts/
│   ├── Inter-Black.ttf
│   └── EBGaramond-Italic.ttf
├── static/
│   ├── index.html      # 3-tab UI
│   ├── style.css       # Dark theme
│   └── app.js          # Frontend logic
├── setup.sh            # One-click setup
├── requirements.txt
├── README.md
├── CONTRIBUTING.md
├── LICENSE
└── .gitignore
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Ideas welcome:

- [ ] Drag-to-select on timeline
- [ ] Waveform visualization
- [ ] Subtitle style editor (font, color, position)
- [ ] Export to GIF / Reels format
- [ ] Chapters auto-detection
- [ ] Electron standalone app
- [ ] Docker support
- [ ] Windows installer

## 📄 License

MIT
