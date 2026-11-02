// Convertidor de audio a Opus dentro del navegador, con el codificador NATIVO
// del navegador (WebCodecs). Ligero: no descarga nada. Convierte cualquier formato
// que el navegador sepa decodificar (WAV/MP3/FLAC/AAC/OGG…) a Opus (.opus) y lo
// empaqueta en un contenedor Ogg válido. Todo local; nada sale del navegador.
//
// Compatibilidad: Chrome/Edge (computadora y Android). iPhone/Safari no trae el
// codificador Opus de WebCodecs → available() devuelve false y la UI lo avisa.

const OPUS_RATE = 48000;   // Opus trabaja a 48 kHz

// ¿Este navegador puede codificar Opus con WebCodecs?
export function available() {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined' &&
    (typeof OfflineAudioContext !== 'undefined' || typeof webkitOfflineAudioContext !== 'undefined');
}

export function opusName(name) {
  return String(name || 'pista').replace(/\.[a-z0-9]+$/i, '') + '.opus';
}

// ---- CRC32 de Ogg (polinomio 0x04C11DB7, sin reflejar, init 0) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0;
  for (let i = 0; i < buf.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

// Lacing (tabla de segmentos) de un paquete: 255… y el resto; múltiplo exacto → termina en 0.
function laceOf(len) { const s = []; while (len >= 255) { s.push(255); len -= 255; } s.push(len); return s; }

// Construye una página Ogg. granule es un entero (Number; suficiente para pistas normales).
function buildPage(serial, seq, headerType, granule, packets) {
  const segTable = [];
  for (const pk of packets) for (const v of laceOf(pk.length)) segTable.push(v);
  if (segTable.length > 255) throw new Error('demasiados segmentos en una página');
  let dataLen = 0; for (const pk of packets) dataLen += pk.length;
  const page = new Uint8Array(27 + segTable.length + dataLen);
  const dv = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0);      // "OggS"
  page[4] = 0;                                  // versión
  page[5] = headerType;                         // 0x02 BOS, 0x04 EOS
  // granule_position (64 bits LE): parte baja/alta
  dv.setUint32(6, granule >>> 0, true);
  dv.setUint32(10, Math.floor(granule / 4294967296) >>> 0, true);
  dv.setUint32(14, serial >>> 0, true);         // serial
  dv.setUint32(18, seq >>> 0, true);            // nº de página
  dv.setUint32(22, 0, true);                     // CRC (se calcula luego)
  page[26] = segTable.length;                    // nº de segmentos
  page.set(segTable, 27);
  let off = 27 + segTable.length;
  for (const pk of packets) { page.set(pk, off); off += pk.length; }
  dv.setUint32(22, crc32(page), true);           // CRC sobre toda la página
  return page;
}

function u32le(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
function strBytes(s) { return new TextEncoder().encode(s); }

function opusTagsPacket() {
  const vendor = strBytes('AUDIT SOUND');
  const parts = [strBytes('OpusTags'), u32le(vendor.length), vendor, u32le(0)];
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// preSkip (muestras) dentro de la cabecera OpusHead (bytes 10-11, LE).
function preSkipOf(opusHead) {
  if (!opusHead || opusHead.length < 12) return 3840;
  return opusHead[10] | (opusHead[11] << 8);
}

// Decodifica los bytes de entrada a PCM a 48 kHz (1 o 2 canales).
async function decodeTo48k(bytes) {
  const OC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : webkitOfflineAudioContext;
  const probe = new OC(2, 1, OPUS_RATE);                 // decodeAudioData remuestrea a 48k
  const buf = await probe.decodeAudioData(bytes.slice(0));
  const ch = Math.min(2, buf.numberOfChannels || 1);
  const n = buf.length;
  const L = buf.getChannelData(0);
  const R = ch > 1 ? buf.getChannelData(1) : null;
  const inter = new Float32Array(n * ch);
  if (ch === 1) inter.set(L);
  else for (let i = 0; i < n; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
  return { inter, channels: ch, frames: n };
}

// Convierte `bytes` (ArrayBuffer) a Opus. Devuelve { bytes:ArrayBuffer, name:'....opus' }.
export async function toOpus(bytes, name, { bitrate = 160000, onProgress } = {}) {
  if (!available()) throw new Error('este navegador no puede codificar Opus (usa Chrome/Edge en computadora)');
  const { inter, channels, frames } = await decodeTo48k(bytes);

  const cfg = { codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: channels, bitrate };
  const sup = await AudioEncoder.isConfigSupported(cfg);
  if (!sup.supported) throw new Error('Opus no soportado por este navegador');

  const packets = [];            // { data:Uint8Array, samples:int }
  let opusHead = null;
  let encErr = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      if (!opusHead && meta && meta.decoderConfig && meta.decoderConfig.description)
        opusHead = new Uint8Array(meta.decoderConfig.description);
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      const samples = Math.round((chunk.duration || 20000) * OPUS_RATE / 1e6);
      packets.push({ data: d, samples });
    },
    error: (e) => { encErr = e; },
  });
  enc.configure(cfg);

  // Alimenta el PCM en bloques de 1 s.
  const block = OPUS_RATE; // frames por bloque
  for (let start = 0; start < frames; start += block) {
    if (encErr) break;
    const cnt = Math.min(block, frames - start);
    const slice = inter.subarray(start * channels, (start + cnt) * channels);
    const ad = new AudioData({
      format: 'f32', sampleRate: OPUS_RATE, numberOfFrames: cnt, numberOfChannels: channels,
      timestamp: Math.round(start / OPUS_RATE * 1e6), data: slice,
    });
    enc.encode(ad); ad.close();
    if (onProgress) { try { onProgress(start / frames); } catch (x) {} }
  }
  await enc.flush();
  enc.close();
  if (encErr) throw new Error('error de codificación Opus: ' + (encErr.message || encErr));
  if (!packets.length) throw new Error('no se generó audio Opus');

  // Si el navegador no entregó OpusHead, lo construimos (mapping family 0).
  if (!opusHead) {
    opusHead = new Uint8Array(19);
    opusHead.set(strBytes('OpusHead'), 0);
    opusHead[8] = 1;                      // versión
    opusHead[9] = channels;               // canales
    opusHead[10] = 3840 & 0xff; opusHead[11] = (3840 >> 8) & 0xff;  // pre-skip
    new DataView(opusHead.buffer).setUint32(12, OPUS_RATE, true);   // tasa original
    // gain(16-17)=0, mapping family(18)=0
  }
  const preSkip = preSkipOf(opusHead);

  // ---- Muxing Ogg ----
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages = [];
  pages.push(buildPage(serial, 0, 0x02, 0, [opusHead]));   // BOS
  pages.push(buildPage(serial, 1, 0x00, 0, [opusTagsPacket()]));
  let seq = 2, granule = preSkip, group = [], groupSegs = 0;
  const flushGroup = (eos) => {
    if (!group.length) return;
    pages.push(buildPage(serial, seq++, eos ? 0x04 : 0x00, granule, group.map((p) => p.data)));
    group = []; groupSegs = 0;
  };
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    const segs = laceOf(p.data.length).length;
    if (groupSegs + segs > 255) flushGroup(false);   // la página no puede pasar de 255 segmentos
    group.push(p); groupSegs += segs; granule += p.samples;
    const last = i === packets.length - 1;
    if (groupSegs >= 250 || last) flushGroup(last);
  }

  let total = 0; for (const pg of pages) total += pg.length;
  const out = new Uint8Array(total); let o = 0; for (const pg of pages) { out.set(pg, o); o += pg.length; }
  if (onProgress) { try { onProgress(1); } catch (x) {} }
  return { bytes: out.buffer, name: opusName(name) };
}
