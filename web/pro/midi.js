// Control MIDI del mezclador (P2c, Web MIDI API). Mapea mensajes MIDI (Control
// Change y Note On) a los controles del AudioBridge, con "MIDI Learn" y persistencia
// en localStorage. No depende de un controlador concreto: el usuario aprende cada
// control moviendo su perilla/fader/botón. Incluye un mapa por defecto razonable.
//
// El manejador de mensajes es _handle([status,d1,d2]) para poder probarlo con bytes
// sintéticos sin hardware.

// Destinos mapeables: id -> { label, kind, apply(bridge, v01, ctx) }
// kind 'range' usa el valor 0..1; 'trigger' se dispara en Note On (velocity>0).
export const TARGETS = {
  xfader:  { label: 'Crossfader',   kind: 'range',   apply: (b, v) => b.xfader(v) },
  master:  { label: 'Máster',       kind: 'range',   apply: (b, v) => b.master(v) },
  faderA:  { label: 'Fader A',      kind: 'range',   apply: (b, v) => b.fader(0, v) },
  faderB:  { label: 'Fader B',      kind: 'range',   apply: (b, v) => b.fader(1, v) },
  trimA:   { label: 'Trim A',       kind: 'range',   apply: (b, v) => b.gain(0, v * 1.5) },
  trimB:   { label: 'Trim B',       kind: 'range',   apply: (b, v) => b.gain(1, v * 1.5) },
  hiA:     { label: 'EQ Hi A',      kind: 'range',   apply: (b, v, c) => c.eq(0, 'high', v) },
  midA:    { label: 'EQ Mid A',     kind: 'range',   apply: (b, v, c) => c.eq(0, 'mid', v) },
  lowA:    { label: 'EQ Low A',     kind: 'range',   apply: (b, v, c) => c.eq(0, 'low', v) },
  hiB:     { label: 'EQ Hi B',      kind: 'range',   apply: (b, v, c) => c.eq(1, 'high', v) },
  midB:    { label: 'EQ Mid B',     kind: 'range',   apply: (b, v, c) => c.eq(1, 'mid', v) },
  lowB:    { label: 'EQ Low B',     kind: 'range',   apply: (b, v, c) => c.eq(1, 'low', v) },
  filterA: { label: 'Filtro A',     kind: 'range',   apply: (b, v) => b.filter(0, v * 2 - 1) },
  filterB: { label: 'Filtro B',     kind: 'range',   apply: (b, v) => b.filter(1, v * 2 - 1) },
  pitchA:  { label: 'Pitch A',      kind: 'range',   apply: (b, v) => b.rate(0, 1 + (v * 16 - 8) / 100) },
  pitchB:  { label: 'Pitch B',      kind: 'range',   apply: (b, v) => b.rate(1, 1 + (v * 16 - 8) / 100) },
  fxEcho:  { label: 'FX Eco',       kind: 'range',   apply: (b, v) => b.fxEcho(v) },
  fxReverb:{ label: 'FX Reverb',    kind: 'range',   apply: (b, v) => b.fxReverb(v) },
  fxFilter:{ label: 'FX Filtro',    kind: 'range',   apply: (b, v) => b.fxFilter(v * 2 - 1) },
  playA:   { label: 'Play A',       kind: 'trigger', apply: (b, _v, c) => b.play(0, c.togglePlay(0)) },
  playB:   { label: 'Play B',       kind: 'trigger', apply: (b, _v, c) => b.play(1, c.togglePlay(1)) },
  cueA:    { label: 'Cue A',        kind: 'trigger', apply: (b) => b.cue(0) },
  cueB:    { label: 'Cue B',        kind: 'trigger', apply: (b) => b.cue(1) },
};

// Mapa por defecto (CC estándar): clave "cc:<n>" o "note:<n>" (canal ignorado) -> targetId
const DEFAULT_MAP = {
  'cc:7': 'master', 'cc:8': 'faderA', 'cc:9': 'faderB', 'cc:10': 'xfader',
  'cc:11': 'hiA', 'cc:12': 'midA', 'cc:13': 'lowA', 'cc:14': 'hiB', 'cc:15': 'midB', 'cc:16': 'lowB',
  'cc:17': 'filterA', 'cc:18': 'filterB', 'cc:19': 'pitchA', 'cc:20': 'pitchB',
  'cc:21': 'fxEcho', 'cc:22': 'fxReverb', 'cc:23': 'fxFilter',
  'note:36': 'playA', 'note:37': 'playB', 'note:38': 'cueA', 'note:39': 'cueB',
};
const LS_KEY = 'auditsound.midimap';

export class MidiController {
  // getPlaying(deck) -> bool actual; se usa para alternar Play desde un botón MIDI.
  constructor(bridge, { getPlaying } = {}) {
    this.bridge = bridge;
    this.getPlaying = getPlaying || (() => false);
    this.access = null;
    this.inputs = [];
    this.map = this._load();
    this.learnTarget = null;     // targetId en espera de aprender
    this.onLearned = null;       // callback(key, targetId)
    this.onDevices = null;       // callback([names])
    this._eq = [{ low: 0, mid: 0, high: 0 }, { low: 0, mid: 0, high: 0 }];
  }

  _load() {
    try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch (e) {}
    return { ...DEFAULT_MAP };
  }
  _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.map)); } catch (e) {} }

  async connect() {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI no disponible en este navegador');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => {
      this.inputs = [];
      this.access.inputs.forEach((inp) => {
        this.inputs.push(inp.name || inp.id);
        inp.onmidimessage = (e) => this._handle(e.data);
      });
      if (this.onDevices) this.onDevices(this.inputs.slice());
    };
    bind();
    this.access.onstatechange = bind;
    return this.inputs.slice();
  }

  // Helpers expuestos a TARGETS.apply
  eq(deck, band, v01) {
    this._eq[deck][band] = v01 * 32 - 26;  // 0..1 -> -26..+6 dB
    this.bridge.eq(deck, this._eq[deck].low, this._eq[deck].mid, this._eq[deck].high);
  }
  togglePlay(deck) { return !this.getPlaying(deck); }

  // Arranca/cancela el aprendizaje de un control.
  learn(targetId) { this.learnTarget = targetId || null; }
  clearMapping(targetId) {
    for (const k of Object.keys(this.map)) if (this.map[k] === targetId) delete this.map[k];
    this._save();
  }
  resetMap() { this.map = { ...DEFAULT_MAP }; this._save(); }
  mappingFor(targetId) { return Object.keys(this.map).find((k) => this.map[k] === targetId) || null; }

  // Procesa un mensaje MIDI: [status, data1, data2].
  _handle(data) {
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0, d1 = data[1], d2 = data.length > 2 ? data[2] : 0;
    let key = null;
    if (status === 0xB0) key = 'cc:' + d1;                 // Control Change
    else if (status === 0x90 && d2 > 0) key = 'note:' + d1; // Note On (velocity>0)
    else if (status === 0x80 || (status === 0x90 && d2 === 0)) return;  // Note Off: ignorar
    else return;

    // MIDI Learn: asignar este control al target en espera.
    if (this.learnTarget) {
      // quita cualquier binding previo de ese target y de esa tecla
      this.clearMapping(this.learnTarget);
      delete this.map[key];
      this.map[key] = this.learnTarget;
      const learned = this.learnTarget; this.learnTarget = null; this._save();
      if (this.onLearned) this.onLearned(key, learned);
      return;
    }

    const targetId = this.map[key];
    if (!targetId) return;
    const t = TARGETS[targetId];
    if (!t) return;
    if (t.kind === 'trigger') t.apply(this.bridge, 1, this);
    else t.apply(this.bridge, d2 / 127, this);
  }
}
