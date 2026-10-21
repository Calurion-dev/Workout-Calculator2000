/* Chrono WOD — a self-contained workout timer for Workout Calculator 2000 */
(() => {
  'use strict';

  const STORAGE = {
    settings: 'calisthenics_timer_settings',
    presets: 'calisthenics_timer_presets',
    log: 'calisthenics_timer_log',
  };

  const MODES = {
    amrap: {
      label: 'AMRAP', color: '#f59e0b', icon: 'repeat-2',
      tagline: 'Autant de tours que possible',
      setupTitle: 'Autant de tours que possible',
      setupSub: 'Choisis la durée. Chaque appui sur « Tour +1 » enregistre un tour.',
    },
    fortime: {
      label: 'FOR TIME', color: '#4f7cff', icon: 'flag',
      tagline: 'Le plus vite possible',
      setupTitle: 'Termine le plus vite possible',
      setupSub: 'Le chrono monte. Ajoute une limite de temps si tu veux un cap.',
    },
    emom: {
      label: 'EMOM', color: '#a855f7', icon: 'hourglass',
      tagline: 'Chaque minute compte',
      setupTitle: 'Chaque intervalle compte',
      setupSub: 'Un signal au début de chaque intervalle. Le nombre de tours est calculé automatiquement.',
    },
    tabata: {
      label: 'TABATA', color: '#10b981', icon: 'zap',
      tagline: 'Travail / repos, sans pitié',
      setupTitle: 'Travail. Repos. Recommence.',
      setupSub: 'Le dernier repos est supprimé : 8 × 20/10 = 3 min 50.',
    },
    mix: {
      label: 'MIX', color: '#6b7280', icon: 'layers',
      tagline: 'Enchaîne les blocs',
      setupTitle: 'Compose ton MIX',
      setupSub: 'AMRAP, For Time, EMOM, Tabata, travail ou repos : mets les blocs dans l’ordre.',
    },
  };

  const TYPE_INFO = {
    amrap: { label: 'AMRAP', color: '#f59e0b' },
    fortime: { label: 'FOR TIME', color: '#4f7cff' },
    emom: { label: 'EMOM', color: '#a855f7' },
    tabata: { label: 'TABATA', color: '#10b981' },
    work: { label: 'TRAVAIL', color: '#64748b' },
    rest: { label: 'REPOS', color: '#475569' },
  };

  const DONE_MESSAGES = [
    'Beau travail. Les bras s’en souviendront.',
    'Séance validée. Le canapé peut attendre.',
    'C’est fait. Tu peux respirer.',
    'Chaque seconde compte. Tu viens de le prouver.',
    'Terminé. La prochaine fois, tu iras encore plus loin.',
    'Bien joué. Le chrono n’a rien pu faire contre toi.',
  ];

  const T = {
    root: null,
    view: 'menu',
    mode: 'amrap',
    config: null,
    mixConfig: { mode: 'mix', blocks: [], rounds: 1, notes: '' },
    mixDraft: null,
    run: null,
    settings: null,
    presets: [],
    log: [],
    lastEntry: null,
    summaryEntry: null,
    confirmStop: null,
    baseTitle: 'Workout Calculator 2000',
    lastFocus: null,
  };

  let timerAudio = null;
  let timerWakeLock = null;
  let timerPresetDialog = null;
  let timerConfirmDialog = null;
  let timerSwipeState = null;

  function $(id) { return document.getElementById(id); }
  function now() { return performance.now(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pad2(value) { return String(value).padStart(2, '0'); }

  function tEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function clampNum(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function fmtClock(seconds, roundUp = false) {
    let total = Math.max(0, Number(seconds) || 0);
    total = roundUp ? Math.ceil(total) : Math.floor(total);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${pad2(minutes)}:${pad2(secs)}`;
  }

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }

  function timerToast(message, type = 'success') {
    if (typeof window.notify === 'function') window.notify(message, type);
    else console.log(message);
  }

  function timerIcons(root) {
    const target = root || T.root;
    if (typeof window.refreshIcons === 'function') {
      window.refreshIcons(target);
    } else if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ scope: target || document });
    }
  }

  function icon(name, size = 'w-4 h-4') {
    return `<i data-lucide="${name}" class="${size}" aria-hidden="true"></i>`;
  }

  /* ------------------------------------------------------------------ */
  /* Configuration                                                      */
  /* ------------------------------------------------------------------ */

  function timerDefaultConfig(mode) {
    if (mode === 'fortime') return { mode: 'fortime', cap: 0, notes: '' };
    if (mode === 'emom') return { mode: 'emom', duration: 600, interval: 60, notes: '' };
    if (mode === 'tabata') {
      return { mode: 'tabata', work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60, notes: '' };
    }
    if (mode === 'mix') return { mode: 'mix', blocks: [], rounds: 1, notes: '' };
    return { mode: 'amrap', duration: 600, notes: '' };
  }

  function timerNormalizeBlock(block) {
    if (!block || !TYPE_INFO[block.type]) return null;
    const base = {
      type: block.type,
      label: String(block.label || TYPE_INFO[block.type].label).slice(0, 60),
    };
    if (block.type === 'amrap' || block.type === 'work' || block.type === 'rest') {
      base.duration = clampNum(block.duration, 1, 7200, block.type === 'rest' ? 60 : 300);
    } else if (block.type === 'fortime') {
      base.cap = clampNum(block.cap, 0, 7200, 0);
    } else if (block.type === 'emom') {
      base.duration = clampNum(block.duration, 1, 7200, 600);
      base.interval = clampNum(block.interval, 5, 600, 60);
    } else if (block.type === 'tabata') {
      base.work = clampNum(block.work, 1, 600, 20);
      base.rest = clampNum(block.rest, 0, 600, 10);
      base.rounds = Math.round(clampNum(block.rounds, 1, 99, 8));
      base.sets = Math.round(clampNum(block.sets, 1, 20, 1));
      base.setRest = clampNum(block.setRest, 0, 900, 60);
    }
    return base;
  }

  function timerNormalizeConfig(config) {
    const mode = config && MODES[config.mode] ? config.mode : 'amrap';
    const out = timerDefaultConfig(mode);
    const source = config && typeof config === 'object' ? config : {};
    out.notes = String(source.notes || '').slice(0, 1000);
    if (mode === 'amrap') {
      out.duration = clampNum(source.duration, 1, 7200, 600);
    } else if (mode === 'fortime') {
      out.cap = clampNum(source.cap, 0, 7200, 0);
    } else if (mode === 'emom') {
      out.duration = clampNum(source.duration, 1, 7200, 600);
      out.interval = clampNum(source.interval, 5, 600, 60);
    } else if (mode === 'tabata') {
      out.work = clampNum(source.work, 1, 600, 20);
      out.rest = clampNum(source.rest, 0, 600, 10);
      out.rounds = Math.round(clampNum(source.rounds, 1, 99, 8));
      out.sets = Math.round(clampNum(source.sets, 1, 20, 1));
      out.setRest = clampNum(source.setRest, 0, 900, 60);
    } else if (mode === 'mix') {
      const blocks = Array.isArray(source.blocks) ? source.blocks : [];
      out.blocks = blocks.map(timerNormalizeBlock).filter(Boolean).slice(0, 40);
      out.rounds = Math.round(clampNum(source.rounds, 1, 99, 1));
    }
    return out;
  }

  function timerConfigSummary(config) {
    const c = timerNormalizeConfig(config);
    if (c.mode === 'amrap') return `${Math.round(c.duration / 60)} min`;
    if (c.mode === 'fortime') return c.cap ? `Cap ${fmtClock(c.cap)}` : 'Sans limite';
    if (c.mode === 'emom') return `${Math.round(c.duration / 60)} min · ${c.interval}s`;
    if (c.mode === 'tabata') {
      const sets = c.sets > 1 ? `${c.sets}×` : '';
      return `${sets}${c.rounds} × ${c.work}/${c.rest}s`;
    }
    const plural = c.blocks.length > 1 ? 's' : '';
    return `${c.blocks.length} bloc${plural} · ${c.rounds} tour${c.rounds > 1 ? 's' : ''}`;
  }

  function timerModeInfo(mode) {
    return MODES[mode] || MODES.amrap;
  }

  /* ------------------------------------------------------------------ */
  /* Timeline                                                           */
  /* ------------------------------------------------------------------ */

  function timerBuildTimeline(config) {
    const c = timerNormalizeConfig(config);
    const mode = timerModeInfo(c.mode);
    const phases = [];
    let unknown = false;

    if (T.settings && T.settings.intro > 0) {
      phases.push({
        kind: 'intro', seconds: T.settings.intro, label: 'PRÊT', color: '#94a3b8',
        countUp: false, allowLaps: false, sublabel: 'Concentration',
      });
    }

    function push(p) {
      if (p.countUp || p.seconds > 0) phases.push(p);
    }

    function pushTabata(work, rest, rounds, sets, setRest, block, blockIndex, repeat, repeatTotal, color) {
      const totalWork = rounds * sets;
      let done = 0;
      for (let set = 0; set < sets; set += 1) {
        for (let round = 0; round < rounds; round += 1) {
          done += 1;
          push({
            kind: 'work', seconds: work, label: 'TRAVAIL', color,
            round: done, totalRounds: totalWork, allowLaps: false, countUp: false,
            blockLabel: block ? block.label : '', blockIndex, blockType: 'tabata',
            mixRepeat: repeat, mixRepeatTotal: repeatTotal,
          });
          if (done < totalWork) {
            const setEnd = round === rounds - 1;
            const pause = setEnd ? setRest : rest;
            if (pause > 0) {
              push({
                kind: 'rest', seconds: pause, label: setEnd ? 'RÉCUPÉRATION' : 'REPOS',
                color, round: done, totalRounds: totalWork, allowLaps: false, countUp: false,
                blockLabel: block ? block.label : '', blockIndex, blockType: 'tabata',
                mixRepeat: repeat, mixRepeatTotal: repeatTotal,
              });
            }
          }
        }
      }
    }

    if (c.mode === 'amrap') {
      push({
        kind: 'amrap', seconds: c.duration, label: 'AMRAP', color: mode.color,
        allowLaps: true, countUp: false, blockLabel: '', mixRepeat: 0, mixRepeatTotal: 0,
      });
    } else if (c.mode === 'fortime') {
      push({
        kind: 'fortime', countUp: true, cap: c.cap, seconds: 0, label: 'FOR TIME',
        color: mode.color, allowLaps: true, blockLabel: '', mixRepeat: 0, mixRepeatTotal: 0,
      });
      if (!c.cap) unknown = true;
    } else if (c.mode === 'emom') {
      const totalRounds = Math.max(1, Math.ceil(c.duration / c.interval));
      let remaining = c.duration;
      let index = 0;
      while (remaining > 0.001 && index < 500) {
        index += 1;
        const segment = Math.min(c.interval, remaining);
        push({
          kind: 'emom', seconds: segment, label: 'EMOM', color: mode.color,
          round: index, totalRounds, allowLaps: false, countUp: false,
          blockLabel: '', mixRepeat: 0, mixRepeatTotal: 0,
        });
        remaining -= segment;
      }
    } else if (c.mode === 'tabata') {
      pushTabata(c.work, c.rest, c.rounds, c.sets, c.setRest, null, -1, 0, 0, mode.color);
    } else if (c.mode === 'mix') {
      const repeats = c.rounds;
      for (let rep = 1; rep <= repeats; rep += 1) {
        c.blocks.forEach((block, blockIndex) => {
          const info = TYPE_INFO[block.type] || TYPE_INFO.work;
          const label = block.label || info.label;
          if (block.type === 'amrap') {
            push({
              kind: 'amrap', seconds: block.duration, label, color: info.color,
              allowLaps: true, countUp: false, blockLabel: label, blockIndex,
              blockType: block.type, mixRepeat: rep, mixRepeatTotal: repeats,
            });
          } else if (block.type === 'fortime') {
            push({
              kind: 'fortime', countUp: true, cap: block.cap, seconds: 0, label,
              color: info.color, allowLaps: true, blockLabel: label, blockIndex,
              blockType: block.type, mixRepeat: rep, mixRepeatTotal: repeats,
            });
            if (!block.cap) unknown = true;
          } else if (block.type === 'emom') {
            const totalRounds = Math.max(1, Math.ceil(block.duration / block.interval));
            let remaining = block.duration;
            let index = 0;
            while (remaining > 0.001 && index < 500) {
              index += 1;
              const segment = Math.min(block.interval, remaining);
              push({
                kind: 'emom', seconds: segment, label, color: info.color,
                round: index, totalRounds, allowLaps: false, countUp: false,
                blockLabel: label, blockIndex, blockType: block.type,
                mixRepeat: rep, mixRepeatTotal: repeats,
              });
              remaining -= segment;
            }
          } else if (block.type === 'tabata') {
            pushTabata(
              block.work, block.rest, block.rounds, block.sets, block.setRest,
              block, blockIndex, rep, repeats, info.color,
            );
          } else {
            push({
              kind: block.type === 'rest' ? 'rest' : 'work',
              seconds: block.duration,
              label,
              color: info.color,
              allowLaps: false,
              countUp: false,
              blockLabel: label,
              blockIndex,
              blockType: block.type,
              mixRepeat: rep,
              mixRepeatTotal: repeats,
            });
          }
        });
      }
    }

    const totalSeconds = phases.reduce((sum, phase) => sum + (phase.countUp ? (phase.cap || 0) : phase.seconds), 0);
    return {
      mode: c.mode, label: mode.label, config: c, phases, totalSeconds, unknown,
    };
  }

  function timerEstimateText(config) {
    const c = timerNormalizeConfig(config);
    if (c.mode === 'fortime' && !c.cap) return 'Sans limite';
    if (c.mode === 'mix' && !c.blocks.length) return '—';
    const timeline = timerBuildTimeline(c);
    if (timeline.unknown) return 'Durée variable';
    return fmtClock(timeline.totalSeconds);
  }

  /* ------------------------------------------------------------------ */
  /* Audio + wake lock                                                  */
  /* ------------------------------------------------------------------ */

  function timerAudioContext() {
    if (!T.settings || !T.settings.sound) return null;
    if (!timerAudio) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      try { timerAudio = new AudioCtor(); } catch { return null; }
    }
    if (timerAudio.state === 'suspended') timerAudio.resume().catch(() => {});
    return timerAudio;
  }

  function timerTone(frequency, offset, duration, type, volume) {
    const ctx = timerAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + offset;
      const pack = T.settings.soundPack;
      const wave = pack === 'bell' ? 'triangle' : pack === 'boxing' ? 'square' : type;
      const level = pack === 'soft' ? volume * 0.55 : volume;
      osc.type = wave;
      osc.frequency.setValueAtTime(frequency, start);
      if (pack === 'bell') {
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 2.4);
      } else {
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      }
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration * (pack === 'bell' ? 2.6 : 1.1));
    } catch { /* audio is non-critical */ }
  }

  function timerSound(kind) {
    if (!T.settings || !T.settings.sound) return;
    const pack = T.settings.soundPack;
    const pause = pack === 'bell' ? 0.1 : 0.075;
    if (kind === 'start') {
      timerTone(523, 0, 0.12, 'sine', 0.14);
      timerTone(659, pause, 0.12, 'sine', 0.14);
      timerTone(880, pause * 2, 0.2, 'sine', 0.16);
    } else if (kind === 'phase') {
      timerTone(740, 0, 0.11, 'sine', 0.12);
      timerTone(988, pause, 0.14, 'sine', 0.12);
    } else if (kind === 'rest') {
      timerTone(440, 0, 0.16, 'sine', 0.1);
      timerTone(330, pause, 0.2, 'sine', 0.1);
    } else if (kind === 'tick') {
      timerTone(880, 0, 0.055, 'square', 0.055);
    } else if (kind === 'half') {
      timerTone(659, 0, 0.1, 'sine', 0.1);
    } else if (kind === 'minute') {
      timerTone(988, 0, 0.08, 'sine', 0.1);
    } else if (kind === 'lap') {
      timerTone(1046, 0, 0.07, 'sine', 0.1);
    } else if (kind === 'finish') {
      timerTone(523, 0, 0.14, 'sine', 0.14);
      timerTone(659, 0.13, 0.14, 'sine', 0.14);
      timerTone(784, 0.26, 0.18, 'sine', 0.16);
      timerTone(1046, 0.4, 0.28, 'sine', 0.14);
    }
  }

  function timerSpeak(text) {
    if (!T.settings || !T.settings.voice || !text || !('speechSynthesis' in window)) return;
    try {
      if (/^\d$/.test(text)) window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text));
      utterance.lang = 'fr-FR';
      utterance.rate = 1.08;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch { /* voice is optional */ }
  }

  async function timerWakeLockOn() {
    if (!T.settings || !T.settings.keepAwake || !('wakeLock' in navigator)) return;
    try { timerWakeLock = await navigator.wakeLock.request('screen'); } catch { /* not available */ }
  }

  function timerWakeLockOff() {
    try { if (timerWakeLock) timerWakeLock.release(); } catch { /* noop */ }
    timerWakeLock = null;
  }

  async function timerToggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      timerToast('Le plein écran n’est pas disponible ici.', 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Engine                                                             */
  /* ------------------------------------------------------------------ */

  function timerStopTicker() {
    if (T.run && T.run.ticker) {
      clearInterval(T.run.ticker);
      T.run.ticker = null;
    }
  }

  function timerPhaseElapsed() {
    const run = T.run;
    if (!run) return 0;
    if (run.paused) return run.phaseElapsed;
    return run.phaseElapsed + (now() - run.phaseStartedAt) / 1000;
  }

  function timerTotalElapsed() {
    const run = T.run;
    if (!run) return 0;
    const end = run.paused ? run.pausedAt : now();
    return Math.max(0, (end - run.startedAt - run.pausedTotal) / 1000);
  }

  function timerCurrentPhase() {
    if (!T.run) return null;
    return T.run.timeline.phases[T.run.index] || null;
  }

  function timerStart(config) {
    const normalized = timerNormalizeConfig(config);
    if (normalized.mode === 'mix' && !normalized.blocks.length) {
      timerToast('Ajoute au moins un bloc au MIX.', 'error');
      return;
    }
    const timeline = timerBuildTimeline(normalized);
    if (!timeline.phases.length) {
      timerToast('La séance est vide.', 'error');
      return;
    }
    timerStopTicker();
    timerWakeLockOff();
    const start = now();
    T.config = normalized;
    T.mode = normalized.mode;
    T.run = {
      timeline,
      config: clone(normalized),
      index: 0,
      phaseStartedAt: start,
      phaseElapsed: 0,
      paused: false,
      pausedAt: 0,
      pausedTotal: 0,
      startedAt: start,
      finished: false,
      splits: [],
      rounds: 0,
      lastSplitAt: start,
      lastTickSecond: null,
      halfDone: false,
      ticker: null,
    };
    T.view = 'run';
    T.confirmStop = null;
    T.baseTitle = T.baseTitle || document.title;
    timerRender();
    timerWakeLockOn();
    timerSound('start');
    timerAnnouncePhase();
    T.run.ticker = setInterval(timerTick, 100);
    timerTick();
  }

  function timerTick() {
    const run = T.run;
    if (!run || run.finished || run.paused || T.view !== 'run') return;
    const phase = timerCurrentPhase();
    if (!phase) { timerFinish('complete'); return; }
    const elapsed = timerPhaseElapsed();
    const threshold = phase.countUp ? phase.cap : phase.seconds;
    if (phase.countUp && phase.cap && elapsed >= phase.cap) {
      timerCompletePhase(false);
      return;
    }
    if (!phase.countUp && elapsed >= phase.seconds) {
      timerCompletePhase(false);
      return;
    }
    timerCueProgress(phase, elapsed, threshold || 0);
    timerUpdateRunUI();
  }

  function timerCueProgress(phase, elapsed, total) {
    const run = T.run;
    if (!run || !total) return;
    const remaining = phase.countUp ? Math.max(0, total - elapsed) : Math.max(0, total - elapsed);
    if (total >= 45 && remaining <= total / 2 && !run.halfDone) {
      run.halfDone = true;
      timerSound('half');
      timerSpeak('Moitié');
    }
    if (remaining <= 3.15) {
      const second = Math.ceil(remaining);
      if (second > 0 && second !== run.lastTickSecond) {
        run.lastTickSecond = second;
        timerSound('tick');
        timerSpeak(String(second));
      }
    }
    if (phase.countUp) {
      const second = Math.floor(elapsed);
      if (second > 0 && second % 60 === 0 && second !== run.lastTickSecond) {
        run.lastTickSecond = second;
        timerSound('minute');
      }
    }
  }

  function timerAddSplit(phase, seconds) {
    const run = T.run;
    if (!run) return;
    run.splits.push({
      label: phase.label,
      seconds: Math.max(0, Number(seconds) || 0),
      kind: phase.kind,
      blockLabel: phase.blockLabel || '',
      round: phase.round || null,
    });
  }

  function timerRecordLap() {
    const run = T.run;
    const phase = timerCurrentPhase();
    if (!run || !phase || !phase.allowLaps) return;
    const at = now();
    const seconds = (at - run.lastSplitAt) / 1000;
    if (seconds < 0.4) return;
    run.splits.push({
      label: `Tour ${run.splits.length + 1}`,
      seconds,
      kind: phase.kind,
      blockLabel: phase.blockLabel || '',
      round: run.splits.length + 1,
    });
    run.rounds = Math.max(run.rounds, run.splits.length);
    run.lastSplitAt = at;
    timerSound('lap');
    timerUpdateRunUI();
  }

  function timerCompletePhase(manual) {
    const run = T.run;
    if (!run || run.finished) return;
    const phase = timerCurrentPhase();
    if (!phase) { timerFinish('complete'); return; }
    if (phase.kind !== 'intro') {
      if (phase.allowLaps) {
        if (manual || (phase.kind === 'fortime' && run.timeline.mode === 'mix')) timerRecordLap();
      } else if (phase.countUp) {
        timerAddSplit(phase, Math.min(timerPhaseElapsed(), phase.cap || timerPhaseElapsed()));
      } else {
        timerAddSplit(phase, phase.seconds);
      }
    }
    if (phase.round) run.rounds = Math.max(run.rounds, phase.round);
    run.index += 1;
    if (run.index >= run.timeline.phases.length) {
      timerFinish('complete');
      return;
    }
    const next = timerCurrentPhase();
    run.phaseStartedAt = now();
    run.phaseElapsed = 0;
    run.lastSplitAt = now();
    run.lastTickSecond = null;
    run.halfDone = false;
    timerRender();
    timerSound(next && next.kind === 'rest' ? 'rest' : 'phase');
    timerAnnouncePhase();
  }

  function timerPauseToggle() {
    const run = T.run;
    if (!run || run.finished) return;
    if (!run.paused) {
      run.phaseElapsed = timerPhaseElapsed();
      run.pausedAt = now();
      run.paused = true;
      timerSound('rest');
    } else {
      run.pausedTotal += now() - run.pausedAt;
      run.pausedAt = 0;
      run.phaseStartedAt = now();
      run.paused = false;
      timerSound('phase');
    }
    timerUpdateRunUI();
  }

  function timerFinish(reason = 'complete') {
    const run = T.run;
    if (!run || run.finished) return;
    const phase = timerCurrentPhase();
    if (phase && phase.allowLaps && phase.kind === 'fortime') {
      const lastSeconds = (now() - run.lastSplitAt) / 1000;
      if (lastSeconds >= 1) {
        run.splits.push({
          label: `Tour ${run.splits.length + 1}`,
          seconds: lastSeconds,
          kind: phase.kind,
          blockLabel: phase.blockLabel || '',
          round: run.splits.length + 1,
        });
        run.rounds = Math.max(run.rounds, run.splits.length);
      }
    }
    run.finished = true;
    timerStopTicker();
    timerWakeLockOff();
    const elapsed = Math.max(1, Math.round(timerTotalElapsed()));
    const mode = timerModeInfo(run.config.mode);
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString(),
      mode: run.config.mode,
      label: `${mode.label} · ${timerConfigSummary(run.config)}`,
      duration: elapsed,
      rounds: run.rounds || run.splits.length,
      splits: clone(run.splits),
      notes: run.config.notes || '',
      config: clone(run.config),
      completed: reason === 'complete',
    };
    T.lastEntry = entry;
    T.log.unshift(entry);
    T.log = T.log.slice(0, 100);
    writeJSON(STORAGE.log, T.log);
    T.run = null;
    T.view = 'done';
    T.confirmStop = null;
    document.title = T.baseTitle || 'Workout Calculator 2000';
    timerSound('finish');
    timerRender();
  }

  function timerAnnouncePhase() {
    const phase = timerCurrentPhase();
    if (!phase) return;
    if (phase.kind === 'intro') timerSpeak('Prêt');
    else if (phase.kind === 'rest') timerSpeak('Repos');
    else if (phase.kind === 'fortime') timerSpeak('For time');
    else timerSpeak(phase.label);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: common                                                  */
  /* ------------------------------------------------------------------ */

  function timerTopbar(title, right = '') {
    return `
      <div class="timer-topbar">
        <button type="button" class="timer-icon-btn" data-action="back" aria-label="Retour">${icon('arrow-left')}</button>
        <div class="timer-title">${tEsc(title)}</div>
        <div class="timer-actions">${right || '<span style="width:40px;display:block"></span>'}</div>
      </div>`;
  }

  function timerRender() {
    if (!T.root) return;
    if (!T.settings) T.settings = timerLoadSettings();
    let html = '';
    if (T.view === 'menu') html = timerHTMLMenu();
    else if (T.view === 'setup') html = timerHTMLSetup();
    else if (T.view === 'mix') html = timerHTMLMix();
    else if (T.view === 'run') html = timerHTMLRun();
    else if (T.view === 'done') html = timerHTMLDone();
    else if (T.view === 'summary') html = timerHTMLSummary();
    else if (T.view === 'log') html = timerHTMLLog();
    else if (T.view === 'presets') html = timerHTMLPresets();
    else if (T.view === 'settings') html = timerHTMLSettings();
    T.root.innerHTML = html;
    T.root.classList.toggle('timer-contrast', !!T.settings.contrast);
    timerIcons();
    if (T.view === 'run') {
      timerUpdateRunUI(true);
      timerBindSwipe();
    }
  }

  function timerOpenTab() {
    if (typeof window.switchTab === 'function') window.switchTab('timer');
    else {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      $('tab-timer')?.classList.remove('hidden');
    }
  }

  function timerBack() {
    if (T.confirmStop) {
      T.confirmStop = null;
      timerRender();
      return;
    }
    if (T.view === 'run') {
      T.confirmStop = 'stop';
      timerRender();
      return;
    }
    if (T.view === 'summary') T.view = 'log';
    else T.view = 'menu';
    timerRender();
  }

  function timerEnterMode(mode) {
    if (!MODES[mode]) return;
    T.mode = mode;
    T.config = timerDefaultConfig(mode);
    if (mode === 'mix') {
      T.mixConfig = timerDefaultConfig('mix');
      T.mixDraft = null;
      T.view = 'mix';
    } else {
      T.view = 'setup';
    }
    timerRender();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: menu                                                    */
  /* ------------------------------------------------------------------ */

  function timerHTMLMenu() {
    const modeButtons = Object.entries(MODES).map(([key, mode]) => `
      <button type="button" class="timer-mode-btn" style="--mode-color:${mode.color}" data-action="mode" data-mode="${key}">
        <span class="timer-mode-icon">${icon(mode.icon, 'w-5 h-5')}</span>
        <span class="timer-mode-name">${mode.label}${key === 'mix' ? '<span class="timer-mode-badge">MULTI</span>' : ''}</span>
        <span class="timer-mode-meta">${mode.tagline}</span>
      </button>`).join('');
    return `
      <div class="timer-shell timer-menu" style="--timer-color:#f59e0b">
        <div class="timer-topbar">
          <span class="timer-kicker">CHRONO / WOD</span>
          <div class="timer-actions">
            <button type="button" class="timer-icon-btn" data-action="presets" aria-label="Préréglages">${icon('bookmark')}</button>
            <button type="button" class="timer-icon-btn" data-action="settings" aria-label="Réglages">${icon('settings')}</button>
          </div>
        </div>
        <div class="timer-hero">
          <div class="timer-logo">CHRONO<span>WOD</span></div>
          <p class="timer-tagline">Le minuteur des séances qui piquent. AMRAP, EMOM, Tabata, For Time et MIX.</p>
        </div>
        <div class="timer-mode-list">${modeButtons}</div>
        <button type="button" class="timer-journal" data-action="log">
          <span class="flex items-center gap-2">${icon('book-open')} JOURNAL D’ENTRAÎNEMENT</span>
          <span>${T.log.length} séance${T.log.length > 1 ? 's' : ''}</span>
        </button>
        <p class="timer-footnote">Fonctionne hors ligne · sons et voix · préréglages · journal local.<br>Reproduction web indépendante inspirée de SmartWOD Timer.</p>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: setup                                                   */
  /* ------------------------------------------------------------------ */

  function timerField(id, label, value, options = {}) {
    const { min = 0, max = 600, step = 1, unit = '', hint = '', full = false, className = '' } = options;
    return `
      <div class="timer-field${full ? ' full' : ''}${className ? ` ${className}` : ''}">
        <label for="${id}">${tEsc(label)}${unit ? ` <span class="font-normal normal-case tracking-normal text-slate-500">(${tEsc(unit)})</span>` : ''}</label>
        <input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" step="${step}" value="${tEsc(value)}">
        ${hint ? `<span class="timer-hint">${tEsc(hint)}</span>` : ''}
      </div>`;
  }

  function timerNotesField(id, value, placeholder = 'Ajoute des notes pour ta séance…') {
    return `
      <div class="timer-field full">
        <label for="${id}">Notes</label>
        <textarea id="${id}" maxlength="1000" placeholder="${tEsc(placeholder)}">${tEsc(value || '')}</textarea>
      </div>`;
  }

  function timerHTMLSetup() {
    const mode = timerModeInfo(T.mode);
    const c = timerNormalizeConfig(T.config || timerDefaultConfig(T.mode));
    let fields = '';
    let quick = '';
    if (c.mode === 'amrap') {
      const minutes = Math.max(1, Math.round(c.duration / 60));
      fields = `
        <div class="timer-big-field">
          <input id="timer-min" class="timer-big-input" type="number" inputmode="numeric" min="1" max="120" step="1" value="${minutes}" aria-label="Durée en minutes">
          <span class="timer-big-unit">minutes</span>
        </div>
        <div class="timer-preset-chips">
          ${[5, 10, 15, 20, 30].map(value => `<button type="button" class="timer-chip${value === minutes ? ' active' : ''}" data-action="setup-quick" data-target="timer-min" data-value="${value}">${value} min</button>`).join('')}
        </div>`;
      quick = `<button type="button" class="timer-cta secondary" data-action="mode" data-mode="mix">${icon('layers')} Enchaîner plusieurs AMRAP ? Utilise le MIX</button>`;
    } else if (c.mode === 'fortime') {
      const capMinutes = Math.round(c.cap / 60);
      fields = `
        <div class="timer-big-field">
          <input id="timer-cap-min" class="timer-big-input" type="number" inputmode="numeric" min="0" max="120" step="1" value="${capMinutes}" aria-label="Limite de temps en minutes">
          <span class="timer-big-unit">minutes max</span>
        </div>
        <p class="timer-setup-sub" style="text-align:center;margin-top:-.8rem">0 = pas de limite. Tu appuies sur « Terminer » quand tu as fini.</p>`;
      quick = `<button type="button" class="timer-cta secondary" data-action="setup-quick" data-target="timer-cap-min" data-value="0">Sans limite</button>`;
    } else if (c.mode === 'emom') {
      const minutes = Math.max(1, Math.round(c.duration / 60));
      fields = `
        <div class="timer-big-field">
          <input id="timer-min" class="timer-big-input" type="number" inputmode="numeric" min="1" max="120" step="1" value="${minutes}" aria-label="Durée totale en minutes">
          <span class="timer-big-unit">minutes</span>
        </div>
        <div class="timer-config-grid">
          ${timerField('timer-interval', 'Intervalle', c.interval, { min: 5, max: 600, unit: 'secondes' })}
          <div class="timer-field">
            <label>Départs</label>
            <input type="text" value="${Math.max(1, Math.ceil(c.duration / c.interval))} tours" readonly>
          </div>
        </div>`;
      quick = `<div class="timer-preset-chips">${[30, 60, 90, 120].map(value => `<button type="button" class="timer-chip${value === c.interval ? ' active' : ''}" data-action="setup-quick" data-target="timer-interval" data-value="${value}">${value}s</button>`).join('')}</div>`;
    } else if (c.mode === 'tabata') {
      fields = `
        <div class="timer-config-grid">
          ${timerField('timer-work', 'Travail', c.work, { min: 1, max: 600, unit: 'secondes' })}
          ${timerField('timer-rest', 'Repos', c.rest, { min: 0, max: 600, unit: 'secondes' })}
          ${timerField('timer-rounds', 'Tours', c.rounds, { min: 1, max: 99 })}
          ${timerField('timer-sets', 'Séries', c.sets, { min: 1, max: 20 })}
          ${timerField('timer-set-rest', 'Repos entre séries', c.setRest, { min: 0, max: 900, unit: 'secondes', className: c.sets > 1 ? '' : 'hidden' })}
          <div class="timer-field">
            <label>Format</label>
            <input type="text" value="${c.rounds} × ${c.work}/${c.rest}s" readonly>
          </div>
        </div>`;
      quick = `<div class="timer-preset-chips">
        <button type="button" class="timer-chip" data-action="tabata-preset" data-work="20" data-rest="10" data-rounds="8">Tabata 20/10</button>
        <button type="button" class="timer-chip" data-action="tabata-preset" data-work="40" data-rest="20" data-rounds="8">40/20</button>
        <button type="button" class="timer-chip" data-action="tabata-preset" data-work="30" data-rest="15" data-rounds="10">30/15</button>
      </div>`;
    }
    return `
      <div class="timer-shell timer-setup" style="--timer-color:${mode.color}">
        ${timerTopbar(mode.label, `<button type="button" class="timer-icon-btn" data-action="presets" aria-label="Préréglages">${icon('bookmark')}</button>`)}
        <div class="timer-setup-body">
          <div class="timer-mode-kicker">${mode.label}</div>
          <h2 class="timer-h2">${mode.setupTitle}</h2>
          <p class="timer-setup-sub">${mode.setupSub}</p>
          <div style="margin-top:1.35rem">${fields}</div>
          ${quick}
          <div id="timer-estimate" class="timer-estimate">
            <span>Durée estimée</span>
            <strong id="timer-estimate-value">${timerEstimateText(c)}</strong>
          </div>
          ${timerNotesField('timer-notes', c.notes)}
          <button type="button" class="timer-cta" data-action="start">${icon('play')} DÉMARRER LE TIMER</button>
          <button type="button" class="timer-cta secondary" data-action="save-preset">${icon('bookmark')} Sauvegarder comme préréglage</button>
        </div>
      </div>`;
  }

  function timerReadSetupConfig() {
    const mode = T.mode;
    const c = timerDefaultConfig(mode);
    const value = id => $(id) ? Number($(id).value) : NaN;
    if (mode === 'amrap') {
      c.duration = clampNum(value('timer-min') * 60, 60, 7200, 600);
    } else if (mode === 'fortime') {
      c.cap = clampNum(value('timer-cap-min') * 60, 0, 7200, 0);
    } else if (mode === 'emom') {
      c.duration = clampNum(value('timer-min') * 60, 60, 7200, 600);
      c.interval = clampNum(value('timer-interval'), 5, 600, 60);
    } else if (mode === 'tabata') {
      c.work = clampNum(value('timer-work'), 1, 600, 20);
      c.rest = clampNum(value('timer-rest'), 0, 600, 10);
      c.rounds = Math.round(clampNum(value('timer-rounds'), 1, 99, 8));
      c.sets = Math.round(clampNum(value('timer-sets'), 1, 20, 1));
      c.setRest = clampNum(value('timer-set-rest'), 0, 900, 60);
    }
    c.notes = ($('timer-notes')?.value || '').trim();
    return timerNormalizeConfig(c);
  }

  function timerUpdateEstimate() {
    if (T.view !== 'setup' && T.view !== 'mix') return;
    const target = $('timer-estimate-value');
    if (!target) return;
    const config = T.view === 'mix' ? timerReadMixConfig() : timerReadSetupConfig();
    target.textContent = timerEstimateText(config);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: run                                                     */
  /* ------------------------------------------------------------------ */

  function timerHTMLRun() {
    const run = T.run;
    if (!run) return timerHTMLMenu();
    const phase = timerCurrentPhase();
    if (!phase) return timerHTMLMenu();
    const mode = timerModeInfo(run.config.mode);
    const color = phase.color || mode.color;
    const isCountUp = !!phase.countUp;
    const isMixBlockFinish = isCountUp && run.timeline.mode === 'mix' && run.index < run.timeline.phases.length - 1;
    const finishLabel = isCountUp ? (isMixBlockFinish ? 'BLOC TERMINÉ' : 'TERMINER') : 'ARRÊTER';
    const lap = phase.allowLaps ? `<button type="button" class="timer-control-btn lap" data-action="lap" id="timer-lap">${icon('plus')} TOUR +1</button>` : '';
    const swipe = isCountUp ? `
      <div class="timer-swipe" id="timer-swipe" role="button" tabindex="0" aria-label="Glisse pour terminer">
        <div class="timer-swipe-thumb">${icon('chevron-right')}</div>
        <div class="timer-swipe-label">GLISSE POUR TERMINER</div>
      </div>` : '';
    const soundIcon = T.settings.sound ? 'volume-2' : 'volume-x';
    const confirm = T.confirmStop ? `
      <div class="timer-modal" data-action="stop-cancel">
        <div class="timer-modal-card" role="dialog" aria-modal="true" aria-labelledby="timer-stop-title">
          <h3 id="timer-stop-title">Arrêter la séance ?</h3>
          <p>Le temps déjà couru sera enregistré dans le journal.</p>
          <div class="timer-modal-actions">
            <button type="button" data-action="stop-cancel">Continuer</button>
            <button type="button" class="danger" data-action="stop-confirm">Arrêter</button>
          </div>
        </div>
      </div>` : '';
    return `
      <div class="timer-shell timer-shell-run" style="--timer-color:${color}">
        <div class="timer-topbar">
          <button type="button" class="timer-icon-btn" data-action="back" aria-label="Arrêter la séance">${icon('arrow-left')}</button>
          <div class="timer-title">${mode.label}</div>
          <div class="timer-actions">
            <button type="button" class="timer-icon-btn${T.settings.sound ? ' is-on' : ''}" data-action="sound-toggle" aria-label="${T.settings.sound ? 'Couper le son' : 'Activer le son'}">${icon(soundIcon)}</button>
            <button type="button" class="timer-icon-btn" data-action="fullscreen" aria-label="Plein écran">${icon('maximize')}</button>
          </div>
        </div>
        <div class="timer-run-main">
          <div class="timer-run-side">
            <div id="timer-eyebrow" class="timer-run-eyebrow"></div>
            <div id="timer-round" class="timer-roundline"></div>
            <div id="timer-phase" class="timer-phase-label" aria-live="polite"></div>
            <div id="timer-block" class="timer-block-label"></div>
          </div>
          <div class="timer-ring-wrap">
            <svg class="timer-ring" viewBox="0 0 320 320" aria-hidden="true">
              <circle class="timer-ring-track" cx="160" cy="160" r="138"></circle>
              <circle class="timer-ring-ticks" cx="160" cy="160" r="151"></circle>
              <circle id="timer-progress" class="timer-ring-progress" cx="160" cy="160" r="138" stroke-dasharray="867.08" stroke-dashoffset="0"></circle>
            </svg>
            <button type="button" class="timer-face" data-action="pause" id="timer-face" aria-label="Mettre en pause">
              <span id="timer-display" class="timer-time">00:00</span>
              <span id="timer-hint" class="timer-hint">Appuie pour mettre sur pause</span>
            </button>
          </div>
          <div class="timer-run-side">
            <div id="timer-total" class="timer-total"></div>
            <div id="timer-next" class="timer-next"></div>
          </div>
        </div>
        <div class="timer-controls">
          ${lap}
          <button type="button" class="timer-control-btn primary" data-action="pause" id="timer-pause">${icon('pause')}<span>PAUSE</span></button>
          <button type="button" class="timer-control-btn finish" data-action="finish" id="timer-finish">${icon('flag')}<span>${finishLabel}</span></button>
        </div>
        ${swipe}
        <p class="timer-run-note">Le chrono continue même si tu changes d’onglet.</p>
        ${confirm}
      </div>`;
  }

  function timerUpdateRunUI(force = false) {
    const run = T.run;
    if (!run || T.view !== 'run') return;
    const phase = timerCurrentPhase();
    if (!phase) return;
    const elapsed = timerPhaseElapsed();
    const isCountUp = !!phase.countUp;
    const total = isCountUp ? (phase.cap || 60) : phase.seconds;
    const value = isCountUp ? elapsed : Math.max(0, phase.seconds - elapsed);
    const progress = total > 0
      ? (isCountUp ? (phase.cap ? Math.min(1, elapsed / phase.cap) : (elapsed % 60) / 60) : Math.max(0, Math.min(1, value / phase.seconds)))
      : 0;
    const display = $('timer-display');
    if (display) display.textContent = fmtClock(value, !isCountUp);
    const ring = $('timer-progress');
    if (ring) ring.style.strokeDashoffset = String(867.08 * (1 - progress));
    const round = $('timer-round');
    const eyebrow = $('timer-eyebrow');
    const phaseLabel = $('timer-phase');
    const blockLabel = $('timer-block');
    const totalLabel = $('timer-total');
    const nextLabel = $('timer-next');
    const hint = $('timer-hint');
    const shell = document.querySelector('.timer-shell-run');
    if (shell) {
      shell.classList.toggle('is-paused', run.paused);
      shell.classList.toggle('is-final', !isCountUp && value <= 3.05 && !run.paused);
    }
    if (eyebrow) {
      if (phase.kind === 'intro') eyebrow.textContent = 'PRÊT ?';
      else if (phase.mixRepeatTotal) eyebrow.textContent = `RÉPÉTITION ${phase.mixRepeat}/${phase.mixRepeatTotal}`;
      else eyebrow.textContent = timerModeInfo(run.config.mode).label;
      if (phase.kind === 'fortime') {
        const last = run.splits.length ? run.splits[run.splits.length - 1].seconds : 0;
        eyebrow.textContent = `DERNIER TOUR : ${fmtClock(last)}`;
      }
    }
    if (round) {
      if (phase.kind === 'intro') round.textContent = 'DÉCOMPTE';
      else if (phase.round && phase.totalRounds) round.textContent = `TOUR ${phase.round}/${phase.totalRounds}`;
      else if (phase.allowLaps) round.textContent = `${run.splits.length} TOUR${run.splits.length > 1 ? 'S' : ''}`;
      else round.textContent = '';
    }
    if (phaseLabel) {
      phaseLabel.textContent = phase.kind === 'amrap' ? 'TOURS LIBRES'
        : phase.kind === 'fortime' ? 'LE PLUS VITE POSSIBLE'
        : phase.kind === 'emom' ? 'INTERVALLE'
        : phase.label;
    }
    if (blockLabel) {
      if (phase.blockLabel && phase.blockLabel !== phase.label) blockLabel.textContent = phase.blockLabel;
      else blockLabel.textContent = '';
    }
    if (totalLabel) totalLabel.textContent = `TEMPS TOTAL : ${fmtClock(timerTotalElapsed())}`;
    if (nextLabel) {
      const next = run.timeline.phases[run.index + 1];
      nextLabel.textContent = next ? `PROCHAIN : ${next.label}${next.blockLabel && next.blockLabel !== next.label ? ` · ${next.blockLabel}` : ''}` : 'DERNIER BLOC';
    }
    if (hint) hint.textContent = run.paused ? 'Appuie pour reprendre' : 'Appuie pour mettre sur pause';
    const pause = $('timer-pause');
    if (pause && (force || pause.dataset.state !== (run.paused ? 'paused' : 'running'))) {
      pause.dataset.state = run.paused ? 'paused' : 'running';
      pause.innerHTML = `${icon(run.paused ? 'play' : 'pause')}<span>${run.paused ? 'REPRENDRE' : 'PAUSE'}</span>`;
      timerIcons(pause);
    }
    const face = $('timer-face');
    if (face) face.setAttribute('aria-label', run.paused ? 'Reprendre' : 'Mettre en pause');
    const title = document.title;
    const nextTitle = `${fmtClock(value, !isCountUp)} · ${timerModeInfo(run.config.mode).label} — Chrono WOD`;
    if (title !== nextTitle) document.title = nextTitle;
  }

  function timerBindSwipe() {
    const swipe = $('timer-swipe');
    if (!swipe) return;
    const thumb = swipe.querySelector('.timer-swipe-thumb');
    if (!thumb) return;
    let startX = null;
    let moved = 0;
    const max = () => Math.max(40, swipe.clientWidth - 60);
    const reset = () => {
      startX = null;
      moved = 0;
      thumb.style.transform = 'translateX(0)';
    };
    swipe.addEventListener('pointerdown', event => {
      startX = event.clientX;
      moved = 0;
      try { swipe.setPointerCapture(event.pointerId); } catch { /* noop */ }
    });
    swipe.addEventListener('pointermove', event => {
      if (startX == null) return;
      moved = Math.max(0, Math.min(max(), event.clientX - startX));
      thumb.style.transform = `translateX(${moved}px)`;
    });
    const finish = () => {
      if (T.run && T.run.timeline.mode === 'mix' && T.run.index < T.run.timeline.phases.length - 1) timerCompletePhase(true);
      else timerFinish('complete');
    };
    swipe.addEventListener('pointerup', () => {
      if (startX == null) return;
      if (moved >= max() * 0.72) finish();
      else reset();
    });
    swipe.addEventListener('pointercancel', reset);
    swipe.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        finish();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: done / summary                                          */
  /* ------------------------------------------------------------------ */

  function timerConfetti() {
    const colors = ['#f59e0b', '#4f7cff', '#a855f7', '#10b981', '#f43f5e', '#fff'];
    return `<div class="timer-confetti" aria-hidden="true">${Array.from({ length: 22 }, (_, index) => {
      const x = Math.round((Math.random() * 280) - 140);
      const y = Math.round((Math.random() * 220) + 40);
      const delay = (Math.random() * 0.35).toFixed(2);
      const spin = Math.round(Math.random() * 680 - 340);
      return `<span style="--confetti-color:${colors[index % colors.length]};--confetti-x:${x}px;--confetti-y:${y}px;--confetti-delay:${delay}s;--confetti-spin:${spin}deg;--confetti-rotate:${Math.round(Math.random() * 180)}deg"></span>`;
    }).join('')}</div>`;
  }

  function timerHTMLDone() {
    const entry = T.lastEntry;
    if (!entry) return timerHTMLMenu();
    const mode = timerModeInfo(entry.mode);
    const message = DONE_MESSAGES[Math.floor(Math.random() * DONE_MESSAGES.length)];
    return `
      <div class="timer-shell timer-done" style="--timer-color:${mode.color}">
        ${timerConfetti()}
        ${timerTopbar(mode.label, `<button type="button" class="timer-icon-btn" data-action="share" aria-label="Partager">${icon('share-2')}</button>`)}
        <div class="timer-done-body">
          <div class="timer-check">${icon('check', 'w-12 h-12')}</div>
          <div class="timer-done-kicker">${entry.completed ? 'SÉANCE TERMINÉE' : 'SÉANCE ARRÊTÉE'}</div>
          <h2 class="timer-done-title">${message}</h2>
          <div class="timer-done-meta">
            <span class="timer-pill mode">${mode.label}</span>
            <span class="timer-pill">${fmtClock(entry.duration)}</span>
            <span class="timer-pill">${entry.rounds} tour${entry.rounds > 1 ? 's' : ''}</span>
            <span class="timer-pill">${timerConfigSummary(entry.config)}</span>
          </div>
          <textarea class="timer-done-notes" id="timer-done-notes" maxlength="1000" placeholder="Ajoute une note sur cette séance…">${tEsc(entry.notes)}</textarea>
          <div class="timer-view-actions">
            <button type="button" class="timer-cta" data-action="summary">${icon('list')} VOIR LE RÉSUMÉ</button>
            <button type="button" class="timer-cta secondary" data-action="menu">${icon('rotate-ccw')} NOUVELLE SÉANCE</button>
          </div>
        </div>
      </div>`;
  }

  function timerHTMLSummary() {
    const entry = T.summaryEntry;
    if (!entry) return timerHTMLLog();
    const mode = timerModeInfo(entry.mode);
    const splits = Array.isArray(entry.splits) ? entry.splits : [];
    const average = splits.length ? splits.reduce((sum, split) => sum + split.seconds, 0) / splits.length : 0;
    const rows = splits.map((split, index) => {
      const delta = split.seconds - average;
      const abs = Math.round(Math.abs(delta));
      const deltaText = abs <= 1 ? '—' : `${delta < 0 ? '−' : '+'}${abs}s`;
      return `<div class="timer-split-row">
        <span class="label">${tEsc(split.label || `Tour ${index + 1}`)}</span>
        <span class="time">${fmtClock(split.seconds)}</span>
        <span class="delta ${delta < -1 ? 'fast' : delta > 1 ? 'slow' : ''}">${deltaText}</span>
      </div>`;
    }).join('');
    const emptyHint = ['tabata', 'emom', 'mix'].includes(entry.mode)
      ? 'Les tours se terminent automatiquement, tu n’as rien à cocher.'
      : 'Utilise « Tour +1 » pendant un AMRAP ou un For Time.';
    return `
      <div class="timer-shell timer-summary" style="--timer-color:${mode.color}">
        ${timerTopbar('RÉSUMÉ', `<button type="button" class="timer-icon-btn" data-action="share" aria-label="Partager">${icon('share-2')}</button>`)}
        <div class="timer-summary-head">
          <strong>${mode.label}</strong>
          <span>${fmtClock(entry.duration)}</span>
        </div>
        <div class="timer-summary-date">${timerFormatDate(entry.date)} · ${timerConfigSummary(entry.config)}</div>
        <div class="timer-summary-stats">
          <div class="timer-stat"><span>Durée</span><strong>${fmtClock(entry.duration)}</strong></div>
          <div class="timer-stat"><span>Tours</span><strong>${entry.rounds}</strong></div>
          <div class="timer-stat"><span>Moyenne</span><strong>${average ? fmtClock(average) : '—'}</strong></div>
        </div>
        <div class="timer-section-title">Tours</div>
        ${rows ? `<div class="timer-splits">${rows}</div>` : `<div class="timer-empty"><strong>Aucun tour enregistré</strong>${emptyHint}</div>`}
        ${entry.notes ? `<div class="timer-section-title">Notes</div><div class="timer-notes-box">${tEsc(entry.notes)}</div>` : ''}
        <div class="timer-view-actions">
          <button type="button" class="timer-cta" data-action="retry">${icon('rotate-ccw')} REFAIRE</button>
          <button type="button" class="timer-cta secondary danger" data-action="delete-entry" data-id="${entry.id}">${icon('trash-2')} SUPPRIMER</button>
        </div>
      </div>`;
  }

  function timerFormatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
        + ' · ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: log / presets / settings                                */
  /* ------------------------------------------------------------------ */

  function timerHTMLLog() {
    const totalSeconds = T.log.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0);
    const items = T.log.map(entry => {
      const mode = timerModeInfo(entry.mode);
      return `<button type="button" class="timer-list-item" style="--item-color:${mode.color}" data-action="open-log" data-id="${entry.id}">
        <span class="main">
          <span class="name">${tEsc(entry.label || mode.label)}</span>
          <span class="meta">${timerFormatDate(entry.date)} · ${entry.rounds} tour${entry.rounds > 1 ? 's' : ''}</span>
        </span>
        <span class="value">${fmtClock(entry.duration)}</span>
      </button>`;
    }).join('');
    return `
      <div class="timer-shell timer-log" style="--timer-color:#94a3b8">
        ${timerTopbar('JOURNAL', `<button type="button" class="timer-icon-btn" data-action="export-log" aria-label="Exporter en CSV">${icon('download')}</button>`)}
        <div class="timer-page-head">
          <div class="timer-page-kicker">JOURNAL D’ENTRAÎNEMENT</div>
          <h2 class="timer-page-title">Tes séances.</h2>
          <p class="timer-page-sub">${T.log.length} séance${T.log.length > 1 ? 's' : ''} · ${fmtClock(totalSeconds)} de travail cumulé</p>
        </div>
        ${items ? `<div class="timer-list">${items}</div>` : `<div class="timer-empty"><strong>Rien ici pour l’instant</strong>Lance un chrono, termine ta séance, et elle apparaîtra automatiquement.</div>`}
        <div class="timer-view-actions">
          <button type="button" class="timer-cta" data-action="menu">${icon('plus')} NOUVELLE SÉANCE</button>
          <button type="button" class="timer-cta secondary" data-action="export-log">${icon('download')} EXPORT CSV</button>
        </div>
        ${T.log.length ? `<button type="button" class="timer-cta secondary danger" style="margin-top:.5rem" data-action="clear-log">${icon('trash-2')} EFFACER LE JOURNAL</button>` : ''}
      </div>`;
  }

  function timerHTMLPresets() {
    const items = T.presets.map(preset => {
      const mode = timerModeInfo(preset.config?.mode || 'amrap');
      return `<div class="timer-list-item" style="--item-color:${mode.color}">
        <button type="button" class="main" data-action="load-preset" data-id="${preset.id}">
          <span class="name">${tEsc(preset.name)}</span>
          <span class="meta">${mode.label} · ${timerConfigSummary(preset.config)}</span>
        </button>
        <div class="timer-list-actions">
          <button type="button" class="timer-icon-btn" data-action="start-preset" data-id="${preset.id}" aria-label="Démarrer ${tEsc(preset.name)}">${icon('play')}</button>
          <button type="button" class="timer-icon-btn danger" data-action="delete-preset" data-id="${preset.id}" aria-label="Supprimer ${tEsc(preset.name)}">${icon('trash-2')}</button>
        </div>
      </div>`;
    }).join('');
    return `
      <div class="timer-shell timer-presets" style="--timer-color:#f59e0b">
        ${timerTopbar('PRÉRÉGLAGES', `<button type="button" class="timer-icon-btn" data-action="settings" aria-label="Réglages">${icon('settings')}</button>`)}
        <div class="timer-page-head">
          <div class="timer-page-kicker">MES PRÉRÉGLAGES</div>
          <h2 class="timer-page-title">Prêt à lancer.</h2>
          <p class="timer-page-sub">Sauvegarde une configuration depuis un écran de préparation.</p>
        </div>
        ${items ? `<div class="timer-list">${items}</div>` : `<div class="timer-empty"><strong>Aucun préréglage</strong>Configure un chrono, puis appuie sur « Sauvegarder comme préréglage ».</div>`}
        <div class="timer-view-actions">
          <button type="button" class="timer-cta" data-action="menu">${icon('arrow-left')} RETOUR AU MENU</button>
        </div>
      </div>`;
  }

  function timerHTMLSettings() {
    const s = T.settings;
    const packOptions = [
      ['fitness', 'Minuteur fitness'],
      ['bell', 'Cloche de méditation'],
      ['boxing', 'Cloche de boxe'],
      ['soft', 'Cloche courte'],
    ];
    return `
      <div class="timer-shell timer-settings" style="--timer-color:#94a3b8">
        ${timerTopbar('RÉGLAGES')}
        <div class="timer-page-head">
          <div class="timer-page-kicker">CHRONO WOD</div>
          <h2 class="timer-page-title">Réglages.</h2>
          <p class="timer-page-sub">Tout reste dans ce navigateur. Aucun compte, aucun serveur.</p>
        </div>
        <div class="timer-settings-list">
          <div class="timer-setting-row">
            <div><div class="label">Son</div><div class="sub">Signaux de phase et décompte</div></div>
            <button type="button" class="timer-switch${s.sound ? ' on' : ''}" data-action="toggle-setting" data-key="sound" aria-pressed="${s.sound}" aria-label="Activer ou couper le son"></button>
          </div>
          <div class="timer-setting-row">
            <div><div class="label">Voix</div><div class="sub">${'speechSynthesis' in window ? 'Annonces en français' : 'Non disponible dans ce navigateur'}</div></div>
            <button type="button" class="timer-switch${s.voice ? ' on' : ''}" data-action="toggle-setting" data-key="voice" aria-pressed="${s.voice}" aria-label="Activer ou couper la voix"></button>
          </div>
          <div class="timer-setting-row">
            <div><div class="label">Décompte d’introduction</div><div class="sub">Avant le début de la séance</div></div>
            <select data-setting="intro" aria-label="Décompte d’introduction">
              ${[0, 3, 5, 10].map(value => `<option value="${value}"${s.intro === value ? ' selected' : ''}>${value ? `${value} secondes` : 'Aucun'}</option>`).join('')}
            </select>
          </div>
          <div class="timer-setting-row">
            <div><div class="label">Ambiance sonore</div><div class="sub">Le timbre des signaux</div></div>
            <select data-setting="soundPack" aria-label="Ambiance sonore">
              ${packOptions.map(([value, label]) => `<option value="${value}"${s.soundPack === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
          <div class="timer-setting-row">
            <div><div class="label">Contraste maximal</div><div class="sub">Fond noir, chiffres plus lumineux</div></div>
            <button type="button" class="timer-switch${s.contrast ? ' on' : ''}" data-action="toggle-setting" data-key="contrast" aria-pressed="${s.contrast}" aria-label="Activer le contraste maximal"></button>
          </div>
          <div class="timer-setting-row">
            <div><div class="label">Garder l’écran allumé</div><div class="sub">Wake Lock, si le navigateur le permet</div></div>
            <button type="button" class="timer-switch${s.keepAwake ? ' on' : ''}" data-action="toggle-setting" data-key="keepAwake" aria-pressed="${s.keepAwake}" aria-label="Garder l’écran allumé"></button>
          </div>
        </div>
        <div class="timer-view-actions">
          <button type="button" class="timer-cta" data-action="test-sound">${icon('volume-2')} TESTER LE SON</button>
          <button type="button" class="timer-cta secondary danger" data-action="reset-data">${icon('trash-2')} EFFACER LES DONNÉES</button>
        </div>
        <p class="timer-about">Chrono WOD est une reproduction web indépendante, sans lien avec SmartWOD. Les données (réglages, préréglages, journal) restent dans le stockage local de ce navigateur.</p>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: mix                                                     */
  /* ------------------------------------------------------------------ */

  function timerMixDefaults(type = 'amrap') {
    const base = { type, label: TYPE_INFO[type]?.label || 'BLOC' };
    if (type === 'amrap') return { ...base, duration: 300 };
    if (type === 'fortime') return { ...base, cap: 0 };
    if (type === 'emom') return { ...base, duration: 600, interval: 60 };
    if (type === 'tabata') return { ...base, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60 };
    return { ...base, duration: 120 };
  }

  function timerMixDraftFromBlock(block, index) {
    return { ...clone(block), index };
  }

  function timerReadMixDraft() {
    const draft = T.mixDraft;
    if (!draft) return null;
    const block = timerMixDefaults(draft.type);
    const value = id => $(id) ? Number($(id).value) : NaN;
    block.label = ($('mix-label')?.value || '').trim() || TYPE_INFO[draft.type].label;
    if (draft.type === 'amrap' || draft.type === 'work' || draft.type === 'rest') {
      block.duration = clampNum(value('mix-minutes') * 60, 1, 7200, block.duration);
    } else if (draft.type === 'fortime') {
      block.cap = clampNum(value('mix-cap') * 60, 0, 7200, 0);
    } else if (draft.type === 'emom') {
      block.duration = clampNum(value('mix-minutes') * 60, 1, 7200, 600);
      block.interval = clampNum(value('mix-interval'), 5, 600, 60);
    } else if (draft.type === 'tabata') {
      block.work = clampNum(value('mix-work'), 1, 600, 20);
      block.rest = clampNum(value('mix-rest'), 0, 600, 10);
      block.rounds = Math.round(clampNum(value('mix-rounds'), 1, 99, 8));
      block.sets = Math.round(clampNum(value('mix-sets'), 1, 20, 1));
      block.setRest = clampNum(value('mix-set-rest'), 0, 900, 60);
    }
    return timerNormalizeBlock(block);
  }

  function timerReadMixConfig() {
    const c = timerDefaultConfig('mix');
    c.blocks = (T.mixConfig.blocks || []).map(timerNormalizeBlock).filter(Boolean);
    c.rounds = Math.round(clampNum($('mix-rounds')?.value, 1, 99, T.mixConfig.rounds || 1));
    c.notes = ($('timer-mix-notes')?.value || '').trim();
    return timerNormalizeConfig(c);
  }

  function timerMixBlockSummary(block) {
    const info = TYPE_INFO[block.type] || TYPE_INFO.work;
    if (block.type === 'amrap') return `${Math.round(block.duration / 60)} min · tours libres`;
    if (block.type === 'fortime') return block.cap ? `Cap ${fmtClock(block.cap)}` : 'Sans limite';
    if (block.type === 'emom') return `${Math.round(block.duration / 60)} min · toutes les ${block.interval}s`;
    if (block.type === 'tabata') return `${block.sets > 1 ? `${block.sets} × ` : ''}${block.rounds} × ${block.work}/${block.rest}s`;
    return `${info.label} · ${fmtClock(block.duration)}`;
  }

  function timerMixEditorHTML() {
    const draft = T.mixDraft;
    if (!draft) return '';
    const d = { ...timerMixDefaults(draft.type), ...draft };
    const typeButtons = Object.keys(TYPE_INFO).map(type => `<button type="button" class="timer-type-btn${draft.type === type ? ' active' : ''}" data-action="mix-type" data-type="${type}">${TYPE_INFO[type].label}</button>`).join('');
    let fields = `<div class="timer-field full"><label for="mix-label">Nom du bloc</label><input id="mix-label" type="text" maxlength="60" value="${tEsc(d.label)}" placeholder="${tEsc(TYPE_INFO[draft.type].label)}"></div>`;
    if (draft.type === 'amrap' || draft.type === 'work' || draft.type === 'rest') {
      fields += timerField('mix-minutes', draft.type === 'rest' ? 'Durée du repos' : 'Durée', Math.max(1, Math.round(d.duration / 60)), { min: 1, max: 120, unit: 'minutes' });
    } else if (draft.type === 'fortime') {
      fields += timerField('mix-cap', 'Limite', Math.round((d.cap || 0) / 60), { min: 0, max: 120, unit: 'minutes', hint: '0 = sans limite, tu termines le bloc à la main.' });
    } else if (draft.type === 'emom') {
      fields += timerField('mix-minutes', 'Durée totale', Math.max(1, Math.round(d.duration / 60)), { min: 1, max: 120, unit: 'minutes' });
      fields += timerField('mix-interval', 'Intervalle', d.interval, { min: 5, max: 600, unit: 'secondes' });
    } else if (draft.type === 'tabata') {
      fields += timerField('mix-work', 'Travail', d.work, { min: 1, max: 600, unit: 'secondes' });
      fields += timerField('mix-rest', 'Repos', d.rest, { min: 0, max: 600, unit: 'secondes' });
      fields += timerField('mix-rounds', 'Tours', d.rounds, { min: 1, max: 99 });
      fields += timerField('mix-sets', 'Séries', d.sets, { min: 1, max: 20 });
      fields += timerField('mix-set-rest', 'Repos entre séries', d.setRest, { min: 0, max: 900, unit: 'secondes' });
    }
    return `
      <div class="timer-editor" id="timer-mix-editor">
        <div class="timer-editor-title">${draft.index === null || draft.index === undefined ? 'Ajouter un bloc' : 'Modifier le bloc'}</div>
        <div class="timer-type-grid">${typeButtons}</div>
        <div class="timer-config-grid">${fields}</div>
        <div class="timer-editor-actions">
          <button type="button" class="timer-cta" data-action="mix-save">${icon('check')} ${draft.index === null || draft.index === undefined ? 'AJOUTER' : 'ENREGISTRER'}</button>
          <button type="button" class="timer-cta secondary" data-action="mix-cancel">ANNULER</button>
        </div>
      </div>`;
  }

  function timerHTMLMix() {
    const c = timerNormalizeConfig(T.mixConfig);
    const blocks = c.blocks.map((block, index) => {
      const info = TYPE_INFO[block.type] || TYPE_INFO.work;
      return `<div class="timer-mix-block" style="--block-color:${info.color}">
        <div class="main">
          <div class="name"><span class="timer-mix-badge" style="--block-color:${info.color}">${info.label}</span>${tEsc(block.label)}</div>
          <div class="meta">${timerMixBlockSummary(block)}</div>
        </div>
        <div class="timer-mix-actions">
          <button type="button" class="timer-icon-btn" data-action="mix-up" data-index="${index}" aria-label="Monter">${icon('chevron-up')}</button>
          <button type="button" class="timer-icon-btn" data-action="mix-down" data-index="${index}" aria-label="Descendre">${icon('chevron-down')}</button>
          <button type="button" class="timer-icon-btn" data-action="mix-edit" data-index="${index}" aria-label="Modifier">${icon('pencil')}</button>
          <button type="button" class="timer-icon-btn" data-action="mix-dup" data-index="${index}" aria-label="Dupliquer">${icon('copy')}</button>
          <button type="button" class="timer-icon-btn danger" data-action="mix-del" data-index="${index}" aria-label="Supprimer">${icon('trash-2')}</button>
        </div>
      </div>`;
    }).join('');
    const estimate = timerEstimateText(c);
    return `
      <div class="timer-shell timer-mix" style="--timer-color:#6b7280">
        ${timerTopbar('MIX', `<button type="button" class="timer-icon-btn" data-action="presets" aria-label="Préréglages">${icon('bookmark')}</button>`)}
        <div class="timer-setup-body">
          <div class="timer-mode-kicker">MIX</div>
          <h2 class="timer-h2">Compose ton enchaînement.</h2>
          <p class="timer-setup-sub">AMRAP, For Time, EMOM, Tabata, travail ou repos. L’ordre est libre.</p>
          <div id="timer-estimate" class="timer-estimate">
            <span>Durée estimée</span>
            <strong id="timer-estimate-value">${estimate}</strong>
          </div>
          ${blocks || `<div class="timer-empty"><strong>Ton MIX est vide</strong>Ajoute un premier bloc pour commencer.</div>`}
          <button type="button" class="timer-cta secondary" data-action="mix-add">${icon('plus')} AJOUTER UN BLOC</button>
          ${timerMixEditorHTML()}
          <div class="timer-inline-row">
            <span>Répéter la séquence</span>
            <input id="mix-rounds" type="number" inputmode="numeric" min="1" max="99" step="1" value="${c.rounds}" aria-label="Nombre de répétitions">
          </div>
          ${timerNotesField('timer-mix-notes', c.notes)}
          <button type="button" class="timer-cta" data-action="start">${icon('play')} DÉMARRER LE MIX</button>
          <button type="button" class="timer-cta secondary" data-action="save-preset">${icon('bookmark')} Sauvegarder comme préréglage</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Preset modal                                                       */
  /* ------------------------------------------------------------------ */

  function timerOpenPresetDialog() {
    let config;
    try {
      config = T.view === 'mix' ? timerReadMixConfig() : timerReadSetupConfig();
    } catch {
      timerToast('Impossible de lire cette configuration.', 'error');
      return;
    }
    if (!config) return;
    if (config.mode === 'mix' && !config.blocks.length) {
      timerToast('Ajoute au moins un bloc avant de sauvegarder.', 'error');
      return;
    }
    timerClosePresetDialog();
    const overlay = document.createElement('div');
    overlay.className = 'timer-modal';
    overlay.id = 'timer-preset-modal';
    overlay.style.setProperty('--timer-color', timerModeInfo(config.mode).color);
    overlay.innerHTML = `
      <div class="timer-modal-card" role="dialog" aria-modal="true" aria-labelledby="timer-preset-title">
        <h3 id="timer-preset-title">Sauvegarder le préréglage</h3>
        <p>${timerModeInfo(config.mode).label} · ${timerConfigSummary(config)}</p>
        <input id="timer-preset-name" type="text" maxlength="40" placeholder="Ex. Tabata du lundi" aria-label="Nom du préréglage">
        <div class="timer-modal-actions">
          <button type="button" data-preset-cancel>Annuler</button>
          <button type="button" class="primary" data-preset-save>Enregistrer</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    timerPresetDialog = overlay;
    const input = overlay.querySelector('#timer-preset-name');
    const close = () => timerClosePresetDialog();
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
      if (event.target.closest('[data-preset-cancel]')) close();
      if (event.target.closest('[data-preset-save]')) {
        const name = input.value.trim() || `${timerModeInfo(config.mode).label} ${T.presets.length + 1}`;
        const existing = T.presets.find(preset => preset.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.config = clone(config);
          existing.createdAt = new Date().toISOString();
        } else {
          T.presets.unshift({
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            config: clone(config),
            createdAt: new Date().toISOString(),
          });
        }
        T.presets = T.presets.slice(0, 50);
        writeJSON(STORAGE.presets, T.presets);
        close();
        timerToast(`Préréglage « ${name} » enregistré.`);
        if (T.view === 'presets') timerRender();
      }
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        overlay.querySelector('[data-preset-save]')?.click();
      }
      if (event.key === 'Escape') close();
    });
    input.focus();
  }

  function timerClosePresetDialog() {
    if (timerPresetDialog) {
      timerPresetDialog.remove();
      timerPresetDialog = null;
    }
  }

  function timerConfirm(title, text, onConfirm, options = {}) {
    timerCloseConfirm();
    const overlay = document.createElement('div');
    overlay.className = 'timer-modal';
    overlay.innerHTML = `
      <div class="timer-modal-card" role="dialog" aria-modal="true" aria-labelledby="timer-confirm-title">
        <h3 id="timer-confirm-title">${tEsc(title)}</h3>
        <p>${tEsc(text)}</p>
        <div class="timer-modal-actions">
          <button type="button" data-confirm-cancel>Annuler</button>
          <button type="button" class="${options.danger ? 'danger' : 'primary'}" data-confirm-ok>${tEsc(options.label || 'Confirmer')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    timerConfirmDialog = overlay;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) timerCloseConfirm();
      if (event.target.closest('[data-confirm-cancel]')) timerCloseConfirm();
      if (event.target.closest('[data-confirm-ok]')) {
        timerCloseConfirm();
        onConfirm();
      }
    });
    overlay.querySelector('[data-confirm-ok]')?.focus();
  }

  function timerCloseConfirm() {
    if (timerConfirmDialog) {
      timerConfirmDialog.remove();
      timerConfirmDialog = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */

  function timerOnClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target || !T.root.contains(target)) return;
    if (target.classList.contains('timer-modal') && event.target !== target) return;
    const action = target.dataset.action;
    if (action === 'mode') timerEnterMode(target.dataset.mode);
    else if (action === 'back') timerBack();
    else if (action === 'presets') { T.view = 'presets'; timerRender(); }
    else if (action === 'settings') { T.view = 'settings'; timerRender(); }
    else if (action === 'log') { T.view = 'log'; timerRender(); }
    else if (action === 'menu') {
      if (T.run) { T.confirmStop = 'stop'; timerRender(); }
      else { T.view = 'menu'; timerRender(); }
    } else if (action === 'start') {
      if (T.mode === 'mix') {
        const config = timerReadMixConfig();
        if (!config.blocks.length) { timerToast('Ajoute au moins un bloc au MIX.', 'error'); return; }
        timerStart(config);
      } else {
        timerStart(timerReadSetupConfig());
      }
    } else if (action === 'setup-quick') {
      const input = $(target.dataset.target);
      if (input) {
        input.value = target.dataset.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        timerUpdateEstimate();
        T.root.querySelectorAll('.timer-chip').forEach(chip => chip.classList.toggle('active', chip === target));
      }
    } else if (action === 'tabata-preset') {
      const values = { 'timer-work': target.dataset.work, 'timer-rest': target.dataset.rest, 'timer-rounds': target.dataset.rounds, 'timer-sets': '1' };
      Object.entries(values).forEach(([id, value]) => { const input = $(id); if (input) input.value = value; });
      timerUpdateEstimate();
      T.root.querySelectorAll('.timer-chip').forEach(chip => chip.classList.toggle('active', chip === target));
    } else if (action === 'pause') timerPauseToggle();
    else if (action === 'lap') timerRecordLap();
    else if (action === 'finish') {
      const phase = timerCurrentPhase();
      if (!phase) return;
      if (phase.countUp) {
        if (T.run && T.run.timeline.mode === 'mix' && T.run.index < T.run.timeline.phases.length - 1) timerCompletePhase(true);
        else timerFinish('complete');
      } else {
        T.confirmStop = 'finish';
        timerRender();
      }
    } else if (action === 'stop-cancel') {
      T.confirmStop = null;
      timerRender();
    } else if (action === 'stop-confirm') {
      T.confirmStop = null;
      timerFinish('stopped');
    } else if (action === 'sound-toggle') {
      T.settings.sound = !T.settings.sound;
      timerSaveSettings();
      timerRender();
    } else if (action === 'fullscreen') timerToggleFullscreen();
    else if (action === 'summary') { T.view = 'summary'; T.summaryEntry = T.lastEntry; timerRender(); }
    else if (action === 'open-log') {
      T.summaryEntry = T.log.find(entry => entry.id === target.dataset.id) || null;
      T.view = 'summary';
      timerRender();
    } else if (action === 'export-log') timerExportLog();
    else if (action === 'clear-log') {
      timerConfirm('Effacer le journal ?', 'Toutes les séances enregistrées seront supprimées de ce navigateur.', () => {
        T.log = [];
        writeJSON(STORAGE.log, T.log);
        timerToast('Journal effacé.');
        timerRender();
      }, { danger: true, label: 'Effacer' });
    } else if (action === 'delete-entry') {
      timerConfirm('Supprimer cette séance ?', 'Elle disparaîtra du journal.', () => {
        T.log = T.log.filter(entry => entry.id !== target.dataset.id);
        writeJSON(STORAGE.log, T.log);
        T.summaryEntry = null;
        T.view = 'log';
        timerToast('Séance supprimée.');
        timerRender();
      }, { danger: true, label: 'Supprimer' });
    } else if (action === 'retry') {
      const entry = T.summaryEntry;
      if (entry && entry.config) timerStart(entry.config);
      else { T.view = 'menu'; timerRender(); }
    } else if (action === 'share') timerShare(T.summaryEntry || T.lastEntry);
    else if (action === 'save-preset') timerOpenPresetDialog();
    else if (action === 'load-preset') timerLoadPreset(target.dataset.id);
    else if (action === 'start-preset') timerStartPreset(target.dataset.id);
    else if (action === 'delete-preset') timerDeletePreset(target.dataset.id);
    else if (action === 'toggle-setting') {
      const key = target.dataset.key;
      T.settings[key] = !T.settings[key];
      timerSaveSettings();
      timerRender();
    } else if (action === 'test-sound') timerSound('start');
    else if (action === 'reset-data') {
      timerConfirm('Effacer les données du chrono ?', 'Réglages, préréglages et journal seront supprimés. Le générateur de séances n’est pas touché.', () => {
        try {
          localStorage.removeItem(STORAGE.settings);
          localStorage.removeItem(STORAGE.presets);
          localStorage.removeItem(STORAGE.log);
        } catch { /* noop */ }
        T.settings = timerLoadSettings();
        T.presets = [];
        T.log = [];
        T.lastEntry = null;
        T.summaryEntry = null;
        T.run = null;
        T.view = 'menu';
        T.mode = 'amrap';
        T.config = timerDefaultConfig('amrap');
        timerToast('Données du chrono effacées.');
        timerRender();
      }, { danger: true, label: 'Effacer' });
    } else if (action === 'mix-add') {
      T.mixDraft = timerMixDefaults('amrap');
      timerRender();
      $('timer-mix-editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (action === 'mix-type') {
      const type = target.dataset.type;
      if (T.mixDraft) {
        T.mixDraft = { ...timerMixDefaults(type), index: T.mixDraft.index, label: T.mixDraft.label && T.mixDraft.label !== TYPE_INFO[T.mixDraft.type]?.label ? T.mixDraft.label : TYPE_INFO[type].label };
        timerRender();
      }
    } else if (action === 'mix-save') {
      const block = timerReadMixDraft();
      if (!block) return;
      const index = T.mixDraft?.index;
      if (index === null || index === undefined) T.mixConfig.blocks.push(block);
      else T.mixConfig.blocks[index] = block;
      T.mixDraft = null;
      timerRender();
    } else if (action === 'mix-cancel') {
      T.mixDraft = null;
      timerRender();
    } else if (action === 'mix-edit') {
      const index = Number(target.dataset.index);
      const block = T.mixConfig.blocks[index];
      if (block) {
        T.mixDraft = timerMixDraftFromBlock(block, index);
        timerRender();
        $('timer-mix-editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else if (action === 'mix-up' || action === 'mix-down') {
      const index = Number(target.dataset.index);
      const next = action === 'mix-up' ? index - 1 : index + 1;
      if (next >= 0 && next < T.mixConfig.blocks.length) {
        const blocks = T.mixConfig.blocks;
        [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
        timerRender();
      }
    } else if (action === 'mix-dup') {
      const index = Number(target.dataset.index);
      const block = T.mixConfig.blocks[index];
      if (block) {
        T.mixConfig.blocks.splice(index + 1, 0, { ...clone(block), label: `${block.label} +` });
        timerRender();
      }
    } else if (action === 'mix-del') {
      const index = Number(target.dataset.index);
      T.mixConfig.blocks.splice(index, 1);
      timerRender();
    }
  }

  function timerOnInput(event) {
    if (event.target.id === 'timer-done-notes' && T.lastEntry) {
      T.lastEntry.notes = event.target.value;
      const saved = T.log.find(entry => entry.id === T.lastEntry.id);
      if (saved) saved.notes = event.target.value;
      writeJSON(STORAGE.log, T.log);
      return;
    }
    if (T.view === 'setup' && event.target.id === 'timer-sets') {
      const wrap = $('timer-set-rest')?.closest('.timer-field');
      if (wrap) wrap.classList.toggle('hidden', Number(event.target.value) <= 1);
    }
    if (T.view === 'setup' || T.view === 'mix') timerUpdateEstimate();
  }

  function timerOnChange(event) {
    const setting = event.target.closest('[data-setting]');
    if (setting) {
      const key = setting.dataset.setting;
      if (key === 'intro') T.settings.intro = Number(setting.value);
      else if (key === 'soundPack') T.settings.soundPack = setting.value;
      timerSaveSettings();
      if (key === 'soundPack') timerSound('phase');
      return;
    }
    if (event.target.id === 'mix-rounds') timerUpdateEstimate();
  }

  function timerLoadPreset(id) {
    const preset = T.presets.find(item => item.id === id);
    if (!preset) return;
    const config = timerNormalizeConfig(preset.config);
    T.mode = config.mode;
    T.config = config;
    if (config.mode === 'mix') {
      T.mixConfig = clone(config);
      T.mixDraft = null;
      T.view = 'mix';
    } else {
      T.view = 'setup';
    }
    timerRender();
  }

  function timerStartPreset(id) {
    const preset = T.presets.find(item => item.id === id);
    if (preset) timerStart(preset.config);
  }

  function timerDeletePreset(id) {
    T.presets = T.presets.filter(item => item.id !== id);
    writeJSON(STORAGE.presets, T.presets);
    timerToast('Préréglage supprimé.');
    timerRender();
  }

  function timerShare(entry) {
    if (!entry) { timerToast('Rien à partager.', 'error'); return; }
    const text = [
      `${timerModeInfo(entry.mode).label} · ${fmtClock(entry.duration)}`,
      `${entry.rounds} tour${entry.rounds > 1 ? 's' : ''} · ${timerConfigSummary(entry.config)}`,
      entry.notes ? `Notes : ${entry.notes}` : '',
      'Chrono WOD',
    ].filter(Boolean).join('\n');
    if (navigator.share) {
      navigator.share({ title: 'Chrono WOD', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => timerToast('Résumé copié.')).catch(() => timerToast('Partage indisponible.', 'error'));
    } else {
      timerToast('Partage indisponible.', 'error');
    }
  }

  function timerCsvField(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function timerDownload(filename, content) {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function timerExportLog() {
    if (!T.log.length) { timerToast('Le journal est vide.', 'error'); return; }
    const rows = [['Date', 'Mode', 'Durée (s)', 'Durée', 'Tours', 'Notes'].map(timerCsvField).join(',')];
    T.log.forEach(entry => {
      rows.push([
        entry.date,
        timerModeInfo(entry.mode).label,
        entry.duration,
        fmtClock(entry.duration),
        entry.rounds,
        entry.notes || '',
      ].map(timerCsvField).join(','));
    });
    timerDownload(`chrono-wod-journal-${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\r\n'));
    timerToast('Journal exporté en CSV.');
  }

  /* ------------------------------------------------------------------ */
  /* Storage + init                                                     */
  /* ------------------------------------------------------------------ */

  function timerLoadSettings() {
    const saved = readJSON(STORAGE.settings, {});
    return {
      sound: saved.sound !== false,
      voice: !!saved.voice,
      intro: [0, 3, 5, 10].includes(Number(saved.intro)) ? Number(saved.intro) : 5,
      soundPack: ['fitness', 'bell', 'boxing', 'soft'].includes(saved.soundPack) ? saved.soundPack : 'fitness',
      contrast: !!saved.contrast,
      keepAwake: saved.keepAwake !== false,
    };
  }

  function timerSaveSettings() {
    writeJSON(STORAGE.settings, T.settings);
  }

  function timerLoadPresets() {
    const list = readJSON(STORAGE.presets, []);
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && item.id && item.name && item.config).slice(0, 50);
  }

  function timerLoadLog() {
    const list = readJSON(STORAGE.log, []);
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && item.id && item.date && item.config).slice(0, 100);
  }

  function timerGlobalKey(event) {
    if (event.key !== 'Escape') return;
    if (timerPresetDialog) { timerClosePresetDialog(); return; }
    if (timerConfirmDialog) { timerCloseConfirm(); return; }
    if (T.confirmStop) { T.confirmStop = null; timerRender(); }
  }

  function timerInit() {
    T.root = $('timer-app');
    if (!T.root) return;
    T.settings = timerLoadSettings();
    T.presets = timerLoadPresets();
    T.log = timerLoadLog();
    T.config = timerDefaultConfig('amrap');
    T.mixConfig = timerDefaultConfig('mix');
    T.baseTitle = document.title;
    T.root.addEventListener('click', timerOnClick);
    T.root.addEventListener('input', timerOnInput);
    T.root.addEventListener('change', timerOnChange);
    $('timer-shortcut')?.addEventListener('click', timerOpenTab);
    document.addEventListener('keydown', timerGlobalKey);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && T.run && !T.run.finished) {
        timerTick();
        timerWakeLockOn();
      }
    });
    window.addEventListener('beforeunload', event => {
      if (T.run && !T.run.finished) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    timerRender();
  }

  window.ChronoWod = {
    open: timerOpenTab,
    start: timerStart,
    finish: () => timerFinish('manual'),
    buildTimeline: timerBuildTimeline,
    getState: () => {
      const run = T.run;
      const phase = timerCurrentPhase();
      return {
        view: T.view,
        mode: run ? run.config.mode : T.mode,
        running: !!run && !run.paused && !run.finished,
        paused: !!run && run.paused,
        index: run ? run.index : -1,
        remaining: phase ? (phase.countUp ? timerPhaseElapsed() : Math.max(0, phase.seconds - timerPhaseElapsed())) : 0,
        total: run ? run.timeline.totalSeconds : 0,
        rounds: run ? run.rounds : 0,
        settings: { ...T.settings },
      };
    },
    setSettings: patch => {
      Object.assign(T.settings, patch || {});
      timerSaveSettings();
      timerRender();
    },
    version: '1.0.0',
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', timerInit);
  } else {
    timerInit();
  }
})();
