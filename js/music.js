/* Dice music: C-major melody banks, expressed in quarter-note durations. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DiceMusic = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var METERS = Object.freeze({
    '4/4': Object.freeze({ beats: 4, unit: 4, quarterBeats: 4, label: '4/4', tempoUnit: 1 }),
    '2/4': Object.freeze({ beats: 2, unit: 4, quarterBeats: 2, label: '2/4', tempoUnit: 1 }),
    '3/4': Object.freeze({ beats: 3, unit: 4, quarterBeats: 3, label: '3/4', tempoUnit: 1 }),
    '6/8': Object.freeze({ beats: 6, unit: 8, quarterBeats: 3, label: '6/8', tempoUnit: 1.5 })
  });
  var FLOW_CHORDS = Object.freeze(['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I']);
  var SCALE = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5'];
  var CHORD_STEPS = { I: [0, 2, 4, 7], IV: [0, 3, 5, 7], V: [1, 4, 6, 8] };
  var DURATIONS = [0.5, 1, 1.5, 2, 3, 4];
  var RHYTHMS = {
    '4/4': [
      [1, 1, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 1, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 0.5, 0.5, 0.5, 0.5],
      [0.5, 0.5, 1, 0.5, 0.5, 1], [2, 1, 1], [1, 1, 2],
      [1, 0.5, 0.5, 2], [0.5, 0.5, 1, 2], [2, 0.5, 0.5, 1],
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1], [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      [0.5, 0.5, 1, 1, 0.5, 0.5], [2, 2], [1.5, 0.5, 1, 1]
    ],
    '2/4': [[1, 1], [0.5, 0.5, 1], [1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], [2], [1.5, 0.5]],
    '3/4': [
      [1, 1, 1], [2, 1], [1, 2], [0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1],
      [1, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 1], [1, 0.5, 0.5, 0.5, 0.5],
      [0.5, 0.5, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [1.5, 0.5, 1]
    ],
    // Each 6/8 group occupies one dotted-quarter beat. No ordinary bar variant crosses its middle.
    '6/8': [
      [1.5, 1.5], [1, 0.5, 1, 0.5], [0.5, 1, 0.5, 1],
      [1.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 1.5],
      [1, 0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 1, 0.5],
      [0.5, 1, 1, 0.5], [1, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    ]
  };
  var ENDING_RHYTHMS = {
    '4/4': [[1, 1, 2], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [2, 2], [1, 3], [0.5, 0.5, 3], [4]],
    '2/4': [[0.5, 0.5, 1], [1, 1], [2]],
    '3/4': [[0.5, 0.5, 2], [1, 2], [3]],
    '6/8': [[0.5, 0.5, 0.5, 1.5], [1, 0.5, 1.5], [0.5, 1, 1.5], [1.5, 1.5], [3]]
  };
  var CONTOURS = [
    [0, 1, 2, 1, 0, 1, 2, 3], [1, 1, 2, 1, 0, 1, 0, 1],
    [0, 1, 1, 2, 1, 0, 2, 1], [1, 0, 1, 0, 1, 2, 1, 0],
    [3, 2, 1, 0, 1, 2, 1, 0], [1, 2, 1, 0, 2, 1, 0, 1]
  ];

  // The supplied app's eighteen original 4/4 fragments remain part of the expanded banks.
  var ORIGINAL = {
    I: [
      [['C4', 1], ['E4', 1], ['G4', 1], ['E4', 1]],
      [['E4', 1], ['E4', 1], ['G4', 1], ['E4', 1]],
      [['C4', 1], ['E4', 0.5], ['E4', 0.5], ['E4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5]],
      [['E4', 0.5], ['D4', 0.5], ['E4', 0.5], ['D4', 0.5], ['E4', 1], ['C4', 1]],
      [['C5', 2], ['C5', 0.5], ['C5', 0.5], ['G4', 0.5], ['E4', 0.5]],
      [['E4', 2], ['G4', 2]]
    ],
    IV: [
      [['F4', 1], ['A4', 0.5], ['A4', 0.5], ['C5', 1], ['A4', 1]],
      [['F4', 0.5], ['F4', 0.5], ['F4', 0.5], ['F4', 0.5], ['A4', 1], ['F4', 1]],
      [['A4', 0.5], ['F4', 0.5], ['A4', 0.5], ['F4', 0.5], ['C4', 1], ['REST', 1]],
      [['C5', 1], ['A4', 0.5], ['F4', 0.5], ['C5', 1], ['A4', 0.5], ['F4', 0.5]],
      [['C4', 2], ['A4', 1], ['F4', 1]], [['A4', 2], ['F4', 2]]
    ],
    V: [
      [['G4', 1], ['G4', 1], ['B4', 0.5], ['A4', 0.5], ['G4', 1]],
      [['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 2]],
      [['D4', 1], ['REST', 1], ['G4', 1], ['REST', 1]],
      [['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['C5', 0.5], ['D5', 1], ['G4', 1]],
      [['G4', 0.5], ['G4', 0.5], ['G4', 0.5], ['G4', 0.5], ['D4', 2]],
      [['B4', 2], ['G4', 2]]
    ]
  };
  var cache = Object.create(null);

  function cloneNotes(notes) {
    return notes.map(function (note) { return { pitch: note.pitch, dur: note.dur }; });
  }
  function signature(notes) {
    return notes.map(function (note) { return note.pitch + ':' + note.dur; }).join('|');
  }
  function checkOptions(meter, dice, chord) {
    if (!Object.prototype.hasOwnProperty.call(METERS, meter)) throw new RangeError('Unknown meter: ' + meter);
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new RangeError('Dice must be an integer from 1 to 6.');
    if (!Object.prototype.hasOwnProperty.call(CHORD_STEPS, chord)) throw new RangeError('Unknown chord: ' + chord);
  }
  function pitchFrequency(pitch) {
    if (pitch === 'REST') return 0;
    var match = /^([A-G])([#b]?)(-?\d+)$/.exec(String(pitch));
    if (!match) throw new RangeError('Unknown pitch: ' + pitch);
    var semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var alteration = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
    var midi = (Number(match[3]) + 1) * 12 + semitones[match[1]] + alteration;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function validateBar(bar, meter) {
    var notes = Array.isArray(bar) ? bar : bar && bar.notes;
    var config = METERS[meter];
    if (!config || !Array.isArray(notes) || !notes.length) return false;
    var total = 0;
    for (var i = 0; i < notes.length; i += 1) {
      var note = notes[i];
      if (!note || DURATIONS.indexOf(note.dur) === -1) return false;
      if (note.pitch !== 'REST' && SCALE.indexOf(note.pitch) === -1) return false;
      total += note.dur;
    }
    return Math.abs(total - config.quarterBeats) < 0.000001;
  }

  function makeBank(meter, dice, chord, ending) {
    var key = [meter, dice, chord, ending ? 'ending' : 'normal'].join(':');
    if (cache[key]) return cache[key];
    var bank = [];
    var seen = Object.create(null);
    function add(notes) {
      var id = signature(notes);
      if (!seen[id] && validateBar(notes, meter)) {
        seen[id] = true;
        bank.push(Object.freeze({
          variant: key + ':' + (bank.length + 1),
          notes: Object.freeze(notes.map(function (note) { return Object.freeze(note); }))
        }));
      }
    }
    if (!ending && meter === '4/4') {
      add(ORIGINAL[chord][dice - 1].map(function (pair) { return { pitch: pair[0], dur: pair[1] }; }));
    }
    var patterns = ending ? ENDING_RHYTHMS[meter] : RHYTHMS[meter];
    var contour = CONTOURS[dice - 1];
    var tones = CHORD_STEPS[chord];
    // Enumerate rhythm, contour direction, registration and passing-tone variations deterministically.
    for (var seed = 0; seed < 240 && bank.length < (ending ? 40 : 48); seed += 1) {
      var rhythm = patterns[(seed + dice - 1) % patterns.length];
      var phase = Math.floor(seed / patterns.length);
      var notes = [];
      var offset = 0;
      for (var n = 0; n < rhythm.length; n += 1) {
        var step;
        if (ending) {
          var high = (phase + dice) % 2 === 0;
          var tonic = high ? 7 : 0;
          var approaches = high ? [8, 6, 4] : [1, 2, 4];
          var preamble = high ? [7, 4, 5, 6, 8] : [0, 2, 3, 4, 1];
          if (n === rhythm.length - 1) step = tonic;
          else if (n === rhythm.length - 2) step = approaches[(phase + dice + seed) % approaches.length];
          else step = preamble[(contour[n % contour.length] + phase + seed) % preamble.length];
        } else {
          var position = contour[(n + phase) % contour.length];
          if (phase % 3 === 1) position = 3 - position;
          position = (position + Math.floor(phase / 3)) % tones.length;
          step = tones[position];
          // Passing notes decorate weak subdivisions; principal beats retain chord tones.
          var strongBeat = meter === '6/8' ? offset % 1.5 === 0 : offset % 1 === 0;
          if (!strongBeat && rhythm[n] <= 0.5 && (phase + n + dice) % 3 === 0) {
            step = Math.max(0, Math.min(SCALE.length - 1, step + (phase % 2 === 0 ? 1 : -1)));
          }
        }
        notes.push({ pitch: SCALE[step], dur: rhythm[n] });
        offset += rhythm[n];
      }
      add(notes);
    }
    // Very short cadences can collapse several contour variants. Exhaustively add concise resolutions.
    if (ending && bank.length < 40) {
      for (var register = 0; register < 2; register += 1) {
        var endingPitch = register ? 'C5' : 'C4';
        var leadPitches = register ? ['D5', 'B4', 'G4'] : ['D4', 'E4', 'G4'];
        var firstPitches = register ? ['G4', 'A4', 'B4', 'C5', 'D5'] : ['C4', 'D4', 'E4', 'F4', 'G4'];
        patterns.forEach(function (rhythm) {
          firstPitches.forEach(function (first, firstIndex) {
            leadPitches.forEach(function (lead) {
              if (bank.length >= 40) return;
              add(rhythm.map(function (dur, index) {
                return { pitch: index === rhythm.length - 1 ? endingPitch : index === rhythm.length - 2 ? lead : firstPitches[(firstIndex + index + dice) % firstPitches.length], dur: dur };
              }));
            });
          });
        });
      }
    }
    cache[key] = Object.freeze(bank);
    return cache[key];
  }
  function getVariants(meter, dice, chord, ending) {
    checkOptions(meter, dice, chord);
    return makeBank(meter, dice, chord, Boolean(ending)).map(function (entry) { return cloneNotes(entry.notes); });
  }
  function previousSignature(previous) {
    var notes = Array.isArray(previous) ? previous : previous && previous.notes;
    return notes ? signature(notes) : null;
  }
  function generateMeasure(options) {
    options = options || {};
    var meter = options.meter || '4/4';
    var dice = options.dice === undefined ? 1 + Math.floor(Math.random() * 6) : options.dice;
    var index = options.barIndex === undefined ? 0 : options.barIndex;
    if (!Number.isInteger(index) || index < 0 || index > 7) throw new RangeError('barIndex must be an integer from 0 to 7.');
    var ending = index === 7;
    var chord = ending ? 'I' : options.chord || FLOW_CHORDS[index];
    checkOptions(meter, dice, chord);
    var oldSignature = previousSignature(options.previous);
    var candidates = makeBank(meter, dice, chord, ending).map(function (entry) {
      var notes = cloneNotes(entry.notes);
      if (index === 6) {
        // A leading tone or dominant third directs the penultimate V toward the final tonic.
        notes[notes.length - 1].pitch = notes[notes.length - 1].pitch === 'D4' ? 'D4' : 'B4';
      }
      return { notes: notes, variant: entry.variant };
    }).filter(function (entry) { return signature(entry.notes) !== oldSignature; });
    if (!candidates.length) throw new Error('Melody bank has no alternative to the previous bar.');
    var priorStep = SCALE.indexOf(options.previousLastPitch);
    var nearby = candidates.filter(function (entry) {
      return priorStep < 0 || Math.abs(SCALE.indexOf(entry.notes[0].pitch) - priorStep) <= 4;
    });
    var pool = nearby.length ? nearby : candidates;
    var choice = pool[Math.floor(Math.random() * pool.length)];
    return { dice: dice, chord: chord, notes: choice.notes, variant: choice.variant, ending: ending };
  }
  function generateSong(meter, previousBars) {
    meter = meter || '4/4';
    if (!METERS[meter]) throw new RangeError('Unknown meter: ' + meter);
    previousBars = previousBars || [];
    var bars = [];
    for (var index = 0; index < 8; index += 1) {
      var prior = index ? bars[index - 1].notes.filter(function (note) { return note.pitch !== 'REST'; }) : [];
      bars.push(generateMeasure({
        meter: meter, dice: 1 + Math.floor(Math.random() * 6), chord: FLOW_CHORDS[index], barIndex: index,
        previous: previousBars[index], previousLastPitch: prior.length ? prior[prior.length - 1].pitch : undefined
      }));
    }
    return bars;
  }

  return Object.freeze({
    METERS: METERS, FLOW_CHORDS: FLOW_CHORDS, getVariants: getVariants,
    generateMeasure: generateMeasure, generateSong: generateSong,
    validateBar: validateBar, pitchFrequency: pitchFrequency
  });
});
