'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const music = require('../js/music.js');
const sig = notes => notes.map(note => `${note.pitch}:${note.dur}`).join('|');

test('all meters have sufficient unique valid melody and cadence variants for every die and chord', () => {
  for (const meter of Object.keys(music.METERS)) {
    for (let dice = 1; dice <= 6; dice++) {
      for (const chord of ['I', 'IV', 'V']) {
        for (const ending of [false, true]) {
          const variants = music.getVariants(meter, dice, chord, ending);
          assert.ok(variants.length >= 12, `${meter} die ${dice} ${chord} ending=${ending}: ${variants.length}`);
          assert.equal(new Set(variants.map(sig)).size, variants.length);
          for (const notes of variants) {
            assert.ok(music.validateBar(notes, meter));
            if (ending) {
              assert.match(notes.at(-1).pitch, /^C[45]$/);
              assert.ok(notes.at(-1).dur >= (meter === '6/8' ? 1.5 : meter === '4/4' ? 2 : meter === '3/4' ? 2 : 1));
            }
          }
        }
      }
    }
  }
});

test('6/8 uses two dotted-quarter groups and exactly six eighth notes of elapsed time', () => {
  assert.equal(music.METERS['6/8'].quarterBeats, 3);
  assert.equal(music.METERS['6/8'].tempoUnit, 1.5);
  for (let dice = 1; dice <= 6; dice++) {
    for (const chord of ['I', 'IV', 'V']) {
      for (const notes of music.getVariants('6/8', dice, chord)) {
        let offset = 0;
        for (const note of notes) {
          assert.ok(!(offset < 1.5 && offset + note.dur > 1.5), 'No unnotated tie across compound-beat groups');
          offset += note.dur;
        }
        assert.equal(offset, 3);
      }
    }
  }
});

test('rerolling the same die changes the actual notes, including penultimate lead-ins and endings', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    for (const meter of Object.keys(music.METERS)) {
      for (let dice = 1; dice <= 6; dice++) {
        for (let barIndex = 0; barIndex < 8; barIndex++) {
          let previous;
          for (let reroll = 0; reroll < 5; reroll++) {
            const bar = music.generateMeasure({ meter, dice, barIndex, previous });
            assert.ok(music.validateBar(bar, meter));
            if (previous) assert.notEqual(sig(previous.notes), sig(bar.notes));
            if (barIndex === 6) assert.ok(['B4', 'D4'].includes(bar.notes.at(-1).pitch));
            if (barIndex === 7) assert.ok(bar.ending);
            previous = bar;
          }
        }
      }
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('whole songs preserve the source progression and close with a sustained tonic', () => {
  for (const meter of Object.keys(music.METERS)) {
    const first = music.generateSong(meter);
    const second = music.generateSong(meter, first);
    assert.equal(second.length, 8);
    assert.deepEqual(second.map(bar => bar.chord), ['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I']);
    assert.deepEqual(second.map(bar => bar.ending), [false, false, false, false, false, false, false, true]);
    second.forEach((bar, index) => {
      assert.ok(music.validateBar(bar, meter));
      assert.notEqual(sig(bar.notes), sig(first[index].notes));
    });
    assert.match(second[7].notes.at(-1).pitch, /^C[45]$/);
  }
});

test('banks and generated measures do not share mutable note objects', () => {
  const variants = music.getVariants('4/4', 1, 'I');
  const expected = sig(variants[0]);
  variants[0][0].pitch = 'REST';
  assert.equal(sig(music.getVariants('4/4', 1, 'I')[0]), expected);
  const bar = music.generateMeasure({ meter: '3/4', dice: 2 });
  bar.notes[0].dur = 100;
  assert.ok(music.getVariants('3/4', 2, 'I').every(notes => music.validateBar(notes, '3/4')));
});

test('the supplied app original fragments are preserved in the 4/4 banks', () => {
  assert.equal(sig(music.getVariants('4/4', 1, 'I')[0]), 'C4:1|E4:1|G4:1|E4:1');
  assert.equal(sig(music.getVariants('4/4', 3, 'IV')[0]), 'A4:0.5|F4:0.5|A4:0.5|F4:0.5|C4:1|REST:1');
  assert.equal(sig(music.getVariants('4/4', 6, 'V')[0]), 'B4:2|G4:2');
});

test('browser loading needs no module loader, and frequencies match equal temperament', () => {
  const context = { window: {}, Math, Object, Number, String, RangeError, Error };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/music.js'), 'utf8'), context);
  assert.equal(context.window.DiceMusic.generateSong('2/4').length, 8);
  assert.equal(music.pitchFrequency('A4'), 440);
  assert.ok(Math.abs(music.pitchFrequency('C4') - 261.625565) < 0.000001);
  assert.equal(music.pitchFrequency('REST'), 0);
  assert.equal(music.pitchFrequency('C#4'), music.pitchFrequency('Db4'));
});

test('invalid rhythm, pitch, meter, die and bar index fail explicitly', () => {
  assert.equal(music.validateBar({ notes: [{ pitch: 'C4', dur: 3 }] }, '4/4'), false);
  assert.equal(music.validateBar([{ pitch: 'Z4', dur: 4 }], '4/4'), false);
  assert.equal(music.validateBar([{ pitch: 'C4', dur: 0.25 }], '2/4'), false);
  assert.equal(music.validateBar(null, '4/4'), false);
  assert.throws(() => music.generateMeasure({ meter: '5/4' }), RangeError);
  assert.throws(() => music.generateMeasure({ dice: 0 }), RangeError);
  assert.throws(() => music.generateMeasure({ dice: 2.5 }), RangeError);
  assert.throws(() => music.generateMeasure({ chord: 'ii' }), RangeError);
  assert.throws(() => music.generateMeasure({ barIndex: 8 }), RangeError);
  assert.throws(() => music.pitchFrequency('Z4'), RangeError);
});
