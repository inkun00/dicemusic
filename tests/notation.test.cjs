'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const notation = require('../js/notation.js');
const music = require('../js/music.js');

test('staff positions follow diatonic pitches and proportional duration in every meter', () => {
  for (const meter of ['2/4', '3/4', '4/4', '6/8']) {
    const notes = [{ pitch: 'C4', dur: 0.5 }, { pitch: 'D4', dur: 1 }, { pitch: 'E4', dur: 0.5 }];
    const positions = notation.layoutMeasure(notes, { meter, width: 340 });
    assert.equal(positions.length, notes.length);
    assert.equal(positions[0].y - positions[1].y, 4.25);
    assert.equal(positions[1].y - positions[2].y, 4.25);
    assert.ok(Math.abs((positions[2].x - positions[1].x) - (positions[1].x - positions[0].x) * 2) < 0.000001);
    assert.ok(positions.every(p => p.x > 60 && p.x < 320 && p.lyricY > p.y));
  }
});

test('rests preserve rhythmic space and do not print a lyric beneath the rest', () => {
  const notes = [{ pitch: 'C4', dur: 1 }, { pitch: 'REST', dur: 1 }, { pitch: 'E4', dur: 2 }];
  const positions = notation.layoutMeasure(notes);
  assert.equal(positions[1].rest, true);
  assert.equal(positions[1].onset, 1);
  assert.equal(positions[2].onset, 2);
  const svg = notation.renderMeasure(notes, { lyrics: ['노', 'REST-LYRIC', '래'] });
  assert.ok(svg.includes('>노</text>') && svg.includes('>래</text>'));
  assert.ok(!svg.includes('REST-LYRIC'));
});

test('6/8 eighth notes beam in two groups of three while 3/4 beams in three pairs', () => {
  const notes = Array.from({ length: 6 }, () => ({ pitch: 'E4', dur: 0.5 }));
  const beamCount = svg => (svg.match(/<path d="M [^\"]+ Z" fill="#263c47"\/>/g) || []).length;
  assert.equal(beamCount(notation.renderMeasure(notes, { meter: '6/8' })), 2);
  assert.equal(beamCount(notation.renderMeasure(notes, { meter: '3/4' })), 3);
});

test('generated songs render eight bars, all notes, metadata, and the ending barline', () => {
  for (const meter of ['2/4', '3/4', '4/4', '6/8']) {
    const bars = music.generateSong(meter);
    const song = { meter, bars, bpm: 100, title: '별빛 노래', composer: '김노래', lyrics: bars.map(bar => bar.notes.map(() => '빛')) };
    const svg = notation.renderSong(song);
    const notes = bars.reduce((total, bar) => total + bar.notes.length, 0);
    assert.equal((svg.match(/data-note-index=/g) || []).length, notes);
    assert.ok(svg.includes('별빛 노래') && svg.includes('김노래') && svg.includes('>8</text>'));
    assert.equal((svg.match(/stroke-width="3.6"/g) || []).length, 1);
    assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
  }
});

test('title, composer and lyrics remain SVG text, including malicious markup', () => {
  const attack = '<script>alert("x")</script>&';
  const state = { title: attack, composer: attack, meter: '4/4', bars: [{ notes: [{ pitch: 'C4', dur: 4 }] }], lyrics: [[attack]] };
  const svg = notation.renderSong(state);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('&amp;'));
  assert.ok(notation.renderMeasure([{ pitch: 'C4', dur: 4 }], { chord: attack }).includes('&lt;script&gt;'));
});

test('a larger staff reserves scaled horizontal room for its clef and time signature', () => {
  const notes = [{ pitch: 'E4', dur: 1 }, { pitch: 'G4', dur: 1 }];
  const regular = notation.layoutMeasure(notes, { width: 514, showClef: true });
  const large = notation.layoutMeasure(notes, { width: 514, staffGap: 12, showClef: true });
  const largeWithoutMeter = notation.layoutMeasure(notes, { width: 514, staffGap: 12, showClef: true, showMeter: false });
  const clefRight = 15 + 38 * (12 / 8.5);
  const meterRight = 15 + 55 * (12 / 8.5) + 10 * (12 / 8.5);
  assert.ok(large[0].x > regular[0].x);
  assert.ok(large[0].x - 6 * (12 / 8.5) > meterRight);
  assert.ok(largeWithoutMeter[0].x - 6 * (12 / 8.5) > clefRight);
});

test('four-character lyrics wrap legibly without removing any syllable in a dense bar', () => {
  const notes = Array.from({ length: 8 }, () => ({ pitch: 'E4', dur: 0.5 }));
  const svg = notation.renderMeasure(notes, { width: 514, staffGap: 12, lyrics: notes.map(() => '반짝반짝') });
  assert.ok(svg.includes('<tspan'));
  assert.equal((svg.match(/반/g) || []).length, 16);
  assert.equal((svg.match(/짝/g) || []).length, 16);
});
