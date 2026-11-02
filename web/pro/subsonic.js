// Cliente Subsonic para el navegador (Navidrome implementa esta API).
// Permite buscar en tu propio servidor de música y traer una pista como bytes
// para cargarla en el mezclador o guardarla en la biblioteca persistente.
//
// Autenticación por TOKEN con sal (recomendada por Subsonic): la contraseña se
// usa una sola vez para derivar token = md5(password + salt); se guardan en
// localStorage solo {url, user, salt, token}, NUNCA la contraseña en claro.
//
// Requisitos del servidor (se documentan en el panel si fallan):
//  - HTTPS si el mezclador está en HTTPS (mezcla de contenido).
//  - CORS habilitado (Access-Control-Allow-Origin) para el origen del mezclador:
//    la página usa COEP require-corp, así que la respuesta debe ser CORS válida.

const LS_KEY = 'auditsound.subsonic';
const CLIENT = 'auditsound';
const API_VERSION = '1.16.1';

// ---- MD5 (compacto, para el token de Subsonic; SubtleCrypto no ofrece MD5) ----
// Implementación clásica sobre cadenas UTF-8. Devuelve hex en minúsculas.
function md5(str) {
  function toBytes(s) { return unescape(encodeURIComponent(s)); } // a UTF-8
  function add(x, y) { const l = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff); }
  function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
  function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function toBlocks(s) {
    const n = s.length, blks = [];
    for (let i = 0; i < n * 8; i += 8) blks[i >> 5] = (blks[i >> 5] || 0) | ((s.charCodeAt(i / 8) & 0xff) << (i % 32));
    const tail = n * 8;
    blks[tail >> 5] = (blks[tail >> 5] || 0) | (0x80 << (tail % 32));
    blks[(((tail + 64) >>> 9) << 4) + 14] = tail;
    for (let i = 0; i < (((tail + 64) >>> 9) << 4) + 16; i++) blks[i] = blks[i] || 0;
    return blks;
  }
  const s = toBytes(str), x = toBlocks(s);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hex = (n) => { let s = ''; for (let i = 0; i < 4; i++) s += ((n >> (i * 8 + 4)) & 0x0f).toString(16) + ((n >> (i * 8)) & 0x0f).toString(16); return s; };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

export { md5 };  // exportado para pruebas (vectores conocidos)

function randomSalt() {
  const a = new Uint8Array(8);
  (self.crypto || window.crypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class SubsonicClient {
  constructor(cfg) { this.cfg = cfg || loadConfig(); }

  get configured() { return !!(this.cfg && this.cfg.url && this.cfg.user && this.cfg.token && this.cfg.salt); }

  // Normaliza la URL base (sin barra final; admite que el usuario pegue .../rest).
  static baseFrom(url) { return String(url || '').trim().replace(/\/+$/, '').replace(/\/rest$/i, ''); }

  _params(extra) {
    const p = new URLSearchParams({
      u: this.cfg.user, t: this.cfg.token, s: this.cfg.salt,
      v: API_VERSION, c: CLIENT, ...(extra || {}),
    });
    return p;
  }
  _url(view, extra) { return `${this.cfg.url}/rest/${view}?${this._params(extra).toString()}`; }

  // Prueba la conexión y las credenciales. Lanza con un mensaje claro si falla.
  async ping() {
    let res;
    try { res = await fetch(this._url('ping.view', { f: 'json' }), { mode: 'cors' }); }
    catch (e) { throw new Error('no se pudo conectar (¿URL, HTTPS o CORS del servidor?): ' + (e.message || e)); }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' del servidor');
    const j = await res.json();
    const r = j['subsonic-response'] || {};
    if (r.status !== 'ok') throw new Error((r.error && r.error.message) || 'credenciales rechazadas');
    return { version: r.version, type: r.type };
  }

  // Busca canciones. Devuelve [{id,title,artist,album,duration,suffix,size}].
  async search(query, count = 25) {
    const res = await fetch(this._url('search3.view', { query: query || '', songCount: count, artistCount: 0, albumCount: 0, f: 'json' }), { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = (await res.json())['subsonic-response'] || {};
    if (r.status !== 'ok') throw new Error((r.error && r.error.message) || 'búsqueda rechazada');
    const songs = (r.searchResult3 && r.searchResult3.song) || [];
    return songs.map((s) => ({
      id: s.id, title: s.title || s.id, artist: s.artist || '', album: s.album || '',
      duration: s.duration || 0, suffix: s.suffix || '', size: s.size || 0,
    }));
  }

  // Canciones por GÉNERO (para "armar set" por estilo, p. ej. merengue).
  async songsByGenre(genre, count = 25) {
    const res = await fetch(this._url('getSongsByGenre.view', { genre: genre || '', count, f: 'json' }), { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = (await res.json())['subsonic-response'] || {};
    if (r.status !== 'ok') throw new Error((r.error && r.error.message) || 'género rechazado');
    const songs = (r.songsByGenre && r.songsByGenre.song) || [];
    return songs.map((s) => ({
      id: s.id, title: s.title || s.id, artist: s.artist || '', album: s.album || '',
      duration: s.duration || 0, suffix: s.suffix || '', size: s.size || 0,
    }));
  }

  // Nombre de archivo sugerido para una canción.
  static filename(song) {
    const base = [song.artist, song.title].filter(Boolean).join(' - ') || song.id;
    return base.replace(/[\/\\:*?"<>|]+/g, '_') + (song.suffix ? '.' + song.suffix : '');
  }

  // Descarga el archivo ORIGINAL (sin transcodificar) como ArrayBuffer.
  async getBytes(id) {
    const res = await fetch(this._url('download.view', { id }), { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' al descargar');
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('json') || ct.includes('xml')) {  // el servidor devolvió un error, no audio
      let msg = 'el servidor devolvió un error en vez de audio';
      try { const j = await res.json(); msg = (j['subsonic-response'] && j['subsonic-response'].error && j['subsonic-response'].error.message) || msg; } catch (e) {}
      throw new Error(msg);
    }
    return await res.arrayBuffer();
  }
}

// ---- Persistencia de la configuración (sin contraseña en claro) ----
export function saveConfig({ url, user, password }) {
  const base = SubsonicClient.baseFrom(url);
  const salt = randomSalt();
  const token = md5((password || '') + salt);
  const cfg = { url: base, user: String(user || '').trim(), salt, token };
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {}
  return cfg;
}
export function loadConfig() {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export function clearConfig() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
