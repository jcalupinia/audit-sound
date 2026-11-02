// Copiloto IA del Modo B (P3). La IA ANALIZA y RECOMIENDA, pero NO ejecuta nada:
// solo devuelve sugerencias (pista compatible, punto/efecto de transición) y aprende
// de lo que el DJ acepta. El DJ es quien ejecuta (botón "Preparar"). La lógica de
// recomendación reutiliza los mismos criterios del selector (Camelot + BPM + energía),
// pero sin tocar el motor ni cargar audio: es pura evaluación read-only.

// --- Rueda Camelot (misma convención que engine/selector) ---
const MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
export function camelot(key) {
  if (key < 0 || key > 23) return '—';
  return key <= 11 ? (MAJ[key] + 'B') : (MAJ[((key - 12) + 3) % 12] + 'A');
}
function camNum(key) { return key <= 11 ? MAJ[key] : MAJ[((key - 12) + 3) % 12]; }
function isMinor(key) { return key > 11; }
export function keysCompatible(a, b) {
  if (a < 0 || b < 0 || a > 23 || b > 23) return false;
  const na = camNum(a), nb = camNum(b);
  if (na === nb) return true;                 // mismo número (relativo mayor/menor o igual)
  const dn = Math.abs(na - nb);
  return isMinor(a) === isMinor(b) && (dn === 1 || dn === 11);  // ±1 en la rueda, mismo modo
}

const LS = 'auditsound.copilot.prefs';

export class Copilot {
  constructor() {
    this.library = [];                 // {id, name, bpm, key, energy}
    this.prefs = this._load();         // aprendizaje: sesgo de energía y tolerancia de BPM
    this.weights = { harmony: 0.45, tempo: 0.30, energy: 0.25 };
  }
  _load() {
    try { const s = localStorage.getItem(LS); if (s) return JSON.parse(s); } catch (e) {}
    return { energyBias: 0.0, bpmTol: 8.0, accepts: 0 };
  }
  _save() { try { localStorage.setItem(LS, JSON.stringify(this.prefs)); } catch (e) {} }

  addTrack(t) {
    if (!t || !t.name) return;
    if (this.library.some(x => x.id === t.id || x.name === t.name)) return;
    this.library.push({ id: t.id ?? t.name, name: t.name, bpm: +t.bpm || 0, key: (t.key ?? -1) | 0, energy: +t.energy || 0 });
  }
  size() { return this.library.length; }

  // Recomienda las N mejores siguientes para el estado actual, SIN ejecutar nada.
  // current = {name, bpm, key, energy}. Devuelve [{track, score, dBpm, harmonic, reason}].
  recommend(current, n = 5) {
    if (!current) return [];
    const tol = Math.max(3, this.prefs.bpmTol);
    const targetE = Math.max(0, Math.min(1, (current.energy || 0) + this.prefs.energyBias));
    const out = [];
    for (const t of this.library) {
      if (current.name && t.name === current.name) continue;
      const harmonic = keysCompatible(current.key, t.key);
      const hScore = harmonic ? 1 : (camNum(current.key) === camNum(t.key) ? 0.5 : 0.15);
      const dBpm = (current.bpm > 0 && t.bpm > 0) ? (t.bpm - current.bpm) : 0;
      const tScore = Math.max(0, 1 - Math.abs(dBpm) / tol);
      const eScore = Math.max(0, 1 - Math.abs(t.energy - targetE) / 0.5);
      const score = this.weights.harmony * hScore + this.weights.tempo * tScore + this.weights.energy * eScore;
      out.push({ track: t, score, dBpm, harmonic, reason: this._reason(harmonic, dBpm, t.energy - (current.energy || 0)) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, n);
  }

  _reason(harmonic, dBpm, dE) {
    const parts = [];
    parts.push(harmonic ? 'tono compatible' : 'tono a revisar');
    const ad = Math.abs(dBpm);
    parts.push(ad < 1 ? 'mismo BPM' : (ad <= 3 ? ('Δ' + ad.toFixed(1) + ' BPM, mezcla directa') : ('Δ' + ad.toFixed(1) + ' BPM, ajusta pitch/sync')));
    parts.push(dE > 0.08 ? 'sube la energía' : (dE < -0.08 ? 'baja la energía' : 'energía pareja'));
    return parts.join(' · ');
  }

  // Sugerencia de transición/efecto (texto), NO se ejecuta.
  suggestTransition(current, rec) {
    if (!rec) return '';
    const ad = Math.abs(rec.dBpm);
    const tips = [];
    if (ad > 3) tips.push('iguala el BPM con SYNC o pitch antes de abrir');
    tips.push(rec.harmonic ? 'corte de graves (LOW) de la saliente y sube la entrante' : 'usa el FILTRO para suavizar el choque de tonos');
    if ((rec.track.energy - (current?.energy || 0)) > 0.1) tips.push('remata con un ECO corto al salir');
    return tips.join('; ');
  }

  // Aprendizaje: el DJ aceptó esta recomendación (la preparó). Ajusta preferencias.
  accept(current, rec) {
    if (!rec) return;
    const dE = rec.track.energy - (current?.energy || 0);
    this.prefs.energyBias = Math.max(-0.4, Math.min(0.4, this.prefs.energyBias * 0.8 + dE * 0.2));
    const ad = Math.abs(rec.dBpm);
    // Si acepta mezclas con más diferencia de BPM, ampliar la tolerancia (y viceversa).
    this.prefs.bpmTol = Math.max(3, Math.min(16, this.prefs.bpmTol * 0.85 + Math.max(ad, 3) * 0.15));
    this.prefs.accepts = (this.prefs.accepts || 0) + 1;
    this._save();
  }
  resetLearning() { this.prefs = { energyBias: 0, bpmTol: 8, accepts: 0 }; this._save(); }
}
