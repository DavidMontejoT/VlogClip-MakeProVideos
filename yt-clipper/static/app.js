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

let subVideoPath = "";
let subUploadedFilename = "";
let subSegments = [];
let subKaraokeMode = false;
let subStyle = { position_x_pct: 0.5, position_y_pct: 0.85, font_size: 24, font_color: "#ffffff", outline_color: "#000000", outline_width: 2.5, border_style: 1, back_color: null, back_alpha: 0, highlight_color: "#ffdd00", animation: "none" };
let subDragging = false;
let subDragOffset = { x: 0, y: 0 };
let subActiveSegIndex = -1;

// ── Phase 1: Upload ───────────────────────────────────────

setupDropZone("subDropZone", "subFileInput", (result) => {
  subVideoPath = result.path;
  subUploadedFilename = result.filename;
  $("#subVideoPath").value = result.filename;
  $("#subPathRow").classList.remove("hidden");
});

$("#btnClearSub").addEventListener("click", () => {
  subVideoPath = "";
  subUploadedFilename = "";
  $("#subVideoPath").value = "";
  $("#subPathRow").classList.add("hidden");
  resetDropZone("subDropZone");
  $("#subStatus").classList.add("hidden");
  $("#subPreviewPanel").classList.add("hidden");
});

// ── Transcribe ────────────────────────────────────────────

$("#btnTranscribe").addEventListener("click", async () => {
  if (!subVideoPath) { toast("Upload a video first", "error"); return; }

  const model = $("#subModel").value;
  const language = $("#subLanguage").value;
  const btn = $("#btnTranscribe");

  btn.disabled = true;
  btn.textContent = "Transcribing...";
  $("#subStatus").classList.remove("hidden");
  $("#subStatus").innerHTML = '<span style="color:var(--accent)">Running Whisper... this may take a few minutes.</span>';
  $("#subPreviewPanel").classList.add("hidden");

  try {
    subKaraokeMode = $("#subKaraokeToggle").checked;
    const result = await api("/api/subtitle/transcribe", {
      path: subVideoPath, model, language,
      word_timestamps: subKaraokeMode,
    });
    if (result.error) {
      $("#subStatus").innerHTML = `<span style="color:var(--red)">${result.error}</span>`;
      btn.disabled = false; btn.textContent = "Transcribe";
      return;
    }

    const jobId = result.job_id;
    const poll = setInterval(async () => {
      const job = await api("/api/job/" + jobId);
      if (job.status === "done" && job.result) {
        clearInterval(poll);
        subSegments = job.result.segments;
        showTranscriptPreview(subSegments);
        btn.disabled = false; btn.textContent = "Transcribe";
        $("#subStatus").classList.add("hidden");
        setTimeout(showSubEditor, 300);
      } else if (job.status === "error") {
        clearInterval(poll);
        $("#subStatus").innerHTML = `<span style="color:var(--red)">${job.error}</span>`;
        btn.disabled = false; btn.textContent = "Transcribe";
      } else {
        $("#subStatus").innerHTML = `<span style="color:var(--accent)">${job.current || "Transcribing..."}</span>`;
      }
    }, 2000);
  } catch (e) {
    toast("Error: " + e.message, "error");
    btn.disabled = false; btn.textContent = "Transcribe";
  }
});

function showTranscriptPreview(segments) {
  $("#subPreviewPanel").classList.remove("hidden");
  $("#subTranscript").innerHTML = segments.map(seg => `
    <div class="sub-line">
      <span class="sub-ts">${fmtTime(seg.start)}</span>
      <span class="sub-txt">${seg.text}</span>
    </div>
  `).join("");
}

// ── Phase 2: Visual Editor ────────────────────────────────

function showSubEditor() {
  $("#subPhase1").classList.add("hidden");
  $("#subPhase2").classList.remove("hidden");

  const vid = $("#subVideo");
  vid.src = `/api/uploads/${subUploadedFilename}`;
  vid.load();

  subStyle = { position_x_pct: 0.5, position_y_pct: 0.85, font_size: 24, font_color: "#ffffff", outline_color: "#000000", outline_width: 2.5, border_style: 1, back_color: null, back_alpha: 0, highlight_color: "#ffdd00", animation: "none" };
  $$(".sub-anim-btn").forEach(b => b.classList.toggle("sub-anim-active", b.dataset.anim === "none"));
  $("#subHighlightRow").classList.toggle("hidden", !subKaraokeMode);
  renderSubPresets();
  updateSubOverlayPosition();
  updateSubOverlayStyle();
  renderSubSegments();
  $("#subSegCount").textContent = subSegments.length;
  $("#subExportStatus").classList.add("hidden");
}

function renderSubPresets() {
  const container = $("#subPresets");
  container.innerHTML = "";
  SUB_PRESETS.forEach((preset, i) => {
    const card = document.createElement("div");
    card.className = "sub-preset-card" + (i === 0 ? " sub-preset-active" : "");
    card.dataset.id = preset.id;
    const p = preset.preview;
    card.innerHTML = `
      <div class="sub-preset-preview" style="background:${p.bg};${p.boxBg ? "padding:2px 5px;border-radius:2px;" : ""}">
        <span style="color:${p.color};text-shadow:${p.shadow || "none"};font-weight:${p.bold ? 900 : 700};font-size:13px">Abc</span>
      </div>
      <span class="sub-preset-name">${preset.name}</span>
    `;
    card.addEventListener("click", () => applySubPreset(preset));
    container.appendChild(card);
  });
}

function applySubPreset(preset) {
  subStyle.font_size = preset.font_size;
  subStyle.font_color = preset.font_color;
  subStyle.outline_color = preset.outline_color;
  subStyle.outline_width = preset.outline_width;
  subStyle.border_style = preset.border_style;
  subStyle.back_color = preset.back_color;
  subStyle.back_alpha = preset.back_alpha || 0;

  $("#subFontSizeSlider").value = preset.font_size;
  $("#subFontSizeLabel").textContent = preset.font_size;
  $("#subColorPicker").value = preset.font_color;

  document.querySelectorAll(".sub-preset-card").forEach(c => c.classList.remove("sub-preset-active"));
  document.querySelector(`.sub-preset-card[data-id="${preset.id}"]`)?.classList.add("sub-preset-active");

  updateSubOverlayStyle();
}

$("#btnBackSub").addEventListener("click", () => {
  $("#subPhase2").classList.add("hidden");
  $("#subPhase1").classList.remove("hidden");
  const vid = $("#subVideo");
  vid.pause();
  vid.src = "";
});

// ── Video Playback ────────────────────────────────────────

const subVideo = $("#subVideo");

subVideo.addEventListener("loadedmetadata", () => {
  $("#subSeekBar").max = Math.floor(subVideo.duration * 10);
  updateSubTime();
});

subVideo.addEventListener("timeupdate", () => {
  if (!subVideo.paused) $("#subSeekBar").value = Math.floor(subVideo.currentTime * 10);
  updateSubTime();
  syncSubtitleOverlay();
});

subVideo.addEventListener("play",  () => { $("#subPlayBtn").innerHTML = "&#9646;&#9646;"; });
subVideo.addEventListener("pause", () => { $("#subPlayBtn").innerHTML = "&#9654;"; });

$("#subPlayBtn").addEventListener("click", () => {
  if (subVideo.paused) subVideo.play(); else subVideo.pause();
});

$("#subSeekBar").addEventListener("input", () => {
  subVideo.currentTime = $("#subSeekBar").value / 10;
});

function updateSubTime() {
  const cur = fmtTime(Math.floor(subVideo.currentTime || 0));
  const dur = isNaN(subVideo.duration) ? "0:00" : fmtTime(Math.floor(subVideo.duration));
  $("#subTimeLabel").textContent = `${cur} / ${dur}`;
}

function syncSubtitleOverlay() {
  const t = subVideo.currentTime;
  let activeIdx = -1;
  for (let i = 0; i < subSegments.length; i++) {
    if (t >= subSegments[i].start && t <= subSegments[i].end) { activeIdx = i; break; }
  }

  const previewEl = $("#subPreviewText");
  const seg = activeIdx >= 0 ? subSegments[activeIdx] : null;

  if (!seg) {
    previewEl.innerHTML = "";
  } else if (subKaraokeMode && seg.words && seg.words.length > 0) {
    // Word-by-word karaoke preview
    const activeWord = seg.words.find(w => t >= w.start && t <= w.end);
    const hlColor = subStyle.highlight_color || "#ffdd00";
    const html = seg.words.map(w => {
      const isActive = activeWord && w.start === activeWord.start;
      return isActive
        ? `<span style="color:${hlColor}">${w.word}</span>`
        : `<span style="opacity:0.5">${w.word}</span>`;
    }).join(" ");
    previewEl.innerHTML = html;
  } else {
    previewEl.textContent = seg.text;
  }

  if (activeIdx !== subActiveSegIndex) {
    subActiveSegIndex = activeIdx;
    document.querySelectorAll(".sub-seg-item").forEach((el, i) => {
      el.classList.toggle("sub-seg-active", i === activeIdx);
    });
    if (activeIdx >= 0) {
      const el = $(`.sub-seg-item[data-idx="${activeIdx}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      triggerSubtitleAnimation();
    }
  }
}

// ── Subtitle Overlay ──────────────────────────────────────

function updateSubOverlayPosition() {
  const handle = $("#subDragHandle");
  handle.style.left = (subStyle.position_x_pct * 100) + "%";
  handle.style.top  = (subStyle.position_y_pct * 100) + "%";
}

function updateSubOverlayStyle() {
  const text = $("#subPreviewText");
  const handle = $("#subDragHandle");
  const size = subStyle.font_size || 24;
  const color = subStyle.font_color || "#ffffff";
  const oc = subStyle.outline_color || "#000000";
  const ow = subStyle.outline_width ?? 2.5;

  text.style.fontSize = size + "px";
  text.style.color = color;

  if (ow > 0) {
    const s = Math.round(ow);
    text.style.textShadow = `${s}px ${s}px 0 ${oc},${-s}px ${-s}px 0 ${oc},${s}px ${-s}px 0 ${oc},${-s}px ${s}px 0 ${oc}`;
  } else {
    text.style.textShadow = "none";
  }

  if (subStyle.back_color && subStyle.border_style === 3) {
    const h = subStyle.back_color.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = 1 - (subStyle.back_alpha || 0);
    handle.style.background = `rgba(${r},${g},${b},${a})`;
    handle.style.padding = "4px 12px";
    handle.style.borderRadius = "3px";
  } else {
    handle.style.background = "transparent";
    handle.style.padding = "4px 8px";
  }
}

// ── Drag ─────────────────────────────────────────────────

const dragHandle = $("#subDragHandle");

dragHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  subDragging = true;
  const rect = dragHandle.getBoundingClientRect();
  subDragOffset.x = e.clientX - rect.left - rect.width / 2;
  subDragOffset.y = e.clientY - rect.top  - rect.height / 2;
  dragHandle.style.cursor = "grabbing";
});

document.addEventListener("mousemove", (e) => {
  if (!subDragging) return;
  const wrap = $("#subVideoWrap");
  const r = wrap.getBoundingClientRect();
  subStyle.position_x_pct = Math.max(0.05, Math.min(0.95, (e.clientX - subDragOffset.x - r.left) / r.width));
  subStyle.position_y_pct = Math.max(0.05, Math.min(0.95, (e.clientY - subDragOffset.y - r.top)  / r.height));
  updateSubOverlayPosition();
});

document.addEventListener("mouseup", () => {
  if (subDragging) { subDragging = false; dragHandle.style.cursor = "grab"; }
});

dragHandle.addEventListener("touchstart", (e) => {
  subDragging = true;
  const t = e.touches[0];
  const rect = dragHandle.getBoundingClientRect();
  subDragOffset.x = t.clientX - rect.left - rect.width / 2;
  subDragOffset.y = t.clientY - rect.top  - rect.height / 2;
  e.preventDefault();
}, { passive: false });

document.addEventListener("touchmove", (e) => {
  if (!subDragging) return;
  const t = e.touches[0];
  const wrap = $("#subVideoWrap");
  const r = wrap.getBoundingClientRect();
  subStyle.position_x_pct = Math.max(0.05, Math.min(0.95, (t.clientX - subDragOffset.x - r.left) / r.width));
  subStyle.position_y_pct = Math.max(0.05, Math.min(0.95, (t.clientY - subDragOffset.y - r.top)  / r.height));
  updateSubOverlayPosition();
  e.preventDefault();
}, { passive: false });

document.addEventListener("touchend", () => { subDragging = false; });

// ── Style Controls ────────────────────────────────────────

$("#subFontSizeSlider").addEventListener("input", (e) => {
  subStyle.font_size = parseInt(e.target.value);
  $("#subFontSizeLabel").textContent = e.target.value;
  updateSubOverlayStyle();
});

$("#subColorPicker").addEventListener("input", (e) => {
  subStyle.font_color = e.target.value;
  updateSubOverlayStyle();
});

$("#subHighlightPicker").addEventListener("input", (e) => {
  subStyle.highlight_color = e.target.value;
});

document.querySelectorAll(".sub-pos-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sub-pos-btn").forEach(b => b.classList.remove("sub-pos-active"));
    btn.classList.add("sub-pos-active");
    subStyle.position_y_pct = parseFloat(btn.dataset.y);
    updateSubOverlayPosition();
  });
});

document.querySelectorAll(".sub-anim-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sub-anim-btn").forEach(b => b.classList.remove("sub-anim-active"));
    btn.classList.add("sub-anim-active");
    subStyle.animation = btn.dataset.anim;
    triggerSubtitleAnimation();
  });
});

function triggerSubtitleAnimation() {
  const handle = $("#subDragHandle");
  handle.classList.remove("sub-anim-fade", "sub-anim-slide", "sub-anim-pop");
  void handle.offsetWidth; // force reflow to restart animation
  if (subStyle.animation && subStyle.animation !== "none") {
    handle.classList.add(`sub-anim-${subStyle.animation}`);
  }
}

// ── Transcript Segment Editor ─────────────────────────────

function renderSubSegments() {
  const list = $("#subSegmentsList");
  list.innerHTML = "";
  subSegments.forEach((seg, i) => {
    const div = document.createElement("div");
    div.className = "sub-seg-item";
    div.dataset.idx = i;
    div.innerHTML = `
      <span class="sub-seg-ts">${fmtTime(seg.start)}</span>
      <span class="sub-seg-text" contenteditable="true" spellcheck="false">${seg.text}</span>
    `;
    div.querySelector(".sub-seg-ts").addEventListener("click", () => {
      subVideo.currentTime = seg.start;
      subVideo.pause();
      syncSubtitleOverlay();
    });
    const textEl = div.querySelector(".sub-seg-text");
    textEl.addEventListener("input", () => {
      subSegments[i].text = textEl.textContent.trim();
      subSegments[i].words = [];  // word timing becomes stale after manual edit
      if (subActiveSegIndex === i) syncSubtitleOverlay();
    });
    textEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); textEl.blur(); }
    });
    list.appendChild(div);
  });
}

// ── Export ────────────────────────────────────────────────

function hexToAss(hex) {
  const h = hex.replace("#", "");
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

$("#btnExportSubs").addEventListener("click", async () => {
  if (!subVideoPath || subSegments.length === 0) { toast("Nothing to export", "error"); return; }

  const statusEl = $("#subExportStatus");
  const btn = $("#btnExportSubs");

  btn.disabled = true; btn.textContent = "Exporting...";
  statusEl.classList.remove("hidden");
  statusEl.innerHTML = '<span style="color:var(--accent)">Burning subtitles into video...</span>';

  const exportStyle = {
    font_size: subStyle.font_size,
    position_x_pct: subStyle.position_x_pct,
    position_y_pct: subStyle.position_y_pct,
    primary_color:   hexToAss(subStyle.font_color      || "#ffffff"),
    outline_color:   hexToAss(subStyle.outline_color   || "#000000"),
    highlight_color: hexToAss(subStyle.highlight_color || "#ffdd00"),
    dim_color: "&H80FFFFFF",
    outline_width: subStyle.outline_width ?? 2.5,
    border_style: subStyle.border_style || 1,
    back_color: subStyle.back_color || null,
    back_alpha: subStyle.back_alpha || 0,
    animation: subStyle.animation || "none",
  };

  try {
    const result = await api("/api/subtitle/burn", {
      path: subVideoPath,
      segments: subSegments,
      style: exportStyle,
    });

    if (result.error) {
      statusEl.innerHTML = `<span style="color:var(--red)">${result.error}</span>`;
      btn.disabled = false; btn.textContent = "Export & Burn";
      return;
    }

    const poll = setInterval(async () => {
      const job = await api("/api/job/" + result.job_id);
      if (job.status === "done" && job.result) {
        clearInterval(poll);
        statusEl.innerHTML = `
          <span style="color:var(--green)">Done! ${job.result.count} subtitles burned.</span><br>
          <span style="font-size:11px;color:var(--text-muted)">Output: ${job.result.output}</span>
        `;
        btn.disabled = false; btn.textContent = "Export & Burn";
        toast("Exported successfully!", "success");
      } else if (job.status === "error") {
        clearInterval(poll);
        statusEl.innerHTML = `<span style="color:var(--red)">${job.error}</span>`;
        btn.disabled = false; btn.textContent = "Export & Burn";
      } else {
        statusEl.innerHTML = `<span style="color:var(--accent)">${job.current || "Burning..."}</span>`;
      }
    }, 2000);
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
    btn.disabled = false; btn.textContent = "Export & Burn";
  }
});

// ═══════════════════════════════════════════════════════════
//  MODULE: Editor
// ═══════════════════════════════════════════════════════════

let editorVideoPath = "";

// Setup drop zone
setupDropZone("editorDropZone", "editorFileInput", (result) => {
  editorVideoPath = result.path;
  $("#editorVideoPath").value = result.filename;
  $("#editorPathRow").classList.remove("hidden");
});

$("#btnClearEditor").addEventListener("click", () => {
  editorVideoPath = "";
  $("#editorVideoPath").value = "";
  $("#editorPathRow").classList.add("hidden");
  resetDropZone("editorDropZone");
  $("#editorMain").classList.add("hidden");
});

$("#btnLoadLocal").addEventListener("click", async () => {
  const path = editorVideoPath;
  if (!path) { toast("Enter a video path", "error"); return; }

  $("#btnLoadLocal").disabled = true;
  $("#btnLoadLocal").textContent = "Loading...";

  try {
    const info = await api("/api/local/info", { path });
    if (info.error) { toast(info.error, "error"); return; }
    state.editorInfo = info;
    state.editorInfo.path = editorVideoPath;

    $("#editorMain").classList.remove("hidden");
    $("#editorInfo").innerHTML = `
      <span>📁 ${info.filename}</span>
      <span>⏱ ${fmtTime(info.duration)}</span>
      <span>🎥 ${info.video?.width || "?"}×${info.video?.height || "?"}</span>
      <span>📦 ${info.size_mb} MB</span>
    `;
    toast(`Loaded: ${info.filename}`, "success");

    // Auto-generate thumbnails
    await editorGenThumbs();
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
  $("#btnLoadLocal").disabled = false;
  $("#btnLoadLocal").textContent = "Load Video";
});

$("#btnGenThumbs").addEventListener("click", editorGenThumbs);

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
    timeline.style.display = "flex";
    timeline.style.flexWrap = "wrap";
    timeline.style.gap = "2px";

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
    return;
  }

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

  $("#btnEditorOpenOut").classList.remove("hidden");
}

$("#btnEditorOpenOut").addEventListener("click", async () => {
  await api("/api/open-output");
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

// ── Init ─────────────────────────────────────────────────
console.log("YT Clipper ready ✂️ | YouTube · Subtitles · Editor");
