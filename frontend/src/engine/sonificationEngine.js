const DEFAULT_BASE_FREQ = 220; // A3
const MINOR_PENTATONIC = [0, 3, 5, 7, 10]; // semitones

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function freqForNorm(norm, baseFreq = DEFAULT_BASE_FREQ) {
  const notesPerOctave = MINOR_PENTATONIC.length;
  const totalNotes = notesPerOctave * 4; // ~4 octaves
  const idx = Math.floor(clamp01(norm) * (totalNotes - 1));
  const octave = Math.floor(idx / notesPerOctave);
  const degree = idx % notesPerOctave;
  const semitone = MINOR_PENTATONIC[degree] + octave * 12;
  return baseFreq * 2 ** (semitone / 12);
}

export function createSonificationEngine() {
  let audioCtx = null;
  let masterGain = null;
  let isPlaying = false;
  let timerId = null;

  let rows = [];
  let column = "";
  let anomaliesByIndex = new Map(); // index -> severity 0..1
  let speed = 1;
  let position = 0;
  let onPosition = null;

  let min = 0;
  let max = 1;

  function ensureAudio() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.12;
    masterGain.connect(audioCtx.destination);
  }

  function computeMinMax() {
    let localMin = Infinity;
    let localMax = -Infinity;
    for (const r of rows) {
      const n = toNumber(r?.[column]);
      if (!Number.isFinite(n)) continue;
      localMin = Math.min(localMin, n);
      localMax = Math.max(localMax, n);
    }
    if (!Number.isFinite(localMin) || !Number.isFinite(localMax) || localMin === localMax) {
      min = 0;
      max = 1;
      return;
    }
    min = localMin;
    max = localMax;
  }

  function noteAt(idx) {
    ensureAudio();
    if (!audioCtx || !masterGain) return;
    if (audioCtx.state === "suspended") {
      // Resume must happen inside a user gesture; if it fails, we'll just skip the note.
      audioCtx.resume().catch(() => {});
    }

    const r = rows[idx];
    const n = toNumber(r?.[column]);
    const norm = clamp01((n - min) / (max - min));
    const baseFreq = freqForNorm(norm);
    const severity = anomaliesByIndex.get(idx) ?? 0;

    const t0 = audioCtx.currentTime;
    const dur = 0.09;

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(lerp(0.02, 0.08, norm), t0 + 0.01);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    g.connect(masterGain);

    const o1 = audioCtx.createOscillator();
    o1.type = "sine";
    o1.frequency.setValueAtTime(baseFreq, t0);
    o1.connect(g);
    o1.start(t0);
    o1.stop(t0 + dur);

    if (severity > 0) {
      const o2 = audioCtx.createOscillator();
      const dissonant = baseFreq * 2 ** (6 / 12); // tritone
      o2.type = "triangle";
      o2.frequency.setValueAtTime(dissonant, t0);

      const g2 = audioCtx.createGain();
      g2.gain.setValueAtTime(0, t0);
      g2.gain.linearRampToValueAtTime(lerp(0.01, 0.08, severity), t0 + 0.01);
      g2.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      g2.connect(masterGain);

      o2.connect(g2);
      o2.start(t0);
      o2.stop(t0 + dur);
    }
  }

  function tick() {
    if (!isPlaying) return;
    if (!rows.length) return;
    noteAt(position);
    position = (position + 1) % rows.length;
    onPosition?.(position);
  }

  function clearTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function setTempo(newSpeed) {
    speed = Math.max(0.25, Math.min(8, Number(newSpeed) || 1));
    if (isPlaying) {
      clearTimer();
      timerId = window.setInterval(tick, Math.round(140 / speed));
    }
  }

  return {
    setDataset(nextRows, nextColumn, anomalies) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      column = String(nextColumn || "");
      position = 0;

      const maxAbs = Math.max(
        1,
        ...(Array.isArray(anomalies) ? anomalies : []).map((a) => Math.abs(toNumber(a?.score) || 1)),
      );
      anomaliesByIndex = new Map(
        (Array.isArray(anomalies) ? anomalies : [])
          .filter((a) => Number.isFinite(Number(a?.index)))
          .map((a) => [Number(a.index), clamp01(Math.abs(toNumber(a?.score) || 1) / maxAbs)]),
      );

      computeMinMax();
    },
    setOnPosition(cb) {
      onPosition = typeof cb === "function" ? cb : null;
    },
    setPosition(nextPos) {
      position = Math.max(0, Math.min(rows.length ? rows.length - 1 : 0, Number(nextPos) || 0));
      onPosition?.(position);
    },
    setSpeed(nextSpeed) {
      setTempo(nextSpeed);
    },
    play() {
      isPlaying = true;
      setTempo(speed);
    },
    pause() {
      isPlaying = false;
      clearTimer();
    },
    destroy() {
      isPlaying = false;
      clearTimer();
      try {
        masterGain?.disconnect();
      } catch (_) {}
      masterGain = null;
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      audioCtx = null;
    },
    getState() {
      return { isPlaying, speed, position, rows: rows.length, column };
    },
  };
}

