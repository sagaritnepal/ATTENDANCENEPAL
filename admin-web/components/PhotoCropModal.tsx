'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const VIEWPORT = 260; // CSS px, the square preview shown to the user
const OUTPUT_SIZE = 600; // px, the actual saved image's width/height
const MAX_UPLOAD_BYTES = 1_000_000; // 1MB — re-compress below this before saving

/** Re-encodes a canvas as JPEG, stepping quality down until it's under
 * MAX_UPLOAD_BYTES (or hits the quality floor) — the "if more than 1MB,
 * compress it" requirement, applied to the actual cropped output rather
 * than the original file. */
function canvasToCompressedBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const qualities = [0.85, 0.7, 0.55, 0.4, 0.25];
    let i = 0;
    const tryNext = () => {
      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('Could not export the cropped image.'));
            return;
          }
          if (blob.size <= MAX_UPLOAD_BYTES || i === qualities.length - 1) {
            resolve(blob);
            return;
          }
          i += 1;
          tryNext();
        },
        'image/jpeg',
        qualities[i]
      );
    };
    tryNext();
  });
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Pick-a-file -> pan/zoom-to-crop -> explicit Save modal. Shared by any page
 * that lets someone set a profile photo, so cropping/compression behavior
 * (and the "don't upload until Save" step) only lives in one place.
 */
export default function PhotoCropModal({
  file,
  onCancel,
  onSave,
  saving = false,
}: {
  file: File;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
  saving?: boolean;
}) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Base scale so the image's SHORTER side exactly covers the viewport at
  // zoom=1 (same idea as CSS object-fit: cover), then zoom multiplies on
  // top of that.
  const baseScale = imgEl ? VIEWPORT / Math.min(imgEl.naturalWidth, imgEl.naturalHeight) : 1;
  const dispScale = baseScale * zoom;
  const dispW = imgEl ? imgEl.naturalWidth * dispScale : 0;
  const dispH = imgEl ? imgEl.naturalHeight * dispScale : 0;
  const maxPanX = Math.max(0, (dispW - VIEWPORT) / 2);
  const maxPanY = Math.max(0, (dispH - VIEWPORT) / 2);

  const clampedPan = useMemo(
    () => ({ x: clamp(pan.x, -maxPanX, maxPanX), y: clamp(pan.y, -maxPanY, maxPanY) }),
    [pan, maxPanX, maxPanY]
  );

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    dragStartRef.current = { startX: e.clientX, startY: e.clientY, panX: clampedPan.x, panY: clampedPan.y };
    setDragging(true);
  }

  // Track the drag via window-level listeners instead of relying on the
  // viewport div's own setPointerCapture — capture-based dragging has been
  // flaky across mobile browsers/in-app webviews; a window listener keeps
  // tracking the pointer regardless of what element it's currently over.
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.startX;
      const dy = e.clientY - start.startY;
      setPan({
        x: clamp(start.panX + dx, -maxPanX, maxPanX),
        y: clamp(start.panY + dy, -maxPanY, maxPanY),
      });
    };
    const handleUp = () => {
      dragStartRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, maxPanX, maxPanY]);

  async function handleSave() {
    if (!imgEl) return;
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const outputScale = OUTPUT_SIZE / VIEWPORT;
    const drawScale = dispScale * outputScale;
    const drawW = imgEl.naturalWidth * drawScale;
    const drawH = imgEl.naturalHeight * drawScale;
    const drawX = (OUTPUT_SIZE - drawW) / 2 + clampedPan.x * outputScale;
    const drawY = (OUTPUT_SIZE - drawH) / 2 + clampedPan.y * outputScale;

    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);

    const blob = await canvasToCompressedBlob(canvas);
    onSave(blob);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 text-base font-semibold text-ink">Adjust photo</h3>
        <p className="mb-4 text-xs text-slate-500">Drag to reposition, use the slider to zoom.</p>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-full border border-slate-200 bg-slate-100"
          style={{ width: VIEWPORT, height: VIEWPORT, cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown}
        >
          {imgEl && (
            <img
              src={imgEl.src}
              alt="Crop preview"
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={{
                width: dispW,
                height: dispH,
                left: (VIEWPORT - dispW) / 2 + clampedPan.x,
                top: (VIEWPORT - dispH) / 2 + clampedPan.y,
              }}
            />
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-slate-400">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1"
          />
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!imgEl || saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
