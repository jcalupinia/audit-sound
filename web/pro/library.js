// Biblioteca persistente del mezclador PRO (IndexedDB).
// Guarda los bytes del archivo + sus metadatos (BPM/tono/energía) para que las
// pistas se recuerden entre sesiones del navegador: al recargar la página, la
// biblioteca vuelve a estar disponible sin volver a elegir los archivos.
//
// Todo vive en el navegador (origen del sitio). No se sube nada a ningún servidor.
// Cada lectura/escritura va envuelta en try/catch del lado del consumidor; aquí
// las promesas rechazan con el error de IndexedDB para que la UI pueda avisar.
//
// La clave de cada pista es su NOMBRE de archivo (dedup natural: re-añadir el mismo
// nombre reemplaza la entrada). El registro guarda:
//   { id, name, bpm, key, energy, size, type, addedAt, bytes:ArrayBuffer }

const DB_NAME = 'auditsound';
const STORE = 'tracks';
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB no disponible')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ¿Está disponible la persistencia en este navegador/contexto?
export function available() {
  return typeof indexedDB !== 'undefined';
}

// Guarda (o reemplaza) una pista. `rec` debe traer name + bytes (ArrayBuffer).
// Devuelve los metadatos guardados (sin los bytes).
export async function putTrack(rec) {
  const db = await openDB();
  const id = rec.id || rec.name;
  const row = {
    id,
    name: rec.name || id,
    bpm: +rec.bpm || 0,
    key: (rec.key ?? -1) | 0,
    energy: +rec.energy || 0,
    size: rec.size || (rec.bytes ? rec.bytes.byteLength : 0),
    type: rec.type || '',
    addedAt: rec.addedAt || Date.now(),
    bytes: rec.bytes,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transacción abortada'));
  });
  db.close();
  const { bytes, ...meta } = row;
  return meta;
}

// Lista los metadatos de todas las pistas (SIN los bytes), ordenadas por antigüedad.
export async function listTracks() {
  const db = await openDB();
  const out = await new Promise((resolve, reject) => {
    const res = [];
    const tx = db.transaction(STORE, 'readonly');
    const cur = tx.objectStore(STORE).openCursor();
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { const { bytes, ...meta } = c.value; res.push(meta); c.continue(); }
      else resolve(res);
    };
    cur.onerror = () => reject(cur.error);
  });
  db.close();
  return out.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

// Recupera los bytes (ArrayBuffer) de una pista, o null si no existe.
export async function getBytes(id) {
  const db = await openDB();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return row ? row.bytes : null;
}

// Borra una pista por id.
export async function removeTrack(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// Vacía toda la biblioteca.
export async function clearAll() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
