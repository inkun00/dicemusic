'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('../js/audio.js');
const helpers = audio._test;

function song(meter, bpm = 120) {
  const beats = meter === '6/8' ? 3 : Number(meter[0]);
  return { meter, bpm, instrument: 'musicbox', volume: 0.7, bars: Array.from({ length: 8 }, () => ({ notes: [{ pitch: 'C5', dur: beats }] })) };
}

test('all four meters keep eight complete bars and compound-meter tempo', () => {
  assert.equal(audio.duration(song('2/4')), 8);
  assert.equal(audio.duration(song('3/4')), 12);
  assert.equal(audio.duration(song('4/4')), 16);
  assert.equal(audio.duration(song('6/8')), 8);
  for (const meter of ['2/4', '3/4', '4/4', '6/8']) assert.equal(helpers.validateForExport(song(meter)), true);
});

test('note frequencies accept notation, accidentals and MIDI, with silent rests', () => {
  assert.equal(helpers.frequencyForPitch('A4'), 440);
  assert.equal(helpers.frequencyForPitch(69), 440);
  assert.equal(helpers.frequencyForPitch('a/4'), 440);
  assert.equal(helpers.frequencyForPitch('Bb4'), helpers.frequencyForPitch('A#4'));
  assert.equal(helpers.frequencyForPitch(null), null);
  assert.equal(helpers.frequencyForPitch('r'), null);
  assert.throws(() => helpers.frequencyForPitch('H4'));
});

test('timeline places rests, eighths and the final cadence without shifting bars', () => {
  const state = song('6/8');
  state.bars[0].notes = [{ pitch: 'C5', dur: 0.5 }, { pitch: null, dur: 0.5 }, { pitch: 'E5', dur: 2 }];
  const timeline = helpers.buildTimeline(state);
  assert.equal(timeline.events[1].midi, null);
  assert.equal(timeline.events[1].start, 1 / 6);
  assert.equal(timeline.events[3].start, 1);
  assert.equal(timeline.events.at(-1).start, 7);
  assert.equal(timeline.events.at(-1).start + timeline.events.at(-1).duration, 8);
  assert.equal(timeline.accompaniment.filter(event => !event.bass).length, 48);
  assert.equal(timeline.accompaniment.at(-1).midi, 36);
});

test('music export requires exactly eight bars with correct rhythmic totals', () => {
  const incomplete = song('4/4');
  incomplete.bars[5] = null;
  assert.throws(() => helpers.validateForExport(incomplete), /8마디/);
  const wrongRhythm = song('3/4');
  wrongRhythm.bars[3].notes[0].dur = 4;
  assert.throws(() => helpers.validateForExport(wrongRhythm), /박자/);
  const wrongNote = song('2/4');
  wrongNote.bars[2].notes[0].pitch = 'H6';
  assert.throws(() => helpers.validateForExport(wrongNote), /음높이/);
});

test('playback snapshot is insulated from score edits', () => {
  const state = song('4/4');
  const copy = helpers.snapshot(state);
  state.bars[0].notes[0].pitch = 'D5';
  state.bpm = 180;
  assert.equal(copy.bars[0].notes[0].pitch, 'C5');
  assert.equal(copy.bpm, 120);
});

test('encoding avoids clipping and keeps intentionally quiet volume', () => {
  const loud = helpers.normalizeSamples(new Float32Array([0, 2, -2, 0.5]));
  assert.ok(Math.abs(loud[1] - 0.96) < 0.000001);
  assert.ok(Math.abs(loud[2] + 0.96) < 0.000001);
  assert.equal(loud[0], 0);
  const quiet = helpers.normalizeSamples(new Float32Array([0.25, -0.25]));
  assert.equal(quiet[0], 0.25);
  assert.equal(quiet[1], -0.25);
});
