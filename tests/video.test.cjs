'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const audio = require('../js/audio.js');
const video = require('../js/video.js');
const helpers = video._test;

function song(meter = '4/4') {
  const beats = meter === '6/8' ? 3 : Number(meter[0]);
  return {
    meter, bpm: 120, volume: 0.65, instrument: 'musicbox',
    bars: Array.from({ length: 8 }, () => ({ notes: [{ pitch: 'C5', dur: beats / 2 }, { pitch: 'E5', dur: beats / 2 }] })),
    lyrics: Array.from({ length: 8 }, (_, i) => [`${i + 1}마디 `, '노래'])
  };
}

function timelineFor(state) {
  return (audio.buildTimeline || audio._test.buildTimeline)(state);
}

function mp4Blob() {
  const bytes = new Uint8Array(200);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24);
  bytes.set(Buffer.from('ftypisom'), 4);
  bytes.set(Buffer.from('isommp42'), 16);
  return new Blob([bytes], { type: 'video/mp4' });
}

test('lyric video follows the real audio note boundaries in all meters', () => {
  for (const meter of ['2/4', '3/4', '4/4', '6/8']) {
    const state = song(meter);
    const timeline = timelineFor(state);
    const frames = helpers.lyricFrames(state, timeline);
    timeline.events.forEach(event => {
      const frame = helpers.frameAt(frames, timeline, event.start + event.duration / 2);
      assert.equal(frame.barIndex, event.barIndex);
      assert.equal(frame.activeNote, event.noteIndex);
      assert.equal(frame.tokens[event.noteIndex].text, state.lyrics[event.barIndex][event.noteIndex]);
    });
    const ending = helpers.frameAt(frames, timeline, timeline.duration + 0.7);
    assert.equal(ending.barIndex, 7);
    assert.equal(ending.activeNote, -1);
    assert.equal(ending.tokens.map(token => token.text).join(''), '8마디 노래');
  }
});

test('silent rests and empty lyrics do not introduce invented words', () => {
  const state = song('2/4');
  state.bars[0].notes[0].pitch = 'REST';
  state.lyrics[0] = ['지워야함', ''];
  state.lyrics[1] = ['   ', ''];
  const timeline = timelineFor(state);
  const frames = helpers.lyricFrames(state, timeline);
  const rest = helpers.frameAt(frames, timeline, 0.1);
  assert.equal(rest.activeNote, -1);
  assert.equal(rest.tokens.map(token => token.text).join(''), '');
  assert.deepEqual(helpers.wrapTokens(frames[1].tokens, () => 10, 100), []);
});

test('long Korean phrases wrap with their original syllable timing and word spaces', () => {
  const tokens = [{ text: '바람 ', noteIndex: 0 }, { text: '따라', noteIndex: 1 }, { text: '노래', noteIndex: 2 }];
  const lines = helpers.wrapTokens(tokens, char => char === ' ' ? 4 : 10, 35);
  assert.ok(lines.length > 1);
  assert.equal(lines.flatMap(line => line.glyphs).map(glyph => glyph.text).join(''), '바람 따라노래');
  assert.deepEqual(lines.flatMap(line => line.glyphs).map(glyph => glyph.noteIndex), [0, 0, 0, 1, 1, 2, 2]);
  assert.ok(lines.every(line => line.width <= 35));
});

test('format negotiation requires a real MP4 container with H.264 and AAC', () => {
  assert.equal(helpers.chooseMime({ isTypeSupported: type => type.startsWith('video/webm') }), null);
  const chosen = helpers.chooseMime({ isTypeSupported: type => type === 'video/mp4;codecs=avc1,mp4a.40.2' });
  assert.equal(chosen, 'video/mp4;codecs=avc1,mp4a.40.2');
  assert.match(helpers.chooseMime({ isTypeSupported: () => true }), /1F,mp4a\.40\.2$/);
});

test('MP4 signature check rejects renamed WebM and accepts the MP4 ftyp brand', async () => {
  assert.equal(await helpers.assertMp4(mp4Blob()), true);
  const webm = new Uint8Array(200);
  webm.set([0x1a, 0x45, 0xdf, 0xa3]);
  await assert.rejects(helpers.assertMp4(new Blob([webm], { type: 'video/mp4' })), /MP4 형식/);
  await assert.rejects(helpers.assertMp4(new Blob([])), /만들지 못했/);
});

function runtime() {
  const observed = { tracks: [], contexts: [], sources: [], recorderStops: 0, listeners: new Map(), connectedToSpeakers: false };
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  }
  function track(kind) {
    const result = { kind, stops: 0, stop() { this.stops++; } };
    observed.tracks.push(result);
    return result;
  }
  class Context {
    constructor() { this.state = 'suspended'; this.origin = Date.now(); observed.contexts.push(this); }
    get currentTime() { return (Date.now() - this.origin) / 1000; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; this.closes = (this.closes || 0) + 1; }
    createMediaStreamDestination() { return { stream: new Stream([track('audio')]) }; }
    createBufferSource() {
      const source = {
        stops: 0, disconnects: 0,
        connect(destination) { if (!destination.stream) observed.connectedToSpeakers = true; },
        start() { this.timer = setTimeout(() => { if (this.onended) this.onended(); }, this.buffer.duration * 1000); },
        stop() { this.stops++; clearTimeout(this.timer); },
        disconnect() { this.disconnects++; }
      };
      observed.sources.push(source);
      return source;
    }
  }
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('video/mp4'); }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; setTimeout(() => { if (this.onstart) this.onstart(); }, 0); }
    stop() {
      this.state = 'inactive'; observed.recorderStops++;
      setTimeout(() => {
        if (this.ondataavailable) this.ondataavailable({ data: mp4Blob() });
        if (this.onstop) this.onstop();
      }, 0);
    }
  }
  const sandbox = {
    module: { exports: {} }, Blob, Uint8Array, DataView, Set, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
    AudioContext: Context, MediaRecorder: Recorder, MediaStream: Stream,
    addEventListener(name, listener) { observed.listeners.set(name, listener); },
    removeEventListener(name) { observed.listeners.delete(name); },
    DiceAudio: {
      duration: state => timelineFor(state).duration,
      buildTimeline: timelineFor,
      async renderBuffer(state) { return { buffer: { duration: 0.03 }, timeline: timelineFor(state) }; }
    },
    document: {
      createElement() {
        return {
          getContext() { return { fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText(text) { return { width: Array.from(text).length * 50 }; } }; },
          captureStream() { return new Stream([track('video')]); }
        };
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/video.js'), 'utf8'), sandbox);
  return { api: sandbox.module.exports, observed };
}

test('successful recording includes both tracks and releases every media resource', async () => {
  const { api, observed } = runtime();
  const phases = [];
  const file = await api.exportMp4(song(), event => phases.push(event.phase));
  assert.equal(file.type, 'video/mp4');
  assert.equal(await helpers.assertMp4(file), true);
  assert.ok(phases.includes('recording'));
  assert.equal(phases.at(-1), 'complete');
  assert.equal(observed.connectedToSpeakers, false);
  assert.equal(observed.tracks.length, 2);
  assert.ok(observed.tracks.every(track => track.stops === 1));
  assert.equal(observed.sources[0].disconnects, 1);
  assert.equal(observed.contexts[0].closes, 1);
  assert.equal(observed.listeners.size, 0);
  assert.equal(api.isExporting, false);
});

test('cancelling an active recording rejects without leaving tracks or playback running', async () => {
  const { api, observed } = runtime();
  const controller = new AbortController();
  await assert.rejects(api.exportMp4(song(), event => {
    if (event.phase === 'recording') controller.abort();
  }, { signal: controller.signal }), { name: 'AbortError' });
  assert.ok(observed.tracks.every(track => track.stops === 1));
  assert.equal(observed.recorderStops, 1);
  assert.equal(observed.sources[0].stops, 1);
  assert.equal(observed.contexts[0].closes, 1);
  assert.equal(observed.listeners.size, 0);
  assert.equal(api.isExporting, false);
});
