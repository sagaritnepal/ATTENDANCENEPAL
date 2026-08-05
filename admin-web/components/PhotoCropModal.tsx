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
 * Pick-a-file -> pan/zoom-to-crop -> explicit Save modal. Shared by every
 * page that lets someone set a profile photo (admin Employees pages and
 * the employee-facing My Profile page), so cropping/compression behavior
 * is identical everywhere instead of each place rolling its own.
 *
 * Pan+zoom model: `focus` is the natural-image pixel currently centered in
 * the viewport — NOT a screen-space pixel offset. That's what keeps zoom
 * anchored on whatever the user panned to (e.g. a face): a screen-space
 * offset means the same absolute offset represents a shrinking fraction of
 * the image as it grows, so the framing silently drifts back toward the
 * image's own center every time zoom changes. A natural-image-space focus
 * point has no such drift — it stays exactly where it was regardless of
 * zoom.
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
  const [focus, setFocus] = useState({ x: 0, y: 0 }); // natural-image px, set once the image loads
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; focusX: number; focusY: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setFocus({ x: img.naturalWidth / 2, y: img.naturalHeight / 2 });
      setZoom(1);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Base scale so the image's SHORTER side exactly covers the viewport at
  // zoom=1 (same idea as CSS object-fit: cover), then zoom multiplies on
  // top of that.
  const baseScale = imgEl ? VIEWPORT / Math.min(imgEl.naturalWidth, imgEl.naturalHeight) : 1;
  const scale = baseScale * zoom;

  // The valid range for the focus point, so the image always fully covers
  // the viewport (no blank edges) at the current zoom — see the module
  // comment for the derivation.
  const clampedFocus = useMemo(() => {
    if (!imgEl) return focus;
    const halfViewportImg = VIEWPORT / 2 / scale;
    return {
      x: clamp(focus.x, halfViewportImg, Math.max(halfViewportImg, imgEl.naturalWidth - halfViewportImg)),
      y: clamp(focus.y, halfViewportImg, Math.max(halfViewportImg, imgEl.naturalHeight - halfViewportImg)),
    };
  }, [focus, scale, imgEl]);

  const dispW = imgEl ? imgEl.naturalWidth * scale : 0;
  const dispH = imgEl ? imgEl.naturalHeight * scale : 0;
  const imgLeft = VIEWPORT / 2 - clampedFocus.x * scale;
  const imgTop = VIEWPORT / 2 - clampedFocus.y * scale;

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    dragStartRef.current = { startX: e.clientX, startY: e.clientY, focusX: clampedFocus.x, focusY: clampedFocus.y };
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
      // Screen-space drag delta -> natural-image-space delta (divide by
      // scale), and dragging the photo right means the focus point moves
      // left (you're revealing what was off to the left), hence the minus.
      const dx = (e.clientX - start.startX) / scale;
      const dy = (e.clientY - start.startY) / scale;
      setFocus({ x: start.focusX - dx, y: start.focusY - dy });
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
  }, [dragging, scale]);

  async function handleSave() {
    if (!imgEl) return;
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const outputScale = OUTPUT_SIZE / VIEWPORT;
    const drawScale = scale * outputScale;
    const drawW = imgEl.naturalWidth * drawScale;
    const drawH = imgEl.naturalHeight * drawScale;
    const drawX = OUTPUT_SIZE / 2 - clampedFocus.x * drawScale;
    const drawY = OUTPUT_SIZE / 2 - clampedFocus.y * drawScale;

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
              style={{ width: dispW, height: dispH, left: imgLeft, top: imgTop }}
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
