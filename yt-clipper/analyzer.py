"""
Smart Clip Analyzer — Find the most engaging moments in a video.

Uses:
- faster-whisper: transcribe audio, score segments by speech density/emotion
- ffmpeg: detect scene changes (visual activity)

Returns top N clips ranked by a combined "engagement score".
"""

import json
import subprocess
import tempfile
import os
import re
from pathlib import Path
from collections import defaultdict

# ── Keyword scoring ───────────────────────────────────────
# Words that indicate high-energy / engaging moments
HIGH_ENERGY_ES = {
    "increíble", "impresionante", "espectacular", "brutal", "bestial",
    "tremendo", "genial", "fantástico", "maravilloso", "perfecto",
    "vamos", "dale", "mira", "atención", "importante", "clave",
    "revolucionario", "único", "jamás", "nunca", "siempre",
    "ganador", "ganar", "éxito", "logro", "récord",
    "no puede ser", "wow", "guau", "risas", "aplausos",
    "gracias", "felicidades", "amo", "me encanta",
}
HIGH_ENERGY_EN = {
    "incredible", "amazing", "awesome", "spectacular", "brilliant",
    "wow", "look", "watch", "never", "ever", "best", "greatest",
    "perfect", "beautiful", "stunning", "unbelievable",
    "winner", "record", "history", "first", "revolutionary",
    "game changer", "breakthrough", "insane", "crazy",
}

EXCITEMENT_PATTERNS = [
    (r"!", 3),            # Exclamation marks
    (r"\?\s*\!|\!\s*\?", 5),  # Interrobang
    (r"[A-ZÁÉÍÓÚ]{3,}", 4),   # ALL CAPS words
    (r"jaj+a|hah+a|lol", 5),  # Laughter
]


def score_text_segment(text: str, lang: str = "es") -> float:
    """Score a text segment for engagement level."""
    score = 1.0
    words = set(text.lower().split())
    keywords = HIGH_ENERGY_ES if lang.startswith("es") else HIGH_ENERGY_EN

    # Keyword matches
    matches = words & keywords
    score += len(matches) * 2.5

    # Check multi-word matches
    for kw in keywords:
        if " " in kw and kw in text.lower():
            score += 3.0

    # Excitement patterns
    for pattern, bonus in EXCITEMENT_PATTERNS:
        if re.search(pattern, text):
            score += bonus

    # Word density bonus (more words = more content)
    word_count = len(text.split())
    if word_count > 15:
        score += 2.0
    elif word_count > 8:
        score += 1.0

    return round(score, 1)


def detect_scene_changes(video_path: str) -> list[float]:
    """Detect scene change timestamps (fast mode: sample every 2s)."""
    try:
        # Use fast mode: sample at 0.5 fps
        cmd = [
            "ffmpeg", "-i", video_path,
            "-vf", "fps=0.5,select='gt(scene,0.4)',showinfo",
            "-f", "null", "-"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        timestamps = []
        for line in result.stderr.split("\n"):
            if "pts_time:" in line:
                match = re.search(r"pts_time:([\d.]+)", line)
                if match:
                    timestamps.append(float(match.group(1)))
        return sorted(set(round(t, 1) for t in timestamps))
    except subprocess.TimeoutExpired:
        return []
    except Exception:
        return []


def analyze_video(video_path: str, top_n: int = 10, min_duration: int = 15,
                  max_duration: int = 120, language: str = "es") -> list[dict]:
    """
    Analyze a video and return the most engaging clips.

    Returns list of {start, end, duration, score, reasons}
    sorted by score descending.
    """
    from faster_whisper import WhisperModel

    print(f"🔍 Analyzing: {video_path}")

    # 1. Transcribe
    print("   🎙️  Transcribing...")
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(video_path, language=language, vad_filter=True)
    seg_list = list(segments)

    # 2. Detect scene changes (fast sampling mode)
    print("   🎬  Detecting scene changes (fast mode)...")
    scene_times = detect_scene_changes(video_path)
    scene_set = set(scene_times)

    # 3. Score segments
    print("   📊  Scoring segments...")
    scored = []
    for seg in seg_list:
        text = seg.text.strip()
        if not text:
            continue

        text_score = score_text_segment(text, language)

        # Scene change bonus: if a scene change happens mid-segment
        scene_bonus = 0
        mid = (seg.start + seg.end) / 2
        for st in scene_times:
            if seg.start <= st <= seg.end:
                scene_bonus += 1.5

        # Duration bonus: segments 15-60s are ideal
        dur = seg.end - seg.start
        dur_bonus = 0
        if 15 <= dur <= 60:
            dur_bonus = 1.5
        elif 60 < dur <= 90:
            dur_bonus = 1.0

        total = text_score + scene_bonus + dur_bonus
        scored.append({
            "start": round(seg.start, 1),
            "end": round(seg.end, 1),
            "duration": round(dur, 1),
            "text": text,
            "score": round(total, 2),
            "text_score": text_score,
            "scene_bonus": scene_bonus,
        })

    # 4. Merge adjacent high-scoring segments into clips
    print(f"   🧩  Merging {len(scored)} segments into clips...")
    clips = _merge_segments(scored, min_duration, max_duration)

    # 5. Sort by score, pick top N
    clips.sort(key=lambda c: c["engagement"], reverse=True)
    top_clips = clips[:top_n]

    # 6. Add reasons
    for clip in top_clips:
        reasons = []
        if clip.get("keyword_hits", 0) > 0:
            reasons.append(f"{clip['keyword_hits']} keyword hits")
        if clip.get("scene_changes", 0) > 1:
            reasons.append(f"{clip['scene_changes']} scene changes")
        if clip.get("avg_text_score", 0) > 3:
            reasons.append("high-energy speech")
        if clip["duration"] <= 30:
            reasons.append("short & punchy")
        clip["reasons"] = reasons

    print(f"   ✅ Top {len(top_clips)} clips found")
    return top_clips


def _merge_segments(scored: list[dict], min_dur: float, max_dur: float) -> list[dict]:
    """Merge adjacent segments into coherent clips."""
    if not scored:
        return []

    # Sort by start time
    scored.sort(key=lambda s: s["start"])

    clips = []
    current = {
        "start": scored[0]["start"],
        "end": scored[0]["end"],
        "segments": [scored[0]],
        "scores": [scored[0]["score"]],
        "texts": [scored[0]["text"]],
    }

    for seg in scored[1:]:
        gap = seg["start"] - current["end"]

        # Merge if gap is small (<3s) and total won't exceed max
        new_dur = seg["end"] - current["start"]
        if gap <= 3.0 and new_dur <= max_dur:
            current["end"] = seg["end"]
            current["segments"].append(seg)
            current["scores"].append(seg["score"])
            current["texts"].append(seg["text"])
        else:
            # Finalize current clip
            dur = current["end"] - current["start"]
            if dur >= min_dur:
                clips.append(_build_clip(current))
            # Start new clip
            current = {
                "start": seg["start"],
                "end": seg["end"],
                "segments": [seg],
                "scores": [seg["score"]],
                "texts": [seg["text"]],
            }

    # Final clip
    dur = current["end"] - current["start"]
    if dur >= min_dur:
        clips.append(_build_clip(current))

    return clips


def _build_clip(raw: dict) -> dict:
    """Build final clip dict from merged segments."""
    dur = raw["end"] - raw["start"]
    scores = raw["scores"]
    avg_score = sum(scores) / len(scores) if scores else 0

    # Count keyword matches
    keyword_hits = 0
    for seg in raw["segments"]:
        keyword_hits += max(0, int(seg.get("text_score", 1) - 1) // 2)

    # Count scene changes
    scene_changes = sum(1 for s in raw["segments"] if s.get("scene_bonus", 0) > 0)

    # Engagement score: weighted formula
    engagement = (
        avg_score * 2.0 +
        (keyword_hits * 1.5) +
        (scene_changes * 2.0)
    )
    # Prefer shorter clips slightly
    if dur <= 60:
        engagement *= 1.2

    return {
        "start": round(raw["start"], 1),
        "end": round(raw["end"], 1),
        "duration": round(dur, 1),
        "transcript": " ".join(raw["texts"]),
        "engagement": round(engagement, 2),
        "avg_text_score": round(avg_score, 2),
        "keyword_hits": keyword_hits,
        "scene_changes": scene_changes,
        "segment_count": len(raw["segments"]),
    }


# ── CLI ───────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python3 analyzer.py <video.mp4> [top_n]")
        sys.exit(1)

    path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    print(f"🎯 Finding top {n} clips...\n")
    clips = analyze_video(path, top_n=n)

    for i, clip in enumerate(clips):
        print(f"\n#{i+1} ⭐ {clip['engagement']}")
        print(f"   ⏱ {clip['start']}s – {clip['end']}s ({clip['duration']}s)")
        print(f"   💬 {clip['transcript'][:120]}...")
        if clip.get("reasons"):
            print(f"   🏷  {', '.join(clip['reasons'])}")
