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
CORS(app)

# ── In-memory job tracking ────────────────────────────────
jobs: dict[str, dict] = {}  # job_id -> {status, progress, ...}
jobs_lock = threading.Lock()


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
                import urllib.request, ssl
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
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

    if not video_path or not Path(video_path).exists():
        return jsonify({"error": "Video file not found"}), 400

    job_id = str(int(time.time() * 1000))
    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": "Loading Whisper model...", "result": None}

    def do_transcribe():
        try:
            with jobs_lock:
                jobs[job_id]["current"] = "Transcribing audio..."
            segs = transcribe(video_path, model_size, language)
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
                "fps": eval(video_stream.get("r_frame_rate", "0/1")) if video_stream else None,
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

    # Generate thumbnails
    for i in range(min(thumb_count, 200)):  # cap at 200
        outfile = thumb_dir / f"thumb_{i:04d}.jpg"
        if not outfile.exists():
            seek = i * interval
            run([
                "ffmpeg", "-y", "-ss", str(seek), "-i", path,
                "-vframes", "1", "-q:v", "3", "-s", "320x180",
                str(outfile)
            ], timeout=15)

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
    """Cut a segment from a local video using ffmpeg"""
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


# ═══════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
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

    app.run(host="0.0.0.0", port=port, debug=False)
