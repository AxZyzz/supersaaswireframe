/**
 * Org branding (T9.3, white-label readiness). Tailwind v4 compiles `bg-accent`
 * etc. to `var(--color-accent)`, so overriding the custom properties on <html>
 * re-themes the whole app at runtime. Hover/soft shades are derived from the
 * one brand color with color-mix, keeping the original palette's relationships.
 */
const VARS: Record<string, (c: string) => string> = {
  "--color-accent": (c) => c,
  "--color-accent-hover": (c) => `color-mix(in srgb, ${c} 88%, black)`,
  "--color-accent-pressed": (c) => `color-mix(in srgb, ${c} 80%, black)`,
  // tints mix with the surface, so they read right in light and dark
  "--color-accent-soft": (c) => `color-mix(in srgb, ${c} 14%, var(--color-surface))`,
  "--color-accent-soft2": (c) => `color-mix(in srgb, ${c} 24%, var(--color-surface))`,
};

export const DEFAULT_ACCENT = "#3e63dd";

export function applyBrand(color: string | null | undefined) {
  const root = document.documentElement.style;
  for (const [name, derive] of Object.entries(VARS)) {
    if (color) root.setProperty(name, derive(color));
    else root.removeProperty(name);
  }
}

// Server cap is 90k chars; 256px PNGs of typical logos land far below that.
const MAX_DATA_URL = 90_000;
const MAX_SIDE = 256;

/** Read an uploaded logo as a small data: URL. Raster images are downscaled
 *  to fit 256px; SVGs pass through when already small. */
export async function logoToDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
    throw new Error("Use a PNG, JPG, WebP or SVG image.");
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml") {
    if (raw.length > MAX_DATA_URL) throw new Error("That SVG is too large.");
    return raw;
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("That image could not be decoded."));
    i.src = raw;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/png");
  if (out.length > MAX_DATA_URL) throw new Error("That image is too detailed.");
  return out;
}
