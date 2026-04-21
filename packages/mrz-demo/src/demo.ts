/**
 * MRZ Scanner browser demo.
 * Supports file upload and live camera with automatic MRZ detection.
 *
 * Camera flow:
 * 1. Continuously capture the MRZ guide region from the video
 * 2. Send cropped region to the worker for detection + OCR
 * 3. When MRZ lines are found: "Hold steady..."
 * 4. Confirm with a second scan, then show result
 */

import * as Comlink from 'comlink';
import type { ScanWorkerApi } from './worker.js';

// --- Elements ---
const fileInput = document.getElementById('photo') as HTMLInputElement;
const cameraBtn = document.getElementById('camera-btn') as HTMLButtonElement;
const cameraContainer = document.getElementById('camera-container')!;
const video = document.getElementById('video') as HTMLVideoElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const cameraStatus = document.getElementById('camera-status')!;
const statusEl = document.getElementById('status')!;
const statusText = statusEl.querySelector('.status-text')!;
const resultEl = document.getElementById('result')!;
const previewEl = document.getElementById('preview')!;

// --- Worker setup ---
const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
});
const api = Comlink.wrap<ScanWorkerApi>(worker);

worker.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type === 'progress') {
    const stage = e.data.stage as string;
    statusText.textContent = stage.charAt(0).toUpperCase() + stage.slice(1) + '...';
  } else if (e.data?.type === 'log') {
    console.log('[worker]', e.data.msg);
  }
});

// --- File upload ---
fileInput.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (!target.files?.length) return;
  stopCamera();

  resultEl.innerHTML = '';
  previewEl.innerHTML = '';
  statusEl.classList.remove('hidden');
  statusText.textContent = 'Processing...';

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const result = await api.scan(ev.target?.result as string);
      statusEl.classList.add('hidden');
      showResult(result);
    } catch (err) {
      statusEl.classList.add('hidden');
      resultEl.innerHTML = `<div class="error">${esc(String(err))}</div>`;
    }
  };
  reader.readAsDataURL(target.files[0]);
});

// --- Camera state ---
let stream: MediaStream | null = null;
let running = false;
let busy = false;

// Guide region (fraction of video frame)
const GUIDE = { x: 0.02, y: 0.55, w: 0.96, h: 0.40 };

cameraBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    video.srcObject = stream;
    await video.play();

    cameraContainer.classList.remove('hidden');
    cameraBtn.disabled = true;
    resultEl.innerHTML = '';
    previewEl.innerHTML = '';
    showTips();
    setStatus('idle', 'Point camera at the MRZ zone');

    // Wait for video dimensions
    await new Promise<void>((resolve) => {
      const check = () => {
        if (video.videoWidth > 0) return resolve();
        requestAnimationFrame(check);
      };
      check();
    });

    sizeOverlay();
    window.addEventListener('resize', sizeOverlay);

    running = true;
    scanLoop();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    resultEl.innerHTML = `<div class="error">Camera error: ${esc(msg)}</div>`;
  }
}

function stopCamera() {
  running = false;
  window.removeEventListener('resize', sizeOverlay);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraContainer.classList.add('hidden');
  cameraBtn.disabled = false;
  busy = false;
}

// --- Overlay ---
function sizeOverlay() {
  const rect = video.getBoundingClientRect();
  const dpr = devicePixelRatio;
  overlay.width = rect.width * dpr;
  overlay.height = rect.height * dpr;
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
}

type GuideState = 'idle' | 'scanning' | 'hold' | 'found';

function drawGuide(state: GuideState) {
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  const w = overlay.width;
  const h = overlay.height;
  const dpr = devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  const gx = w * GUIDE.x;
  const gy = h * GUIDE.y;
  const gw = w * GUIDE.w;
  const gh = h * GUIDE.h;

  // Dim outside guide
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, w, gy);
  ctx.fillRect(0, gy, gx, gh);
  ctx.fillRect(gx + gw, gy, w - gx - gw, gh);
  ctx.fillRect(0, gy + gh, w, h - gy - gh);

  // Color based on state
  const color =
    state === 'found'
      ? '#22c55e'
      : state === 'hold'
        ? '#facc15'
        : state === 'scanning'
          ? '#60a5fa'
          : '#3b82f6';

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * dpr;
  ctx.setLineDash(state === 'scanning' ? [12, 6] : []);
  ctx.strokeRect(gx, gy, gw, gh);
  ctx.setLineDash([]);

  // Corner brackets
  const c = 24 * dpr;
  ctx.lineWidth = 4 * dpr;
  ctx.strokeStyle = color;
  const corners = [
    [gx, gy, 1, 1],
    [gx + gw, gy, -1, 1],
    [gx, gy + gh, 1, -1],
    [gx + gw, gy + gh, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + c * dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + c * dx, cy);
    ctx.stroke();
  }

  // Status text in the guide
  const fontSize = Math.max(18, Math.round(20 * dpr));
  ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';

  const label =
    state === 'found'
      ? 'MRZ Detected!'
      : state === 'hold'
        ? 'Hold steady...'
        : 'Align MRZ zone here';

  const tx = gx + gw / 2;
  const ty = gy - 12 * dpr;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillText(label, tx + 1, ty + 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, tx, ty);
  ctx.textAlign = 'start';
}

function setStatus(state: GuideState, text: string) {
  cameraStatus.textContent = text;
  cameraStatus.className =
    'camera-status' + (state === 'hold' || state === 'scanning' ? ' scanning' : state === 'found' ? ' found' : '');
}

// --- Capture the guide region only ---
function captureGuideRegion(): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw) return null;

  const sx = Math.round(vw * GUIDE.x);
  const sy = Math.round(vh * GUIDE.y);
  const sw = Math.round(vw * GUIDE.w);
  const sh = Math.round(vh * GUIDE.h);

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/jpeg', 0.92);
}

// --- Main scan loop ---
async function scanLoop() {
  let guideState: GuideState = 'idle';

  // Redraw guide continuously on a separate rAF loop
  let rafId = 0;
  const redraw = () => {
    if (!running) return;
    drawGuide(guideState);
    rafId = requestAnimationFrame(redraw);
  };
  rafId = requestAnimationFrame(redraw);

  while (running) {
    if (busy) {
      await sleep(50);
      continue;
    }

    const dataUrl = captureGuideRegion();
    if (!dataUrl) {
      await sleep(100);
      continue;
    }

    busy = true;
    guideState = 'scanning';

    try {
      const result = await api.scan(dataUrl);
      const parsed = result.parsed as Record<string, unknown> | undefined;

      if (parsed?.valid) {
        successCount++;
        guideState = 'found';
        drawGuide('found');
        setStatus('found', 'MRZ detected!');
        showResult(result);

        // Flash green, then keep scanning in case user wants another
        busy = false;
        await sleep(3000);
        if (!running) { cancelAnimationFrame(rafId); return; }
        guideState = 'idle';
        setStatus('idle', 'Scan another or stop camera');
      } else if (result.ocrLines && result.ocrLines.length > 0) {
        guideState = 'hold';
        setStatus('hold', `Reading MRZ... hold steady`);
        // Show partial OCR in result area so user sees progress
        showPartialOcr(result.ocrLines, result.error);
      } else if (result.error) {
        guideState = 'idle';
        const msg = result.error;
        if (msg.includes('no roi')) {
          setStatus('idle', 'No MRZ found — align document in the box');
        } else {
          setStatus('idle', 'Scanning...');
        }
      } else {
        guideState = 'idle';
        setStatus('idle', 'Point camera at the MRZ zone');
      }
    } catch (e) {
      guideState = 'idle';
      console.warn('[scan]', e);
    }

    busy = false;
    await sleep(150);
  }
}

function showTips() {
  resultEl.innerHTML = `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:0.75rem 1rem;border-radius:0.5rem;font-size:0.85rem;color:#1e40af;line-height:1.6">
      <strong>Tips for best results:</strong>
      <ul style="margin:0.4rem 0 0;padding-left:1.2rem">
        <li>Use good, even lighting — avoid shadows and glare</li>
        <li>Hold the document flat and steady for ~2 seconds</li>
        <li>Align the MRZ lines (bottom of the document) inside the guide box</li>
        <li>Keep the camera about 15-20 cm from the document</li>
      </ul>
    </div>
  `;
}

function showPartialOcr(lines: string[], error?: string) {
  const info = lines.join('\n');
  resultEl.innerHTML = `
    <div style="background:#fefce8;border:1px solid #fde68a;padding:0.75rem;border-radius:0.5rem;font-size:0.8rem;color:#92400e">
      <strong>Detected MRZ (not yet parsed):</strong>
      <pre style="margin:0.5rem 0 0;font-size:0.85rem">${esc(info)}</pre>
      ${error ? `<div style="margin-top:0.25rem;font-size:0.75rem;color:#b91c1c">${esc(error)}</div>` : ''}
    </div>
  `;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Display result ---
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PII_NOTICE = `<div style="background:#fefce8;border:1px solid #fde68a;padding:0.5rem 0.75rem;border-radius:0.375rem;font-size:0.75rem;color:#92400e;margin-top:0.5rem">
  This data contains personal information. All processing is done locally in your browser — nothing is sent to any server.
</div>`;

function showResult(result: {
  parsed?: Record<string, unknown>;
  ocrLines?: string[];
  error?: string;
}) {
  const info = result.ocrLines?.join('\n') ?? '';

  if (result.error) {
    resultEl.innerHTML = `
      <div class="error"><pre style="white-space:pre-wrap;margin:0">${esc(result.error)}</pre></div>
      ${info ? `<pre>${esc(info)}</pre>` : ''}
    `;
    return;
  }

  const parsed = result.parsed as Record<string, unknown> | undefined;
  if (parsed?.valid) {
    resultEl.innerHTML = `
      <div class="success">MRZ parsed successfully</div>
      <pre>${esc(JSON.stringify(parsed.fields, null, 2))}</pre>
      <pre>${esc(info)}</pre>
      ${PII_NOTICE}
    `;
  } else {
    resultEl.innerHTML = `
      <pre>Could not parse MRZ text:</pre>
      <pre>${esc(info)}</pre>
    `;
  }
}
