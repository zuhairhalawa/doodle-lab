/** Photo handling in the browser: orientation, downscaling and JPEG encoding. */

export interface Picture {
  /** Downscaled image the stage draws and the reader sees. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Base64 JPEG without the data: prefix. */
  jpeg: string;
}

const MAX_SIDE = 1280;

export async function fromBlob(blob: Blob): Promise<Picture> {
  if (!blob.type.startsWith('image/')) throw new Error('That file is not a picture. Choose a photo of your drawing.');
  if (blob.size > 25 * 1024 * 1024) throw new Error('That photo is over 25 MB. Choose a smaller one.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That picture could not be opened. Try a JPEG or PNG.');
  }
  return fromSource(bitmap, bitmap.width, bitmap.height);
}

export function fromSource(src: CanvasImageSource, w: number, h: number): Picture {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const width = Math.round(w * k);
  const height = Math.round(h * k);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(src, 0, 0, width, height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.86).split(',')[1]!;
  return { canvas, width, height, jpeg };
}

export async function fromUrl(url: string): Promise<Picture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('The sample drawing could not be loaded.');
  return fromBlob(await res.blob());
}
