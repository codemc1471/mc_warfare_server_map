(() => {
  "use strict";

  const SEED = "7748490339196353958";
  const VERSION = "Java 1.20.1";
  const MIN_COORD = -10000;
  const MAX_COORD = 10000;
  const WORLD_SIZE = MAX_COORD - MIN_COORD;
  const TILE_SIZE = 512;
  const STORAGE_KEY = `seed-terrain:pings:${SEED}:java-1.20.1`;
  const PING_COLORS = ["#ff6257", "#ffad42", "#f1d354", "#9bd366", "#4ed0a1", "#54b8ff", "#8177ff", "#dc6fe7", "#f58fbc", "#f4f4ef"];

  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const sourceBadge = document.getElementById("sourceBadge");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const cursorCoords = document.getElementById("cursorCoords");
  const chunkCoords = document.getElementById("chunkCoords");
  const centerCoords = document.getElementById("centerCoords");
  const zoomStatus = document.getElementById("zoomStatus");
  const pingDialog = document.getElementById("pingDialog");
  const pingForm = document.getElementById("pingForm");
  const pingList = document.getElementById("pingList");
  const pingEmpty = document.getElementById("pingEmpty");
  const sidebar = document.getElementById("sidebar");
  const toast = document.getElementById("toast");

  const state = {
    width: 1,
    height: 1,
    dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
    centerX: 0,
    centerZ: 0,
    pixelsPerBlock: 0.05,
    minPixelsPerBlock: 0.02,
    maxPixelsPerBlock: 2.5,
    source: null,
    imageCache: new Map(),
    pings: loadPings(),
    selectedPingId: null,
    editingPingId: null,
    grid: true,
    renderQueued: false,
    activePointers: new Map(),
    gesture: null,
    longPressTimer: null,
    longPressStart: null,
    movedDuringPointer: false,
    cursorWorld: { x: 0, z: 0 },
  };

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function rounded(value) { return Math.round(Number(value) || 0); }
  function chunkCoord(value) { return Math.floor(value / 16); }
  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadPings() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { /* cookie fallback below */ }
    if (!raw) {
      const match = document.cookie.split("; ").find((row) => row.startsWith(`${encodeURIComponent(STORAGE_KEY)}=`));
      if (match) raw = decodeURIComponent(match.split("=").slice(1).join("="));
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z)))
        .map((p) => ({
          id: String(p.id || uid()),
          name: String(p.name || "이름 없는 핑").slice(0, 40),
          x: clamp(rounded(p.x), MIN_COORD, MAX_COORD),
          z: clamp(rounded(p.z), MIN_COORD, MAX_COORD),
          color: PING_COLORS.includes(p.color) ? p.color : PING_COLORS[0],
          createdAt: Number(p.createdAt) || Date.now(),
        }));
    } catch (_) {
      return [];
    }
  }

  function savePings() {
    const raw = JSON.stringify(state.pings);
    let saved = false;
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      saved = true;
    } catch (_) { /* cookie fallback */ }
    if (!saved) {
      const compact = JSON.stringify(state.pings.slice(-35));
      document.cookie = `${encodeURIComponent(STORAGE_KEY)}=${encodeURIComponent(compact)}; max-age=31536000; path=/; SameSite=Lax`;
    }
    renderPingList();
    requestRender();
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    state.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    updateMinZoom();
    clampCenter();
    requestRender();
  }

  function updateMinZoom() {
    const sideAllowance = window.innerWidth > 760 ? 330 : 0;
    const usableWidth = Math.max(260, state.width - sideAllowance - 36);
    const usableHeight = Math.max(220, state.height - 120);
    state.minPixelsPerBlock = Math.min(usableWidth / WORLD_SIZE, usableHeight / WORLD_SIZE);
    state.pixelsPerBlock = clamp(state.pixelsPerBlock, state.minPixelsPerBlock, state.maxPixelsPerBlock);
  }

  function fitMap() {
    updateMinZoom();
    state.centerX = 0;
    state.centerZ = 0;
    state.pixelsPerBlock = state.minPixelsPerBlock;
    clampCenter();
    requestRender();
  }

  function clampCenter() {
    const halfW = state.width / (2 * state.pixelsPerBlock);
    const halfH = state.height / (2 * state.pixelsPerBlock);
    const maxCenterX = Math.max(0, WORLD_SIZE / 2 - Math.min(WORLD_SIZE / 2, halfW));
    const maxCenterZ = Math.max(0, WORLD_SIZE / 2 - Math.min(WORLD_SIZE / 2, halfH));
    state.centerX = clamp(state.centerX, -maxCenterX, maxCenterX);
    state.centerZ = clamp(state.centerZ, -maxCenterZ, maxCenterZ);
  }

  function worldToScreen(x, z) {
    return {
      x: state.width / 2 + (x - state.centerX) * state.pixelsPerBlock,
      y: state.height / 2 + (z - state.centerZ) * state.pixelsPerBlock,
    };
  }

  function screenToWorld(x, y) {
    return {
      x: state.centerX + (x - state.width / 2) / state.pixelsPerBlock,
      z: state.centerZ + (y - state.height / 2) / state.pixelsPerBlock,
    };
  }

  function visibleBounds() {
    const a = screenToWorld(0, 0);
    const b = screenToWorld(state.width, state.height);
    return {
      minX: Math.max(MIN_COORD, a.x),
      minZ: Math.max(MIN_COORD, a.z),
      maxX: Math.min(MAX_COORD, b.x),
      maxZ: Math.min(MAX_COORD, b.z),
    };
  }

  async function loadSource() {
    let manifest = null;
    try {
      const response = await fetch("./assets/tiles/manifest.json", { cache: "no-store" });
      if (response.ok) manifest = await response.json();
    } catch (_) { /* preview fallback */ }

    if (manifest?.levels?.length) {
      state.source = { type: "tiles", manifest };
      sourceBadge.textContent = "고도 지형도 20K";
      sourceBadge.className = "badge badge-exact";
      loadingOverlay.classList.add("is-hidden");
      requestRender();
      return;
    }

    const preview = new Image();
    preview.decoding = "async";
    preview.onload = () => {
      state.source = { type: "preview", image: preview, size: preview.naturalWidth };
      sourceBadge.textContent = "로컬 미리보기";
      sourceBadge.className = "badge badge-preview";
      loadingOverlay.classList.add("is-hidden");
      requestRender();
    };
    preview.onerror = () => {
      state.source = { type: "none" };
      sourceBadge.textContent = "지도 없음";
      sourceBadge.className = "badge badge-preview";
      loadingOverlay.classList.add("is-hidden");
      showToast("지형 이미지 파일을 찾지 못했습니다.");
      requestRender();
    };
    preview.src = "./assets/terrain-preview.webp";
  }

  function requestRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      render();
    });
  }

  function render() {
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.fillStyle = "#17201d";
    ctx.fillRect(0, 0, state.width, state.height);

    drawTerrain();
    drawWorldBoundary();
    if (state.grid) drawGrid();
    drawOrigin();
    drawPings();
    drawScaleBar();
    updateStatus();
  }

  function drawTerrain() {
    if (!state.source || state.source.type === "none") {
      drawNoMapPattern();
      return;
    }
    if (state.source.type === "preview") {
      drawPreview(state.source.image);
      return;
    }
    drawTiles(state.source.manifest);
  }

  function drawNoMapPattern() {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.04)";
    ctx.lineWidth = 1;
    for (let x = -state.height; x < state.width + state.height; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + state.height, state.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPreview(image) {
    const tl = worldToScreen(MIN_COORD, MIN_COORD);
    const br = worldToScreen(MAX_COORD, MAX_COORD);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }

  function chooseLevel(manifest) {
    const levels = manifest.levels;
    const target = state.pixelsPerBlock * state.dpr;
    let best = levels[0];
    let bestScore = Infinity;
    for (const level of levels) {
      const layerPpb = level.size / WORLD_SIZE;
      const score = Math.abs(Math.log2(Math.max(1e-6, layerPpb / target)));
      if (score < bestScore) {
        bestScore = score;
        best = level;
      }
    }
    return best;
  }

  function drawTiles(manifest) {
    const level = chooseLevel(manifest);
    const levelSize = level.size;
    const tileWorld = TILE_SIZE / levelSize * WORLD_SIZE;
    const bounds = visibleBounds();
    const colMin = clamp(Math.floor((bounds.minX - MIN_COORD) / tileWorld), 0, level.cols - 1);
    const rowMin = clamp(Math.floor((bounds.minZ - MIN_COORD) / tileWorld), 0, level.rows - 1);
    const colMax = clamp(Math.floor((bounds.maxX - MIN_COORD) / tileWorld), 0, level.cols - 1);
    const rowMax = clamp(Math.floor((bounds.maxZ - MIN_COORD) / tileWorld), 0, level.rows - 1);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = state.pixelsPerBlock > .5 ? "low" : "high";

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const key = `${level.level}:${col}:${row}`;
        let entry = state.imageCache.get(key);
        if (!entry) {
          const image = new Image();
          image.decoding = "async";
          entry = { image, loaded: false, touched: performance.now() };
          state.imageCache.set(key, entry);
          image.onload = () => { entry.loaded = true; requestRender(); };
          image.onerror = () => { entry.failed = true; requestRender(); };
          image.src = `./assets/tiles/${level.level}/${col}_${row}.${manifest.format || "webp"}`;
        }
        entry.touched = performance.now();

        const worldX = MIN_COORD + col * tileWorld;
        const worldZ = MIN_COORD + row * tileWorld;
        const screen = worldToScreen(worldX, worldZ);
        const fallbackW = Math.min(TILE_SIZE, levelSize - col * TILE_SIZE);
        const fallbackH = Math.min(TILE_SIZE, levelSize - row * TILE_SIZE);
        const naturalW = entry.loaded ? entry.image.naturalWidth : fallbackW;
        const naturalH = entry.loaded ? entry.image.naturalHeight : fallbackH;
        const screenW = naturalW / levelSize * WORLD_SIZE * state.pixelsPerBlock;
        const screenH = naturalH / levelSize * WORLD_SIZE * state.pixelsPerBlock;

        if (entry.loaded) {
          ctx.drawImage(entry.image, screen.x, screen.y, screenW + .35, screenH + .35);
        } else if (!entry.failed) {
          ctx.fillStyle = ((col + row) & 1) ? "#24302a" : "#202a25";
          ctx.fillRect(screen.x, screen.y, screenW + 1, screenH + 1);
        }
      }
    }

    if (state.imageCache.size > 220) {
      const entries = [...state.imageCache.entries()].sort((a, b) => a[1].touched - b[1].touched);
      for (const [key] of entries.slice(0, state.imageCache.size - 180)) state.imageCache.delete(key);
    }
  }

  function drawWorldBoundary() {
    const tl = worldToScreen(MIN_COORD, MIN_COORD);
    const br = worldToScreen(MAX_COORD, MAX_COORD);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.round(tl.x) + .5, Math.round(tl.y) + .5, br.x - tl.x, br.y - tl.y);
    ctx.restore();
  }

  function gridSpacing() {
    const candidates = [16, 32, 64, 128, 256, 512, 1000, 2000, 5000];
    for (const spacing of candidates) {
      if (spacing * state.pixelsPerBlock >= 72) return spacing;
    }
    return 5000;
  }

  function drawGrid() {
    const bounds = visibleBounds();
    const spacing = gridSpacing();
    const majorEvery = spacing < 1000 ? 4 : 2;
    const startX = Math.ceil(bounds.minX / spacing) * spacing;
    const startZ = Math.ceil(bounds.minZ / spacing) * spacing;

    ctx.save();
    ctx.font = '9px "SFMono-Regular", Consolas, monospace';
    ctx.textBaseline = "top";

    for (let x = startX; x <= bounds.maxX; x += spacing) {
      const screenX = worldToScreen(x, 0).x;
      const isMajor = Math.round(x / spacing) % majorEvery === 0 || x === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.075)";
      ctx.lineWidth = isMajor ? 1 : .7;
      ctx.beginPath();
      ctx.moveTo(Math.round(screenX) + .5, 0);
      ctx.lineTo(Math.round(screenX) + .5, state.height);
      ctx.stroke();
      if (isMajor && state.pixelsPerBlock * spacing > 110) {
        ctx.fillStyle = "rgba(245,248,243,.7)";
        ctx.fillText(`X ${x}`, screenX + 4, 86);
      }
    }

    for (let z = startZ; z <= bounds.maxZ; z += spacing) {
      const screenY = worldToScreen(0, z).y;
      const isMajor = Math.round(z / spacing) % majorEvery === 0 || z === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.075)";
      ctx.lineWidth = isMajor ? 1 : .7;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(screenY) + .5);
      ctx.lineTo(state.width, Math.round(screenY) + .5);
      ctx.stroke();
      if (isMajor && state.pixelsPerBlock * spacing > 110) {
        ctx.fillStyle = "rgba(245,248,243,.7)";
        ctx.fillText(`Z ${z}`, 10, screenY + 4);
      }
    }
    ctx.restore();
  }

  function drawOrigin() {
    const p = worldToScreen(0, 0);
    if (p.x < -20 || p.x > state.width + 20 || p.y < -20 || p.y > state.height + 20) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.fillStyle = "rgba(17,20,18,.78)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 10, p.y);
    ctx.lineTo(p.x + 10, p.y);
    ctx.moveTo(p.x, p.y - 10);
    ctx.lineTo(p.x, p.y + 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawPings() {
    const bounds = visibleBounds();
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font = '700 11px Inter, "Noto Sans KR", sans-serif';

    for (const ping of state.pings) {
      if (ping.x < bounds.minX - 100 || ping.x > bounds.maxX + 100 || ping.z < bounds.minZ - 100 || ping.z > bounds.maxZ + 100) continue;
      const p = worldToScreen(ping.x, ping.z);
      const selected = ping.id === state.selectedPingId;
      const radius = selected ? 9 : 7;

      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = ping.color;
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowColor = "transparent";
      const textWidth = ctx.measureText(ping.name).width;
      const labelX = p.x + radius + 7;
      const labelY = p.y;
      ctx.fillStyle = "rgba(16,19,17,.86)";
      roundRect(ctx, labelX - 4, labelY - 10, textWidth + 9, 20, 5);
      ctx.fill();
      ctx.fillStyle = "#f5f7f3";
      ctx.fillText(ping.name, labelX, labelY + .5);
    }
    ctx.restore();
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawScaleBar() {
    const targetPx = 120;
    const targetWorld = targetPx / state.pixelsPerBlock;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, targetWorld)));
    const normalized = targetWorld / magnitude;
    const nice = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    const blocks = nice * magnitude;
    const pixels = blocks * state.pixelsPerBlock;
    const x = 18;
    const y = state.height - 70;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.fillStyle = "rgba(16,19,17,.78)";
    ctx.lineWidth = 2;
    ctx.fillRect(x - 6, y - 20, pixels + 12, 30);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + pixels, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + pixels, y - 5);
    ctx.lineTo(x + pixels, y + 5);
    ctx.stroke();
    ctx.font = '700 9px "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = "#fff";
    ctx.fillText(`${Math.round(blocks).toLocaleString()} blocks`, x, y - 9);
    ctx.restore();
  }

  function updateStatus() {
    centerCoords.textContent = `X ${rounded(state.centerX).toLocaleString()} · Z ${rounded(state.centerZ).toLocaleString()}`;
    const base = Math.max(state.minPixelsPerBlock, .000001);
    zoomStatus.textContent = `${Math.round(state.pixelsPerBlock / base * 100).toLocaleString()}%`;
  }

  function setCursorFromScreen(x, y) {
    const w = screenToWorld(x, y);
    const wx = clamp(rounded(w.x), MIN_COORD, MAX_COORD);
    const wz = clamp(rounded(w.z), MIN_COORD, MAX_COORD);
    state.cursorWorld = { x: wx, z: wz };
    cursorCoords.textContent = `X ${wx.toLocaleString()} · Z ${wz.toLocaleString()}`;
    chunkCoords.textContent = `${chunkCoord(wx)}, ${chunkCoord(wz)}`;
  }

  function zoomAt(screenX, screenY, factor) {
    const before = screenToWorld(screenX, screenY);
    state.pixelsPerBlock = clamp(state.pixelsPerBlock * factor, state.minPixelsPerBlock, state.maxPixelsPerBlock);
    const after = screenToWorld(screenX, screenY);
    state.centerX += before.x - after.x;
    state.centerZ += before.z - after.z;
    clampCenter();
    requestRender();
  }

  function panByPixels(dx, dy) {
    state.centerX -= dx / state.pixelsPerBlock;
    state.centerZ -= dy / state.pixelsPerBlock;
    clampCenter();
    requestRender();
  }

  function findPingAt(screenX, screenY) {
    for (let i = state.pings.length - 1; i >= 0; i--) {
      const ping = state.pings[i];
      const p = worldToScreen(ping.x, ping.z);
      if (Math.hypot(screenX - p.x, screenY - p.y) <= 14) return ping;
    }
    return null;
  }

  function openPingDialog(x, z, ping = null) {
    state.editingPingId = ping?.id || null;
    document.getElementById("dialogTitle").textContent = ping ? "핑 수정" : "핑 추가";
    document.getElementById("pingName").value = ping?.name || "";
    document.getElementById("pingX").value = clamp(rounded(ping?.x ?? x), MIN_COORD, MAX_COORD);
    document.getElementById("pingZ").value = clamp(rounded(ping?.z ?? z), MIN_COORD, MAX_COORD);
    document.getElementById("deleteDialogPing").hidden = !ping;
    const selectedColor = ping?.color || PING_COLORS[state.pings.length % PING_COLORS.length];
    const radio = document.querySelector(`input[name="pingColor"][value="${selectedColor}"]`);
    if (radio) radio.checked = true;
    pingDialog.showModal();
    setTimeout(() => document.getElementById("pingName").focus(), 0);
  }

  function closePingDialog() {
    state.editingPingId = null;
    pingDialog.close();
  }

  function submitPing(event) {
    event.preventDefault();
    const name = document.getElementById("pingName").value.trim() || "이름 없는 핑";
    const x = clamp(rounded(document.getElementById("pingX").value), MIN_COORD, MAX_COORD);
    const z = clamp(rounded(document.getElementById("pingZ").value), MIN_COORD, MAX_COORD);
    const color = document.querySelector('input[name="pingColor"]:checked')?.value || PING_COLORS[0];

    if (state.editingPingId) {
      const ping = state.pings.find((p) => p.id === state.editingPingId);
      if (ping) Object.assign(ping, { name, x, z, color });
      showToast("핑을 수정했습니다.");
    } else {
      const ping = { id: uid(), name, x, z, color, createdAt: Date.now() };
      state.pings.push(ping);
      state.selectedPingId = ping.id;
      showToast("핑을 저장했습니다.");
    }
    savePings();
    closePingDialog();
  }

  function deletePing(id) {
    const index = state.pings.findIndex((p) => p.id === id);
    if (index < 0) return;
    state.pings.splice(index, 1);
    if (state.selectedPingId === id) state.selectedPingId = null;
    savePings();
    showToast("핑을 삭제했습니다.");
  }

  function flyToPing(ping) {
    state.centerX = ping.x;
    state.centerZ = ping.z;
    state.pixelsPerBlock = Math.max(state.pixelsPerBlock, .28);
    state.selectedPingId = ping.id;
    clampCenter();
    sidebar.classList.remove("is-open");
    requestRender();
    renderPingList();
  }

  function renderPingList() {
    pingList.innerHTML = "";
    pingEmpty.hidden = state.pings.length > 0;
    pingList.hidden = state.pings.length === 0;

    const sorted = [...state.pings].sort((a, b) => b.createdAt - a.createdAt);
    for (const ping of sorted) {
      const card = document.createElement("div");
      card.className = `ping-card${ping.id === state.selectedPingId ? " is-selected" : ""}`;
      card.style.setProperty("--ping-color", ping.color);
      card.tabIndex = 0;
      card.innerHTML = `
        <span class="ping-dot" aria-hidden="true"></span>
        <span class="ping-info">
          <span class="ping-name"></span>
          <span class="ping-coords">X ${ping.x.toLocaleString()} · Z ${ping.z.toLocaleString()}</span>
        </span>
        <button class="ping-edit" type="button" title="수정">⋯</button>`;
      card.querySelector(".ping-name").textContent = ping.name;
      card.addEventListener("click", (event) => {
        if (event.target.closest(".ping-edit")) return;
        flyToPing(ping);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") flyToPing(ping);
      });
      card.querySelector(".ping-edit").addEventListener("click", () => openPingDialog(ping.x, ping.z, ping));
      pingList.appendChild(card);
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function exportPings() {
    const payload = {
      format: "seed-terrain-pings-v1",
      seed: SEED,
      version: VERSION,
      bounds: [MIN_COORD, MAX_COORD],
      exportedAt: new Date().toISOString(),
      pings: state.pings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seed-${SEED}-pings.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("핑 JSON을 내보냈습니다.");
  }

  async function importPings(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.pings;
      if (!Array.isArray(incoming)) throw new Error("invalid format");
      let added = 0;
      for (const item of incoming) {
        if (!item || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.z))) continue;
        state.pings.push({
          id: uid(),
          name: String(item.name || "가져온 핑").slice(0, 40),
          x: clamp(rounded(item.x), MIN_COORD, MAX_COORD),
          z: clamp(rounded(item.z), MIN_COORD, MAX_COORD),
          color: PING_COLORS.includes(item.color) ? item.color : PING_COLORS[added % PING_COLORS.length],
          createdAt: Date.now() + added,
        });
        added++;
      }
      if (!added) throw new Error("no pings");
      savePings();
      showToast(`${added}개의 핑을 가져왔습니다.`);
    } catch (_) {
      showToast("올바른 핑 JSON 파일이 아닙니다.");
    }
  }

  function buildColorOptions() {
    const container = document.getElementById("colorOptions");
    PING_COLORS.forEach((color, index) => {
      const label = document.createElement("label");
      label.className = "color-choice";
      label.style.setProperty("--choice", color);
      label.innerHTML = `<input type="radio" name="pingColor" value="${color}" ${index === 0 ? "checked" : ""}><span aria-hidden="true"></span>`;
      container.appendChild(label);
    });
  }

  function setupEvents() {
    window.addEventListener("resize", resizeCanvas, { passive: true });
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = findPingAt(x, y);
      const world = screenToWorld(x, y);
      openPingDialog(world.x, world.z, hit);
    });

    canvas.addEventListener("dblclick", (event) => {
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      openPingDialog(world.x, world.z);
    });

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * .0015);
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    }, { passive: false });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      canvas.setPointerCapture(event.pointerId);
      state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      state.movedDuringPointer = false;
      canvas.classList.add("is-dragging");

      if (state.activePointers.size === 1) {
        state.gesture = { type: "pan", lastX: event.clientX, lastY: event.clientY };
        if (event.pointerType === "touch") {
          state.longPressStart = { x: event.clientX, y: event.clientY };
          clearTimeout(state.longPressTimer);
          state.longPressTimer = setTimeout(() => {
            if (!state.movedDuringPointer && state.activePointers.size === 1) {
              const rect = canvas.getBoundingClientRect();
              const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
              openPingDialog(world.x, world.z);
            }
          }, 620);
        }
      } else if (state.activePointers.size === 2) {
        clearTimeout(state.longPressTimer);
        const [a, b] = [...state.activePointers.values()];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const rect = canvas.getBoundingClientRect();
        state.gesture = {
          type: "pinch",
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          startPpb: state.pixelsPerBlock,
          anchorWorld: screenToWorld(midX - rect.left, midY - rect.top),
          midX: midX - rect.left,
          midY: midY - rect.top,
        };
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      setCursorFromScreen(event.clientX - rect.left, event.clientY - rect.top);
      if (!state.activePointers.has(event.pointerId)) return;
      const previous = state.activePointers.get(event.pointerId);
      state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 1) state.movedDuringPointer = true;
      if (state.longPressStart && Math.hypot(event.clientX - state.longPressStart.x, event.clientY - state.longPressStart.y) > 8) clearTimeout(state.longPressTimer);

      if (state.activePointers.size === 1 && state.gesture?.type === "pan") {
        const dx = event.clientX - state.gesture.lastX;
        const dy = event.clientY - state.gesture.lastY;
        if (Math.hypot(dx, dy) > 1.5) state.movedDuringPointer = true;
        panByPixels(dx, dy);
        state.gesture.lastX = event.clientX;
        state.gesture.lastY = event.clientY;
      } else if (state.activePointers.size === 2) {
        const [a, b] = [...state.activePointers.values()];
        const distance = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        if (state.gesture?.type !== "pinch") {
          state.gesture = { type: "pinch", distance, startPpb: state.pixelsPerBlock, anchorWorld: screenToWorld(midX, midY), midX, midY };
        }
        state.pixelsPerBlock = clamp(state.gesture.startPpb * (distance / state.gesture.distance), state.minPixelsPerBlock, state.maxPixelsPerBlock);
        const after = screenToWorld(midX, midY);
        state.centerX += state.gesture.anchorWorld.x - after.x;
        state.centerZ += state.gesture.anchorWorld.z - after.z;
        clampCenter();
        requestRender();
      }
    });

    function endPointer(event) {
      clearTimeout(state.longPressTimer);
      state.longPressStart = null;
      state.activePointers.delete(event.pointerId);
      if (state.activePointers.size === 0) {
        canvas.classList.remove("is-dragging");
        state.gesture = null;
        if (!state.movedDuringPointer && event.pointerType !== "touch" && event.button === 0) {
          const rect = canvas.getBoundingClientRect();
          const hit = findPingAt(event.clientX - rect.left, event.clientY - rect.top);
          if (hit) flyToPing(hit);
        }
      } else if (state.activePointers.size === 1) {
        const only = [...state.activePointers.values()][0];
        state.gesture = { type: "pan", lastX: only.x, lastY: only.y };
      }
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    document.getElementById("zoomIn").addEventListener("click", () => zoomAt(state.width / 2, state.height / 2, 1.5));
    document.getElementById("zoomOut").addEventListener("click", () => zoomAt(state.width / 2, state.height / 2, 1 / 1.5));
    document.getElementById("fitMap").addEventListener("click", fitMap);
    document.getElementById("centerMap").addEventListener("click", () => {
      state.centerX = 0; state.centerZ = 0; clampCenter(); requestRender();
    });
    document.getElementById("gridToggle").addEventListener("click", (event) => {
      state.grid = !state.grid;
      event.currentTarget.classList.toggle("is-active", state.grid);
      event.currentTarget.setAttribute("aria-pressed", String(state.grid));
      requestRender();
    });

    document.getElementById("gotoForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.centerX = clamp(rounded(document.getElementById("gotoX").value), MIN_COORD, MAX_COORD);
      state.centerZ = clamp(rounded(document.getElementById("gotoZ").value), MIN_COORD, MAX_COORD);
      state.pixelsPerBlock = Math.max(state.pixelsPerBlock, .18);
      clampCenter(); requestRender();
    });

    document.getElementById("copySeed").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(SEED); showToast("시드를 복사했습니다."); }
      catch (_) { showToast(SEED); }
    });
    document.getElementById("addCenterPing").addEventListener("click", () => openPingDialog(state.centerX, state.centerZ));
    document.getElementById("exportPings").addEventListener("click", exportPings);
    document.getElementById("importPings").addEventListener("click", () => document.getElementById("importInput").click());
    document.getElementById("importInput").addEventListener("change", (event) => {
      importPings(event.target.files?.[0]);
      event.target.value = "";
    });

    pingForm.addEventListener("submit", submitPing);
    document.getElementById("dialogClose").addEventListener("click", closePingDialog);
    document.getElementById("dialogCancel").addEventListener("click", closePingDialog);
    document.getElementById("deleteDialogPing").addEventListener("click", () => {
      if (state.editingPingId) deletePing(state.editingPingId);
      closePingDialog();
    });
    pingDialog.addEventListener("click", (event) => {
      const rect = pingDialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) closePingDialog();
    });

    document.getElementById("sidebarToggle").addEventListener("click", () => sidebar.classList.add("is-open"));
    document.getElementById("sidebarClose").addEventListener("click", () => sidebar.classList.remove("is-open"));

    window.addEventListener("keydown", (event) => {
      if (pingDialog.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
      const step = event.shiftKey ? 600 : 160;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0", "Home", "p", "P"].includes(event.key)) event.preventDefault();
      if (event.key === "ArrowLeft") panByPixels(step, 0);
      if (event.key === "ArrowRight") panByPixels(-step, 0);
      if (event.key === "ArrowUp") panByPixels(0, step);
      if (event.key === "ArrowDown") panByPixels(0, -step);
      if (event.key === "+" || event.key === "=") zoomAt(state.width / 2, state.height / 2, 1.5);
      if (event.key === "-") zoomAt(state.width / 2, state.height / 2, 1 / 1.5);
      if (event.key === "0" || event.key === "Home") fitMap();
      if (event.key === "p" || event.key === "P") openPingDialog(state.centerX, state.centerZ);
    });
  }

  buildColorOptions();
  renderPingList();
  setupEvents();
  resizeCanvas();
  fitMap();
  loadSource();
})();
