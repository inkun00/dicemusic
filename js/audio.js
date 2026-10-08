/* Local Web Audio instruments and shared offline music rendering. */
(function (root) {
  'use strict';

  const SAMPLE_RATE = 44100;
  const RELEASE_TAIL = 0.8;
  const METERS = { '2/4': 2, '3/4': 3, '4/4': 4, '6/8': 3 };
  const HARMONY = ['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I'];
  const CHORDS = {
    I: { bass: 36, tones: [48, 52, 55] },
    IV: { bass: 41, tones: [48, 53, 57] },
    V: { bass: 43, tones: [47, 50, 55] }
  };
  const TIMBRES = {
    musicbox: { attack: 0.006, release: 0.35, cutoff: 6500, partials: [[1, 'sine', 1], [2.002, 'sine', 0.24], [3, 'sine', 0.045]] },
    piano: { attack: 0.008, release: 0.26, cutoff: 2800, partials: [[1, 'triangle', 0.7], [1, 'sine', 0.28], [2, 'sine', 0.12]] },
    marimba: { attack: 0.004, release: 0.16, cutoff: 4000, partials: [[1, 'sine', 1], [4, 'sine', 0.12]] },
    strings: { attack: 0.09, release: 0.28, cutoff: 2200, partials: [[1, 'triangle', 0.52, -4], [1, 'triangle', 0.52, 4], [2, 'sine', 0.07]] }
  };
  let audioContext = null;
  let active = null;
  let pausedOffset = 0;
  let operation = 0;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function quarterSeconds(state) {
    const bpm = Number(state.bpm);
    if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('올바른 빠르기를 선택해 주세요.');
    return 60 / bpm / (state.meter === '6/8' ? 1.5 : 1);
  }

  function beatsPerBar(meter) {
    if (!Object.prototype.hasOwnProperty.call(METERS, meter)) throw new Error('지원하지 않는 박자입니다.');
    return METERS[meter];
  }

  function pitchToMidi(pitch) {
    if (pitch === null || pitch === undefined || pitch === '' || /^(r|rest)$/i.test(String(pitch))) return null;
    if (typeof pitch === 'number') {
      if (!Number.isFinite(pitch) || pitch < 0 || pitch > 127) throw new Error('음높이를 확인해 주세요.');
      return pitch;
    }
    const match = String(pitch).match(/^([a-g])([#b]?)(?:\/)?(-?\d)$/i);
    if (!match) throw new Error('알 수 없는 음높이입니다: ' + pitch);
    const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
    const midi = (Number(match[3]) + 1) * 12 + semitone + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    if (midi < 0 || midi > 127) throw new Error('음높이를 확인해 주세요.');
    return midi;
  }

  function frequencyForPitch(pitch) {
    const midi = pitchToMidi(pitch);
    return midi === null ? null : 440 * Math.pow(2, (midi - 69) / 12);
  }

  function snapshot(state) {
    return {
      meter: state.meter,
      bpm: Number(state.bpm),
      instrument: Object.prototype.hasOwnProperty.call(TIMBRES, state.instrument) ? state.instrument : 'musicbox',
      volume: Number.isFinite(Number(state.volume)) ? clamp(Number(state.volume), 0, 1) : 0.7,
      bars: (state.bars || []).map(function (bar) {
        return bar ? { chord: bar.chord, ending: !!bar.ending, notes: (bar.notes || []).map(function (note) {
          return { pitch: note.pitch, dur: Number(note.dur) };
        }) } : null;
      })
    };
  }

  function buildTimeline(state) {
    const quarter = quarterSeconds(state);
    const beats = beatsPerBar(state.meter);
    const barDuration = beats * quarter;
    const bars = state.bars || [];
    const events = [];
    const accompaniment = [];
    bars.forEach(function (bar, barIndex) {
      if (!bar || !Array.isArray(bar.notes) || !bar.notes.length) return;
      let beatOffset = 0;
      bar.notes.forEach(function (note, noteIndex) {
        const noteBeats = Number(note.dur);
        if (!Number.isFinite(noteBeats) || noteBeats <= 0) throw new Error('음표의 길이를 확인해 주세요.');
        const midi = pitchToMidi(note.pitch);
        events.push({ start: barIndex * barDuration + beatOffset * quarter, duration: noteBeats * quarter, midi: midi, barIndex: barIndex, noteIndex: noteIndex });
        beatOffset += noteBeats;
      });
      const chord = CHORDS[bar.chord] || CHORDS[HARMONY[barIndex % 8]];
      // Two dotted-quarter groups in 6/8, one pulse per quarter elsewhere.
      const pulseBeats = state.meter === '6/8' ? 0.5 : 1;
      const pulses = Math.round(beats / pulseBeats);
      const order = state.meter === '6/8' ? [0, 1, 2, 0, 2, 1] : [0, 2, 1, 2];
      for (let pulse = 0; pulse < pulses; pulse += 1) {
        accompaniment.push({ start: barIndex * barDuration + pulse * pulseBeats * quarter, duration: pulseBeats * quarter * 0.85, midi: chord.tones[order[pulse]], level: pulse === 0 || (state.meter === '6/8' && pulse === 3) ? 0.065 : 0.047 });
      }
      accompaniment.push({ start: barIndex * barDuration, duration: barDuration * 0.8, midi: chord.bass, level: 0.06, bass: true });
    });
    return { events: events, accompaniment: accompaniment, duration: bars.length * barDuration, barDuration: barDuration };
  }

  function duration(state) {
    return (state.bars || []).length * beatsPerBar(state.meter) * quarterSeconds(state);
  }

  function validateForExport(state) {
    const beats = beatsPerBar(state.meter);
    quarterSeconds(state);
    if (!Array.isArray(state.bars) || state.bars.length !== 8 || state.bars.some(function (bar) { return !bar || !Array.isArray(bar.notes) || !bar.notes.length; })) {
      throw new Error('8마디를 모두 완성한 후 음악 파일을 만들어 주세요.');
    }
    state.bars.forEach(function (bar) {
      const total = bar.notes.reduce(function (sum, note) {
        const noteBeats = Number(note.dur);
        if (!Number.isFinite(noteBeats) || noteBeats <= 0) throw new Error('음표의 길이를 확인해 주세요.');
        pitchToMidi(note.pitch);
        return sum + noteBeats;
      }, 0);
      if (Math.abs(total - beats) > 0.00001) throw new Error('마디의 박자 길이가 맞지 않습니다. 가락을 다시 선택해 주세요.');
    });
    return true;
  }

  function makeScene(context, volume) {
    const input = context.createGain();
    const output = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const delayA = context.createDelay(0.5);
    const delayB = context.createDelay(0.5);
    const wetA = context.createGain();
    const wetB = context.createGain();
    const roomFilter = context.createBiquadFilter();
    input.gain.value = volume;
    output.gain.value = 0.9;
    compressor.threshold.value = -12;
    compressor.knee.value = 15;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.22;
    delayA.delayTime.value = 0.11;
    delayB.delayTime.value = 0.23;
    wetA.gain.value = 0.12;
    wetB.gain.value = 0.075;
    roomFilter.type = 'lowpass';
    roomFilter.frequency.value = 3600;
    input.connect(compressor);
    input.connect(roomFilter);
    roomFilter.connect(delayA);
    roomFilter.connect(delayB);
    delayA.connect(wetA);
    delayB.connect(wetB);
    wetA.connect(compressor);
    wetB.connect(compressor);
    compressor.connect(output);
    output.connect(context.destination);
    return { context: context, input: input, sources: [], nodes: [input, output, compressor, delayA, delayB, wetA, wetB, roomFilter] };
  }

  function synthNote(scene, midi, start, length, instrument, level, bass) {
    if (midi === null || length <= 0) return;
    const context = scene.context;
    const voice = bass ? { attack: 0.015, release: 0.2, cutoff: 700, partials: [[1, 'sine', 1]] } : TIMBRES[instrument];
    const frequency = frequencyForPitch(midi);
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const attack = Math.min(voice.attack, length * 0.25);
    const peak = Math.max(0.0001, level);
    const releaseEnd = start + length + voice.release;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(voice.cutoff, context.sampleRate * 0.45), start);
    filter.Q.value = 0.45;
    gain.gain.setValueAtTime(0.00001, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    if (instrument === 'strings' && !bass) {
      gain.gain.linearRampToValueAtTime(peak * 0.78, start + length);
      gain.gain.exponentialRampToValueAtTime(0.00001, releaseEnd);
    } else {
      gain.gain.exponentialRampToValueAtTime(Math.max(0.00002, peak * (instrument === 'marimba' ? 0.035 : 0.13)), start + length);
      gain.gain.exponentialRampToValueAtTime(0.00001, releaseEnd);
    }
    filter.connect(gain);
    gain.connect(scene.input);
    scene.nodes.push(gain, filter);
    voice.partials.forEach(function (partial) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = partial[1];
      oscillator.frequency.setValueAtTime(frequency * partial[0], start);
      oscillator.detune.value = partial[3] || 0;
      partialGain.gain.value = partial[2];
      oscillator.connect(partialGain);
      partialGain.connect(filter);
      oscillator.start(start);
      oscillator.stop(releaseEnd + 0.015);
      scene.sources.push(oscillator);
      scene.nodes.push(oscillator, partialGain);
    });
  }

  function scheduleScene(scene, score, timeline, origin, offset) {
    timeline.events.forEach(function (event) {
      const end = event.start + event.duration;
      if (end <= offset) return;
      synthNote(scene, event.midi, origin + Math.max(0, event.start - offset), end - Math.max(offset, event.start), score.instrument, 0.19, false);
    });
    timeline.accompaniment.forEach(function (event) {
      const end = event.start + event.duration;
      if (end <= offset) return;
      synthNote(scene, event.midi, origin + Math.max(0, event.start - offset), end - Math.max(offset, event.start), 'piano', event.level, event.bass);
    });
  }

  function releaseScene(scene) {
    if (!scene) return;
    scene.sources.forEach(function (source) {
      try { source.stop(); } catch (_) { /* Already ended. */ }
    });
    scene.nodes.forEach(function (node) {
      try { node.disconnect(); } catch (_) { /* Already detached. */ }
    });
    scene.sources.length = 0;
    scene.nodes.length = 0;
  }

  function elapsedFor(session) {
    return clamp(session.offset + Math.max(0, session.context.currentTime - session.origin), 0, session.timeline.duration);
  }

  function clearPlayback() {
    if (!active) return;
    clearInterval(active.timer);
    clearTimeout(active.endTimer);
    releaseScene(active.scene);
    active = null;
  }

  function notifyProgress(session) {
    if (typeof session.onProgress !== 'function') return;
    const elapsed = elapsedFor(session);
    const currentNote = session.timeline.events.find(function (event) { return elapsed >= event.start && elapsed < event.start + event.duration; });
    session.onProgress({ elapsed: elapsed, duration: session.timeline.duration, barIndex: Math.min(session.score.bars.length - 1, Math.floor(elapsed / session.timeline.barDuration)), noteIndex: currentNote && currentNote.midi !== null ? currentNote.noteIndex : -1, tail: elapsed >= session.timeline.duration });
  }

  async function play(state, options) {
    options = options || {};
    const score = snapshot(state);
    const timeline = buildTimeline(score);
    if (!timeline.events.some(function (event) { return event.midi !== null; })) throw new Error('먼저 주사위를 굴려 가락을 만들어 주세요.');
    stop();
    const ticket = operation;
    const AudioContextClass = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextClass) throw new Error('이 브라우저는 음악 재생을 지원하지 않습니다. 최신 Chrome 또는 Edge를 이용해 주세요.');
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (ticket !== operation) return;
    if (audioContext.state !== 'running') throw new Error('재생 버튼을 한 번 더 눌러 음악을 시작해 주세요.');
    const offset = clamp(Number(options.startOffset) || 0, 0, timeline.duration);
    const origin = audioContext.currentTime + 0.04;
    const scene = makeScene(audioContext, score.volume);
    const session = { score: score, timeline: timeline, scene: scene, context: audioContext, offset: offset, origin: origin, onProgress: options.onProgress, onEnd: options.onEnd, timer: null, endTimer: null };
    active = session;
    pausedOffset = offset;
    scheduleScene(scene, score, timeline, origin, offset);
    notifyProgress(session);
    session.timer = setInterval(function () { if (active === session) notifyProgress(session); }, 40);
    session.endTimer = setTimeout(function () {
      if (active !== session) return;
      notifyProgress(session);
      clearPlayback();
      pausedOffset = 0;
      if (typeof session.onEnd === 'function') session.onEnd();
    }, (timeline.duration - offset + RELEASE_TAIL + 0.04) * 1000);
  }

  function pause() {
    operation += 1;
    if (active) {
      pausedOffset = elapsedFor(active);
      clearPlayback();
    }
    return pausedOffset;
  }

  function stop() {
    operation += 1;
    clearPlayback();
    pausedOffset = 0;
  }

  function preview(bar, state) {
    return play(Object.assign({}, state, { bars: [bar] }));
  }

  function normalizeSamples(samples) {
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    // Only attenuate. A quiet volume setting remains quiet in the saved file.
    const scale = peak > 0.96 ? 0.96 / peak : 1;
    const output = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = clamp(samples[index] * scale, -1, 1);
      output[index] = sample;
    }
    return output;
  }

  function yieldToUI() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  async function renderBuffer(state, onProgress, options) {
    const signal = options && options.signal;
    function checkCancelled() {
      if (signal && signal.aborted) { const error = new Error('영상 제작을 취소했어요.'); error.name = 'AbortError'; throw error; }
    }
    checkCancelled();
    const score = snapshot(state);
    validateForExport(score);
    const OfflineClass = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OfflineClass) throw new Error('이 브라우저는 음악 파일 생성을 지원하지 않습니다. 최신 Chrome 또는 Edge를 이용해 주세요.');
    function report(phase, progress) {
      if (typeof onProgress === 'function') onProgress({ phase: phase, progress: progress });
    }
    report('rendering', 0.02);
    await yieldToUI();
    checkCancelled();
    const timeline = buildTimeline(score);
    const offline = new OfflineClass(1, Math.ceil((timeline.duration + RELEASE_TAIL) * SAMPLE_RATE), SAMPLE_RATE);
    const scene = makeScene(offline, score.volume);
    scheduleScene(scene, score, timeline, 0, 0);
    let rendered;
    try {
      rendered = await offline.startRendering();
    } finally {
      releaseScene(scene);
    }
    checkCancelled();
    rendered.copyToChannel(normalizeSamples(rendered.getChannelData(0)), 0);
    report('complete', 1);
    return { buffer: rendered, timeline: timeline };
  }

  const api = { play: play, pause: pause, stop: stop, preview: preview, renderBuffer: renderBuffer, buildTimeline: buildTimeline, duration: duration };
  Object.defineProperty(api, 'isPlaying', { enumerable: true, get: function () { return !!active; } });
  Object.defineProperty(api, '_test', { value: { pitchToMidi: pitchToMidi, frequencyForPitch: frequencyForPitch, quarterSeconds: quarterSeconds, buildTimeline: buildTimeline, validateForExport: validateForExport, normalizeSamples: normalizeSamples, snapshot: snapshot } });
  root.DiceAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
