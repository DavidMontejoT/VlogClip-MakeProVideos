/**
 * YT Clipper — Frontend App
 * Tabs: YouTube | Subtitles | Editor
 */

const API = "";
const state = {
  // YouTube
  videoUrl: "", videoInfo: null, sbData: null,
  sbLoaded: 0, sbTotal: 0,
  selection: { start: null, end: null },
  clipCounter: 0, clips: [],
  currentJobId: null, pollInterval: null,
  // Editor
  editorInfo: null, editorThumbs: 0,
  editorSel: { start: null, end: null },
  editorClips: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Helpers ──────────────────────────────────────────────
function fmtTime(sec) {
  sec = Math.abs(Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtSize(mb) {
  if (mb < 1) return (mb * 1024).toFixed(0) + " KB";
  if (mb > 1024) return (mb / 1024).toFixed(1) + " GB";
  return mb.toFixed(1) + " MB";
}
function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast " + type + " show";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2500);
}
async function api(path, body = null) {
  const opts = { headers: { "Content-Type": "application/json" } };
  if (body) { opts.method = "POST"; opts.body = JSON.stringify(body); }
  const res = await fetch(API + path, opts);
  return res.json();
}

// ── Tabs ─────────────────────────────────────────────────
$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    $("#tab-" + tab.dataset.tab).classList.add("active");
  });
});

// ═══════════════════════════════════════════════════════════
//  MODULE: YouTube (existing logic, refactored)
// ═══════════════════════════════════════════════════════════

// Refs
const yt = {
  urlInput: $("#urlInput"), btnLoad: $("#btnLoad"), urlError: $("#urlError"),
  app: $("#app"), videoTitle: $("#videoTitle"), videoDuration: $("#videoDuration"),
  videoChapters: $("#videoChapters"), sbQuality: $("#sbQuality"),
  sbGrid: $("#storyboardGrid"), sbProgressWrap: $("#sbProgressWrap"),
  sbProgressFill: $("#sbProgressFill"), sbProgressText: $("#sbProgressText"),
  selectionBar: $("#selectionBar"), selRange: $("#selRange"),
  btnAddClip: $("#btnAddClip"), btnClearSel: $("#btnClearSel"),
  clipList: $("#clipList"), clipCount: $("#clipCount"),
  clipActions: $("#clipActions"), btnExtract: $("#btnExtract"),
  btnClearClips: $("#btnClearClips"), extractQuality: $("#extractQuality"),
  jobSection: $("#jobSection"), jobInfo: $("#jobInfo"),
  jobFiles: $("#jobFiles"), btnOpenOutput: $("#btnOpenOutput"),
};

function ytShowError(msg) {
  yt.urlError.textContent = msg;
  yt.urlError.classList.remove("hidden");
}

async function ytLoadVideo() {
  const url = yt.urlInput.value.trim();
  if (!url) { ytShowError("Please enter a URL"); return; }
  yt.btnLoad.disabled = true; yt.btnLoad.textContent = "Loading...";
  yt.urlError.classList.add("hidden");

  try {
    state.videoUrl = url;
    state.videoInfo = await api("/api/info", { url });
    if (state.videoInfo.error) {
      ytShowError(state.videoInfo.error);
      yt.btnLoad.disabled = false; yt.btnLoad.textContent = "Load Video";
      return;
    }
    yt.app.classList.remove("hidden");
    yt.videoTitle.textContent = state.videoInfo.title;
    yt.videoDuration.textContent = `⏱ ${fmtTime(state.videoInfo.duration)}`;
    yt.btnLoad.textContent = "Reload"; yt.btnLoad.disabled = false;
    await ytLoadStoryboards();
    toast("Video loaded ✓", "success");
  } catch (e) {
    ytShowError("Connection error: " + e.message);
    yt.btnLoad.disabled = false; yt.btnLoad.textContent = "Load Video";
  }
}

async function ytLoadStoryboards() {
  const quality = yt.sbQuality.value;
  yt.sbGrid.innerHTML = '<div class="placeholder-msg"><div class="placeholder-icon">⏳</div><p>Loading storyboards...</p></div>';
  yt.sbProgressWrap.classList.remove("hidden");
  yt.sbProgressFill.style.width = "0%";
  yt.sbProgressText.textContent = "Fetching URLs...";

  try {
    state.sbData = await api("/api/storyboard-urls", { url: state.videoUrl, quality });
    if (state.sbData.error) {
      yt.sbGrid.innerHTML = `<div class="placeholder-msg"><p>❌ ${state.sbData.error}</p></div>`;
      yt.sbProgressWrap.classList.add("hidden"); return;
    }
    state.sbTotal = state.sbData.total || state.sbData.urls?.length || 0;
    state.sbLoaded = 0;
    yt.sbGrid.innerHTML = "";
    yt.sbGrid.classList.add("loaded");

    const fragDur = state.sbData.fragment_duration || 90;
    const thumbBase = state.sbData.thumb_base || "";
    const items = [];

    for (let i = 0; i < state.sbTotal; i++) {
      const gridStart = i * fragDur;
      const div = document.createElement("div");
      div.className = "sb-item"; div.dataset.index = i; div.dataset.gridStart = gridStart;
      div.style.width = state.sbData.columns === 10 ? "10%" : "33.33%";
      const img = document.createElement("img");
      img.alt = `Grid ${i+1}`;
      img.loading = "lazy";
      // Use server-cached image URL
      img.src = `${thumbBase}/${i}.jpg`;
      img.onerror = function() {
        // Fallback: retry after a moment (server may still be caching)
        const that = this;
        if (!this._retried) {
          this._retried = true;
          setTimeout(() => { that.src = `${thumbBase}/${i}.jpg?t=${Date.now()}`; }, 3000);
        }
      };
      const tooltip = document.createElement("div");
      tooltip.className = "sb-tooltip";
      tooltip.textContent = `${fmtTime(gridStart)} — ${fmtTime(Math.min(gridStart+fragDur, state.videoInfo.duration))}`;
      div.appendChild(img); div.appendChild(tooltip);
      div.addEventListener("click", () => ytOnThumbClick(i));
      yt.sbGrid.appendChild(div);
      items.push({ div, img, index: i });
    }

    // Poll for cache progress
    yt.sbProgressText.textContent = "Caching images on server...";
    const pollCache = setInterval(async () => {
      let loaded = 0;
      for (let i = 0; i < Math.min(state.sbTotal, 5); i++) {
        try {
          const resp = await fetch(`${thumbBase}/${i}.jpg`);
          if (resp.ok) loaded++;
        } catch {}
      }
      // Estimate progress based on sample
      if (loaded >= 5 || loaded >= state.sbTotal) {
        clearInterval(pollCache);
        yt.sbProgressFill.style.width = "100%";
        yt.sbProgressText.textContent = `${state.sbTotal} grids ready`;
        yt.sbProgressWrap.classList.add("hidden");
        // Force reload any failed images
        $$(".sb-item img").forEach(img => {
          if (!img.complete || img.naturalWidth === 0) {
            img.src = img.src.split('?')[0] + '?t=' + Date.now();
          }
        });
        toast("Storyboards ready ✓", "success");
      } else {
        yt.sbProgressFill.style.width = "50%";
        yt.sbProgressText.textContent = "Caching images...";
      }
    }, 2000);
    yt.sbProgressWrap.classList.add("hidden");
    toast("Storyboards loaded ✓", "success");
  } catch (e) {
    yt.sbProgressWrap.classList.add("hidden");
    yt.sbGrid.innerHTML = '<div class="placeholder-msg"><p>❌ Error loading storyboards</p></div>';
  }
}

function ytOnThumbClick(gridIndex) {
  const fragDur = state.sbData.fragment_duration || 90;
  if (state.selection.start === null) {
    state.selection.start = gridIndex; state.selection.end = null;
    ytUpdateSelectionUI();
    toast(`Start: ${fmtTime(gridIndex * fragDur)}`, "success");
  } else if (state.selection.end === null) {
    if (gridIndex < state.selection.start) {
      state.selection.end = state.selection.start;
      state.selection.start = gridIndex;
    } else { state.selection.end = gridIndex; }
    ytUpdateSelectionUI();
    toast(`Range selected ✓`, "success");
  } else {
    state.selection.start = gridIndex; state.selection.end = null;
    ytUpdateSelectionUI();
  }
}

function ytUpdateSelectionUI() {
  $$(".sb-item").forEach(el => el.classList.remove("selected-start", "selected-range", "selected-end"));
  if (state.selection.start === null) { yt.selectionBar.classList.add("hidden"); return; }
  const fragDur = state.sbData.fragment_duration || 90;
  const startSec = state.selection.start * fragDur;
  if (state.selection.end === null) {
    const el = $(`.sb-item[data-index="${state.selection.start}"]`);
    if (el) el.classList.add("selected-start");
    yt.selRange.textContent = `Start: ${fmtTime(startSec)}`;
    yt.selectionBar.classList.remove("hidden");
    yt.btnAddClip.disabled = true;
  } else {
    const endSec = Math.min((state.selection.end + 1) * fragDur, state.videoInfo.duration);
    const s = Math.min(state.selection.start, state.selection.end);
    const e = Math.max(state.selection.start, state.selection.end);
    for (let i = s; i <= e; i++) {
      const el = $(`.sb-item[data-index="${i}"]`);
      if (!el) continue;
      if (i === s) el.classList.add("selected-start");
      else if (i === e) el.classList.add("selected-end");
      else el.classList.add("selected-range");
    }
    yt.selRange.textContent = `${fmtTime(startSec)} — ${fmtTime(endSec)}`;
    yt.selectionBar.classList.remove("hidden");
    yt.btnAddClip.disabled = false;
  }
}

function ytAddClip() {
  if (state.selection.start === null || state.selection.end === null) return;
  const fragDur = state.sbData.fragment_duration || 90;
  const startSec = state.selection.start * fragDur;
  const endSec = Math.min((state.selection.end + 1) * fragDur, state.videoInfo.duration);
  state.clipCounter++;
  state.clips.push({ start: startSec, end: endSec, label: `Clip ${state.clipCounter}`, duration: Math.round(endSec - startSec) });
  state.selection.start = null; state.selection.end = null;
  ytUpdateSelectionUI();
  ytRenderClips();
  toast("Clip added ✓", "success");
}

function ytRemoveClip(index) { state.clips.splice(index, 1); ytRenderClips(); }
function ytClearClips() { state.clips = []; state.clipCounter = 0; ytRenderClips(); }

function ytRenderClips() {
  yt.clipCount.textContent = state.clips.length;
  yt.clipList.innerHTML = "";
  if (state.clips.length === 0) {
    yt.clipList.innerHTML = '<div class="empty-hint">Select a range and click <strong>+ Add Clip</strong></div>';
    yt.clipActions.classList.add("hidden"); return;
  }
  yt.clipActions.classList.remove("hidden");
  state.clips.forEach((clip, i) => {
    const card = document.createElement("div");
    card.className = "clip-card";
    card.innerHTML = `
      <div class="clip-card-info">
        <div class="clip-card-label">${clip.label}</div>
        <div class="clip-card-range">${fmtTime(clip.start)} → ${fmtTime(clip.end)}</div>
      </div>
      <div class="clip-card-dur">${fmtTime(clip.duration)}</div>
      <button class="clip-card-remove" data-idx="${i}">×</button>`;
    card.querySelector(".clip-card-remove").addEventListener("click", () => ytRemoveClip(i));
    yt.clipList.appendChild(card);
  });
}

async function ytExtractClips() {
  if (state.clips.length === 0) return;
  yt.btnExtract.disabled = true; yt.btnExtract.textContent = "Starting...";
  yt.jobSection.classList.remove("hidden");
  yt.jobInfo.textContent = "⏳ Preparing...";
  yt.jobFiles.innerHTML = "";
  yt.btnOpenOutput.classList.add("hidden");
  try {
    const result = await api("/api/extract", {
      url: state.videoUrl,
      clips: state.clips.map(c => ({ start: c.start, end: c.end, label: c.label })),
      quality: yt.extractQuality.value,
    });
    if (result.error) { toast(result.error, "error"); yt.btnExtract.disabled = false; yt.btnExtract.textContent = "⚡ Extract All Clips"; return; }
    state.currentJobId = result.job_id;
    yt.btnExtract.textContent = "Extracting...";
    if (state.pollInterval) clearInterval(state.pollInterval);
    state.pollInterval = setInterval(ytPollJob, 1000);
  } catch (e) {
    toast("Error: " + e.message, "error");
    yt.btnExtract.disabled = false; yt.btnExtract.textContent = "⚡ Extract All Clips";
  }
}

async function ytPollJob() {
  if (!state.currentJobId) return;
  try {
    const job = await api("/api/job/" + state.currentJobId);
    if (job.error) return;
    if (job.status === "running") {
      yt.jobInfo.innerHTML = `⏳ Extracting <strong>${job.current}</strong><br><span style="font-size:11px;color:var(--text-muted)">${job.completed}/${job.total}</span>`;
    } else if (job.status === "done" || job.status === "partial") {
      yt.jobInfo.innerHTML = job.status === "done" ? `✅ All ${job.total} clips extracted!` : `⚠️ ${job.completed}/${job.total} (${job.errors.length} failed)`;
      yt.btnExtract.disabled = false; yt.btnExtract.textContent = "⚡ Extract All Clips";
      clearInterval(state.pollInterval); state.pollInterval = null;
      yt.btnOpenOutput.classList.remove("hidden");
      ytShowJobFiles(job);
    }
  } catch (e) {}
}

function ytShowJobFiles(job) {
  yt.jobFiles.innerHTML = "";
  job.files.forEach(f => {
    const div = document.createElement("div"); div.className = "job-file";
    div.innerHTML = `<span class="done">✓</span><span class="job-file-name">${f.label}</span><span style="color:var(--text-muted);font-size:10px">${fmtSize(f.size_mb)}</span>`;
    yt.jobFiles.appendChild(div);
  });
  job.errors.forEach(e => {
    const div = document.createElement("div"); div.className = "job-file";
    div.innerHTML = `<span class="err">✗</span><span class="job-file-name">${e.label}</span><span style="color:var(--red);font-size:10px">${e.error.substring(0,50)}</span>`;
    yt.jobFiles.appendChild(div);
  });
}

async function ytOpenOutput() { await api("/api/open-output"); }

// ── Shared: File Upload / Drag & Drop ───────────────────
function setupDropZone(dropZoneId, fileInputId, onUploaded) {
  const zone = document.getElementById(dropZoneId);
  const input = document.getElementById(fileInputId);
  if (!zone || !input) return;

  // Click to browse
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files[0]) handleFileUpload(input.files[0], zone, onUploaded);
  });

  // Drag events
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file, zone, onUploaded);
  });
}

async function handleFileUpload(file, zone, onUploaded) {
  // Show upload status
  zone.querySelector(".drop-icon").textContent = "⏳";
  zone.querySelector("p").textContent = `Uploading ${file.name}...`;
  zone.querySelector(".drop-hint").textContent = `${(file.size/(1024*1024)).toFixed(1)} MB`;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const resp = await fetch("/api/upload", { method: "POST", body: formData });
    const result = await resp.json();

    if (result.ok) {
      zone.querySelector(".drop-icon").textContent = "✅";
      zone.querySelector("p").textContent = `${result.filename}`;
      zone.querySelector(".drop-hint").textContent = `${result.size_mb} MB — uploaded!`;
      zone.classList.add("uploaded");
      onUploaded(result);
      toast("Upload complete ✓", "success");
    } else {
      zone.querySelector(".drop-icon").textContent = "❌";
      zone.querySelector("p").textContent = result.error || "Upload failed";
      zone.querySelector(".drop-hint").textContent = "Try again";
      toast(result.error, "error");
    }
  } catch (e) {
    zone.querySelector(".drop-icon").textContent = "❌";
    zone.querySelector("p").textContent = "Connection error";
    zone.querySelector(".drop-hint").textContent = e.message;
    toast("Upload error: " + e.message, "error");
  }
}

function resetDropZone(zoneId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.classList.remove("uploaded");
  zone.querySelector(".drop-icon").textContent = "📁";
  zone.querySelector("p").textContent = "Drag & drop a video here, or click to browse";
  zone.querySelector(".drop-hint").textContent = "MP4, MOV, AVI, MKV — up to 2GB";
}

// ── YouTube events ──────────────────────────────────────
yt.btnLoad.addEventListener("click", ytLoadVideo);
yt.urlInput.addEventListener("keydown", e => { if (e.key === "Enter") ytLoadVideo(); });
yt.sbQuality.addEventListener("change", () => { if (state.videoUrl) ytLoadStoryboards(); });
$("#btnRefreshSB").addEventListener("click", () => { if (state.videoUrl) ytLoadStoryboards(); });
yt.btnAddClip.addEventListener("click", ytAddClip);
yt.btnClearSel.addEventListener("click", () => { state.selection.start = null; state.selection.end = null; ytUpdateSelectionUI(); });
yt.btnClearClips.addEventListener("click", ytClearClips);
yt.btnExtract.addEventListener("click", ytExtractClips);
yt.btnOpenOutput.addEventListener("click", ytOpenOutput);

// ═══════════════════════════════════════════════════════════
//  MODULE: Subtitles
// ═══════════════════════════════════════════════════════════

const SUB_PRESETS = [
  {
    id: "clean", name: "Clean",
    font_size: 24, font_color: "#ffffff", outline_color: "#000000", outline_width: 2.5,
    border_style: 1, back_color: null, back_alpha: 0,
    preview: { color: "#fff", shadow: "1px 1px 0 #000,-1px -1px 0 #000", bg: "#1a1a2e" },
  },
  {
    id: "dark-box", name: "Dark Box",
    font_size: 22, font_color: "#ffffff", outline_color: "#000000", outline_width: 0,
    border_style: 3, back_color: "#000000", back_alpha: 0.45,
    preview: { color: "#fff", shadow: "none", bg: "rgba(0,0,0,0.7)", boxBg: "rgba(0,0,0,0.7)" },
  },
  {
    id: "yellow", name: "Yellow",
    font_size: 26, font_color: "#ffdd00", outline_color: "#000000", outline_width: 3,
    border_style: 1, back_color: null, back_alpha: 0,
    preview: { color: "#ffdd00", shadow: "1px 1px 0 #000,-1px -1px 0 #000", bg: "#1a1a2e" },
  },
  {
    id: "neon", name: "Neon",
    font_size: 24, font_color: "#00ff88", outline_color: "#003322", outline_width: 2,
    border_style: 1, back_color: null, back_alpha: 0,
    preview: { color: "#00ff88", shadow: "0 0 6px #00ff88,1px 1px 0 #003322", bg: "#0d1117" },
  },
  {
    id: "white-box", name: "White Box",
    font_size: 20, font_color: "#111111", outline_color: "#ffffff", outline_width: 0,
    border_style: 3, back_color: "#ffffff", back_alpha: 0.05,
    preview: { color: "#111", shadow: "none", bg: "rgba(255,255,255,0.92)", boxBg: "rgba(255,255,255,0.92)" },
  },
  {
    id: "big", name: "Big Bold",
    font_size: 34, font_color: "#ffffff", outline_color: "#000000", outline_width: 4,
    border_style: 1, back_color: null, back_alpha: 0,
    preview: { color: "#fff", shadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000", bg: "#1a1a2e", bold: true },
  },
];

// SUB_PRESETS above — used by the unified editor subtitle module below

// ═══════════════════════════════════════════════════════════
//  MODULE: Editor — Multi-video state
// ═══════════════════════════════════════════════════════════

// Multi-video state
let editorVideos = [];        // [{id, path, filename, info, order, subtitles: {segments, style, karaoke, transcribed}}]
let activeVideoId = null;     // currently displayed video
let editorVideoCounter = 0;

// Timeline clips — the sequenced clip list (CapCut-style single track)
// Each clip: {id, videoId, path, filename, info, trimStart, trimEnd, subtitles, playerSrc?}
let timelineClips = [];
let activeClipId = null;
let clipCounter = 0;

function getActiveClip() {
  return timelineClips.find(c => c.id === activeClipId) || null;
}
function getTotalDuration() {
  return timelineClips.reduce((s, c) => s + (c.trimEnd - c.trimStart), 0);
}

// ── Overlay clips — PiP layers composited on top of main track ──
let overlayClips = [];
let overlayCounter = 0;

// ── Output format / canvas aspect ratio ──────────────────────────
const FORMAT_PRESETS = {
  "9:16":  { label: "TikTok / Reels / Shorts", ratio: 9 / 16, ffTarget: [1080, 1920] },
  "16:9":  { label: "YouTube / Landscape",      ratio: 16 / 9, ffTarget: [1920, 1080] },
  "1:1":   { label: "Instagram / Square",        ratio: 1,      ffTarget: [1080, 1080] },
  "4:5":   { label: "Instagram Portrait",        ratio: 4 / 5,  ffTarget: [1080, 1350] },
  "free":  { label: "No constraint",             ratio: null,   ffTarget: null },
};
let activeFormat = "9:16";

function setCanvasFormat(fmt) {
  activeFormat = fmt;
  const preset = FORMAT_PRESETS[fmt] || FORMAT_PRESETS["free"];
  const frame = $("#canvasFrame");
  if (frame) {
    if (preset.ratio) {
      frame.style.aspectRatio = String(preset.ratio);
      frame.style.height = "100%";
      frame.style.width = "";
    } else {
      frame.style.aspectRatio = "";
      frame.style.height = "100%";
      frame.style.width = "100%";
    }
  }
  document.querySelectorAll(".fmt-btn").forEach(b => {
    b.classList.toggle("fmt-btn-active", b.dataset.format === fmt);
  });
}

function addAsOverlay(videoId) {
  const v = editorVideos.find(v => v.id === videoId);
  if (!v) return;
  if (overlayClips.find(o => o.videoId === videoId)) {
    toast("Already an overlay", "warn"); return;
  }
  // Remove from main track
  timelineClips = timelineClips.filter(c => c.videoId !== videoId);
  if (!timelineClips.find(c => c.id === activeClipId)) {
    activeClipId = timelineClips[0]?.id || null;
  }
  overlayCounter++;
  const ov = {
    id: `ov_${overlayCounter}`,
    videoId,
    path: v.path,
    filename: v.filename,
    info: v.info,
    playerSrc: v.playerSrc,
    trimStart: 0,
    trimEnd: v.info.duration,
    timelineStart: 0,
    timelineEnd: v.info.duration,
    x: 55, y: 5, width: 38,   // % of canvas
    audioEnabled: false,
    zIndex: 10 + overlayCounter,
  };
  v.isOverlay = true;
  overlayClips.push(ov);
  renderVideoList();
  renderSingleTrackTimeline();
  renderCanvasOverlays();
  toast(`${v.filename} → overlay`, "success");
}

function removeFromOverlay(ovId) {
  const ov = overlayClips.find(o => o.id === ovId);
  if (!ov) return;
  const v = editorVideos.find(v => v.id === ov.videoId);
  if (v) {
    v.isOverlay = false;
    clipCounter++;
    timelineClips.push({
      id: `clip_${clipCounter}`, videoId: v.id,
      path: v.path, filename: v.filename, info: v.info,
      trimStart: 0, trimEnd: v.info.duration, subtitles: v.subtitles,
    });
  }
  overlayClips = overlayClips.filter(o => o.id !== ovId);
  document.getElementById(`ovwrap_${ovId}`)?.remove();
  renderVideoList();
  renderSingleTrackTimeline();
}

function getActiveVideo() {
  return editorVideos.find(v => v.id === activeVideoId) || null;
}

function getActiveVideoPath() {
  const v = getActiveVideo();
  return v ? v.path : "";
}

// Legacy aliases for backward compat — always point to active video
Object.defineProperty(window, 'editorVideoPath', {
  get() { return getActiveVideoPath(); },
  set(v) {
    const av = getActiveVideo();
    if (av) av.path = v;
  }
});
Object.defineProperty(window, 'editorVideoFilename', {
  get() { const v = getActiveVideo(); return v ? v.filename : ""; },
  set(v) {
    const av = getActiveVideo();
    if (av) av.filename = v;
  }
});
// Proxy editorSubs.segments / .karaoke / .activeIdx to active video
const _activeIdx = { val: -1 };

// Global subtitle style (shared, but each video stores its own segments)
let editorSubs = {
  style: {
    position_x_pct: 0.5, position_y_pct: 0.85,
    font_size: 24, font_color: "#ffffff",
    outline_color: "#000000", outline_width: 2.5,
    border_style: 1, back_color: null, back_alpha: 0,
    highlight_color: "#ffdd00", animation: "none",
    max_width_pct: 86,
  },
  dragging: false,
  dragOffset: { x: 0, y: 0 },
};

Object.defineProperty(editorSubs, 'segments', {
  get() { return getSubsData().segments; },
  set(v) {
    const av = getActiveVideo();
    if (av) av.subtitles.segments = v;
  }
});
Object.defineProperty(editorSubs, 'karaoke', {
  get() { return getSubsData().karaoke; },
  set(v) {
    const av = getActiveVideo();
    if (av) av.subtitles.karaoke = v;
  }
});
Object.defineProperty(editorSubs, 'activeIdx', {
  get() { return _activeIdx.val; },
  set(v) { _activeIdx.val = v; }
});

// Convenience getter/setter for active video's subtitle data
function getSubsData() {
  const v = getActiveVideo();
  return v ? v.subtitles : { segments: [], karaoke: false, transcribed: false };
}

// Editor drop zone — click, drag & drop, multi-file
const editorDZ = document.getElementById("editorDropZone");
const editorFileInput = document.getElementById("editorFileInput");

editorDZ.addEventListener("click", () => editorFileInput.click());
editorDZ.addEventListener("dragover", e => { e.preventDefault(); editorDZ.classList.add("drag-over"); });
editorDZ.addEventListener("dragleave", () => editorDZ.classList.remove("drag-over"));
editorDZ.addEventListener("drop", async (e) => {
  e.preventDefault();
  editorDZ.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) await uploadAndAdd(file);
});
editorFileInput.addEventListener("change", async () => {
  const files = Array.from(editorFileInput.files);
  for (const file of files) await uploadAndAdd(file);
  editorFileInput.value = "";
});

// "Add Video" button in infobar
$("#btnAddMoreVideos").addEventListener("click", () => {
  $("#editorFileInput2").click();
});
// "+" button in sidebar VIDEOS section
$("#btnAddVideoSidebar").addEventListener("click", () => {
  $("#editorFileInput2").click();
});
$("#editorFileInput2").addEventListener("change", async () => {
  const files = $("#editorFileInput2").files;
  if (files.length > 0) {
    await addMultipleVideos(files);
    $("#editorFileInput2").value = "";
  }
});

async function uploadAndAdd(file) {
  // Show progress
  editorDZ.querySelector(".drop-icon").textContent = "⏳";
  editorDZ.querySelector("p").textContent = `Uploading ${file.name}...`;
  const formData = new FormData();
  formData.append("file", file);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: formData });
    const result = await resp.json();
    if (result.ok) {
      await addVideoToEditor(result.path, result.filename);
      toast(`Uploaded: ${result.filename}`, "success");
    } else {
      toast(result.error || "Upload failed", "error");
    }
  } catch (e) {
    toast("Upload error: " + e.message, "error");
  }
  // Reset drop zone text
  resetEditorDropZoneText();
}

function resetEditorDropZoneText() {
  if (editorVideos.length === 0) return;
  editorDZ.querySelector(".drop-icon").textContent = "🎬";
  editorDZ.querySelector("p").textContent = "Drag & drop more videos here, or click to browse";
  editorDZ.querySelector(".drop-hint").textContent = `MP4, MOV, AVI, MKV — ${editorVideos.length}/10 loaded`;
}

async function addVideoToEditor(path, filename) {
  if (editorVideos.length >= 10) {
    toast("Maximum 10 videos reached", "error");
    return;
  }

  try {
    const info = await api("/api/local/info", { path });
    if (info.error) { toast(info.error, "error"); return; }
    info.path = path;

    editorVideoCounter++;
    const video = {
      id: `vid_${editorVideoCounter}_${Date.now()}`,
      path, filename,
      info,
      order: editorVideos.length,
      subtitles: {
        segments: [],
        karaoke: false,
        transcribed: false,
      },
    };

    editorVideos.push(video);

    // Create a corresponding timeline clip covering the full video
    clipCounter++;
    const clip = {
      id: `clip_${clipCounter}`,
      videoId: video.id,
      path: video.path,
      filename: video.filename,
      info,
      trimStart: 0,
      trimEnd: info.duration,
      subtitles: video.subtitles,
    };
    timelineClips.push(clip);
    if (!activeClipId) activeClipId = clip.id;

    // First video added — open workspace
    if (editorVideos.length === 1) {
      activeVideoId = video.id;
      state.editorInfo = info;
      $("#editorDropState").classList.add("hidden");
      $("#editorWorkspace").classList.remove("hidden");
      loadActiveVideoIntoPlayer();
    }

    renderVideoList();
    renderSingleTrackTimeline();
    updateEditorInfoBar();
    resetEditorDropZoneText();
  } catch (e) {
    toast("Error loading video: " + e.message, "error");
  }
}

async function addMultipleVideos(files) {
  for (const file of files) {
    await uploadAndAdd(file);
  }
}

function selectClip(clipId) {
  const clip = timelineClips.find(c => c.id === clipId);
  if (!clip) return;
  activeClipId = clipId;
  activeVideoId = clip.videoId;
  state.editorInfo = clip.info;

  const vid = $("#editorVideo");
  const src = clip.playerSrc || `/api/uploads/${clip.filename}`;
  if (!vid.src.endsWith(clip.filename) && !vid.currentSrc.includes(clip.filename)) {
    vid.src = src;
    vid.load();
  }
  vid.addEventListener("loadedmetadata", () => {
    vid.currentTime = clip.trimStart;
  }, { once: true });

  renderSingleTrackTimeline();
  renderVideoList();
  updateEditorInfoBar();

  // Restore subtitle state
  const subs = clip.subtitles;
  if (subs.transcribed) {
    renderEvsTranscript();
    $("#btnEditorBurnSubs").disabled = false;
    $("#evsSegCount").textContent = subs.segments.length;
  } else {
    $("#evsTranscript").innerHTML = '<div class="empty-hint-sm">Transcribe to see segments</div>';
    $("#btnEditorBurnSubs").disabled = true;
    $("#evsSegCount").textContent = "0";
  }
  $("#evsKaraokeToggle").checked = subs.karaoke;
  $("#evsHighlightRow").classList.toggle("hidden", !subs.karaoke);
}

function selectVideo(videoId) {
  if (activeVideoId === videoId) return;
  activeVideoId = videoId;
  const v = getActiveVideo();
  if (!v) return;

  // Sync editorInfo for timeline/clips/thumbs
  state.editorInfo = v.info;

  loadActiveVideoIntoPlayer();
  renderVideoList();
  renderSingleTrackTimeline();
  updateEditorInfoBar();

  // Restore subtitle state for this video
  const subs = v.subtitles;
  if (subs.transcribed) {
    renderEvsTranscript();
    $("#btnEditorBurnSubs").disabled = false;
    $("#evsSegCount").textContent = subs.segments.length;
  } else {
    $("#evsTranscript").innerHTML = '<div class="empty-hint-sm">Transcribe to see segments</div>';
    $("#btnEditorBurnSubs").disabled = true;
    $("#evsSegCount").textContent = "0";
  }

  // Update karaoke toggle
  $("#evsKaraokeToggle").checked = subs.karaoke;
  $("#evsHighlightRow").classList.toggle("hidden", !subs.karaoke);

  // Reset clip selection and refresh thumbnails
  state.editorSel.start = null;
  state.editorSel.end = null;
  editorUpdateSelectionUI(parseInt($("#editorInterval").value));
  editorGenThumbs();
}

function loadActiveVideoIntoPlayer() {
  const v = getActiveVideo();
  if (!v) return;
  const vid = $("#editorVideo");
  // v.playerSrc is set by updateWorkingVideo when a processed file is created in output dir.
  // Falls back to uploads for the original uploaded file.
  vid.src = v.playerSrc || `/api/uploads/${v.filename}`;
  vid.load();
}

function removeVideo(videoId) {
  if (editorVideos.length <= 1) {
    // Remove all
    clearAllVideos();
    return;
  }

  const idx = editorVideos.findIndex(v => v.id === videoId);
  if (idx < 0) return;

  editorVideos.splice(idx, 1);
  editorVideos.forEach((v, i) => { v.order = i; });

  // Remove all timeline clips from this video
  timelineClips = timelineClips.filter(c => c.videoId !== videoId);
  if (!timelineClips.find(c => c.id === activeClipId)) {
    activeClipId = timelineClips[0]?.id || null;
  }

  // If removed active video, switch to first remaining
  if (activeVideoId === videoId) {
    const firstClip = getActiveClip();
    if (firstClip) {
      activeVideoId = firstClip.videoId;
      loadActiveVideoIntoPlayer();
    }
  }

  renderVideoList();
  renderSingleTrackTimeline();
  updateEditorInfoBar();
}

function clearAllVideos() {
  editorVideos = [];
  activeVideoId = null;
  editorVideoCounter = 0;
  timelineClips = [];
  activeClipId = null;
  clipCounter = 0;
  overlayClips = [];
  overlayCounter = 0;
  $("#canvasFrame").querySelectorAll(".canvas-overlay").forEach(el => el.remove());
  currentWorkingFile = null;
  processingHistory = [];
  state.editorClips = [];
  state.editorInfo = null;

  $("#editorWorkspace").classList.add("hidden");
  $("#editorDropState").classList.remove("hidden");
  resetDropZone("editorDropZone");
  const vid = $("#editorVideo");
  vid.pause(); vid.src = "";

  // Reset subtitle panel
  $("#evsTranscript").innerHTML = '<div class="empty-hint-sm">Transcribe to see segments</div>';
  $("#btnEditorBurnSubs").disabled = true;
  $("#evsSegCount").textContent = "0";
  renderProcessingHistory();
}

$("#btnClearEditor").addEventListener("click", clearAllVideos);

function updateEditorInfoBar() {
  const v = getActiveVideo();
  if (!v) { $("#editorInfo").innerHTML = ""; return; }
  const countBadge = editorVideos.length > 1
    ? ` <span style="color:var(--accent);font-size:10px">(${editorVideos.length} videos)</span>`
    : "";
  $("#editorInfo").innerHTML = `
    <span>📁 ${v.filename}${countBadge}</span>
    <span>⏱ ${fmtTime(v.info.duration)}</span>
    <span>🎥 ${v.info.video?.width || "?"}×${v.info.video?.height || "?"}</span>
    <span>📦 ${v.info.size_mb} MB</span>
  `;
  // Enable export button when videos are loaded
  const exportBtn = $("#btnExportFinal");
  if (exportBtn) exportBtn.disabled = timelineClips.length === 0;
}

function renderVideoList() {
  const container = $("#editorVideoList");
  $("#editorVideoCount").textContent = editorVideos.length;

  if (editorVideos.length === 0) {
    container.innerHTML = '<div class="empty-hint-sm">No videos loaded</div>';
    return;
  }

  container.innerHTML = editorVideos.map((v, i) => {
    const subs = v.subtitles;
    const subsBadge = subs.transcribed
      ? `<span class="video-sb-subs-badge">💬${subs.segments.length}</span>`
      : "";
    const isOv = !!v.isOverlay;
    return `
      <div class="video-sidebar-item${v.id === activeVideoId ? ' active' : ''}${isOv ? ' is-overlay' : ''}"
           data-vid="${v.id}" data-idx="${i}">
        <span class="video-sb-drag" data-vid="${v.id}">⋮⋮</span>
        <span class="video-sb-num">${i + 1}</span>
        <span class="video-sb-name">${v.filename}</span>
        ${subsBadge}
        <span class="video-sb-dur">${fmtTime(v.info.duration)}</span>
        <button class="video-sb-ov-btn${isOv ? ' active' : ''}" data-vid="${v.id}"
                title="${isOv ? 'Move back to main track' : 'Use as overlay layer'}"
        >${isOv ? '↙' : '↗'}</button>
        <span class="video-sb-remove" data-vid="${v.id}">×</span>
      </div>`;
  }).join("");

  // Click to select
  container.querySelectorAll(".video-sidebar-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("video-sb-remove") ||
          e.target.classList.contains("video-sb-drag") ||
          e.target.classList.contains("video-sb-ov-btn")) return;
      selectVideo(el.dataset.vid);
    });
  });

  // Overlay toggle button
  container.querySelectorAll(".video-sb-ov-btn").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const vid = el.dataset.vid;
      const v = editorVideos.find(v => v.id === vid);
      if (!v) return;
      if (v.isOverlay) {
        const ovId = overlayClips.find(o => o.videoId === vid)?.id;
        if (ovId) removeFromOverlay(ovId);
      } else {
        addAsOverlay(vid);
      }
    });
  });

  // Remove button
  container.querySelectorAll(".video-sb-remove").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      removeVideo(el.dataset.vid);
    });
  });

  // Drag to reorder (sidebar)
  setupSidebarDragReorder(container);
}

// ═══════════════════════════════════════════════════════════
//  SINGLE-TRACK TIMELINE — horizontal clips (CapCut style)
// ═══════════════════════════════════════════════════════════

function renderSingleTrackTimeline() {
  const container = $("#timelineMultiTrack");
  if (!container) return;

  if (timelineClips.length === 0) {
    container.innerHTML = '<div class="tl-mt-placeholder">Add videos to see them on the timeline</div>';
    return;
  }

  const totalDur = Math.max(getTotalDuration(), 0.01);

  // Update state.editorInfo.duration for ruler
  if (!state.editorInfo) state.editorInfo = {};
  state.editorInfo.duration = totalDur;

  let html = '<div class="tl-st-row">';
  timelineClips.forEach((clip, i) => {
    const dur = clip.trimEnd - clip.trimStart;
    const flexVal = Math.max(dur / totalDur, 0.01);
    const isActive = clip.id === activeClipId;
    const hasSubs = clip.subtitles?.transcribed;
    html += `
      <div class="tl-clip${isActive ? ' active' : ''}"
           data-clipid="${clip.id}" data-idx="${i}"
           style="flex:${flexVal}">
        <div class="tl-clip-trim left" data-clipid="${clip.id}" data-edge="left"></div>
        <div class="tl-clip-inner">
          <span class="tl-clip-num">${i + 1}</span>
          <span class="tl-clip-name">${clip.filename}</span>
          ${hasSubs ? `<span class="tl-clip-subs-dot" title="Has subtitles">💬</span>` : ""}
          <span class="tl-clip-dur">${fmtTime(dur)}</span>
        </div>
        <div class="tl-clip-trim right" data-clipid="${clip.id}" data-edge="right"></div>
      </div>`;
  });
  html += '<div class="tl-st-playhead" id="tlStPlayhead"></div>';
  html += '</div>';

  // Overlay tracks (one row per overlay, positioned absolutely by timelineStart)
  if (overlayClips.length > 0) {
    const maxDur = Math.max(totalDur, ...overlayClips.map(o => o.timelineEnd));
    html += '<div class="tl-ov-tracks">';
    overlayClips.forEach((ov, i) => {
      const ovDur = ov.timelineEnd - ov.timelineStart;
      const leftPct = (ov.timelineStart / maxDur) * 100;
      const widthPct = (ovDur / maxDur) * 100;
      html += `
        <div class="tl-ov-row">
          <div class="tl-ov-block" data-ovid="${ov.id}"
               style="left:${leftPct}%;width:${widthPct}%">
            <div class="tl-ov-handle-slide left" data-ovid="${ov.id}" data-edge="left"></div>
            <span class="tl-ov-label">↗ ${ov.filename}</span>
            <span class="tl-ov-dur">${fmtTime(ovDur)}</span>
            <div class="tl-ov-handle-slide right" data-ovid="${ov.id}" data-edge="right"></div>
          </div>
        </div>`;
    });
    html += '</div>';
  }

  container.innerHTML = html;

  // Click to select clip
  container.querySelectorAll(".tl-clip").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".tl-clip-trim")) return;
      selectClip(el.dataset.clipid);
    });
    // Mousedown for drag reorder
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".tl-clip-trim")) return;
      e.preventDefault();
      _clipDrag.idx = parseInt(el.dataset.idx);
      _clipDrag.startX = e.clientX;
      el.classList.add("dragging");
    });
  });

  // Overlay block drag (slide timelineStart)
  container.querySelectorAll(".tl-ov-block").forEach(el => {
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".tl-ov-handle-slide")) return;
      e.preventDefault();
      const ov = overlayClips.find(o => o.id === el.dataset.ovid);
      if (!ov) return;
      const row = el.closest(".tl-ov-row");
      _ovTlDrag = {
        ov, startX: e.clientX,
        origStart: ov.timelineStart, origEnd: ov.timelineEnd,
        rowWidth: row ? row.clientWidth : 800,
        totalDur: Math.max(totalDur, ov.timelineEnd),
      };
    });
  });

  // Overlay trim slide handles (resize in timeline)
  container.querySelectorAll(".tl-ov-handle-slide").forEach(handle => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const ov = overlayClips.find(o => o.id === handle.dataset.ovid);
      if (!ov) return;
      const row = handle.closest(".tl-ov-row");
      _ovTlResize = {
        ov, edge: handle.dataset.edge, startX: e.clientX,
        origStart: ov.timelineStart, origEnd: ov.timelineEnd,
        rowWidth: row ? row.clientWidth : 800,
        totalDur: Math.max(totalDur, ov.timelineEnd),
      };
    });
  });

  setupClipTrimHandles();
  renderTimelineRuler($("#timelineRuler"));
}

// Backward compat alias — any old code that calls renderMultiTrackTimeline still works
function renderMultiTrackTimeline() { renderSingleTrackTimeline(); }

// ── Single-track playhead sync ────────────────────────────
function syncSingleTrackPlayhead() {
  const playhead = document.getElementById("tlStPlayhead");
  if (!playhead) return;
  const clip = getActiveClip();
  if (!clip) return;
  const totalDur = getTotalDuration();
  if (totalDur <= 0) return;

  let cumStart = 0;
  for (const c of timelineClips) {
    if (c.id === activeClipId) break;
    cumStart += c.trimEnd - c.trimStart;
  }
  const offset = Math.max(evsVideo.currentTime - clip.trimStart, 0);
  const pct = ((cumStart + offset) / totalDur) * 100;
  playhead.style.left = Math.min(pct, 100) + "%";
}

// Deprecated stub — no longer used
function syncMultiTrackPlayhead() { syncSingleTrackPlayhead(); }

// ── Sidebar drag reorder — FIXED: persistent state, no stacking listeners ──
const _sidebarDrag = { idx: -1, container: null };

function setupSidebarDragReorder(container) {
  container.querySelectorAll(".video-sb-drag").forEach(handle => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = handle.closest(".video-sidebar-item");
      _sidebarDrag.idx = parseInt(item.dataset.idx);
      _sidebarDrag.container = container;
      item.style.opacity = "0.4";
    });
  });
}

document.addEventListener("mousemove", (e) => {
  if (_sidebarDrag.idx < 0 || !_sidebarDrag.container) return;
  _sidebarDrag.container.querySelectorAll(".video-sidebar-item").forEach(el => el.classList.remove("drop-target"));
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".video-sidebar-item");
  if (target && parseInt(target.dataset.idx) !== _sidebarDrag.idx) target.classList.add("drop-target");
});

document.addEventListener("mouseup", (e) => {
  if (_sidebarDrag.idx < 0 || !_sidebarDrag.container) return;
  const container = _sidebarDrag.container;
  const srcItem = container.querySelector(`.video-sidebar-item[data-idx="${_sidebarDrag.idx}"]`);
  if (srcItem) srcItem.style.opacity = "";
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".video-sidebar-item");
  container.querySelectorAll(".video-sidebar-item").forEach(el => el.classList.remove("drop-target"));
  if (target) {
    const toIdx = parseInt(target.dataset.idx);
    if (toIdx !== _sidebarDrag.idx && toIdx >= 0) reorderVideos(_sidebarDrag.idx, toIdx);
  }
  _sidebarDrag.idx = -1;
  _sidebarDrag.container = null;
});

// ── Clip drag reorder in timeline — FIXED: persistent state ──
const _clipDrag = { idx: -1, startX: 0 };

document.addEventListener("mousemove", (e) => {
  if (_clipDrag.idx < 0) return;
  const container = $("#timelineMultiTrack");
  if (!container) return;
  container.querySelectorAll(".tl-clip").forEach(el => el.classList.remove("drop-before", "drop-after"));
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".tl-clip");
  if (target) {
    const ti = parseInt(target.dataset.idx);
    if (ti !== _clipDrag.idx) target.classList.add(ti > _clipDrag.idx ? "drop-after" : "drop-before");
  }
});

document.addEventListener("mouseup", (e) => {
  if (_clipDrag.idx < 0) return;
  const container = $("#timelineMultiTrack");
  if (container) {
    container.querySelectorAll(".tl-clip").forEach(el => el.classList.remove("dragging", "drop-before", "drop-after"));
    // Only reorder if mouse moved enough (not just a click)
    if (Math.abs(e.clientX - _clipDrag.startX) > 10) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".tl-clip");
      if (target) {
        const toIdx = parseInt(target.dataset.idx);
        const fromIdx = _clipDrag.idx;
        if (toIdx !== fromIdx && toIdx >= 0) {
          const item = timelineClips.splice(fromIdx, 1)[0];
          timelineClips.splice(toIdx, 0, item);
          renderSingleTrackTimeline();
          toast("Clip reordered ✓", "success");
        }
      }
    }
  }
  _clipDrag.idx = -1;
});

// ── Clip trim handles — persistent global handlers ─────────
let _clipTrimDrag = null;

function setupClipTrimHandles() {
  document.querySelectorAll(".tl-clip-trim").forEach(handle => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const clipId = handle.dataset.clipid;
      const clip = timelineClips.find(c => c.id === clipId);
      if (!clip) return;
      const row = handle.closest(".tl-st-row");
      _clipTrimDrag = {
        clipId,
        edge: handle.dataset.edge,
        startX: e.clientX,
        origStart: clip.trimStart,
        origEnd: clip.trimEnd,
        rowWidth: row ? row.clientWidth : 800,
        totalDur: getTotalDuration(),
      };
    });
  });
}

document.addEventListener("mousemove", (e) => {
  if (!_clipTrimDrag) return;
  const clip = timelineClips.find(c => c.id === _clipTrimDrag.clipId);
  if (!clip) return;
  const dx = e.clientX - _clipTrimDrag.startX;
  const dSec = (dx / _clipTrimDrag.rowWidth) * _clipTrimDrag.totalDur;
  const minDur = 0.2;
  if (_clipTrimDrag.edge === "left") {
    clip.trimStart = Math.max(0, Math.min(_clipTrimDrag.origStart + dSec, clip.trimEnd - minDur));
  } else {
    clip.trimEnd = Math.max(clip.trimStart + minDur, Math.min(_clipTrimDrag.origEnd + dSec, clip.info.duration));
  }
  // Live update clip width and duration label
  const clipEl = document.querySelector(`.tl-clip[data-clipid="${clip.id}"]`);
  if (clipEl) {
    const totalDur = Math.max(getTotalDuration(), 0.01);
    const dur = clip.trimEnd - clip.trimStart;
    clipEl.style.flex = Math.max(dur / totalDur, 0.01);
    const durEl = clipEl.querySelector(".tl-clip-dur");
    if (durEl) durEl.textContent = fmtTime(dur);
  }
});

document.addEventListener("mouseup", () => {
  if (!_clipTrimDrag) return;
  _clipTrimDrag = null;
  renderSingleTrackTimeline();
});

// ── Overlay timeline drag (slide & resize in timeline) ─────
let _ovTlDrag = null;
let _ovTlResize = null;

document.addEventListener("mousemove", (e) => {
  if (_ovTlDrag) {
    const { ov, startX, origStart, origEnd, rowWidth, totalDur } = _ovTlDrag;
    const dx = ((e.clientX - startX) / rowWidth) * totalDur;
    const dur = origEnd - origStart;
    ov.timelineStart = Math.max(0, origStart + dx);
    ov.timelineEnd = ov.timelineStart + dur;
    const block = document.querySelector(`.tl-ov-block[data-ovid="${ov.id}"]`);
    if (block) {
      const maxDur = Math.max(getTotalDuration(), ov.timelineEnd);
      block.style.left = (ov.timelineStart / maxDur * 100) + "%";
    }
  }
  if (_ovTlResize) {
    const { ov, edge, startX, origStart, origEnd, rowWidth, totalDur } = _ovTlResize;
    const dx = ((e.clientX - startX) / rowWidth) * totalDur;
    if (edge === "left") {
      ov.timelineStart = Math.max(0, Math.min(origStart + dx, ov.timelineEnd - 0.5));
    } else {
      ov.timelineEnd = Math.max(ov.timelineStart + 0.5, origEnd + dx);
    }
    const block = document.querySelector(`.tl-ov-block[data-ovid="${ov.id}"]`);
    if (block) {
      const maxDur = Math.max(getTotalDuration(), ov.timelineEnd);
      block.style.left = (ov.timelineStart / maxDur * 100) + "%";
      block.style.width = ((ov.timelineEnd - ov.timelineStart) / maxDur * 100) + "%";
      const durEl = block.querySelector(".tl-ov-dur");
      if (durEl) durEl.textContent = fmtTime(ov.timelineEnd - ov.timelineStart);
    }
  }
});

document.addEventListener("mouseup", () => {
  if (_ovTlDrag || _ovTlResize) {
    _ovTlDrag = null; _ovTlResize = null;
    renderSingleTrackTimeline();
  }
});

// ── Canvas overlay rendering ───────────────────────────────
let _ovMove = null;
let _ovResize = null;

function renderCanvasOverlays() {
  const wrap = $("#canvasFrame");
  wrap.querySelectorAll(".canvas-overlay").forEach(el => el.remove());

  overlayClips.forEach(ov => {
    const container = document.createElement("div");
    container.className = "canvas-overlay";
    container.id = `ovwrap_${ov.id}`;
    container.dataset.ovid = ov.id;
    container.style.cssText = `left:${ov.x}%;top:${ov.y}%;width:${ov.width}%;z-index:${ov.zIndex}`;

    const vid = document.createElement("video");
    vid.id = `ovvid_${ov.id}`;
    vid.src = ov.playerSrc || `/api/uploads/${ov.filename}`;
    vid.muted = !ov.audioEnabled;
    vid.preload = "metadata";
    vid.style.cssText = "width:100%;display:block;border-radius:4px;pointer-events:none";
    container.appendChild(vid);

    // Toolbar
    const tb = document.createElement("div");
    tb.className = "ov-toolbar";
    tb.innerHTML = `
      <span class="ov-tb-name">${ov.filename}</span>
      <button class="ov-tb-btn audio${ov.audioEnabled ? ' on' : ''}" data-ovid="${ov.id}" title="Toggle audio">🔊</button>
      <button class="ov-tb-btn close" data-ovid="${ov.id}" title="Remove overlay">✕</button>`;
    container.appendChild(tb);

    // 4 corner resize handles + left/right edge handles
    ["nw","ne","sw","se","e","w"].forEach(edge => {
      const h = document.createElement("div");
      h.className = `ov-resize-handle ov-h-${edge}`;
      h.dataset.ovid = ov.id; h.dataset.edge = edge;
      container.appendChild(h);
    });

    wrap.appendChild(container);

    // Drag to move (on container, but not toolbar/handles)
    container.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ov-toolbar") || e.target.closest(".ov-resize-handle")) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      _ovMove = { ov, startX: e.clientX, startY: e.clientY, origX: ov.x, origY: ov.y, rect };
    });

    // Resize handles
    container.querySelectorAll(".ov-resize-handle").forEach(h => {
      h.addEventListener("mousedown", (e) => {
        e.preventDefault(); e.stopPropagation();
        const rect = wrap.getBoundingClientRect();
        _ovResize = {
          ov, edge: h.dataset.edge,
          startX: e.clientX, startY: e.clientY,
          origX: ov.x, origY: ov.y, origW: ov.width,
          rect,
        };
      });
    });

    // Toolbar buttons
    tb.querySelector(".ov-tb-btn.audio").addEventListener("click", (e) => {
      e.stopPropagation();
      ov.audioEnabled = !ov.audioEnabled;
      vid.muted = !ov.audioEnabled;
      e.target.classList.toggle("on", ov.audioEnabled);
    });
    tb.querySelector(".ov-tb-btn.close").addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromOverlay(ov.id);
    });
  });
}

// Overlay move / resize — global handlers (registered once)
document.addEventListener("mousemove", (e) => {
  if (_ovMove) {
    const { ov, startX, startY, origX, origY, rect } = _ovMove;
    ov.x = Math.max(0, Math.min(origX + ((e.clientX - startX) / rect.width) * 100, 100 - ov.width));
    ov.y = Math.max(0, Math.min(origY + ((e.clientY - startY) / rect.height) * 100, 95));
    const c = document.getElementById(`ovwrap_${ov.id}`);
    if (c) { c.style.left = ov.x + "%"; c.style.top = ov.y + "%"; }
  }
  if (_ovResize) {
    const { ov, edge, startX, startY, origX, origY, origW, rect } = _ovResize;
    const dx = ((e.clientX - startX) / rect.width) * 100;
    if (edge.includes("e")) {
      ov.width = Math.max(10, Math.min(origW + dx, 100 - ov.x));
    } else if (edge.includes("w")) {
      const newW = Math.max(10, origW - dx);
      ov.x = Math.max(0, origX + (origW - newW));
      ov.width = newW;
    }
    const c = document.getElementById(`ovwrap_${ov.id}`);
    if (c) { c.style.width = ov.width + "%"; c.style.left = ov.x + "%"; }
  }
});

document.addEventListener("mouseup", () => { _ovMove = null; _ovResize = null; });

// Overlay playback sync — called from timeupdate
function syncOverlays(mainT) {
  overlayClips.forEach(ov => {
    const vid = document.getElementById(`ovvid_${ov.id}`);
    if (!vid) return;
    const active = mainT >= ov.timelineStart && mainT <= ov.timelineEnd;
    const container = document.getElementById(`ovwrap_${ov.id}`);
    if (container) container.style.opacity = active ? "1" : "0.2";
    if (active) {
      const ovT = Math.min(ov.trimStart + (mainT - ov.timelineStart), ov.trimEnd - 0.05);
      if (Math.abs(vid.currentTime - ovT) > 0.2) vid.currentTime = ovT;
      if (!evsVideo.paused && vid.paused) vid.play().catch(() => {});
    } else {
      if (!vid.paused) vid.pause();
    }
  });
}

// ── Split clip at playhead ────────────────────────────────
function splitClipAtPlayhead() {
  const clip = getActiveClip();
  if (!clip) { toast("No clip selected", "error"); return; }
  const splitAt = evsVideo.currentTime;  // absolute time in source video
  const minGap = 0.3;
  if (splitAt <= clip.trimStart + minGap || splitAt >= clip.trimEnd - minGap) {
    toast("Move playhead inside the clip to split", "warn");
    return;
  }
  clipCounter++;
  const clipA = { ...clip, trimEnd: splitAt };
  const clipB = { ...clip, id: `clip_${clipCounter}`, trimStart: splitAt };
  const idx = timelineClips.findIndex(c => c.id === clip.id);
  timelineClips.splice(idx, 1, clipA, clipB);
  activeClipId = clipA.id;
  renderSingleTrackTimeline();
  toast("Clip split ✓", "success");
}

function reorderVideos(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const item = editorVideos.splice(fromIdx, 1)[0];
  editorVideos.splice(toIdx, 0, item);
  editorVideos.forEach((v, i) => { v.order = i; });
  renderVideoList();
  renderSingleTrackTimeline();
  toast("Videos reordered ✓", "success");
}

// ── Trim handle drag ──────────────────────────────────────
function setupTrimHandles(container) {
  container.querySelectorAll(".tl-mt-trim-handle").forEach(handle => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const vid = handle.dataset.vid;
      const edge = handle.dataset.edge;
      const v = editorVideos.find(v => v.id === vid);
      if (!v) return;

      trimDrag = {
        videoId: vid,
        edge,
        startX: e.clientX,
        origStart: v.trimStart || 0,
        origEnd: v.trimEnd || v.info.duration,
      };

      document.addEventListener("mousemove", onTrimDragMove);
      document.addEventListener("mouseup", onTrimDragUp);
    });
  });
}

function onTrimDragMove(e) {
  if (!trimDrag) return;
  const v = editorVideos.find(v => v.id === trimDrag.videoId);
  if (!v) return;

  const track = document.querySelector(`.tl-mt-lane-track[data-vid="${trimDrag.videoId}"]`);
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const dx = e.clientX - trimDrag.startX;
  const dSec = (dx / rect.width) * v.info.duration;

  if (trimDrag.edge === "left") {
    const newStart = Math.max(0, Math.min(trimDrag.origStart + dSec, (v.trimEnd || v.info.duration) - 0.5));
    v.trimStart = newStart;
  } else {
    const newEnd = Math.max((v.trimStart || 0) + 0.5, Math.min(trimDrag.origEnd + dSec, v.info.duration));
    v.trimEnd = newEnd;
  }

  // Live update: re-render just the blocks
  updateLaneBlocks(v, track);
}

function updateLaneBlocks(v, track) {
  const maxDuration = state.editorInfo?.duration || v.info.duration;
  const trim = getVideoTrim(v);

  const blockLeftPct = (trim.start / maxDuration) * 100;
  const blockWidthPct = ((trim.end - trim.start) / maxDuration) * 100;

  const videoBlock = track.querySelector(".tl-mt-video-block");
  if (videoBlock) {
    videoBlock.style.left = blockLeftPct + "%";
    videoBlock.style.width = blockWidthPct + "%";
  }

  // Update trim zones
  const zones = track.querySelectorAll(".tl-mt-trim-zone");
  zones.forEach(z => z.remove());
  if (trim.start > 0) {
    const pre = document.createElement("div");
    pre.className = "tl-mt-trim-zone";
    pre.style.cssText = `left:0%;width:${blockLeftPct}%`;
    track.insertBefore(pre, videoBlock);
  }
  if (trim.end < v.info.duration) {
    const post = document.createElement("div");
    post.className = "tl-mt-trim-zone";
    post.style.cssText = `left:${blockLeftPct + blockWidthPct}%;width:${100 - blockLeftPct - blockWidthPct}%`;
    track.appendChild(post);
  }

  // Update duration badge
  const durEl = track.closest(".tl-mt-lane")?.querySelector(".tl-mt-lane-dur");
  if (durEl) durEl.textContent = fmtTime(trim.end - trim.start);

  // Update label trim indicator
  const labelEl = track.closest(".tl-mt-lane")?.querySelector(".tl-mt-lane-label");
  const hasTrim = trim.start > 0 || trim.end < v.info.duration;
  if (labelEl) {
    const existing = labelEl.querySelector("span[style]");
    if (existing && !hasTrim) existing.remove();
    else if (!existing && hasTrim) {
      const badge = document.createElement("span");
      badge.style.cssText = "font-size:9px;color:var(--yellow);margin-left:4px";
      badge.textContent = "✂️";
      labelEl.appendChild(badge);
    }
  }
}

function onTrimDragUp(e) {
  document.removeEventListener("mousemove", onTrimDragMove);
  document.removeEventListener("mouseup", onTrimDragUp);

  if (trimDrag) {
    const v = editorVideos.find(v => v.id === trimDrag.videoId);
    if (v) {
      const trim = getVideoTrim(v);
      // Round and normalize
      v.trimStart = Math.round(trim.start * 10) / 10;
      v.trimEnd = Math.round(trim.end * 10) / 10;
      // Reset if no meaningful trim
      if (v.trimStart <= 0) delete v.trimStart;
      if (v.trimEnd >= v.info.duration - 0.1) delete v.trimEnd;
      renderMultiTrackTimeline();
    }
    trimDrag = null;
  }
}

// editorOpenWorkspace — called after upload, shows workspace and loads video info
async function editorOpenWorkspace(path, filename) {
  try {
    const info = await api("/api/local/info", { path });
    if (info.error) { toast(info.error, "error"); return; }
    info.path = path;

    // Store info on the active video
    const v = getActiveVideo();
    if (v) {
      v.info = info;
      v.path = path;
      v.filename = filename;
    } else {
      state.editorInfo = info;
    }

    $("#editorDropState").classList.add("hidden");
    $("#editorWorkspace").classList.remove("hidden");

    const vid = $("#editorVideo");
    vid.src = `/api/uploads/${filename}`;
    vid.load();

    updateEditorInfoBar();
    await editorGenThumbs();
  } catch (e) {
    toast("Error loading video: " + e.message, "error");
  }
}

$("#btnGenThumbs").addEventListener("click", editorGenThumbs);
$("#btnSplitClip").addEventListener("click", splitClipAtPlayhead);

async function editorGenThumbs() {
  if (!state.editorInfo) return;
  const interval = parseInt($("#editorInterval").value);

  $("#editorThumbStatus").classList.remove("hidden");
  $("#editorThumbStatus").textContent = "Generating thumbnails...";

  try {
    const result = await api("/api/local/thumbnails", {
      path: state.editorInfo.path,
      interval,
    });

    if (result.error) { toast(result.error, "error"); return; }

    const timeline = $("#editorTimeline");
    timeline.innerHTML = "";

    state.editorThumbs = result.thumb_count;
    const baseUrl = result.thumb_base_url;

    for (let i = 0; i < result.thumb_count; i++) {
      const seek = i * interval;
      const div = document.createElement("div");
      div.className = "editor-thumb";
      div.dataset.index = i;
      div.dataset.seek = seek;

      const img = document.createElement("img");
      img.src = `${baseUrl}/thumb_${String(i).padStart(4, "0")}.jpg`;
      img.alt = fmtTime(seek);
      img.loading = "lazy";

      const ts = document.createElement("div");
      ts.className = "thumb-ts";
      ts.textContent = fmtTime(seek);

      div.appendChild(img);
      div.appendChild(ts);
      div.addEventListener("click", () => editorOnThumbClick(i, seek));
      timeline.appendChild(div);
    }

    $("#editorThumbStatus").textContent = `${result.thumb_count} thumbnails ready`;
    toast("Thumbnails ready ✓", "success");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
}

function editorOnThumbClick(index, seek) {
  const interval = parseInt($("#editorInterval").value);

  if (state.editorSel.start === null) {
    state.editorSel.start = index;
    state.editorSel.end = null;
  } else if (state.editorSel.end === null) {
    state.editorSel.end = index;
    if (state.editorSel.end < state.editorSel.start) {
      [state.editorSel.start, state.editorSel.end] = [state.editorSel.end, state.editorSel.start];
    }
  } else {
    state.editorSel.start = index;
    state.editorSel.end = null;
  }

  editorUpdateSelectionUI(interval);
}

function editorUpdateSelectionUI(interval) {
  $$(".editor-thumb").forEach(el => el.classList.remove("selected-start", "selected-range", "selected-end"));

  if (state.editorSel.start === null) {
    $("#editorSelection").classList.add("hidden");
    return;
  }

  const s = state.editorSel.start * interval;
  $("#editorSelection").classList.remove("hidden");

  if (state.editorSel.end === null) {
    const el = $(`.editor-thumb[data-index="${state.editorSel.start}"]`);
    if (el) el.classList.add("selected-start");
    $("#editorSelRange").textContent = `Start: ${fmtTime(s)}`;
  } else {
    const e = Math.min((state.editorSel.end + 1) * interval, state.editorInfo.duration);
    for (let i = state.editorSel.start; i <= state.editorSel.end; i++) {
      const el = $(`.editor-thumb[data-index="${i}"]`);
      if (!el) continue;
      if (i === state.editorSel.start) el.classList.add("selected-start");
      else if (i === state.editorSel.end) el.classList.add("selected-end");
      else el.classList.add("selected-range");
    }
    $("#editorSelRange").textContent = `${fmtTime(s)} — ${fmtTime(e)}`;
  }
}

$("#btnEditorCut").addEventListener("click", async () => {
  if (state.editorSel.start === null || state.editorSel.end === null) {
    toast("Select a range first", "error"); return;
  }
  const interval = parseInt($("#editorInterval").value);
  const startSec = state.editorSel.start * interval;
  const endSec = Math.min((state.editorSel.end + 1) * interval, state.editorInfo.duration);
  const label = $("#editorClipLabel").value.trim() || `clip_${state.editorClips.length + 1}`;

  $("#btnEditorCut").disabled = true;
  $("#btnEditorCut").textContent = "Cutting...";

  try {
    const result = await api("/api/local/cut", {
      path: state.editorInfo.path,
      start: startSec,
      end: endSec,
      label,
    });

    if (result.ok) {
      state.editorClips.push({ label, start: startSec, end: endSec, file: result.filename, size: result.size_mb });
      renderEditorClips();
      state.editorSel.start = null; state.editorSel.end = null;
      editorUpdateSelectionUI(interval);
      toast(`Clip "${label}" cut! ✓`, "success");
    } else {
      toast(result.error || "Cut failed", "error");
    }
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
  $("#btnEditorCut").disabled = false;
  $("#btnEditorCut").textContent = "✂️ Cut Clip";
});

$("#btnEditorClear").addEventListener("click", () => {
  state.editorSel.start = null; state.editorSel.end = null;
  editorUpdateSelectionUI(parseInt($("#editorInterval").value));
});

function renderEditorClips() {
  $("#editorClipCount").textContent = state.editorClips.length;
  const list = $("#editorClipList");
  list.innerHTML = "";

  if (state.editorClips.length === 0) {
    list.innerHTML = '<div class="empty-hint">No clips cut yet</div>';
    $("#btnEditorOpenOut").classList.add("hidden");
    $("#editorTimelineBar").classList.add("hidden");
    return;
  }

  $("#btnEditorOpenOut").classList.remove("hidden");
  $("#editorTimelineBar").classList.remove("hidden");

  state.editorClips.forEach((clip, i) => {
    const card = document.createElement("div");
    card.className = "clip-card";
    card.innerHTML = `
      <div class="clip-card-info">
        <div class="clip-card-label">${clip.label}</div>
        <div class="clip-card-range">${fmtTime(clip.start)} → ${fmtTime(clip.end)} · ${clip.file}</div>
      </div>
      <div class="clip-card-dur">${fmtSize(clip.size)}</div>`;
    list.appendChild(card);
  });

  renderTimeline();
}

// ═══════════════════════════════════════════════════════════
//  TIMELINE — Drag-to-adjust clip timing
// ═══════════════════════════════════════════════════════════

let tlState = {
  dragging: null,        // index of clip being dragged, or null
  dragMode: null,        // "body" | "left" | "right"
  dragStartX: 0,         // mouse X when drag started
  dragOrigStart: 0,      // clip.start before drag
  dragOrigEnd: 0,        // clip.end before drag
  trackWidth: 0,         // pixel width of track
  videoDuration: 0,      // cached video duration in sec
  snapSec: 1,            // snap interval in seconds
};

function pxToSec(px) {
  if (tlState.trackWidth <= 0 || tlState.videoDuration <= 0) return 0;
  return (px / tlState.trackWidth) * tlState.videoDuration;
}
function secToPx(sec) {
  if (tlState.videoDuration <= 0) return 0;
  return (sec / tlState.videoDuration) * tlState.trackWidth;
}
function snapTime(sec) {
  return Math.round(sec / tlState.snapSec) * tlState.snapSec;
}

function renderTimeline() {
  if (!state.editorInfo) return;
  const track = $("#timelineTrack");
  const ruler = $("#timelineRuler");

  tlState.videoDuration = state.editorInfo.duration;
  tlState.trackWidth = track.clientWidth || 800;

  // Build ruler
  renderTimelineRuler(ruler);

  // Build blocks
  track.innerHTML = "";

  if (state.editorClips.length === 0) {
    track.innerHTML = '<div class="timeline-placeholder">No clips yet — select a range and cut</div>';
    return;
  }

  // Color palette for blocks
  const colors = [
    { bg: "rgba(31,111,235,0.25)", border: "rgba(31,111,235,0.5)", label: "var(--accent)" },
    { bg: "rgba(63,185,80,0.22)", border: "rgba(63,185,80,0.45)", label: "var(--green)" },
    { bg: "rgba(210,153,29,0.22)", border: "rgba(210,153,29,0.45)", label: "var(--yellow)" },
    { bg: "rgba(248,81,73,0.22)", border: "rgba(248,81,73,0.4)", label: "var(--red)" },
    { bg: "rgba(163,113,247,0.22)", border: "rgba(163,113,247,0.45)", label: "#a371f7" },
    { bg: "rgba(86,211,200,0.22)", border: "rgba(86,211,200,0.45)", label: "#56d3c8" },
  ];

  state.editorClips.forEach((clip, i) => {
    const c = colors[i % colors.length];
    const leftPct = (clip.start / tlState.videoDuration) * 100;
    const widthPct = ((clip.end - clip.start) / tlState.videoDuration) * 100;

    const block = document.createElement("div");
    block.className = "timeline-block";
    block.dataset.index = i;
    block.style.left = leftPct + "%";
    block.style.width = widthPct + "%";
    block.style.background = `linear-gradient(135deg, ${c.bg}, ${c.bg.replace(/0\.\d+/, (m) => (parseFloat(m) + 0.08).toFixed(2))})`;
    block.style.borderColor = c.border;

    const label = document.createElement("div");
    label.className = "timeline-block-label";
    label.style.color = c.label;
    label.textContent = clip.label;

    const time = document.createElement("div");
    time.className = "timeline-block-time";
    time.textContent = fmtTime(clip.end - clip.start);

    const handleL = document.createElement("div");
    handleL.className = "timeline-block-handle left";

    const handleR = document.createElement("div");
    handleR.className = "timeline-block-handle right";

    block.appendChild(label);
    block.appendChild(time);
    block.appendChild(handleL);
    block.appendChild(handleR);

    // ── Pointer events for dragging ──
    block.addEventListener("pointerdown", (e) => onBlockPointerDown(e, i));
    handleL.addEventListener("pointerdown", (e) => { e.stopPropagation(); onBlockPointerDown(e, i, "left"); });
    handleR.addEventListener("pointerdown", (e) => { e.stopPropagation(); onBlockPointerDown(e, i, "right"); });

    track.appendChild(block);
  });

  // Playhead indicator
  const playhead = document.createElement("div");
  playhead.className = "timeline-playhead";
  playhead.id = "timelinePlayhead";
  track.appendChild(playhead);

  // Snap indicator (hidden by default)
  const snapLine = document.createElement("div");
  snapLine.className = "timeline-snap-line";
  snapLine.id = "timelineSnapLine";
  track.appendChild(snapLine);

  // Re-measure after render
  requestAnimationFrame(() => {
    tlState.trackWidth = track.clientWidth;
    updateAllBlockPositions();
    syncTimelinePlayhead();
  });
}

function renderTimelineRuler(ruler) {
  ruler.innerHTML = "";
  const dur = tlState.videoDuration;
  if (dur <= 0) return;

  // Choose tick interval based on duration
  let tickInterval;
  if (dur <= 30) tickInterval = 5;
  else if (dur <= 120) tickInterval = 10;
  else if (dur <= 600) tickInterval = 30;
  else if (dur <= 1800) tickInterval = 60;
  else tickInterval = 120;

  const minorInterval = tickInterval / 4;

  // Minor ticks
  for (let t = 0; t <= dur; t += minorInterval) {
    const pct = (t / dur) * 100;
    const tick = document.createElement("div");
    tick.className = "timeline-ruler-tick" + (t % tickInterval === 0 ? " major" : "");
    tick.style.left = pct + "%";
    ruler.appendChild(tick);
  }

  // Major tick labels
  for (let t = 0; t <= dur; t += tickInterval) {
    const pct = (t / dur) * 100;
    const mark = document.createElement("div");
    mark.className = "timeline-ruler-mark";
    mark.style.left = pct + "%";
    mark.textContent = fmtTime(t);
    ruler.appendChild(mark);
  }
}

function syncTimelinePlayhead() {
  const playhead = $("#timelinePlayhead");
  if (!playhead || !state.editorInfo) return;
  const vid = $("#editorVideo");
  if (!vid || !vid.duration || isNaN(vid.duration)) return;
  const pct = (vid.currentTime / tlState.videoDuration) * 100;
  playhead.style.left = pct + "%";
}

function updateAllBlockPositions() {
  const track = $("#timelineTrack");
  const blocks = track.querySelectorAll(".timeline-block");
  blocks.forEach(block => {
    const i = parseInt(block.dataset.index);
    if (i >= 0 && i < state.editorClips.length) {
      const clip = state.editorClips[i];
      block.style.left = ((clip.start / tlState.videoDuration) * 100) + "%";
      block.style.width = (((clip.end - clip.start) / tlState.videoDuration) * 100) + "%";
      const timeEl = block.querySelector(".timeline-block-time");
      if (timeEl) timeEl.textContent = fmtTime(clip.end - clip.start);
      const labelEl = block.querySelector(".timeline-block-label");
      if (labelEl) labelEl.textContent = clip.label;
    }
  });
}

// ── Drag Handlers ────────────────────────────────────────

function onBlockPointerDown(e, index, mode = "body") {
  e.preventDefault();
  const track = $("#timelineTrack");
  const block = track.querySelector(`.timeline-block[data-index="${index}"]`);
  if (!block) return;

  tlState.dragging = index;
  tlState.dragMode = mode;
  tlState.dragStartX = e.clientX;
  tlState.dragOrigStart = state.editorClips[index].start;
  tlState.dragOrigEnd = state.editorClips[index].end;
  tlState.trackWidth = track.clientWidth;

  block.classList.add("dragging");
  if (mode !== "body") block.classList.add("dragging-edge");
  block.setPointerCapture(e.pointerId);

  // Listeners on document for move & up
  document.addEventListener("pointermove", onBlockPointerMove);
  document.addEventListener("pointerup", onBlockPointerUp);
  document.addEventListener("pointercancel", onBlockPointerUp);
}

function onBlockPointerMove(e) {
  if (tlState.dragging === null) return;

  const idx = tlState.dragging;
  const clip = state.editorClips[idx];
  const dx = e.clientX - tlState.dragStartX;
  const dSec = snapTime(pxToSec(dx));
  const minDur = 1; // minimum clip duration in seconds

  let newStart = clip.start;
  let newEnd = clip.end;

  switch (tlState.dragMode) {
    case "left":
      newStart = snapTime(tlState.dragOrigStart + pxToSec(dx));
      newStart = Math.max(0, Math.min(newStart, tlState.dragOrigEnd - minDur));
      break;
    case "right":
      newEnd = snapTime(tlState.dragOrigEnd + pxToSec(dx));
      newEnd = Math.max(tlState.dragOrigStart + minDur, Math.min(newEnd, tlState.videoDuration));
      break;
    case "body":
      newStart = snapTime(tlState.dragOrigStart + pxToSec(dx));
      newEnd = snapTime(tlState.dragOrigEnd + pxToSec(dx));
      newStart = Math.max(0, newStart);
      newEnd = Math.min(tlState.videoDuration, newEnd);
      if (newEnd - newStart < minDur) {
        // Clamp: if would be too short, revert
        if (dx > 0) { newEnd = newStart + minDur; }
        else { newStart = newEnd - minDur; }
      }
      break;
  }

  // Update clip data in place
  clip.start = newStart;
  clip.end = newEnd;

  // Update block visually
  const track = $("#timelineTrack");
  const block = track.querySelector(`.timeline-block[data-index="${idx}"]`);
  if (block) {
    block.style.left = ((newStart / tlState.videoDuration) * 100) + "%";
    block.style.width = (((newEnd - newStart) / tlState.videoDuration) * 100) + "%";
    const timeEl = block.querySelector(".timeline-block-time");
    if (timeEl) timeEl.textContent = fmtTime(newEnd - newStart);
  }

  // Show snap line at the current edge being dragged
  const snapLine = $("#timelineSnapLine");
  if (snapLine) {
    let snapSec;
    if (tlState.dragMode === "left") snapSec = newStart;
    else if (tlState.dragMode === "right") snapSec = newEnd;
    else snapSec = newStart; // body mode: show snap at new position
    const snapPct = (snapSec / tlState.videoDuration) * 100;
    snapLine.style.left = snapPct + "%";
    snapLine.style.display = "block";
  }
}

function onBlockPointerUp(e) {
  document.removeEventListener("pointermove", onBlockPointerMove);
  document.removeEventListener("pointerup", onBlockPointerUp);
  document.removeEventListener("pointercancel", onBlockPointerUp);

  // Hide snap line
  const snapLine = $("#timelineSnapLine");
  if (snapLine) snapLine.style.display = "none";

  if (tlState.dragging !== null) {
    const idx = tlState.dragging;
    const clip = state.editorClips[idx];
    const track = $("#timelineTrack");
    const block = track.querySelector(`.timeline-block[data-index="${idx}"]`);
    if (block) {
      block.classList.remove("dragging", "dragging-edge");
    }

    // Show change
    const oldStart = tlState.dragOrigStart;
    const oldEnd = tlState.dragOrigEnd;
    if (clip.start !== oldStart || clip.end !== oldEnd) {
      toast(`Adjusted: ${fmtTime(clip.start)} → ${fmtTime(clip.end)}`, "success");
      // Update the clip list card text without full re-render
      const cards = $$("#editorClipList .clip-card");
      if (cards[idx]) {
        const rangeEl = cards[idx].querySelector(".clip-card-range");
        if (rangeEl) rangeEl.textContent = `${fmtTime(clip.start)} → ${fmtTime(clip.end)} · ${clip.file}`;
        const durEl = cards[idx].querySelector(".clip-card-dur");
        if (durEl) durEl.textContent = fmtSize(clip.size);
      }
    }

    tlState.dragging = null;
    tlState.dragMode = null;
  }
}

// ── Timeline click to seek / add marker ──────────────────
$("#timelineTrack").addEventListener("click", (e) => {
  // Only if clicking on empty track (not a block)
  if (e.target !== e.currentTarget) return;
  // Could be used to set playhead position; for now just show time
  const rect = e.currentTarget.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const t = snapTime(pxToSec(px));
  toast(`Timeline: ${fmtTime(t)}`, "success");
});

// ── Re-render on resize ──────────────────────────────────
window.addEventListener("resize", () => {
  if (state.editorClips.length > 0) {
    const track = $("#timelineTrack");
    tlState.trackWidth = track.clientWidth;
    updateAllBlockPositions();
    renderTimelineRuler($("#timelineRuler"));
  }
});

$("#btnEditorOpenOut").addEventListener("click", async () => {
  await api("/api/open-output");
});

// ═══════════════════════════════════════════════════════════
//  EDITOR SUBTITLES — Unified full-featured subtitle editor
//  (editorSubs.style is declared in the Editor module above;
//   each video stores its own segments in video.subtitles)
// ═══════════════════════════════════════════════════════════

// Render style presets inside the Editor subtitles panel
function renderEvsPresets() {
  const container = $("#evsPresets");
  if (!container) return;
  container.innerHTML = "";
  SUB_PRESETS.forEach((preset, i) => {
    const card = document.createElement("div");
    card.className = "sub-preset-card" + (i === 0 ? " sub-preset-active" : "");
    card.dataset.id = preset.id;
    const p = preset.preview;
    card.innerHTML = `
      <div class="sub-preset-preview" style="background:${p.bg};${p.boxBg ? "padding:2px 5px;border-radius:2px;" : ""}">
        <span style="color:${p.color};text-shadow:${p.shadow || "none"};font-weight:${p.bold ? 900 : 700};font-size:12px">Abc</span>
      </div>
      <span class="sub-preset-name">${preset.name}</span>`;
    card.addEventListener("click", () => applyEvsPreset(preset));
    container.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
//  LANE TRIMMING — drag video block edges to trim
// ═══════════════════════════════════════════════════════════

let trimDrag = null; // {videoId, edge: 'left'|'right', startX, origVal}

function getVideoTrim(video) {
  return {
    start: video.trimStart || 0,
    end: video.trimEnd || video.info.duration,
  };
}

function applyEvsPreset(preset) {
  editorSubs.style.font_size      = preset.font_size;
  editorSubs.style.font_color     = preset.font_color;
  editorSubs.style.outline_color  = preset.outline_color;
  editorSubs.style.outline_width  = preset.outline_width;
  editorSubs.style.border_style   = preset.border_style;
  editorSubs.style.back_color     = preset.back_color;
  editorSubs.style.back_alpha     = preset.back_alpha || 0;

  $("#evsFontSize").value = preset.font_size;
  $("#evsFontSizeLabel").textContent = preset.font_size;
  $("#evsFontColor").value = preset.font_color;

  $$(".sub-preset-card").forEach(c => c.classList.remove("sub-preset-active"));
  $(`.sub-preset-card[data-id="${preset.id}"]`)?.classList.add("sub-preset-active");

  updateEvsOverlayStyle();
}

const evsVideo = $("#editorVideo");

// ── Video playback ────────────────────────────────────────
evsVideo.addEventListener("loadedmetadata", () => {
  $("#evsSeekBar").max = Math.floor(evsVideo.duration * 10);
  updateEvsTime();
});
evsVideo.addEventListener("timeupdate", () => {
  if (!evsVideo.paused) $("#evsSeekBar").value = Math.floor(evsVideo.currentTime * 10);
  updateEvsTime();
  syncEvsOverlay();
  syncTimelinePlayhead();
  syncSingleTrackPlayhead();
  syncOverlays(evsVideo.currentTime);

  // Enforce clip trimEnd — advance to next clip when boundary is reached
  const activeClip = getActiveClip();
  if (activeClip && !evsVideo.paused && evsVideo.currentTime >= activeClip.trimEnd - 0.08) {
    const idx = timelineClips.findIndex(c => c.id === activeClipId);
    if (idx >= 0 && idx < timelineClips.length - 1) {
      const nextClip = timelineClips[idx + 1];
      selectClip(nextClip.id);
      evsVideo.addEventListener("loadedmetadata", () => evsVideo.play(), { once: true });
    } else {
      evsVideo.pause();
    }
  }
});
evsVideo.addEventListener("play",  () => {
  $("#evsPlayBtn").textContent = "⏸";
  overlayClips.forEach(ov => {
    if (evsVideo.currentTime >= ov.timelineStart && evsVideo.currentTime <= ov.timelineEnd) {
      document.getElementById(`ovvid_${ov.id}`)?.play().catch(() => {});
    }
  });
});
evsVideo.addEventListener("pause", () => {
  $("#evsPlayBtn").textContent = "▶";
  overlayClips.forEach(ov => {
    document.getElementById(`ovvid_${ov.id}`)?.pause();
  });
});

$("#evsPlayBtn").addEventListener("click", () => {
  if (evsVideo.paused) evsVideo.play(); else evsVideo.pause();
});
$("#evsSeekBar").addEventListener("input", () => {
  evsVideo.currentTime = $("#evsSeekBar").value / 10;
});

function updateEvsTime() {
  const cur = fmtTime(Math.floor(evsVideo.currentTime || 0));
  const dur = isNaN(evsVideo.duration) ? "0:00" : fmtTime(Math.floor(evsVideo.duration));
  $("#evsTimeLabel").textContent = `${cur} / ${dur}`;
}

// ── Subtitle overlay sync ─────────────────────────────────
function syncEvsOverlay() {
  const t = evsVideo.currentTime;
  let activeIdx = -1;
  for (let i = 0; i < editorSubs.segments.length; i++) {
    if (t >= editorSubs.segments[i].start && t <= editorSubs.segments[i].end) {
      activeIdx = i; break;
    }
  }
  const previewEl = $("#evsPreviewText");
  const seg = activeIdx >= 0 ? editorSubs.segments[activeIdx] : null;

  if (!seg) {
    previewEl.innerHTML = "";
  } else if (editorSubs.karaoke && seg.words && seg.words.length > 0) {
    const activeWord = seg.words.find(w => t >= w.start && t <= w.end);
    const hlColor = editorSubs.style.highlight_color || "#ffdd00";
    previewEl.innerHTML = seg.words.map(w => {
      const isActive = activeWord && w.start === activeWord.start;
      return isActive
        ? `<span style="color:${hlColor}">${w.word}</span>`
        : `<span style="opacity:0.55">${w.word}</span>`;
    }).join(" ");
  } else {
    previewEl.textContent = seg.text;
  }

  if (activeIdx !== editorSubs.activeIdx) {
    editorSubs.activeIdx = activeIdx;
    $$(".evs-seg-item").forEach((el, i) => el.classList.toggle("evs-seg-active", i === activeIdx));
    if (activeIdx >= 0) {
      const el = $(`.evs-seg-item[data-idx="${activeIdx}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      triggerEvsAnimation();
    }
  }
}

function updateEvsOverlayPosition() {
  const handle = $("#evsDragHandle");
  handle.style.left = (editorSubs.style.position_x_pct * 100) + "%";
  handle.style.top  = (editorSubs.style.position_y_pct * 100) + "%";
}

function updateEvsOverlayStyle() {
  const text   = $("#evsPreviewText");
  const handle = $("#evsDragHandle");
  const vid    = $("#editorVideo");
  const assSize = editorSubs.style.font_size || 24;
  const scale  = vid.clientHeight && vid.videoHeight ? vid.clientHeight / vid.videoHeight : 1;
  const ow     = editorSubs.style.outline_width ?? 2.5;

  text.style.fontSize = (assSize * scale) + "px";
  text.style.color    = editorSubs.style.font_color || "#ffffff";
  handle.style.maxWidth = (editorSubs.style.max_width_pct || 86) + "%";

  if (ow > 0) {
    const s = Math.round(ow);
    const oc = editorSubs.style.outline_color || "#000000";
    text.style.textShadow = `${s}px ${s}px 0 ${oc},${-s}px ${-s}px 0 ${oc},${s}px ${-s}px 0 ${oc},${-s}px ${s}px 0 ${oc}`;
  } else {
    text.style.textShadow = "none";
  }

  if (editorSubs.style.back_color && editorSubs.style.border_style === 3) {
    const h = editorSubs.style.back_color.replace("#", "");
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    const a = 1 - (editorSubs.style.back_alpha || 0);
    handle.style.background = `rgba(${r},${g},${b},${a})`;
    handle.style.padding = "4px 12px";
  } else {
    handle.style.background = "transparent";
    handle.style.padding = "4px 8px";
  }
}

function triggerEvsAnimation() {
  const handle = $("#evsDragHandle");
  handle.classList.remove("sub-anim-fade", "sub-anim-slide", "sub-anim-pop");
  void handle.offsetWidth; // force reflow
  const anim = editorSubs.style.animation;
  if (anim && anim !== "none") handle.classList.add(`sub-anim-${anim}`);
}

// ── Overlay drag ──────────────────────────────────────────
const evsDragHandle = $("#evsDragHandle");
evsDragHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  editorSubs.dragging = true;
  const rect = evsDragHandle.getBoundingClientRect();
  editorSubs.dragOffset.x = e.clientX - rect.left - rect.width / 2;
  editorSubs.dragOffset.y = e.clientY - rect.top  - rect.height / 2;
  evsDragHandle.style.cursor = "grabbing";
});
document.addEventListener("mousemove", (e) => {
  if (!editorSubs.dragging) return;
  const wrap = $("#canvasFrame");
  const r = wrap.getBoundingClientRect();
  editorSubs.style.position_x_pct = Math.max(0.05, Math.min(0.95, (e.clientX - editorSubs.dragOffset.x - r.left) / r.width));
  editorSubs.style.position_y_pct = Math.max(0.05, Math.min(0.95, (e.clientY - editorSubs.dragOffset.y - r.top)  / r.height));
  updateEvsOverlayPosition();
});
document.addEventListener("mouseup", () => {
  if (editorSubs.dragging) { editorSubs.dragging = false; evsDragHandle.style.cursor = "grab"; }
});

// ── Style controls ────────────────────────────────────────
$("#evsFontSize").addEventListener("input", (e) => {
  editorSubs.style.font_size = parseInt(e.target.value);
  $("#evsFontSizeLabel").textContent = e.target.value;
  updateEvsOverlayStyle();
});
$("#evsMaxWidth").addEventListener("input", (e) => {
  editorSubs.style.max_width_pct = parseInt(e.target.value);
  $("#evsMaxWidthLabel").textContent = e.target.value + "%";
  updateEvsOverlayStyle();
});
$("#evsFontColor").addEventListener("input", (e) => {
  editorSubs.style.font_color = e.target.value;
  updateEvsOverlayStyle();
});
$("#evsHighlightColor").addEventListener("input", (e) => {
  editorSubs.style.highlight_color = e.target.value;
});
$$(".pos-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".pos-btn").forEach(b => b.classList.remove("pos-btn-active"));
    btn.classList.add("pos-btn-active");
    editorSubs.style.position_y_pct = parseFloat(btn.dataset.y);
    updateEvsOverlayPosition();
  });
});
$$(".anim-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".anim-btn").forEach(b => b.classList.remove("anim-btn-active"));
    btn.classList.add("anim-btn-active");
    editorSubs.style.animation = btn.dataset.anim;
    triggerEvsAnimation();
  });
});

// ── Karaoke toggle ────────────────────────────────────────
$("#evsKaraokeToggle").addEventListener("change", (e) => {
  editorSubs.karaoke = e.target.checked;
  $("#evsHighlightRow").classList.toggle("hidden", !editorSubs.karaoke);
});

// ── Transcribe ────────────────────────────────────────────
$("#btnEditorTranscribe").addEventListener("click", async () => {
  if (!editorVideoPath) { toast("Load a video first", "error"); return; }
  const btn    = $("#btnEditorTranscribe");
  const status = $("#evsStatus");
  btn.disabled = true; btn.textContent = "Transcribing...";
  status.classList.remove("hidden");
  status.textContent = "Running Whisper... this may take a few minutes.";

  try {
    const result = await api("/api/subtitle/transcribe", {
      path: editorVideoPath,
      model: $("#evsModel").value,
      language: $("#evsLanguage").value,
      word_timestamps: editorSubs.karaoke,
    });
    if (result.error) {
      status.textContent = "Error: " + result.error;
      btn.disabled = false; btn.textContent = "🎙️ Transcribe"; return;
    }

    const poll = setInterval(async () => {
      const job = await api("/api/job/" + result.job_id);
      if (job.status === "done" && job.result) {
        clearInterval(poll);
        editorSubs.segments = job.result.segments;
        // Mark video as transcribed
        const av = getActiveVideo();
        if (av) {
          av.subtitles.segments = job.result.segments;
          av.subtitles.transcribed = true;
        }
        renderEvsTranscript();
        $("#btnEditorBurnSubs").disabled = false;
        $("#evsSegCount").textContent = editorSubs.segments.length;
        btn.disabled = false; btn.textContent = "🎙️ Transcribe";
        status.classList.add("hidden");
        renderMultiTrackTimeline();
        renderVideoList();
        toast(`${editorSubs.segments.length} segments ✓`, "success");
      } else if (job.status === "error") {
        clearInterval(poll);
        status.textContent = "Error: " + job.error;
        btn.disabled = false; btn.textContent = "🎙️ Transcribe";
      } else {
        status.textContent = job.current || "Transcribing...";
      }
    }, 2000);
  } catch (e) {
    status.textContent = "Error: " + e.message;
    btn.disabled = false; btn.textContent = "🎙️ Transcribe";
  }
});

// ── Render transcript ─────────────────────────────────────
function renderEvsTranscript() {
  const list = $("#evsTranscript");
  if (!list) return;
  list.innerHTML = "";
  if (editorSubs.segments.length === 0) {
    list.innerHTML = '<div class="empty-hint-sm">Transcribe to see segments</div>';
    return;
  }
  editorSubs.segments.forEach((seg, i) => {
    const div = document.createElement("div");
    div.className = "evs-seg-item";
    div.dataset.idx = i;
    div.innerHTML = `
      <span class="evs-seg-ts">${fmtTime(seg.start)}</span>
      <span class="evs-seg-text" contenteditable="true" spellcheck="false">${seg.text}</span>`;
    div.querySelector(".evs-seg-ts").addEventListener("click", () => {
      evsVideo.currentTime = seg.start; evsVideo.pause();
      syncEvsOverlay();
    });
    const textEl = div.querySelector(".evs-seg-text");
    textEl.addEventListener("input", () => {
      editorSubs.segments[i].text = textEl.textContent.trim();
      editorSubs.segments[i].words = []; // stale after manual edit
      if (editorSubs.activeIdx === i) syncEvsOverlay();
    });
    textEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); textEl.blur(); }
    });
    list.appendChild(div);
  });
}

// ── Burn subtitles (full style — same quality as standalone export) ───
function hexToAssEvs(hex) {
  const h = hex.replace("#", "");
  return `&H00${h.slice(4,6)}${h.slice(2,4)}${h.slice(0,2)}`.toUpperCase();
}

$("#btnEditorBurnSubs").addEventListener("click", async () => {
  if (!editorVideoPath || editorSubs.segments.length === 0) {
    toast("Transcribe first", "error"); return;
  }
  const btn    = $("#btnEditorBurnSubs");
  const status = $("#evsExportStatus");
  btn.disabled = true; btn.textContent = "Burning...";
  status.classList.remove("hidden");
  status.innerHTML = '<span style="color:var(--accent)">Burning subtitles into video...</span>';

  const exportStyle = {
    font_size:       editorSubs.style.font_size,
    position_x_pct: editorSubs.style.position_x_pct,
    position_y_pct: editorSubs.style.position_y_pct,
    max_width_pct:   editorSubs.style.max_width_pct || 86,
    primary_color:   hexToAssEvs(editorSubs.style.font_color   || "#ffffff"),
    outline_color:   hexToAssEvs(editorSubs.style.outline_color || "#000000"),
    highlight_color: hexToAssEvs(editorSubs.style.highlight_color || "#ffdd00"),
    dim_color:       "&H80FFFFFF",
    outline_width:   editorSubs.style.outline_width ?? 2.5,
    border_style:    editorSubs.style.border_style  || 1,
    back_color:      editorSubs.style.back_color    || null,
    back_alpha:      editorSubs.style.back_alpha    || 0,
    animation:       editorSubs.style.animation     || "none",
  };

  try {
    const result = await api("/api/subtitle/burn", {
      path: editorVideoPath,
      segments: editorSubs.segments,
      style: exportStyle,
    });
    if (result.error) {
      status.innerHTML = `<span style="color:var(--red)">${result.error}</span>`;
      btn.disabled = false; btn.textContent = "📼 Burn Subtitles"; return;
    }
    const poll = setInterval(async () => {
      const job = await api("/api/job/" + result.job_id);
      if (job.status === "done" && job.result) {
        clearInterval(poll);
        btn.disabled = false; btn.textContent = "📼 Burn Subtitles";
        status.innerHTML = `<span style="color:var(--green)">Done! Output: ${job.result.output.split("/").pop()}</span>`;
        toast("Subtitles burned ✓", "success");
      } else if (job.status === "error") {
        clearInterval(poll);
        btn.disabled = false; btn.textContent = "📼 Burn Subtitles";
        status.innerHTML = `<span style="color:var(--red)">${job.error}</span>`;
      } else {
        status.innerHTML = `<span style="color:var(--accent)">${job.current || "Burning..."}</span>`;
      }
    }, 2000);
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
    btn.disabled = false; btn.textContent = "📼 Burn Subtitles";
  }
});

// ── Smart Analyzer ───────────────────────────────────────
$("#btnAnalyze").addEventListener("click", async () => {
  if (!state.editorInfo || !editorVideoPath) {
    toast("Load a video first", "error"); return;
  }

  const panel = $("#analyzePanel");
  const status = $("#analyzeStatus");
  const clipsDiv = $("#analyzeClips");

  panel.classList.remove("hidden");
  status.textContent = "⏳ Transcribing + analyzing...";
  clipsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">🧠 Downloading Whisper model + analyzing audio...<br><small>The first run downloads ~1.5GB. After that it is fast.</small></div>';

  try {
    const result = await api("/api/analyze", {
      path: editorVideoPath,
      top_n: 10,
      min_duration: 15,
      max_duration: 120,
    });

    if (result.error) {
      status.textContent = "❌ " + result.error;
      return;
    }

    const jobId = result.job_id;
    const poll = setInterval(async () => {
      const job = await api("/api/job/" + jobId);
      if (job.status === "done") {
        clearInterval(poll);
        if (job.result && job.result.clips && job.result.clips.length > 0) {
          status.textContent = `✅ ${job.result.total} smart clips found`;
          renderSmartClips(job.result.clips);
        } else {
          status.textContent = "⚠️ No clips found — try a longer video (min 15s)";
          clipsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:var(--yellow)">No engaging clips detected. Try a longer video with more speech.</div>';
        }
      } else if (job.status === "error") {
        clearInterval(poll);
        status.textContent = "❌ " + (job.error || "Analysis failed");
        clipsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red)">Error: ' + (job.error || "Unknown") + '</div>';
      } else if (job.status === "running") {
        status.textContent = "⏳ " + (job.current || "Analyzing...");
      }
    }, 2000);
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  }
});

function renderSmartClips(clips) {
  const container = $("#analyzeClips");
  container.innerHTML = "";

  clips.forEach((clip, i) => {
    const div = document.createElement("div");
    div.className = "analyze-clip";
    div.innerHTML = `
      <div class="ac-rank">#${i + 1}</div>
      <div class="ac-info">
        <div class="ac-time">${fmtTime(clip.start)} → ${fmtTime(clip.end)} (${clip.duration}s)</div>
        <div class="ac-text">${clip.transcript?.substring(0, 120) || ""}</div>
        ${(clip.reasons || []).map(r => `<span class="ac-reason">${r}</span>`).join("")}
      </div>
      <div class="ac-score">⭐ ${clip.engagement}</div>
      <button class="ac-cut-btn">✂️ Cut</button>
    `;

    div.querySelector(".ac-cut-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await smartCut(clip);
    });

    container.appendChild(div);
  });
}

async function smartCut(clip) {
  $("#btnAnalyze").disabled = true;
  try {
    const label = `smart_${fmtTime(clip.start).replace(/:/g, "-")}`;
    const result = await api("/api/local/cut", {
      path: editorVideoPath,
      start: clip.start,
      end: clip.end,
      label: label,
    });

    if (result.ok) {
      state.editorClips.push({
        label,
        start: clip.start,
        end: clip.end,
        file: result.filename,
        size: result.size_mb,
      });
      renderEditorClips();
      toast(`Smart clip "${label}" cut! ✓`, "success");
    } else {
      toast(result.error || "Cut failed", "error");
    }
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
  $("#btnAnalyze").disabled = false;
}

// ── Deps check ───────────────────────────────────────────
$("#btnDeps").addEventListener("click", async () => {
  const deps = await api("/api/deps");
  const status = Object.entries(deps).map(([k, v]) => `${k}: ${v.ok ? "✓" : "✗"}`).join("  ");
  toast("Dependencies: " + status);
});

// ═══════════════════════════════════════════════════════════
//  COMMAND PANEL — Natural language actions
// ═══════════════════════════════════════════════════════════

let cmdPollInterval = null;
let processingHistory = [];  // [{action, label, filename, path}]
let currentWorkingFile = null;  // {path, filename} currently in the editor player

// Show panel when video is loaded
function showCmdPanel() {
  $("#cmdPanel").classList.remove("hidden");
}

// Hide panel when no video
function hideCmdPanel() {
  $("#cmdPanel").classList.add("hidden");
}

// ── Working video pipeline ────────────────────────────────
function updateWorkingVideo(outputPath, filename, action, rawCmd) {
  const actionLabels = {
    enhance_audio: "🎙️ Voz mejorada",
    remove_silence: "🔇 Silencios quitados",
    change_speed: "⏩ Velocidad",
    reverse: "🔄 Invertido",
    trim_start: "✂️ Recorte inicio",
    trim_end: "✂️ Recorte final",
    cut_range: "✂️ Clip extraído",
    burn_subtitles: "📼 Subtítulos",
  };

  // Update current working file
  const fname = filename || outputPath.split("/").pop();
  currentWorkingFile = { path: outputPath, filename: fname };

  // Update the editor state so cut/analyze use the processed file
  editorVideoPath = outputPath;
  editorVideoFilename = fname;

  // Set playerSrc so loadActiveVideoIntoPlayer uses the correct endpoint (output dir, not uploads)
  const av = getActiveVideo();
  if (av) {
    av.playerSrc = `/api/serve-output/${fname}?t=${Date.now()}`;
    // Sync all timeline clips that reference this video
    timelineClips.forEach(c => {
      if (c.videoId === av.id) {
        c.path = outputPath;
        c.filename = fname;
        c.playerSrc = av.playerSrc;
      }
    });
  }

  // Reload video player
  const vid = $("#editorVideo");
  const wasPlaying = !vid.paused;
  const currentTime = vid.currentTime;
  vid.src = `/api/serve-output/${fname}?t=${Date.now()}`;
  vid.load();
  vid.addEventListener("loadedmetadata", function seek() {
    vid.currentTime = Math.min(currentTime, vid.duration || 0);
    if (wasPlaying) vid.play();
    vid.removeEventListener("loadedmetadata", seek);
  }, { once: true }); // BUG FIX: was `false`, must be `true` to avoid stacking listeners

  // Add to history
  processingHistory.push({
    action,
    label: actionLabels[action] || action,
    rawCmd,
    filename: fname,
    path: outputPath,
  });
  renderProcessingHistory();

  // Reset clips and timeline (video file changed)
  state.editorClips = [];
  renderEditorClips();
  state.editorInfo = null;
  $("#editorTimeline").innerHTML = '<div class="tl-placeholder">Click <strong>Thumbnails</strong> to update</div>';

  // BUG FIX: only reset subtitles if the action changes timing.
  // enhance_audio only re-encodes audio — video timing is unchanged,
  // so existing subtitles remain valid.
  const TIMING_SAFE_ACTIONS = ["enhance_audio"];
  if (!TIMING_SAFE_ACTIONS.includes(action)) {
    editorSubs.segments = [];
    editorSubs.activeIdx = -1;
    renderEvsTranscript();
    $("#btnEditorBurnSubs").disabled = true;
    $("#evsSegCount").textContent = "0";
  }
}

function renderProcessingHistory() {
  const container = $("#processingStack");
  if (!container) return;

  if (processingHistory.length === 0) {
    container.innerHTML = '<div class="empty-hint-sm">No operations yet</div>';
  } else {
    container.innerHTML = processingHistory.map((h, i) => `
      <div class="proc-item">
        <span class="proc-step">${i + 1}</span>
        <div>
          <div class="proc-label">${h.label}</div>
          <div class="proc-cmd">${h.rawCmd}</div>
        </div>
      </div>`).join("");
  }

  const exportBtn = $("#btnExportFinal");
  if (exportBtn) exportBtn.disabled = timelineClips.length === 0;
}

async function exportAllVideos() {
  if (timelineClips.length === 0) { toast("Nothing to export", "error"); return; }

  const btn = $("#btnExportFinal");
  const resultDiv = $("#cmdResult");
  btn.disabled = true;
  btn.textContent = "Exporting...";
  resultDiv.classList.remove("hidden");
  resultDiv.innerHTML = '<span style="color:var(--accent)">⏳ Processing all videos...</span>';

  try {
    // Build payload from timeline clips (ordered sequence with per-clip trim)
    const payload = timelineClips.map(c => ({
      path: c.path,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      subtitles: c.subtitles?.transcribed ? {
        segments: c.subtitles.segments,
        style: {
          font_size: editorSubs.style.font_size,
          position_x_pct: editorSubs.style.position_x_pct,
          position_y_pct: editorSubs.style.position_y_pct,
          max_width_pct: editorSubs.style.max_width_pct || 86,
          primary_color: editorSubs.style.font_color || "#ffffff",
          outline_color: editorSubs.style.outline_color || "#000000",
          highlight_color: editorSubs.style.highlight_color || "#ffdd00",
          dim_color: "#80FFFFFF",
          outline_width: editorSubs.style.outline_width ?? 2.5,
          border_style: editorSubs.style.border_style || 1,
          back_color: editorSubs.style.back_color || null,
          back_alpha: editorSubs.style.back_alpha || 0,
          animation: editorSubs.style.animation || "none",
        }
      } : null,
    }));

    const overlayPayload = overlayClips.map(ov => ({
      path: ov.path,
      trimStart: ov.trimStart,
      trimEnd: ov.trimEnd,
      timelineStart: ov.timelineStart,
      timelineEnd: ov.timelineEnd,
      x_pct: ov.x,
      y_pct: ov.y,
      width_pct: ov.width,
      audioEnabled: ov.audioEnabled,
    }));
    const concatResult = await api("/api/export/concat", {
      videos: payload,
      overlays: overlayPayload,
      output_format: activeFormat !== "free" ? activeFormat : null,
    });

    if (concatResult.error) {
      throw new Error(concatResult.error);
    }

    // Poll for completion
    const jobResult = await new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        const job = await api("/api/job/" + concatResult.job_id);
        if (job.status === "done" && job.result) {
          clearInterval(poll);
          resolve(job.result);
        } else if (job.status === "error") {
          clearInterval(poll);
          reject(new Error(job.error));
        } else {
          resultDiv.innerHTML = `<span style="color:var(--accent)">⏳ ${job.current || "Processing..."}</span>`;
        }
      }, 1500);
    });

    const subsCount = timelineClips.filter(c => c.subtitles?.transcribed).length;
    resultDiv.classList.add("success");
    resultDiv.innerHTML = `
      <div class="cmd-msg">✅ ${jobResult.video_count} videos concatenados</div>
      <div class="cmd-detail">📁 ${jobResult.filename}</div>
      <div class="cmd-detail">📦 ${fmtSize(jobResult.size_mb)}</div>
      ${subsCount > 0 ? `<div class="cmd-detail" style="color:var(--green)">💬 ${subsCount} videos with subtitles</div>` : ""}
      <div class="cmd-detail" style="font-size:10px;opacity:0.7">📂 ~/Desktop/yt-clipper-output/</div>
      <button class="btn btn-sm" style="margin-top:6px" onclick="fetch('/api/open-output',{method:'POST'})">📂 Open output folder</button>
    `;
    toast(`Exported ${jobResult.video_count} videos ✓`, "success");
  } catch (e) {
    resultDiv.classList.add("error");
    resultDiv.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
    toast("Error: " + e.message, "error");
  }
  btn.disabled = false;
  btn.textContent = "🚀 Export All";
}

$("#btnCmdRun").addEventListener("click", runCommand);
$("#cmdInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runCommand();
});

// Toolbar cmd-button clicks
$$(".tool-cmd").forEach(btn => {
  btn.addEventListener("click", () => {
    $("#cmdInput").value = btn.dataset.cmd;
    runCommand();
  });
});

async function runCommand() {
  const input = $("#cmdInput");
  const text = input.value.trim();
  if (!text) return;
  if (!editorVideoPath) {
    toast("Load a video in the Editor tab first", "error");
    return;
  }

  const btn = $("#btnCmdRun");
  const resultDiv = $("#cmdResult");

  btn.disabled = true;
  btn.textContent = "...";
  resultDiv.classList.remove("hidden", "success", "error");
  resultDiv.innerHTML = `<span style="color:var(--accent)">⏳ Procesando: "${text}"</span>`;

  try {
    const result = await api("/api/cmd/run", {
      text,
      path: editorVideoPath,
    });

    if (result.error) {
      resultDiv.classList.add("error");
      resultDiv.innerHTML = `<span style="color:var(--red)">❌ ${result.error}</span>`;
      btn.disabled = false;
      btn.textContent = "Ejecutar";
      return;
    }

    // Poll for job completion
    if (cmdPollInterval) clearInterval(cmdPollInterval);
    const jobId = result.job_id;
    const parsed = result.parsed;

    cmdPollInterval = setInterval(async () => {
      const job = await api("/api/job/" + jobId);
      if (job.status === "done" && job.result) {
        clearInterval(cmdPollInterval);
        cmdPollInterval = null;
        btn.disabled = false;
        btn.textContent = "Ejecutar";

        const r = job.result;
        if (r.ok) {
          resultDiv.classList.add("success");
          let html = `<div class="cmd-msg">✅ ${r.message || "Completado"}</div>`;
          if (r.output) {
            html += `<div class="cmd-detail">📁 ${r.filename || r.output.split("/").pop()}</div>`;
            html += `<div class="cmd-detail">📦 ${r.size_mb ? fmtSize(r.size_mb) : "—"}</div>`;

            // 🔄 Update editor to use processed file
            updateWorkingVideo(r.output, r.filename, parsed.action, text);
            html += `<div class="cmd-detail" style="color:var(--accent);margin-top:4px">🔄 Video actualizado en el editor</div>`;
          }
          if (r.size_mb) {
            html += `<div class="cmd-detail">📦 ${fmtSize(r.size_mb)}</div>`;
          }
          if (r.new_duration) {
            html += `<div class="cmd-detail">⏱ Original: ${fmtTime(r.original_duration)} → Ahora: ${fmtTime(r.new_duration)}</div>`;
          }
          if (r.preview) {
            html += `<div class="cmd-detail" style="margin-top:6px;white-space:pre-wrap;line-height:1.4">${r.preview}</div>`;
          }
          if (r.clips) {
            r.clips.forEach((c, i) => {
              html += `<div class="cmd-clip">
                <span class="cmd-clip-rank">#${i + 1}</span>
                <span class="cmd-clip-time">${fmtTime(c.start)} → ${fmtTime(c.end)}</span>
                <span class="cmd-clip-score">⭐ ${c.engagement}</span>
              </div>`;
            });
          }
          if (r.details && r.details.length) {
            html += `<div style="margin-top:6px;line-height:1.6">${r.details.map(d => `<div style="font-size:11px;color:var(--text-muted)">${d}</div>`).join("")}</div>`;
          }
          resultDiv.innerHTML = html;
          toast(r.message || "Done!", "success");
          // Clear input on success
          input.value = "";
        } else {
          resultDiv.classList.add("error");
          resultDiv.innerHTML = `<div class="cmd-msg">❌ ${r.error || "Failed"}</div>`;
        }
      } else if (job.status === "error") {
        clearInterval(cmdPollInterval);
        cmdPollInterval = null;
        btn.disabled = false;
        btn.textContent = "Ejecutar";
        resultDiv.classList.add("error");
        resultDiv.innerHTML = `<div class="cmd-msg">❌ ${job.error}</div>`;
      } else if (job.status === "running") {
        resultDiv.innerHTML = `<span style="color:var(--accent)">⏳ ${job.current || "Procesando..."}</span>`;
      }
    }, 1500);
  } catch (e) {
    resultDiv.classList.add("error");
    resultDiv.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
    btn.disabled = false;
    btn.textContent = "Ejecutar";
  }
}

// ── Export All ────────────────────────────────────────
$("#btnExportFinal").addEventListener("click", exportAllVideos);

// ── Format selector ───────────────────────────────────
document.querySelectorAll(".fmt-btn").forEach(btn => {
  btn.addEventListener("click", () => setCanvasFormat(btn.dataset.format));
});
// Apply default format on load
setCanvasFormat(activeFormat);

// ── Init ─────────────────────────────────────────────────
console.log("YT Clipper ready ✂️ | YouTube · Subtitles · Editor");
