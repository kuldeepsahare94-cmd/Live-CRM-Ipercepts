/*
 * Reading the text of a photo in the browser (a bill, a visiting card). Free,
 * and the photo goes to nobody else: only the text it contains is sent to the
 * CRM, which finds the amount, date, GSTIN… (or the name, phone, email…) in it.
 *
 * It uses Tesseract (open source). The reader is about 4 MB and is loaded the
 * first time it is needed — from jsDelivr, and from unpkg if jsDelivr is
 * blocked or down — then the browser keeps it. Before it reads, the photo is
 * cleaned up (resized, grey, contrast stretched), which makes a phone photo
 * read much better; when the first reading finds almost nothing, a second
 * reading with another page layout is tried.
 */

const VERSION = '6.0.1';
const SOURCES = [
  { name: 'jsdelivr', script: `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION}/dist/tesseract.min.js`, worker: `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION}/dist/worker.min.js`, core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6', lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int' },
  { name: 'unpkg', script: `https://unpkg.com/tesseract.js@${VERSION}/dist/tesseract.min.js`, worker: `https://unpkg.com/tesseract.js@${VERSION}/dist/worker.min.js`, core: 'https://unpkg.com/tesseract.js-core@6', lang: 'https://unpkg.com/@tesseract.js-data/eng/4.0.0_best_int' },
];
const NO_READER = 'The text reader could not be loaded (no internet, or it is blocked). Type the details in.';

let using = 0;                 // which source worked last
let loading = null;
function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    let done = false;
    const end = (ok, err) => { if (done) return; done = true; clearTimeout(timer); if (ok) resolve(); else { s.remove(); reject(err); } };
    const timer = setTimeout(() => end(false, new Error('slow')), 25000);
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => end(true);
    s.onerror = () => end(false, new Error('blocked'));
    document.head.appendChild(s);
  });
}
function loadScript() {
  if (typeof window !== 'undefined' && window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loading) return loading;
  loading = (async () => {
    for (let i = 0; i < SOURCES.length; i += 1) {
      const k = (using + i) % SOURCES.length;
      try { await addScript(SOURCES[k].script); if (window.Tesseract) { using = k; return window.Tesseract; } } catch { /* try the next place */ }
    }
    throw new Error(NO_READER);
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

// One reader for the visit; it is closed when it has not been used for two minutes (it holds memory).
let worker = null;
let idle = null;
let tell = null;
async function getWorker() {
  const T = await loadScript();
  if (!worker) {
    const src = SOURCES[using];
    const make = (s) => T.createWorker('eng', 1, {
      workerPath: s.worker, corePath: s.core, langPath: s.lang,
      logger: (m) => { if (tell && m && typeof m.progress === 'number') tell(m.status, m.progress); },
    });
    worker = make(src).catch(async (e) => {
      // the files of this place could not be had: the other place is tried once
      const other = SOURCES[(using + 1) % SOURCES.length];
      try { const w = await make(other); using = (using + 1) % SOURCES.length; return w; } catch { throw e; }
    }).catch((e) => { worker = null; throw e; });
  }
  return worker;
}
function later() {
  clearTimeout(idle);
  idle = setTimeout(async () => {
    const w = worker; worker = null;
    try { if (w) (await w).terminate(); } catch { /* already gone */ }
  }, 120000);
}

// --- the photo is cleaned up before it is read ---
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('The photo could not be opened.'));
    im.src = src;
  });
}
/** Resized so the text is a good size, grey, and the contrast stretched (dark and washed-out photos). */
async function clean(src) {
  const im = await loadImage(src);
  const long = Math.max(im.naturalWidth, im.naturalHeight) || 1;
  const k = Math.min(2.5, Math.max(0.6, 2200 / long));
  const w = Math.max(1, Math.round(im.naturalWidth * k));
  const h = Math.max(1, Math.round(im.naturalHeight * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
  cx.drawImage(im, 0, 0, w, h);
  const img = cx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = g; hist[g] += 1;
  }
  // the darkest and the lightest 1% are ignored, the rest is spread over the full range
  const total = w * h;
  let lo = 0; let hi = 255; let acc = 0;
  for (let v = 0; v < 256; v += 1) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
  const span = Math.max(40, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(((d[i] - lo) * 255) / span)));
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return cv;
}

const worth = (r) => {
  const t = String((r && r.data && r.data.text) || '');
  const good = (t.match(/[A-Za-z0-9@.]{3,}/g) || []).join('').length;
  return good * (0.4 + Math.min(100, (r && r.data && r.data.confidence) || 0) / 100);
};

/**
 * The text of a photo.
 * @param image  a data: URL / blob URL, or { mime, data } with base64 data
 * @param onProgress (status, 0..1)
 * @param opts   { sparse: true } for a visiting card (text in several places on the page)
 */
export async function readText(image, onProgress, opts = {}) {
  const src = image && typeof image === 'object' && image.data ? `data:${image.mime || 'image/jpeg'};base64,${image.data}` : image;
  tell = onProgress || null;
  try {
    const w = await getWorker();
    let input = src;
    try { input = await clean(src); } catch { input = src; }       // (if it cannot be cleaned, the photo itself is read)
    await w.setParameters({ tessedit_pageseg_mode: '3' });
    let best = await w.recognize(input);
    // almost nothing found, or a card (columns, logos): a second reading with another page layout
    const few = String((best.data && best.data.text) || '').replace(/\s/g, '').length < 40;
    if (few || opts.sparse) {
      await w.setParameters({ tessedit_pageseg_mode: '11' });
      const again = await w.recognize(input);
      if (worth(again) > worth(best)) best = again;
      await w.setParameters({ tessedit_pageseg_mode: '3' });
    }
    later();
    return String((best && best.data && best.data.text) || '');
  } catch (e) {
    later();
    throw new Error(e && e.message && /loaded|start|internet|opened/.test(e.message) ? e.message : 'The photo could not be read on this device. Type the details in.');
  } finally {
    tell = null;
  }
}
