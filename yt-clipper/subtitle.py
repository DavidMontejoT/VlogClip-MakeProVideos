"""
Subtitle Generator — Auto-transcribe + burn subtitles
Uses faster-whisper for transcription, ffmpeg for burning.
Inter Black + EB Garamond Italic styling.
"""

import subprocess
import os
from pathlib import Path

# ── Config ────────────────────────────────────────────────
FONT_NAME = "Inter Black"
SECOND_FONT_NAME = "EB Garamond Italic"
FONT_DIR = str(Path(__file__).resolve().parent / "fonts")
FONT_SIZE = 22
FONT_COLOR = "&H00FFFFFF"
OUTLINE_COLOR = "&H00000000"
OUTLINE_WIDTH = 2.5
MARGIN_V = 80
WHISPER_MODEL = "medium"
LANGUAGE = "es"
RESALTAR_ULTIMA_PALABRA = True

# Try to find ffmpeg with libass support
FFMPEG_BIN = "ffmpeg"
_ffmpeg_full = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
if os.path.exists(_ffmpeg_full):
    FFMPEG_BIN = _ffmpeg_full


def fmt_ass(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def split_last_word(text: str) -> tuple[str, str]:
    words = text.strip().split()
    if len(words) <= 1:
        return "", text
    return " ".join(words[:-1]), words[-1]


def build_ass_text(text: str) -> str:
    if not RESALTAR_ULTIMA_PALABRA:
        return text
    resto, ultima = split_last_word(text)
    if not resto:
        return f"{{\\fn{SECOND_FONT_NAME}\\i1}}{ultima}{{\\i0\\fn{FONT_NAME}}}"
    return f"{resto} {{\\fn{SECOND_FONT_NAME}\\i1}}{ultima}{{\\i0\\fn{FONT_NAME}}}"


def hex_to_ass(hex_color: str) -> str:
    """Convert HTML #rrggbb to ASS &H00BBGGRR format."""
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def get_video_dimensions(video_path: str) -> tuple[int, int]:
    """Get video width and height using ffprobe."""
    try:
        result = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", video_path
        ], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            parts = result.stdout.strip().split(",")
            if len(parts) == 2:
                return int(parts[0]), int(parts[1])
    except Exception:
        pass
    return 1080, 1920  # default (vertical video)


def transcribe(video_path: str, model_size: str = None, language: str = None,
               word_timestamps: bool = False) -> list[dict]:
    """Transcribe audio and return segments with timestamps."""
    from faster_whisper import WhisperModel
    model_name = model_size or WHISPER_MODEL
    lang = language or LANGUAGE
    print(f"Transcribing with {model_name} model...")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(video_path, language=lang, vad_filter=True,
                                   word_timestamps=word_timestamps)
    result = []
    for seg in segments:
        entry = {
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        }
        if word_timestamps and seg.words:
            entry["words"] = [
                {"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                for w in seg.words if w.word.strip()
            ]
        result.append(entry)
    return result


def generate_ass_karaoke(segments: list[dict], output_path: str, style: dict = None,
                         video_width: int = 1080, video_height: int = 1920) -> str:
    """
    Generate ASS with word-by-word highlighting (CapCut karaoke effect).
    Each word gets its own Dialogue event showing the full sentence,
    with the active word in highlight color and the rest dimmed.
    Segments without word data fall back to regular subtitles.
    """
    style = style or {}
    font_size = style.get("font_size", FONT_SIZE)
    margin_v = style.get("margin_v", MARGIN_V)
    outline_color = style.get("outline_color", OUTLINE_COLOR)
    outline_width = style.get("outline_width", OUTLINE_WIDTH)
    border_style = style.get("border_style", 1)

    back_color_hex = style.get("back_color")
    if back_color_hex:
        h = back_color_hex.lstrip("#")
        r, g, b = h[0:2], h[2:4], h[4:6]
        aa = format(int(style.get("back_alpha", 0.0) * 255), '02X')
        back_color_ass = f"&H{aa}{b}{g}{r}".upper()
    else:
        back_color_ass = "&H00000000"

    primary_color   = style.get("primary_color",   "&H00FFFFFF")  # normal word color
    highlight_color = style.get("highlight_color", "&H0000FFFF")  # active word (default: yellow)
    dim_color       = style.get("dim_color",       "&H80FFFFFF")  # inactive words (50% white)

    pos_x_pct = style.get("position_x_pct")
    pos_y_pct = style.get("position_y_pct")
    pos_tag = ""
    if pos_x_pct is not None and pos_y_pct is not None:
        x = int(pos_x_pct * video_width)
        y = int(pos_y_pct * video_height)
        pos_tag = f"{{\\an5\\pos({x},{y})}}"

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{FONT_NAME},{font_size},{primary_color},&H000000FF,{outline_color},{back_color_ass},-1,0,0,0,100,100,0,0,{border_style},{outline_width},0,2,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def build_word_line(words: list[dict], active_idx: int) -> str:
        parts = []
        for j, w in enumerate(words):
            color = highlight_color if j == active_idx else dim_color
            parts.append(f"{{\\1c{color}}}{w['word']}")
        return pos_tag + " ".join(parts)

    dialogue_lines = []

    for seg in segments:
        words = seg.get("words") or []

        if not words:
            # No word data — regular subtitle
            start = fmt_ass(seg["start"])
            end = fmt_ass(seg["end"])
            text = build_ass_text(seg["text"])
            if pos_tag:
                text = pos_tag + text
            dialogue_lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
            continue

        # Gap before first word (show all dim)
        if seg["start"] < words[0]["start"] - 0.05:
            all_dim = " ".join(f"{{\\1c{dim_color}}}{w['word']}" for w in words)
            dialogue_lines.append(
                f"Dialogue: 0,{fmt_ass(seg['start'])},{fmt_ass(words[0]['start'])},"
                f"Default,,0,0,0,,{pos_tag}{all_dim}"
            )

        # One event per word
        for i, w in enumerate(words):
            text = build_word_line(words, i)
            dialogue_lines.append(
                f"Dialogue: 0,{fmt_ass(w['start'])},{fmt_ass(w['end'])},Default,,0,0,0,,{text}"
            )

        # Trailing gap after last word (show all in primary color)
        if words[-1]["end"] < seg["end"] - 0.05:
            all_normal = " ".join(f"{{\\1c{primary_color}}}{w['word']}" for w in words)
            dialogue_lines.append(
                f"Dialogue: 0,{fmt_ass(words[-1]['end'])},{fmt_ass(seg['end'])},"
                f"Default,,0,0,0,,{pos_tag}{all_normal}"
            )

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("\n".join(dialogue_lines))
    return output_path


def generate_ass(segments: list[dict], output_path: str, style: dict = None,
                 video_width: int = 1080, video_height: int = 1920):
    """Generate ASS subtitle file with Inter Black + EB Garamond Italic and optional custom style."""
    style = style or {}
    font_size = style.get("font_size", FONT_SIZE)
    margin_v = style.get("margin_v", MARGIN_V)
    primary_color = style.get("primary_color", FONT_COLOR)
    outline_color = style.get("outline_color", OUTLINE_COLOR)
    outline_width = style.get("outline_width", OUTLINE_WIDTH)
    border_style = style.get("border_style", 1)

    # Back color for BorderStyle=3 (opaque box behind text)
    back_color_hex = style.get("back_color")
    if back_color_hex:
        h = back_color_hex.lstrip("#")
        r, g, b = h[0:2], h[2:4], h[4:6]
        aa = format(int(style.get("back_alpha", 0.0) * 255), '02X')
        back_color_ass = f"&H{aa}{b}{g}{r}".upper()
    else:
        back_color_ass = "&H00000000"

    # Custom position from browser editor (0.0-1.0 fraction of video dimensions)
    pos_x_pct = style.get("position_x_pct")
    pos_y_pct = style.get("position_y_pct")
    has_custom_pos = pos_x_pct is not None and pos_y_pct is not None

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{FONT_NAME},{font_size},{primary_color},&H000000FF,{outline_color},{back_color_ass},-1,0,0,0,100,100,0,0,{border_style},{outline_width},0,2,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for seg in segments:
        start = fmt_ass(seg["start"])
        end = fmt_ass(seg["end"])
        text = build_ass_text(seg["text"])

        if has_custom_pos:
            x_abs = int(pos_x_pct * video_width)
            y_abs = int(pos_y_pct * video_height)
            # \an5 = center-center anchor, \pos(x,y) = absolute position in PlayRes coords
            text = "{\\an5\\pos(" + str(x_abs) + "," + str(y_abs) + ")}" + text

        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("\n".join(lines))
    return output_path


def burn_subtitles(video_path: str, ass_path: str, output_path: str):
    """Burn ASS subtitles into video using ffmpeg."""
    fonts_dir_abs = os.path.abspath(FONT_DIR)
    ass_abs = os.path.abspath(ass_path)

    cmd = [
        FFMPEG_BIN, "-y",
        "-i", video_path,
        "-vf", f"ass={ass_abs}:fontsdir={fonts_dir_abs}",
        "-c:a", "copy",
        output_path,
    ]
    print(f"Burning subtitles with {FFMPEG_BIN}, fonts from: {fonts_dir_abs}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg error: {result.stderr[-400:]}")
    return output_path


def process_video(video_path: str, output_path: str = None, model_size: str = None,
                  language: str = None, style: dict = None,
                  segments_override: list = None) -> dict:
    """Full pipeline: transcribe (or use provided segments) -> generate ASS -> burn."""
    video_path = str(video_path)
    if not output_path:
        base = Path(video_path).stem
        output_path = str(Path(video_path).parent / f"{base}_subtitled.mp4")
    ass_path = str(Path(output_path).with_suffix(".ass"))

    segments = segments_override if segments_override else transcribe(video_path, model_size, language)

    w, h = get_video_dimensions(video_path)
    has_word_data = any(seg.get("words") for seg in segments)
    if has_word_data:
        generate_ass_karaoke(segments, ass_path, style=style, video_width=w, video_height=h)
    else:
        generate_ass(segments, ass_path, style=style, video_width=w, video_height=h)
    burn_subtitles(video_path, ass_path, output_path)
    try:
        os.remove(ass_path)
    except Exception:
        pass
    return {"output": output_path, "segments": segments, "count": len(segments)}


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python3 subtitle.py <video.mp4> [output.mp4]")
        sys.exit(1)
    video = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    result = process_video(video, out)
    print(f"Done: {result['output']} ({result['count']} segments)")
