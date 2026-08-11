/**
 * SSIM (structural similarity) on the luma channel.
 *
 * Used to decide encoder quality objectively instead of guessing, and instead of
 * compressing toward a target file size. For each image we pick the *lowest* quality
 * whose SSIM against the reference still clears the floor — so file size is the
 * outcome of a quality decision, never the input to one.
 *
 * Standard formulation: 11-tap Gaussian window, sigma 1.5, C1=(0.01*255)^2,
 * C2=(0.03*255)^2. The Gaussian is applied separably (two 1-D passes) — mathematically
 * identical to the 2-D window but ~5x cheaper, which matters across ~2700 comparisons.
 */
import sharp from 'sharp';

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

function gaussianKernel(radius = 5, sigma = 1.5) {
  const k = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

const KERNEL = gaussianKernel();
const RADIUS = 5;

/**
 * Separable Gaussian blur with edge clamping.
 *
 * The interior is split from the borders so the hot loop carries no bounds checks —
 * this runs on ~1.1M pixels, five times per comparison, across thousands of
 * comparisons, so the branch elimination is worth the extra code.
 */
function blur(src, w, h, tmp, out) {
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < RADIUS; x++) {
      let acc = 0;
      for (let t = -RADIUS; t <= RADIUS; t++) {
        const xx = x + t < 0 ? 0 : x + t;
        acc += src[row + xx] * KERNEL[t + RADIUS];
      }
      tmp[row + x] = acc;
    }
    const end = w - RADIUS;
    for (let x = RADIUS; x < end; x++) {
      const base = row + x - RADIUS;
      let acc = 0;
      for (let t = 0; t < 11; t++) acc += src[base + t] * KERNEL[t];
      tmp[row + x] = acc;
    }
    for (let x = Math.max(end, RADIUS); x < w; x++) {
      let acc = 0;
      for (let t = -RADIUS; t <= RADIUS; t++) {
        const xx = x + t >= w ? w - 1 : x + t;
        acc += src[row + xx] * KERNEL[t + RADIUS];
      }
      tmp[row + x] = acc;
    }
  }
  // vertical
  const top = RADIUS;
  const bottom = h - RADIUS;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    if (y >= top && y < bottom) {
      const base = (y - RADIUS) * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let t = 0; t < 11; t++) acc += tmp[base + t * w + x] * KERNEL[t];
        out[row + x] = acc;
      }
    } else {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let t = -RADIUS; t <= RADIUS; t++) {
          const yy = y + t < 0 ? 0 : y + t >= h ? h - 1 : y + t;
          acc += tmp[yy * w + x] * KERNEL[t + RADIUS];
        }
        out[row + x] = acc;
      }
    }
  }
  return out;
}

/** Decode any image buffer to a single-channel luma plane. */
export async function luma(buffer, width) {
  let pipe = sharp(buffer).greyscale();
  if (width) pipe = pipe.resize({ width, kernel: 'lanczos3' });
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  const f = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) f[i] = data[i];
  return { data: f, w: info.width, h: info.height };
}

/** Mean SSIM between two equally sized luma planes. Returns 1.0 for identical input. */
export function ssim(a, b, w, h) {
  const n = w * h;
  const aa = new Float64Array(n);
  const bb = new Float64Array(n);
  const ab = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    aa[i] = a[i] * a[i];
    bb[i] = b[i] * b[i];
    ab[i] = a[i] * b[i];
  }

  // Scratch buffers reused across all five blurs rather than reallocated.
  const tmp = new Float64Array(n);
  const muA = blur(a, w, h, tmp, new Float64Array(n));
  const muB = blur(b, w, h, tmp, new Float64Array(n));
  const blurAA = blur(aa, w, h, tmp, new Float64Array(n));
  const blurBB = blur(bb, w, h, tmp, new Float64Array(n));
  const blurAB = blur(ab, w, h, tmp, new Float64Array(n));

  let total = 0;
  for (let i = 0; i < n; i++) {
    const ma = muA[i];
    const mb = muB[i];
    const ma2 = ma * ma;
    const mb2 = mb * mb;
    const sa2 = blurAA[i] - ma2;
    const sb2 = blurBB[i] - mb2;
    const sab = blurAB[i] - ma * mb;
    total +=
      ((2 * ma * mb + C1) * (2 * sab + C2)) /
      ((ma2 + mb2 + C1) * (sa2 + sb2 + C2));
  }
  return total / n;
}

/** Peak signal-to-noise ratio, dB. Reported as a secondary sanity metric. */
export function psnr(a, b, n) {
  let mse = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    mse += d * d;
  }
  mse /= n;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}
