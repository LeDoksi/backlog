export const COVER_MAX_DIM = 900;
export const COVER_JPEG_QUALITY = 0.82;

/** Target size for a cover: the long side capped at `max`, never upscaled. */
export function fitWithin(width: number, height: number, max = COVER_MAX_DIM): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

// Covers are stored inline as data URLs, so a phone photo has to shrink
// before it is saved: a 4000px JPEG would bloat every sync of the row.
export async function downscaleCover(file: Blob): Promise<string> {
  const img = await loadImage(await readAsDataUrl(file));
  const { width, height } = fitWithin(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY);
}
