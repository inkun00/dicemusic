/* Black-and-white lyric videos, encoded as genuine H.264/AAC MP4 in the browser. */
(function (root) {
  'use strict';

  const WIDTH = 1280;
  const HEIGHT = 720;
  const FPS = 30;
  const RELEASE_TAIL = 0.8;
  const FONT_SIZE = 68;
  const FONT = '500 ' + FONT_SIZE + 'px "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const MP4_TYPES = [
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
    'video/mp4;codecs=avc1.640028,mp4a.40.2'
  ];
  let exporting = false;

  function audioApi() {
    return root.DiceAudio || (typeof module !== 'undefined' && module.exports ? require('./audio.js') : null);
  }

  function chooseMime(Recorder) {
    if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return null;
    return MP4_TYPES.find(function (type) {
      try { return Recorder.isTypeSupported(type); } catch (_) { return false; }
    }) || null;
  }

  function isSupported() {
    return !!(root.document && (root.AudioContext || root.webkitAudioContext) && root.MediaStream && chooseMime(root.MediaRecorder));
  }

  function duration(state) {
    const audio = audioApi();
    if (!audio) throw new Error('음악 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    return audio.duration(state) + RELEASE_TAIL;
  }

  function abortError() {
    const error = new Error('영상 파일 만들기를 취소했습니다.');
    error.name = 'AbortError';
    return error;
  }

  function abortable(promise, signal) {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise(function (resolve, reject) {
      const cancel = function () { reject(abortError()); };
      signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(function (value) {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      }, function (error) {
        signal.removeEventListener('abort', cancel);
        reject(error);
      });
    });
  }

  function lyricFrames(state, timeline) {
    return state.bars.map(function (bar, barIndex) {
      return {
        start: barIndex * timeline.barDuration,
        duration: timeline.barDuration,
        tokens: bar.notes.map(function (_, noteIndex) {
          const note = timeline.events.find(function (event) { return event.barIndex === barIndex && event.noteIndex === noteIndex; });
          // A rest cannot sing a lyric, even if old state contains text in that slot.
          const text = note && note.midi !== null ? String(state.lyrics && state.lyrics[barIndex] && state.lyrics[barIndex][noteIndex] || '') : '';
          return { text: text.trim() ? text : '', noteIndex: noteIndex };
        })
      };
    });
  }

  function frameAt(frames, timeline, elapsed) {
    const barIndex = Math.max(0, Math.min(frames.length - 1, Math.floor(elapsed / timeline.barDuration)));
    const note = timeline.events.find(function (event) { return event.midi !== null && elapsed >= event.start && elapsed < event.start + event.duration; });
    return { barIndex: barIndex, tokens: frames[barIndex].tokens, activeNote: note && note.barIndex === barIndex ? note.noteIndex : -1 };
  }

  function wrapTokens(tokens, measure, maxWidth) {
    const lines = [];
    let line = { glyphs: [], width: 0 };
    tokens.forEach(function (token) {
      Array.from(token.text).forEach(function (text) {
        const width = measure(text);
        if (line.glyphs.length && line.width + width > maxWidth) {
          lines.push(line);
          line = { glyphs: [], width: 0 };
        }
        line.glyphs.push({ text: text, noteIndex: token.noteIndex, width: width });
        line.width += width;
      });
    });
    if (line.glyphs.length) lines.push(line);
    return lines;
  }

  function drawFrame(context, frame) {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.font = FONT;
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    const lines = wrapTokens(frame.tokens, function (text) { return context.measureText(text).width; }, WIDTH - 160);
    const lineHeight = FONT_SIZE * 1.6;
    lines.forEach(function (line, index) {
      const baseline = HEIGHT / 2 - (lines.length - 1) * lineHeight / 2 + FONT_SIZE * 0.35 + index * lineHeight;
      let x = (WIDTH - line.width) / 2;
      line.glyphs.forEach(function (glyph) {
        context.fillText(glyph.text, x, baseline);
        if (glyph.noteIndex === frame.activeNote && glyph.text.trim()) {
          context.beginPath();
          context.moveTo(x + 1, baseline + 12);
          context.lineTo(x + glyph.width - 1, baseline + 12);
          context.stroke();
        }
        x += glyph.width;
      });
    });
  }

  async function assertMp4(file) {
    if (!file || file.size < 100) throw new Error('영상 파일을 만들지 못했습니다. 다시 시도해 주세요.');
    const bytes = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = function (offset) { return String.fromCharCode.apply(null, bytes.subarray(offset, offset + 4)); };
    let offset = 0;
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset);
      const type = ascii(offset + 4);
      if (size < 8 || offset + size > bytes.length) break;
      if (type === 'ftyp' && size >= 16) {
        const brands = [ascii(offset + 8)];
        for (let index = offset + 16; index + 4 <= offset + size; index += 4) brands.push(ascii(index));
        if (brands.some(function (brand) { return /^(isom|iso[2-9]|mp4[12]|avc[13]|dash|M4V |MSNV)$/.test(brand); })) return true;
        break;
      }
      offset += size;
    }
    throw new Error('MP4 형식으로 저장되지 않았습니다. 최신 Chrome 또는 Edge에서 다시 만들어 주세요.');
  }

  async function exportMp4(state, onProgress, options) {
    options = options || {};
    if (exporting) throw new Error('영상 파일을 만드는 중입니다. 완료될 때까지 기다려 주세요.');
    const audio = audioApi();
    const AudioContextClass = root.AudioContext || root.webkitAudioContext;
    const mimeType = chooseMime(root.MediaRecorder);
    if (!audio || typeof audio.renderBuffer !== 'function' || typeof audio.buildTimeline !== 'function') throw new Error('영상 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    if (!mimeType || !root.document || !AudioContextClass || !root.MediaStream) {
      throw new Error('이 브라우저는 MP4 영상 생성을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.');
    }
    const score = {
      meter: state.meter, bpm: state.bpm, volume: state.volume, instrument: state.instrument,
      bars: (state.bars || []).map(function (bar) { return bar ? { chord: bar.chord, ending: bar.ending, notes: bar.notes.map(function (note) { return { pitch: note.pitch, dur: note.dur }; }) } : null; }),
      lyrics: (state.lyrics || []).map(function (bar) { return Array.isArray(bar) ? bar.map(String) : []; })
    };
    const controller = new root.AbortController();
    const signal = controller.signal;
    const cancel = function () { controller.abort(); };
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', cancel, { once: true });
    }
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', cancel, { once: true });
    let context, canvasStream, audioStream, combined, source, recorder, frameTimer, finalTimer, watchdog;
    let recordingAborted = null;
    const report = function (phase, progress, extra) {
      if (typeof onProgress === 'function' && !signal.aborted) onProgress(Object.assign({ phase: phase, progress: progress }, extra));
    };
    exporting = true;
    try {
      if (signal.aborted) throw abortError();
      // Create/resume this context during the button's user gesture, before awaiting rendering.
      context = new AudioContextClass({ sampleRate: 44100, latencyHint: 'playback' });
      await abortable(context.resume(), signal);
      if (context.state !== 'running') throw new Error('영상 만들기 버튼을 다시 눌러 주세요.');
      report('rendering', 0.01);
      const rendered = await abortable(audio.renderBuffer(score, function (progress) {
        report('rendering', Math.max(0.01, Math.min(0.12, Number(progress.progress || 0) * 0.12)));
      }, { signal: signal }), signal);
      const buffer = rendered.buffer;
      const timeline = rendered.timeline || audio.buildTimeline(score);
      if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('음악을 만들지 못했습니다. 다시 시도해 주세요.');
      const frames = lyricFrames(score, timeline);
      const canvas = root.document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const drawing = canvas.getContext('2d', { alpha: false });
      if (!drawing || typeof canvas.captureStream !== 'function') throw new Error('이 브라우저는 영상 생성을 지원하지 않습니다. 최신 Chrome 또는 Edge를 이용해 주세요.');
      if (root.document.fonts && root.document.fonts.load) await abortable(root.document.fonts.load(FONT), signal);
      drawFrame(drawing, frameAt(frames, timeline, 0));
      canvasStream = canvas.captureStream(FPS);
      const destination = context.createMediaStreamDestination();
      audioStream = destination.stream;
      source = context.createBufferSource();
      source.buffer = buffer;
      // The exported music goes into the recording; it does not play over the app's player.
      source.connect(destination);
      combined = new root.MediaStream(canvasStream.getVideoTracks().concat(audioStream.getAudioTracks()));
      if (combined.getVideoTracks().length !== 1 || combined.getAudioTracks().length !== 1) throw new Error('영상과 음악을 함께 기록하지 못했습니다. 다시 시도해 주세요.');
      recorder = new root.MediaRecorder(combined, { mimeType: mimeType, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
      if (!/^video\/mp4(?:;|$)/i.test(recorder.mimeType)) throw new Error('MP4 인코더를 시작하지 못했습니다. 최신 Chrome 또는 Edge를 이용해 주세요.');
      const chunks = [];
      const file = await new Promise(function (resolve, reject) {
        let finished = false;
        let stopping = false;
        let origin = 0;
        const fail = function (error) {
          if (finished) return;
          finished = true;
          reject(error);
        };
        recordingAborted = function () { fail(abortError()); };
        signal.addEventListener('abort', recordingAborted, { once: true });
        const stopRecording = function () {
          if (stopping || finished) return;
          stopping = true;
          clearInterval(frameTimer);
          report('finalizing', 0.97, { elapsed: buffer.duration, duration: buffer.duration });
          try { recorder.stop(); } catch (error) { fail(error); }
        };
        recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
        recorder.onerror = function () { fail(new Error('MP4 영상 인코딩에 실패했습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.')); };
        recorder.onstop = function () {
          if (finished) return;
          if (!stopping) return fail(new Error('곡이 끝나기 전에 영상 기록이 중단되었습니다. 다시 시도해 주세요.'));
          finished = true;
          resolve(new Blob(chunks, { type: 'video/mp4' }));
        };
        recorder.onstart = function () {
          if (signal.aborted || finished) return fail(abortError());
          try {
            origin = context.currentTime + 0.02;
            source.start(origin);
            const paint = function () {
              if (finished || signal.aborted) return;
              const elapsed = Math.max(0, Math.min(buffer.duration, context.currentTime - origin));
              drawFrame(drawing, frameAt(frames, timeline, elapsed));
              report('recording', 0.12 + 0.83 * elapsed / buffer.duration, { elapsed: elapsed, duration: buffer.duration });
            };
            paint();
            frameTimer = setInterval(paint, 1000 / FPS);
            source.onended = function () {
              // Give the media stream's audio encoder a final block before stopping.
              if (!finished && !signal.aborted) finalTimer = setTimeout(stopRecording, 120);
            };
          } catch (error) { fail(error); }
        };
        watchdog = setTimeout(function () { fail(new Error('영상 기록이 중단되었습니다. 브라우저 창을 열어 둔 채 다시 시도해 주세요.')); }, (buffer.duration + 15) * 1000);
        try { recorder.start(1000); } catch (error) { fail(error); }
      });
      await abortable(assertMp4(file), signal);
      report('complete', 1, { elapsed: buffer.duration, duration: buffer.duration });
      return file;
    } finally {
      clearInterval(frameTimer);
      clearTimeout(finalTimer);
      clearTimeout(watchdog);
      if (recordingAborted) signal.removeEventListener('abort', recordingAborted);
      if (options.signal) options.signal.removeEventListener('abort', cancel);
      if (typeof root.removeEventListener === 'function') root.removeEventListener('pagehide', cancel);
      if (recorder) {
        recorder.onstart = recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* Already stopped. */ }
      }
      if (source) {
        source.onended = null;
        try { source.stop(); } catch (_) { /* Already ended. */ }
        try { source.disconnect(); } catch (_) { /* Already detached. */ }
      }
      const tracks = new Set();
      [canvasStream, audioStream, combined].forEach(function (stream) { if (stream) stream.getTracks().forEach(function (track) { tracks.add(track); }); });
      tracks.forEach(function (track) { track.stop(); });
      if (context && context.state !== 'closed') {
        try { await context.close(); } catch (_) { /* Context was closed by the browser. */ }
      }
      exporting = false;
    }
  }

  const api = { exportMp4: exportMp4, duration: duration, isSupported: isSupported };
  Object.defineProperty(api, 'isExporting', { enumerable: true, get: function () { return exporting; } });
  Object.defineProperty(api, '_test', { value: { chooseMime: chooseMime, lyricFrames: lyricFrames, frameAt: frameAt, wrapTokens: wrapTokens, drawFrame: drawFrame, assertMp4: assertMp4 } });
  root.DiceVideo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
