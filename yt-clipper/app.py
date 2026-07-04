#!/usr/bin/env python3
"""
YT Clipper — Extract clips from YouTube videos with a visual storyboard browser.

Backend: Flask API + yt-dlp + ffmpeg
Frontend: Single-page app in static/
"""

import json
import os
import re
import subprocess
import sys
import time
import threading
import shutil
from fractions import Fraction
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# ── Config ────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

STATIC_DIR = BASE_DIR / "static"
OUTPUT_DIR = Path.home() / "Desktop" / "yt-clipper-output"
CACHE_DIR = BASE_DIR / "cache"
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024 * 1024  # 2GB max upload
CORS(app, origins=["http://localhost:5001", "http://127.0.0.1:5001"])


# ── Security ──────────────────────────────────────────────
def safe_video_path(user_path: str) -> Path:
    """Resolve a user-supplied path into UPLOAD_DIR, preventing traversal."""
    p = (UPLOAD_DIR / Path(user_path).name).resolve()
    if not str(p).startswith(str(UPLOAD_DIR.resolve())):
        raise ValueError("Path fuera del directorio permitido")
    if not p.exists():
        raise FileNotFoundError(user_path)
    return p


def safe_output_path(user_path: str) -> Path:
    """Resolve a user-supplied output path into OUTPUT_DIR."""
    p = (OUTPUT_DIR / Path(user_path).name).resolve()
    if not str(p).startswith(str(OUTPUT_DIR.resolve())):
        raise ValueError("Path fuera del directorio de output")
    if not p.exists():
        raise FileNotFoundError(user_path)
    return p

# ── In-memory job tracking ────────────────────────────────
jobs: dict[str, dict] = {}  # job_id -> {status, progress, ...}
jobs_lock = threading.Lock()

# ── Whisper model cache ───────────────────────────────────
_whisper_models: dict = {}
_whisper_lock = threading.Lock()
_whisper_semaphore = threading.Semaphore(1)  # Only one Whisper task at a time


def get_whisper_model(size: str = "medium"):
    """Get or create a cached WhisperModel. Thread-safe."""
    from faster_whisper import WhisperModel
    with _whisper_lock:
        if size not in _whisper_models:
            _whisper_models[size] = WhisperModel(size, device="cpu", compute_type="int8")
        return _whisper_models[size]


def fmt_time(seconds: float) -> str:
    """Format seconds to h:mm:ss"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def run(cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
    """Run a command, return (returncode, stdout, stderr)"""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "Timeout"


def check_deps() -> dict:
    """Check if required tools are installed"""
    deps = {}
    for name, cmd in [("yt-dlp", ["yt-dlp", "--version"]),
                       ("ffmpeg", ["ffmpeg", "-version"])]:
        rc, out, _ = run(cmd, 10)
        deps[name] = {"ok": rc == 0, "version": out.strip().split("\n")[0] if rc == 0 else None}
    return deps


# ═══════════════════════════════════════════════════════════
#  API Routes
# ═══════════════════════════════════════════════════════════

@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/api/health")
def health():
    deps = check_deps()
    return jsonify({
        "status": "ok",
        "dependencies": deps,
        "output_dir": str(OUTPUT_DIR),
    })


@app.route("/api/info", methods=["POST"])
def video_info():
    """Get video metadata (title, duration, storyboards)"""
    data = request.get_json()
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400

    # Validate URL
    if "youtube.com" not in url and "youtu.be" not in url:
        return jsonify({"error": "Only YouTube URLs are supported"}), 400

    try:
        rc, stdout, stderr = run([
            "yt-dlp", "--dump-json", "--no-download", url
        ], timeout=60)
        if rc != 0:
            return jsonify({"error": stderr.strip()}), 500

        info = json.loads(stdout)

        # Extract storyboard info
        storyboards = []
        for fmt in info.get("formats", []):
            fid = fmt.get("format_id", "")
            note = fmt.get("format_note", "")
            if fid.startswith("sb") or "storyboard" in note.lower():
                fragments = fmt.get("fragments", [])
                storyboards.append({
                    "id": fid,
                    "resolution": fmt.get("resolution", "?"),
                    "rows": fmt.get("rows", 0),
                    "columns": fmt.get("columns", 0),
                    "fragment_count": len(fragments),
                    "fragment_duration": fragments[0].get("duration", 0) if fragments else 0,
                    "urls": [f["url"] for f in fragments],
                    "width": fmt.get("width", 0),
                    "height": fmt.get("height", 0),
                })

        # Sort storyboards by quality (sb0 = best)
        storyboards.sort(key=lambda s: s["id"])

        # Extract chapters if available
        chapters = info.get("chapters") or []

        result = {
            "title": info.get("title", "Unknown"),
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail", ""),
            "description": (info.get("description") or "")[:500],
            "chapters": [
                {"title": ch.get("title", ""),
                 "start": ch.get("start_time", 0),
                 "end": ch.get("end_time", 0)}
                for ch in chapters
            ],
            "storyboards": storyboards,
        }
        return jsonify(result)

    except json.JSONDecodeError:
        return jsonify({"error": "Failed to parse video metadata"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/uploads/<path:filename>")
def serve_upload_file(filename):
    """Serve uploaded video files for browser playback (supports HTTP range for seeking)"""
    safe_name = re.sub(r"[^a-zA-Z0-9_.\-]", "_", Path(filename).name)
    if not (UPLOAD_DIR / safe_name).exists():
        return jsonify({"error": "File not found"}), 404
    return send_from_directory(str(UPLOAD_DIR), safe_name, conditional=True)


@app.route("/api/storyboard/<video_id>/<int:index>.jpg")
def storyboard_image(video_id, index):
    """Serve cached storyboard images"""
    cache_subdir = CACHE_DIR / "sb" / video_id
    cache_file = cache_subdir / f"{index:04d}.jpg"
    if cache_file.exists():
        return send_from_directory(str(cache_subdir), f"{index:04d}.jpg")
    return jsonify({"error": "Not cached yet"}), 404


@app.route("/api/storyboard-urls", methods=["POST"])
def storyboard_urls():
    """Return storyboard info and cache images server-side"""
    data = request.get_json()
    url = data.get("url", "").strip()
    quality = data.get("quality", "sb0")

    rc, stdout, stderr = run([
        "yt-dlp", "--dump-json", "--no-download", url
    ], timeout=60)

    if rc != 0:
        return jsonify({"error": stderr.strip()}), 500

    info = json.loads(stdout)
    video_id = info.get("id", "")

    for fmt in info.get("formats", []):
        if fmt.get("format_id") == quality:
            fragments = fmt.get("fragments", [])
            urls = [f["url"] for f in fragments]

            # Start caching images in background
            cache_subdir = CACHE_DIR / "sb" / video_id
            cache_subdir.mkdir(parents=True, exist_ok=True)

            def cache_images():
                import urllib.request
                ctx = None  # Use default SSL verification
                for i, img_url in enumerate(urls):
                    cache_file = cache_subdir / f"{i:04d}.jpg"
                    if not cache_file.exists():
                        try:
                            req = urllib.request.Request(img_url, headers={
                                "User-Agent": "Mozilla/5.0"
                            })
                            with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
                                cache_file.write_bytes(resp.read())
                        except Exception:
                            pass

            threading.Thread(target=cache_images, daemon=True).start()

            return jsonify({
                "video_id": video_id,
                "resolution": fmt.get("resolution", ""),
                "rows": fmt.get("rows", 0),
                "columns": fmt.get("columns", 0),
                "fragment_duration": fragments[0].get("duration", 0) if fragments else 0,
                "video_duration": info.get("duration", 0),
                "total": len(urls),
                "thumb_base": f"/api/storyboard/{video_id}",
            })

    return jsonify({"error": f"Storyboard quality {quality} not found"}), 404


@app.route("/api/extract", methods=["POST"])
def extract_clips():
    """Start extracting clips in background"""
    data = request.get_json()
    url = data.get("url", "").strip()
    clips = data.get("clips", [])  # [{start, end, label}]
    quality = data.get("quality", "bestvideo+bestaudio")

    if not url or not clips:
        return jsonify({"error": "URL and clips are required"}), 400

    job_id = str(int(time.time() * 1000))
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    with jobs_lock:
        jobs[job_id] = {
            "status": "pending",
            "progress": 0,
            "total": len(clips),
            "completed": 0,
            "current": "",
            "files": [],
            "errors": [],
        }

    def do_extract():
        job = jobs[job_id]
        job["status"] = "running"

        for i, clip in enumerate(clips):
            start = clip["start"]
            end = clip["end"]
            label = clip.get("label", f"clip_{i+1}")
            # Sanitize label for filename
            safe_label = re.sub(r"[^a-zA-Z0-9_\-]", "_", label)

            outfile = OUTPUT_DIR / f"{timestamp}_{i+1:02d}_{safe_label}.mp4"
            job["current"] = label
            job["progress"] = i

            try:
                rc, stdout, stderr = run([
                    "yt-dlp",
                    "--download-sections", f"*{start}-{end}",
                    "-f", quality,
                    "--merge-output-format", "mp4",
                    "-o", str(outfile),
                    "--no-playlist",
                    url,
                ], timeout=900)

                if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
                    size_mb = outfile.stat().st_size / (1024 * 1024)
                    job["files"].append({
                        "name": outfile.name,
                        "path": str(outfile),
                        "label": label,
                        "size_mb": round(size_mb, 1),
                        "start": start,
                        "end": end,
                    })
                    job["completed"] = i + 1
                else:
                    job["errors"].append({
                        "label": label,
                        "error": stderr.strip() or "Unknown error",
                    })
            except Exception as e:
                job["errors"].append({"label": label, "error": str(e)})

            job["progress"] = i + 1

        job["status"] = "done" if len(job["errors"]) == 0 else "partial"
        job["current"] = ""

    threading.Thread(target=do_extract, daemon=True).start()

    return jsonify({"job_id": job_id})


@app.route("/api/job/<job_id>")
def job_status(job_id):
    """Get status of an extraction job"""
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/api/deps")
def dependencies():
    return jsonify(check_deps())


@app.route("/api/open-output")
def open_output():
    """Open the output folder"""
    import platform
    path = str(OUTPUT_DIR)
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", path])
        elif system == "Windows":
            subprocess.run(["explorer", path])
        else:
            subprocess.run(["xdg-open", path])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
#  Upload API
# ═══════════════════════════════════════════════════════════

@app.route("/api/upload", methods=["POST"])
def upload_video():
    """Upload a video file from the browser"""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    # Sanitize filename
    safe_name = re.sub(r"[^a-zA-Z0-9_.\-]", "_", file.filename)
    dest = UPLOAD_DIR / safe_name

    # If exists, add number
    counter = 1
    stem, ext = os.path.splitext(safe_name)
    while dest.exists():
        dest = UPLOAD_DIR / f"{stem}_{counter}{ext}"
        counter += 1

    file.save(str(dest))
    size_mb = dest.stat().st_size / (1024 * 1024)

    return jsonify({
        "ok": True,
        "path": str(dest),
        "filename": dest.name,
        "size_mb": round(size_mb, 1),
    })


# ═══════════════════════════════════════════════════════════
#  Smart Analyzer API
# ═══════════════════════════════════════════════════════════

@app.route("/api/analyze", methods=["POST"])
def analyze_video_endpoint():
    """Analyze video and return top engaging clips"""
    from analyzer import analyze_video
    data = request.get_json()
    path = data.get("path", "").strip()
    top_n = data.get("top_n", 10)
    min_dur = data.get("min_duration", 15)
    max_dur = data.get("max_duration", 120)
    language = data.get("language", "es")

    if not path or not Path(path).exists():
        return jsonify({"error": "Video file not found"}), 400

    job_id = str(int(time.time() * 1000))
    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": "Analyzing video...", "result": None}

    def do_analyze():
        with _whisper_semaphore:
            try:
                with jobs_lock:
                    jobs[job_id]["current"] = "Transcribing audio..."
                clips = analyze_video(path, top_n, min_dur, max_dur, language)
                with jobs_lock:
                    jobs[job_id] = {"status": "done", "result": {"clips": clips, "total": len(clips)}}
            except Exception as e:
                with jobs_lock:
                    jobs[job_id] = {"status": "error", "error": str(e)}

    threading.Thread(target=do_analyze, daemon=True).start()
    return jsonify({"job_id": job_id})


# ═══════════════════════════════════════════════════════════
#  Subtitle API
# ═══════════════════════════════════════════════════════════

@app.route("/api/subtitle/transcribe", methods=["POST"])
def subtitle_transcribe():
    """Transcribe a video asynchronously — returns job_id, poll /api/job/<id>"""
    from subtitle import transcribe
    data = request.get_json()
    video_path = data.get("path", "").strip()
    model_size = data.get("model", "medium")
    language = data.get("language", "es")
    word_timestamps = data.get("word_timestamps", False)

    if not video_path or not Path(video_path).exists():
        return jsonify({"error": "Video file not found"}), 400

    job_id = str(int(time.time() * 1000))
    mode_label = "word-by-word" if word_timestamps else "standard"
    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": f"Loading Whisper model ({mode_label})...", "result": None}

    def do_transcribe():
        with _whisper_semaphore:
            try:
                with jobs_lock:
                    jobs[job_id]["current"] = "Transcribing audio..."
                segs = transcribe(video_path, model_size, language, word_timestamps=word_timestamps)
                with jobs_lock:
                    jobs[job_id] = {"status": "done", "result": {"segments": segs, "count": len(segs)}}
            except Exception as e:
                with jobs_lock:
                    jobs[job_id] = {"status": "error", "error": str(e)}

    threading.Thread(target=do_transcribe, daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/api/subtitle/burn", methods=["POST"])
def subtitle_burn():
    """Burn subtitles: transcribe (or use provided segments) + apply style + export"""
    from subtitle import process_video
    data = request.get_json()
    video_path = data.get("path", "").strip()
    output_path = data.get("output", "").strip() or None
    model_size = data.get("model", "medium")
    language = data.get("language", "es")
    style = data.get("style", {})
    segments_override = data.get("segments")  # pre-edited segments from the browser editor

    if not video_path or not Path(video_path).exists():
        return jsonify({"error": "Video file not found"}), 400

    job_id = str(int(time.time() * 1000))
    msg = "Burning subtitles from editor..." if segments_override else "Transcribing + burning subtitles..."
    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": msg, "result": None}

    def do_subtitle():
        with _whisper_semaphore:
            try:
                with jobs_lock:
                    jobs[job_id]["current"] = "Burning subtitles into video..."
                result = process_video(video_path, output_path, model_size, language,
                                       style=style, segments_override=segments_override)
                with jobs_lock:
                    jobs[job_id] = {"status": "done", "result": result}
            except Exception as e:
                with jobs_lock:
                    jobs[job_id] = {"status": "error", "error": str(e)}

    threading.Thread(target=do_subtitle, daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/api/serve-output/<path:filename>")
def serve_output_file(filename):
    """Serve processed output files for editor preview."""
    safe_name = re.sub(r"[^a-zA-Z0-9_.\-]", "_", Path(filename).name)
    path = OUTPUT_DIR / safe_name
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_from_directory(str(OUTPUT_DIR), safe_name, conditional=True)


# ═══════════════════════════════════════════════════════════
#  Local Editor API
# ═══════════════════════════════════════════════════════════

@app.route("/api/local/info", methods=["POST"])
def local_video_info():
    """Get info about a local video file (duration, resolution, etc.)"""
    data = request.get_json()
    path = data.get("path", "").strip()

    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 400

    try:
        rc, stdout, stderr = run([
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", path
        ], timeout=30)
        if rc != 0:
            return jsonify({"error": stderr.strip()}), 500

        info = json.loads(stdout)
        fmt = info.get("format", {})
        streams = info.get("streams", [])
        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        return jsonify({
            "duration": float(fmt.get("duration", 0)),
            "size_mb": round(float(fmt.get("size", 0)) / (1024 * 1024), 1),
            "filename": Path(path).name,
            "video": {
                "codec": video_stream.get("codec_name", "?") if video_stream else None,
                "width": video_stream.get("width") if video_stream else None,
                "height": video_stream.get("height") if video_stream else None,
                "fps": float(Fraction(video_stream.get("r_frame_rate", "0/1"))) if video_stream else None,
            } if video_stream else None,
            "audio": {
                "codec": audio_stream.get("codec_name", "?") if audio_stream else None,
                "channels": audio_stream.get("channels") if audio_stream else None,
            } if audio_stream else None,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/local/thumbnails", methods=["POST"])
def local_thumbnails():
    """Generate thumbnail storyboard from a local video"""
    data = request.get_json()
    path = data.get("path", "").strip()
    interval = data.get("interval", 10)  # seconds between thumbnails

    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 400

    # Get duration
    rc, stdout, _ = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path
    ], timeout=10)
    if rc != 0:
        return jsonify({"error": "Cannot read video"}), 500

    duration = float(stdout.strip())
    thumb_count = max(1, int(duration / interval))
    thumb_dir = CACHE_DIR / f"local_thumbs_{Path(path).stem}"
    thumb_dir.mkdir(parents=True, exist_ok=True)

    # Generate thumbnails — single ffmpeg pass (200x faster than 200 processes)
    existing = list(thumb_dir.glob("thumb_*.jpg"))
    if len(existing) < min(thumb_count, 200):
        # Remove old partials
        for f in existing:
            f.unlink()
        fps_val = 1.0 / interval
        run([
            "ffmpeg", "-y",
            "-i", path,
            "-vf", f"fps={fps_val},scale=320:180",
            "-q:v", "3",
            "-frames:v", str(min(thumb_count, 200)),
            str(thumb_dir / "thumb_%04d.jpg")
        ], timeout=120)

    return jsonify({
        "duration": duration,
        "interval": interval,
        "thumb_count": thumb_count,
        "thumb_dir": str(thumb_dir),
        "thumb_base_url": f"/api/local/thumb/{Path(path).stem}",
    })


@app.route("/api/local/thumb/<stem>/<filename>")
def local_thumb_image(stem, filename):
    thumb_dir = CACHE_DIR / f"local_thumbs_{stem}"
    if not thumb_dir.exists():
        return jsonify({"error": "Thumbnails not found"}), 404
    return send_from_directory(str(thumb_dir), filename)


@app.route("/api/local/cut", methods=["POST"])
def local_cut():
    """Cut a segment from a local video using ffmpeg."""
    data = request.get_json()
    path = data.get("path", "").strip()
    start = data.get("start", 0)
    end = data.get("end", 0)
    label = data.get("label", "clip")

    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 400
    if end <= start:
        return jsonify({"error": "end must be greater than start"}), 400

    safe_label = re.sub(r"[^a-zA-Z0-9_\-]", "_", label)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    outfile = OUTPUT_DIR / f"{timestamp}_{safe_label}.mp4"

    duration = end - start

    try:
        rc, stdout, stderr = run([
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", path,
            "-t", str(duration),
            "-c", "copy",
            str(outfile)
        ], timeout=300)

        if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
            return jsonify({
                "ok": True,
                "output": str(outfile),
                "filename": outfile.name,
                "size_mb": round(outfile.stat().st_size / (1024 * 1024), 1),
            })
        return jsonify({"error": stderr.strip() or "Unknown error"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/local/export", methods=["POST"])
def local_export():
    """Export current working video to output folder with a clean name."""
    data = request.get_json()
    path = data.get("path", "").strip()
    label = data.get("label", "final")

    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 400

    safe_label = re.sub(r"[^a-zA-Z0-9_\-]", "_", label)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    outfile = OUTPUT_DIR / f"{timestamp}_{safe_label}.mp4"

    try:
        shutil.copy2(path, outfile)
        size_mb = outfile.stat().st_size / (1024 * 1024)
        return jsonify({
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(size_mb, 1),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
#  Command Panel API — Natural language actions
# ═══════════════════════════════════════════════════════════

# Command patterns: (regex, action_name, extractor_fn)
COMMAND_PATTERNS = [
    # Silence removal
    (r"quita[rm]?\s+(los\s+)?(espacios\s+(en|de)\s+)?silencio", "remove_silence",
     lambda m: {}),
    # Trim start: "corta los primeros X segundos"
    (r"corta[rm]?\s+los\s+primeros\s+(\d+)\s*segundos?", "trim_start",
     lambda m: {"seconds": int(m.group(1))}),
    # Trim end: "corta los últimos X segundos"
    (r"corta[rm]?\s+los\s+[úu]ltimos\s+(\d+)\s*segundos?", "trim_end",
     lambda m: {"seconds": int(m.group(1))}),
    # Cut range: "recorta de X a Y" / "extrae el clip entre X y Y"
    (r"(?:recorta[rm]?|extrae[rm]?)\s+(?:de|el\s+clip\s+entre)\s+(\d+(?::\d+)?)\s*(?:a|y|hasta)\s*(\d+(?::\d+)?)", "cut_range",
     lambda m: {"start": _parse_time(m.group(1)), "end": _parse_time(m.group(2))}),
    # Cut range: "corta de X a Y"
    (r"corta[rm]?\s+de\s+(\d+(?::\d+)?)\s*(?:a|y|hasta)\s*(\d+(?::\d+)?)", "cut_range",
     lambda m: {"start": _parse_time(m.group(1)), "end": _parse_time(m.group(2))}),
    # Transcribe: "genera subtítulos" / "transcribe"
    (r"(?:genera[rm]?|crea[rm]?|haz|pon|poner)\s+(subt[íi]tulos?|transcripci[óo]n)", "transcribe",
     lambda m: {"action": "transcribe"}),
    # Burn subtitles: "aplica subtítulos" / "quema subtítulos"
    (r"(?:aplica[rm]?|quema[rm]?|graba[rm]?)\s+(los\s+)?subt[íi]tulos?", "burn_subtitles",
     lambda m: {"action": "burn"}),
    # Smart analyze: "busca los mejores momentos" / "encuentra clips"
    (r"(?:busca[rm]?|encuentra[rm]?|analiza[rm]?)\s+(los\s+)?mejores\s+(momentos|clips)", "smart_analyze",
     lambda m: {}),
    # Speed change: "cambia velocidad a X"
    (r"(?:cambia[rm]?|pon|ajusta[rm]?)\s+(?:la\s+)?velocidad\s+a\s+(\d+(?:\.\d+)?)\s*x?", "change_speed",
     lambda m: {"speed": float(m.group(1))}),
    # Reverse: "invierte el video" / "dale la vuelta"
    (r"(?:invierte[rm]?|dale\s+la\s+vuelta\s+a)\s+(?:el\s+)?video", "reverse",
     lambda m: {}),
    # Enhance audio: "mejora el audio" / "limpia la voz" / "mejora la voz"
    (r"(?:mejora[rm]?|limpia[rm]?|potencia[rm]?|realza[rm]?|mejor\s+)?(?:el\s+)?(?:audio|la\s+voz|las\s+voces|el\s+sonido)", "enhance_audio",
     lambda m: {}),
]


def _parse_time(s: str) -> float:
    """Parse '1:30' -> 90.0, '45' -> 45.0"""
    s = s.strip()
    if ":" in s:
        parts = s.split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return float(s)


def parse_command(text: str) -> dict | None:
    """Parse a natural language Spanish command into structured action."""
    text = text.strip().lower()
    for pattern, action, extractor in COMMAND_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            result = {"action": action, "raw": text}
            result.update(extractor(m))
            return result
    return None


@app.route("/api/cmd/parse", methods=["POST"])
def cmd_parse():
    """Parse a natural language command without executing"""
    data = request.get_json()
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "No command provided"}), 400

    parsed = parse_command(text)
    if parsed:
        return jsonify({"ok": True, "parsed": parsed})
    return jsonify({"ok": False, "hint": "No entendí el comando. Probá: quita los espacios en silencio, recorta de 10 a 30, genera subtítulos, busca los mejores momentos, cambia velocidad a 2x"})


@app.route("/api/cmd/run", methods=["POST"])
def cmd_run():
    """Parse AND execute a natural language command"""
    data = request.get_json()
    text = data.get("text", "").strip()
    video_path = data.get("path", "").strip()

    if not text:
        return jsonify({"error": "No command provided"}), 400
    if not video_path or not Path(video_path).exists():
        return jsonify({"error": "No video loaded. Load a video first in the Editor tab."}), 400

    parsed = parse_command(text)
    if not parsed:
        return jsonify({"error": "No entendí el comando. Probá: quita los espacios en silencio, recorta de 10 a 30, genera subtítulos, busca los mejores momentos, cambia velocidad a 2x"}), 400

    job_id = str(int(time.time() * 1000))
    action = parsed["action"]

    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": f"Ejecutando: {text}", "result": None}

    def do_cmd():
        try:
            result = _execute_command(action, parsed, video_path, job_id)
            with jobs_lock:
                jobs[job_id] = {"status": "done", "result": result}
        except Exception as e:
            with jobs_lock:
                jobs[job_id] = {"status": "error", "error": str(e)}

    threading.Thread(target=do_cmd, daemon=True).start()
    return jsonify({"job_id": job_id, "parsed": parsed})


def _execute_command(action: str, parsed: dict, video_path: str, job_id: str) -> dict:
    """Execute a parsed command action."""
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    if action == "remove_silence":
        return _cmd_remove_silence(video_path, timestamp, job_id)
    elif action == "trim_start":
        return _cmd_trim(video_path, "start", parsed["seconds"], timestamp, job_id)
    elif action == "trim_end":
        return _cmd_trim(video_path, "end", parsed["seconds"], timestamp, job_id)
    elif action == "cut_range":
        return _cmd_cut_range(video_path, parsed["start"], parsed["end"], timestamp, job_id)
    elif action == "transcribe":
        return _cmd_transcribe(video_path, job_id)
    elif action == "burn_subtitles":
        return _cmd_burn_subtitles(video_path, job_id)
    elif action == "smart_analyze":
        return _cmd_smart_analyze(video_path, job_id)
    elif action == "change_speed":
        return _cmd_change_speed(video_path, parsed["speed"], timestamp, job_id)
    elif action == "reverse":
        return _cmd_reverse(video_path, timestamp, job_id)
    elif action == "enhance_audio":
        return _cmd_enhance_audio(video_path, timestamp, job_id)
    else:
        raise ValueError(f"Unknown action: {action}")


def _cmd_remove_silence(video_path: str, timestamp: str, job_id: str) -> dict:
    """Remove silent parts from a video using ffmpeg silenceremove filter."""
    with jobs_lock:
        jobs[job_id]["current"] = "Detectando y eliminando silencios..."

    outfile = OUTPUT_DIR / f"{timestamp}_sin_silencio.mp4"

    rc, stdout, stderr = run([
        "ffmpeg", "-y",
        "-i", video_path,
        "-af", "silenceremove=stop_periods=-1:stop_duration=0.8:stop_threshold=-40dB",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        str(outfile)
    ], timeout=600)

    if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
        orig_dur = _get_duration(video_path)
        new_dur = _get_duration(str(outfile))
        removed = orig_dur - new_dur if orig_dur and new_dur else 0
        return {
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(outfile.stat().st_size / (1024 * 1024), 1),
            "original_duration": orig_dur,
            "new_duration": new_dur,
            "removed_seconds": round(removed, 1),
            "message": f"Silencios eliminados: {fmt_time(removed)} menos",
        }
    raise RuntimeError(stderr.strip() or "Failed to remove silence")


def _cmd_trim(video_path: str, side: str, seconds: float, timestamp: str, job_id: str) -> dict:
    """Trim from start or end of video."""
    with jobs_lock:
        jobs[job_id]["current"] = f"Recortando {seconds}s del {'inicio' if side == 'start' else 'final'}..."

    dur = _get_duration(video_path)
    if side == "start":
        start = seconds
        end = dur
    else:
        start = 0
        end = dur - seconds

    outfile = OUTPUT_DIR / f"{timestamp}_recortado.mp4"
    duration = end - start

    rc, stdout, stderr = run([
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", video_path,
        "-t", str(duration),
        "-c", "copy",
        str(outfile)
    ], timeout=300)

    if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
        return {
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(outfile.stat().st_size / (1024 * 1024), 1),
            "message": f"{'Primeros' if side == 'start' else 'Últimos'} {seconds}s recortados",
        }
    raise RuntimeError(stderr.strip() or "Failed to trim")


def _cmd_cut_range(video_path: str, start: float, end: float, timestamp: str, job_id: str) -> dict:
    """Cut a time range from the video."""
    with jobs_lock:
        jobs[job_id]["current"] = f"Extrayendo clip {fmtTime(start)} → {fmtTime(end)}..."

    outfile = OUTPUT_DIR / f"{timestamp}_clip_{int(start)}-{int(end)}.mp4"
    duration = end - start

    rc, stdout, stderr = run([
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", video_path,
        "-t", str(duration),
        "-c", "copy",
        str(outfile)
    ], timeout=300)

    if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
        return {
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(outfile.stat().st_size / (1024 * 1024), 1),
            "message": f"Clip extraído: {fmtTime(start)} → {fmtTime(end)}",
        }
    raise RuntimeError(stderr.strip() or "Failed to cut")


def _cmd_transcribe(video_path: str, job_id: str) -> dict:
    """Transcribe audio (wrap analyzer/subtitle module)."""
    with jobs_lock:
        jobs[job_id]["current"] = "Esperando turno de Whisper..."
    with _whisper_semaphore:
        with jobs_lock:
            jobs[job_id]["current"] = "Transcribiendo audio con Whisper..."

        from subtitle import transcribe
        segments = transcribe(video_path, model_size="medium", language="es", word_timestamps=False)

    full_text = " ".join(s.get("text", "") for s in segments)
    return {
        "ok": True,
        "segments": len(segments),
        "preview": full_text[:300] + ("..." if len(full_text) > 300 else ""),
        "message": f"Transcripción completada: {len(segments)} segmentos",
    }


def _cmd_burn_subtitles(video_path: str, job_id: str) -> dict:
    """Transcribe + burn subtitles into video."""
    with jobs_lock:
        jobs[job_id]["current"] = "Esperando turno de Whisper..."
    with _whisper_semaphore:
        with jobs_lock:
            jobs[job_id]["current"] = "Transcribiendo y quemando subtítulos..."

        from subtitle import process_video
        result = process_video(video_path, model_size="medium", language="es")
    return {**result, "message": "Subtítulos quemados en el video"}


def _cmd_smart_analyze(video_path: str, job_id: str) -> dict:
    """Run smart analyzer to find best clips."""
    with jobs_lock:
        jobs[job_id]["current"] = "Esperando turno de Whisper..."
    with _whisper_semaphore:
        with jobs_lock:
            jobs[job_id]["current"] = "Analizando video con IA..."

        from analyzer import analyze_video
        clips = analyze_video(video_path, top_n=10, min_duration=15, max_duration=120, language="es")

    return {
        "ok": True,
        "clips": [
            {
                "start": c["start"],
                "end": c["end"],
                "duration": c["duration"],
                "engagement": c["engagement"],
                "transcript": c.get("transcript", "")[:100],
                "reasons": c.get("reasons", []),
            }
            for c in clips
        ],
        "total": len(clips),
        "message": f"{len(clips)} clips interesantes encontrados",
    }


def _cmd_change_speed(video_path: str, speed: float, timestamp: str, job_id: str) -> dict:
    """Change video playback speed."""
    with jobs_lock:
        jobs[job_id]["current"] = f"Cambiando velocidad a {speed}x..."

    outfile = OUTPUT_DIR / f"{timestamp}_speed_{speed}x.mp4"

    # atempo filter for audio; setpts for video
    atempo_val = min(max(speed, 0.5), 2.0)  # ffmpeg atempo range
    # Chain multiple atempo if needed
    audio_filter = f"atempo={atempo_val}"
    if speed > 2.0:
        audio_filter = f"atempo=2.0,atempo={speed/2.0}"
    elif speed < 0.5:
        audio_filter = f"atempo=0.5,atempo={speed/0.5}"

    video_pts = 1.0 / speed

    rc, stdout, stderr = run([
        "ffmpeg", "-y",
        "-i", video_path,
        "-filter_complex", f"[0:v]setpts={video_pts}*PTS[v];[0:a]{audio_filter}[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        str(outfile)
    ], timeout=600)

    if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
        return {
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(outfile.stat().st_size / (1024 * 1024), 1),
            "message": f"Velocidad cambiada a {speed}x",
        }
    raise RuntimeError(stderr.strip() or "Failed to change speed")


def _cmd_reverse(video_path: str, timestamp: str, job_id: str) -> dict:
    """Reverse the video."""
    with jobs_lock:
        jobs[job_id]["current"] = "Invirtiendo video..."

    outfile = OUTPUT_DIR / f"{timestamp}_reversed.mp4"

    rc, stdout, stderr = run([
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", "reverse",
        "-af", "areverse",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        str(outfile)
    ], timeout=600)

    if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
        return {
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(outfile.stat().st_size / (1024 * 1024), 1),
            "message": "Video invertido",
        }
    raise RuntimeError(stderr.strip() or "Failed to reverse")


def _cmd_enhance_audio(video_path: str, timestamp: str, job_id: str) -> dict:
    """Enhance voice audio: denoise → EQ → compress → normalize."""
    with jobs_lock:
        jobs[job_id]["current"] = "Analizando audio..."

    outfile = OUTPUT_DIR / f"{timestamp}_voz_mejorada.mp4"

    # Professional voice enhancement chain:
    # 1. highpass=80   → cut sub-bass rumble (<80Hz)
    # 2. lowpass=8000  → reduce hiss (>8kHz, voice range is ~85-255Hz fundamental, up to ~8kHz harmonics)
    # 3. afftdn=nr=25  → FFT noise reduction (25 = moderate, 10-90 range)
    # 4. compand       → voice compressor for presence
    #    attacks=0.1, decays=0.3  → fast response for speech
    #    points=-80/-80|-30/-18|-15/-8|0/-3  → expander below -30dB, compressor above
    #    gain=6 → 6dB makeup gain
    # 5. loudnorm       → EBU R128 broadcast standard (-16 LUFS for YouTube)
    audio_filter = (
        "highpass=f=80,"
        "lowpass=f=8500,"
        "afftdn=nr=25:nf=-25,"
        "compand=attacks=0.1:decays=0.3:points=-80/-80|-30/-18|-15/-8|0/-3:gain=6:soft-knee=2,"
        "loudnorm=I=-16:LRA=11:TP=-1.5"
    )

    with jobs_lock:
        jobs[job_id]["current"] = "Procesando audio (denoise + EQ + compresión)..."

    rc, stdout, stderr = run([
        "ffmpeg", "-y",
        "-i", video_path,
        "-af", audio_filter,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "256k",
        str(outfile)
    ], timeout=600)

    # If afftdn isn't available (older ffmpeg), fall back without it
    if rc != 0:
        with jobs_lock:
            jobs[job_id]["current"] = "Reintentando sin reducción avanzada de ruido..."

        audio_filter_fallback = (
            "highpass=f=80,"
            "lowpass=f=8500,"
            "compand=attacks=0.1:decays=0.3:points=-80/-80|-30/-18|-15/-8|0/-3:gain=6:soft-knee=2,"
            "loudnorm=I=-16:LRA=11:TP=-1.5"
        )
        rc, stdout, stderr = run([
            "ffmpeg", "-y",
            "-i", video_path,
            "-af", audio_filter_fallback,
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "256k",
            str(outfile)
        ], timeout=600)

    if rc == 0 and outfile.exists() and outfile.stat().st_size > 0:
        orig_size = Path(video_path).stat().st_size / (1024 * 1024)
        new_size = outfile.stat().st_size / (1024 * 1024)
        return {
            "ok": True,
            "output": str(outfile),
            "filename": outfile.name,
            "size_mb": round(new_size, 1),
            "message": "Audio de voz mejorado: reducción de ruido + ecualización + compresión + normalización",
            "details": [
                "🔇 Ruido de fondo reducido (FFT denoise)",
                "🎚️ Sub-graves eliminados (<80Hz)",
                "🎚️ Silbidos reducidos (>8.5kHz)",
                "📢 Voz comprimida y realzada (+6dB presencia)",
                "📏 Normalizado a -16 LUFS (estándar YouTube)",
            ],
        }
    raise RuntimeError(stderr.strip()[-300:] or "Failed to enhance audio")


def _get_duration(path: str) -> float:
    """Get video duration in seconds."""
    rc, stdout, _ = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path
    ], timeout=10)
    if rc == 0 and stdout.strip():
        return float(stdout.strip())
    return 0


# ═══════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    host = "127.0.0.1"  # Default: local only
    if "--lan" in sys.argv:
        host = "0.0.0.0"
        sys.argv.remove("--lan")

    print(f"""
╔══════════════════════════════════════════════════════╗
║           YT Clipper — MVP                          ║
║                                                     ║
║   Abrí:  http://localhost:{port}                       ║
║                                                     ║
║   Output: {OUTPUT_DIR}
╚══════════════════════════════════════════════════════╝
""")
    # Check deps
    deps = check_deps()
    for name, info in deps.items():
        status = "✓" if info["ok"] else "✗ MISSING"
        ver = info.get("version", "") or ""
        print(f"   {name}: {status}  {ver}")
    print()

    app.run(host=host, port=port, debug=False)
