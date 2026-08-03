/** Downscales + re-encodes an image file client-side before upload — phone
 * camera photos are routinely 5-15MB, which is unnecessarily slow (or
 * outright fails on a weak mobile connection) for what ends up displayed as
 * a small avatar. No-op in dimensions for images already smaller than
 * maxDimension; always re-encodes as JPEG at `quality`. */
export function compressImage(file: File, maxDimension = 1200, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Image compression is not supported in this browser.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Image compression failed.'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}
