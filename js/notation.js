/* Self-contained, accessible SVG engraving and a print-quality PDF exporter. */
(function (root) {
  'use strict';

  const INK = '#263c47';
  const ACCENT = '#be6b59';
  const FONT = "Arial, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
  const METERS = ['2/4', '3/4', '4/4', '6/8'];
  const LETTER_STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const BRAVURA_CLEF = root.BravuraClef || (typeof module !== 'undefined' && module.exports ? require('../vendor/bravura-clef.js') : null);
  const clefImages = new Map();

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[char]));
  }

  function meterInfo(meter) {
    const name = METERS.includes(meter) ? meter : '4/4';
    const [top, bottom] = name.split('/').map(Number);
    return { name, top, bottom, beats: top * 4 / bottom, beamGroup: name === '6/8' ? 1.5 : 1 };
  }

  function durationOf(note) {
    const value = Number(note && (note.dur == null ? note.duration : note.dur));
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function isRest(note) {
    return !note || note.rest === true || note.pitch == null || /^(rest|r)$/i.test(String(note.pitch));
  }

  function pitchStep(pitch) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(String(pitch));
    if (!match) return 0;
    return Number(match[3]) * 7 + LETTER_STEPS[match[1]] - (4 * 7 + LETTER_STEPS.B);
  }

  function symbolFor(duration) {
    const values = [
      [6, 'whole', 1, 0], [4, 'whole', 0, 0], [3, 'half', 1, 0],
      [2, 'half', 0, 0], [1.5, 'quarter', 1, 0], [1, 'quarter', 0, 0],
      [0.75, 'eighth', 1, 1], [0.5, 'eighth', 0, 1],
      [0.375, 'sixteenth', 1, 2], [0.25, 'sixteenth', 0, 2]
    ];
    const item = values.find(([value]) => Math.abs(value - duration) < 0.0001) || values[5];
    return { kind: item[1], dots: item[2], flags: item[3], open: item[1] === 'whole' || item[1] === 'half' };
  }

  function settings(options) {
    const o = options || {};
    const width = Math.max(180, Number(o.width) || 300);
    const height = Math.max(115, Number(o.height) || 150);
    const gap = Math.max(6, Number(o.staffGap) || 8.5);
    const scale = gap / 8.5;
    const showClef = o.showClef !== false;
    const showMeter = o.showMeter == null ? showClef : !!o.showMeter;
    const staffTop = Number.isFinite(o.staffTop) ? o.staffTop : 47;
    return Object.assign({}, o, {
      width, height, gap, scale, showClef, showMeter,
      meter: meterInfo(o.meter), staffTop, staffBottom: staffTop + gap * 4,
      lyricY: Number.isFinite(o.lyricY) ? o.lyricY : staffTop + gap * 4 + 36,
      // The clef scales with the staff: reserve its full width before the signature and notes.
      left: (showClef ? 15 + 42 * scale : 16) + (showMeter ? 24 * scale : 0),
      meterX: showClef ? 15 + 55 * scale : 16 + 11 * scale,
      right: width - 20,
      ink: o.ink || INK
    });
  }

  function layoutMeasure(notes, options) {
    const o = settings(options);
    const list = Array.isArray(notes) ? notes : [];
    const beats = Math.max(o.meter.beats, list.reduce((sum, note) => sum + durationOf(note), 0));
    const available = Math.max(60, o.right - o.left - 12);
    let onset = 0;
    return list.map((note, index) => {
      const duration = durationOf(note);
      const step = pitchStep(note && note.pitch);
      const position = {
        index, x: o.left + 10 + (onset / beats) * available,
        y: o.staffTop + o.gap * 2 - step * o.gap / 2,
        lyricY: o.lyricY, pitch: note && note.pitch, duration, onset,
        rest: isRest(note), step, stemDirection: step >= 0 ? -1 : 1,
        symbol: symbolFor(duration)
      };
      onset += duration;
      return position;
    });
  }

  // Use the official Bravura gClef artwork; its font origin lies on the G4 staff line.
  function clef(x, staffTop, scale, ink) {
    if (!BRAVURA_CLEF) throw new Error('음자리표 이미지를 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    if (!clefImages.has(ink)) {
      const svg = BRAVURA_CLEF.svg.replace(/#263c47/g, escape(ink));
      clefImages.set(ink, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    const staffGap = 8.5 * scale;
    const unit = staffGap / BRAVURA_CLEF.staffSpace;
    return `<image data-clef="bravura-g-clef" href="${escape(clefImages.get(ink))}" x="${x - BRAVURA_CLEF.originX * unit}" y="${staffTop + staffGap * 3 - BRAVURA_CLEF.originY * unit}" width="${BRAVURA_CLEF.width * unit}" height="${BRAVURA_CLEF.height * unit}"/>`;
  }

  function restSymbol(p, o) {
    const middle = o.staffTop + o.gap * 2;
    const s = o.scale;
    const ink = p.index === o.activeNote ? ACCENT : o.ink;
    const attrs = `fill="${escape(ink)}" stroke="${escape(ink)}"`;
    let shape = '';
    if (p.symbol.kind === 'whole') {
      shape = `<rect x="${p.x - 6 * s}" y="${o.staffTop + o.gap - 0.5}" width="${12 * s}" height="${4 * s}" ${attrs}/>`;
    } else if (p.symbol.kind === 'half') {
      shape = `<rect x="${p.x - 6 * s}" y="${middle - 4 * s}" width="${12 * s}" height="${4 * s}" ${attrs}/>`;
    } else if (!p.symbol.flags) {
      shape = `<path d="M ${p.x + 2 * s} ${middle - 13 * s} l ${-6 * s} ${8 * s} l ${8 * s} ${8 * s} l ${-5 * s} ${5 * s} q ${-6 * s} ${3 * s} ${-2 * s} ${9 * s} q ${-10 * s} ${-7 * s} ${-2 * s} ${-11 * s} l ${3 * s} ${-3 * s} l ${-6 * s} ${-8 * s} Z" ${attrs} stroke-width="0.6"/>`;
    } else {
      shape = `<path d="M ${p.x + 5 * s} ${middle - 7 * s} l ${-5 * s} ${22 * s}" fill="none" stroke="${escape(ink)}" stroke-width="${1.8 * s}"/>`;
      for (let j = 0; j < p.symbol.flags; j++) {
        shape += `<path d="M ${p.x + 4 * s} ${middle - 7 * s + j * 7 * s} q ${-9 * s} ${8 * s} ${-10 * s} ${1 * s}" fill="none" stroke="${escape(ink)}" stroke-width="${3.4 * s}" stroke-linecap="round"/>`;
      }
    }
    if (p.symbol.dots) shape += `<circle cx="${p.x + 12 * s}" cy="${middle - o.gap / 2}" r="${1.7 * s}" fill="${escape(ink)}"/>`;
    return shape;
  }

  function ledgerLines(p, o) {
    let output = '';
    const line = step => {
      const y = o.staffTop + o.gap * 2 - step * o.gap / 2;
      return `<line x1="${p.x - 9 * o.scale}" x2="${p.x + 9 * o.scale}" y1="${y}" y2="${y}" stroke="${escape(o.ink)}" stroke-width="${0.9 * o.scale}"/>`;
    };
    for (let step = -6; step >= p.step; step -= 2) output += line(step);
    for (let step = 6; step <= p.step; step += 2) output += line(step);
    return output;
  }

  function notehead(p, o) {
    const ink = p.index === o.activeNote ? ACCENT : o.ink;
    const s = o.scale;
    const rx = (p.symbol.kind === 'whole' ? 6.7 : 5.6) * s;
    const ry = (p.symbol.kind === 'whole' ? 4.2 : 3.7) * s;
    let output = ledgerLines(p, o);
    if (p.index === o.activeNote) {
      output += `<circle cx="${p.x}" cy="${p.y}" r="${12 * s}" fill="${ACCENT}" opacity="0.14"/>`;
    }
    output += `<ellipse cx="${p.x}" cy="${p.y}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${p.x} ${p.y})" fill="${p.symbol.open ? 'white' : escape(ink)}" stroke="${escape(ink)}" stroke-width="${p.symbol.open ? 1.6 * s : 0.8 * s}"/>`;
    if (p.symbol.dots) {
      // A dot on a staff line is lifted into the adjoining space.
      const dotY = p.step % 2 === 0 ? p.y - o.gap / 2 : p.y;
      output += `<circle cx="${p.x + 10 * s}" cy="${dotY}" r="${1.6 * s}" fill="${escape(ink)}"/>`;
    }
    const accidental = /^([A-G])([#b])/.exec(String(p.pitch));
    if (accidental) output += `<text x="${p.x - 16 * s}" y="${p.y + 5 * s}" font-family="${FONT}" font-size="${18 * s}" fill="${escape(ink)}">${accidental[2] === '#' ? '♯' : '♭'}</text>`;
    return output;
  }

  function beamGroups(positions, o) {
    const groups = [];
    let group = [];
    let beat = -1;
    positions.forEach(p => {
      const key = Math.floor((p.onset + 0.00001) / o.meter.beamGroup);
      if (p.rest || !p.symbol.flags || key !== beat) {
        if (group.length) groups.push(group);
        group = [];
      }
      if (!p.rest && p.symbol.flags) group.push(p);
      beat = key;
    });
    if (group.length) groups.push(group);
    return groups;
  }

  function stemsAndBeams(positions, o) {
    const groups = beamGroups(positions, o);
    const beamed = new Set(groups.filter(group => group.length > 1).flat().map(p => p.index));
    const s = o.scale;
    let output = '';
    groups.filter(group => group.length > 1).forEach(group => {
      const dir = group.reduce((sum, p) => sum + p.step, 0) / group.length >= 0 ? -1 : 1;
      const first = group[0], last = group[group.length - 1];
      const slope = Math.max(-7 * s, Math.min(7 * s, (last.y - first.y) * 0.22));
      const firstX = first.x + dir * 5 * s;
      const lastX = last.x + dir * 5 * s;
      let firstY = first.y - dir * 28 * s;
      const beamY = p => firstY + slope * (p.x - first.x) / Math.max(1, last.x - first.x);
      const correction = Math.max(0, ...group.map(p => 25 * s - dir * (p.y - beamY(p))));
      firstY -= dir * correction;
      group.forEach(p => {
        p.stemDirection = dir;
        p.stemX = p.x + dir * 5 * s;
        p.stemEndY = beamY(p);
        output += `<line x1="${p.stemX}" y1="${p.y}" x2="${p.stemX}" y2="${p.stemEndY}" stroke="${escape(p.index === o.activeNote ? ACCENT : o.ink)}" stroke-width="${1.2 * s}"/>`;
      });
      const lastY = firstY + slope;
      const thickness = 3.8 * s * dir;
      output += `<path d="M ${firstX} ${firstY} L ${lastX} ${lastY} L ${lastX} ${lastY + thickness} L ${firstX} ${firstY + thickness} Z" fill="${escape(o.ink)}"/>`;
      // Secondary sixteenth beams can span adjacent notes or form short hooks.
      group.forEach((p, index) => {
        if (p.symbol.flags < 2) return;
        const next = group[index + 1];
        if (index > 0 && group[index - 1].symbol.flags > 1) return;
        let finishX = p.stemX + (index === group.length - 1 ? -9 : 9) * s;
        if (next && next.symbol.flags > 1) {
          let end = index + 1;
          while (group[end + 1] && group[end + 1].symbol.flags > 1) end++;
          finishX = group[end].stemX;
        }
        const beginY = beamY(p) + dir * 7 * s;
        const finishY = firstY + slope * (finishX - firstX) / Math.max(1, lastX - firstX) + dir * 7 * s;
        output += `<path d="M ${p.stemX} ${beginY} L ${finishX} ${finishY} L ${finishX} ${finishY + thickness} L ${p.stemX} ${beginY + thickness} Z" fill="${escape(o.ink)}"/>`;
      });
    });
    positions.filter(p => !p.rest && p.symbol.kind !== 'whole' && !beamed.has(p.index)).forEach(p => {
      const dir = p.stemDirection;
      const x = p.x + dir * 5 * s;
      const endY = p.y - dir * 29 * s;
      const ink = p.index === o.activeNote ? ACCENT : o.ink;
      output += `<line x1="${x}" y1="${p.y}" x2="${x}" y2="${endY}" stroke="${escape(ink)}" stroke-width="${1.2 * s}"/>`;
      for (let i = 0; i < p.symbol.flags; i++) {
        const y = endY + dir * i * 7 * s;
        output += `<path d="M ${x} ${y} C ${x + dir * 12 * s} ${y + dir * 4 * s}, ${x + dir * 13 * s} ${y + dir * 14 * s}, ${x + dir * 5 * s} ${y + dir * 19 * s} C ${x + dir * 8 * s} ${y + dir * 10 * s}, ${x + dir * 5 * s} ${y + dir * 9 * s}, ${x} ${y + dir * 7 * s} Z" fill="${escape(ink)}"/>`;
      }
    });
    return output;
  }

  function measureContent(notes, options) {
    const o = settings(options);
    const positions = layoutMeasure(notes, options);
    let content = '';
    for (let i = 0; i < 5; i++) {
      const y = o.staffTop + i * o.gap;
      content += `<line x1="${Number.isFinite(o.staffStart) ? o.staffStart : 8}" x2="${o.width - 9}" y1="${y}" y2="${y}" stroke="${escape(o.ink)}" stroke-opacity="0.55" stroke-width="0.85"/>`;
    }
    if (o.showClef) content += clef(15, o.staffTop, o.scale, o.ink);
    if (o.showMeter) {
      const x = o.meterX;
      content += `<text x="${x}" y="${o.staffTop + o.gap * 1.75}" text-anchor="middle" fill="${escape(o.ink)}" font-family="Georgia, serif" font-size="${20 * o.scale}" font-weight="700">${o.meter.top}</text>`;
      content += `<text x="${x}" y="${o.staffTop + o.gap * 3.85}" text-anchor="middle" fill="${escape(o.ink)}" font-family="Georgia, serif" font-size="${20 * o.scale}" font-weight="700">${o.meter.bottom}</text>`;
    }
    if (o.barNumber != null) content += `<text x="10" y="${o.staffTop - 18}" fill="${escape(o.ink)}" opacity="0.65" font-family="${FONT}" font-size="${10 * o.scale}">${escape(o.barNumber)}</text>`;
    if (o.chord) content += `<text x="${o.width - 18}" y="${o.staffTop - 18}" text-anchor="end" fill="${escape(o.ink)}" opacity="0.65" font-family="Georgia, serif" font-style="italic" font-size="${11 * o.scale}">${escape(o.chord)}</text>`;
    const endX = o.width - 9;
    content += `<line x1="${endX}" x2="${endX}" y1="${o.staffTop}" y2="${o.staffBottom}" stroke="${escape(o.ink)}" stroke-width="${o.final ? 3.6 : 1.1}"/>`;
    if (o.final) content += `<line x1="${endX - 6}" x2="${endX - 6}" y1="${o.staffTop}" y2="${o.staffBottom}" stroke="${escape(o.ink)}" stroke-width="1.2"/>`;
    if (!positions.length) {
      content += `<text x="${o.width / 2 + 8}" y="${o.staffTop + o.gap * 2 + 5}" text-anchor="middle" font-family="${FONT}" font-size="17" fill="${escape(o.ink)}" opacity="0.22">—</text>`;
    }
    content += stemsAndBeams(positions, o);
    positions.forEach(p => {
      content += `<g data-note-index="${p.index}" data-note-x="${p.x}" data-note-y="${p.y}" aria-label="${escape(p.rest ? '쉼표' : p.pitch)}">`;
      content += p.rest ? restSymbol(p, o) : notehead(p, o);
      content += '</g>';
      const lyric = Array.isArray(o.lyrics) ? o.lyrics[p.index] : '';
      if (!p.rest && lyric != null && String(lyric).length) {
        const previous = positions[p.index - 1], next = positions[p.index + 1];
        const room = Math.max(12, Math.min(
          previous ? p.x - previous.x : Infinity,
          next ? next.x - p.x : Infinity,
          2 * (p.x - 8), 2 * (o.width - 18 - p.x)
        ) - 5 * o.scale);
        const lyricText = String(lyric);
        const units = Array.from(lyricText).reduce((total, char) => total + (/[\u0000-\u00ff]/.test(char) ? 0.56 : 1), 0);
        const normalSize = 12 * o.scale;
        const fitSize = Math.min(normalSize, room / Math.max(1, units));
        if (fitSize >= normalSize * 0.72) {
          content += `<text x="${p.x}" y="${o.lyricY}" text-anchor="middle" font-family="${FONT}" font-size="${fitSize}" fill="${escape(o.ink)}">${escape(lyricText)}</text>`;
        } else {
          // Keep multi-character words legible in dense eighth-note passages.
          const lines = wrapTitle(lyricText, Math.max(1, room / normalSize));
          content += `<text x="${p.x}" y="${o.lyricY}" text-anchor="middle" font-family="${FONT}" font-size="${normalSize}" fill="${escape(o.ink)}">`;
          lines.forEach((line, index) => { content += `<tspan x="${p.x}" dy="${index ? normalSize * 1.12 : 0}">${escape(line)}</tspan>`; });
          content += '</text>';
        }
      }
    });
    return content;
  }

  function renderMeasure(notes, options) {
    const o = settings(options);
    const description = `${o.barNumber || ''}마디, ${o.meter.name}박자${o.final ? ', 끝마디' : ''}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${o.width}" height="${o.height}" role="img" aria-label="${escape(description)}" style="color:${escape(o.ink)};overflow:visible">` + measureContent(notes, options) + '</svg>';
  }

  function wrapTitle(value, maxUnits) {
    const lines = [];
    let line = '', units = 0;
    for (const char of Array.from(value)) {
      const unit = /[\u0000-\u00ff]/.test(char) ? 0.56 : 1;
      if (units + unit > maxUnits && line) {
        lines.push(line); line = ''; units = 0;
      }
      line += char; units += unit;
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['우연이 만든 작은 노래'];
  }

  function renderSong(state, options) {
    const song = state || {};
    const o = options || {};
    const width = Math.max(560, Number(o.width) || 1120);
    const scale = width / 1120;
    const title = String(song.title || '우연이 만든 작은 노래').trim();
    const titleLines = wrapTitle(title, 29);
    const extraTitle = (titleLines.length - 1) * 41;
    const header = 150 + extraTitle;
    const rowHeight = 205;
    const footer = header + rowHeight * 4 + 16;
    const height = (footer + 40) * scale;
    const meter = meterInfo(song.meter).name;
    const barWidth = 514;
    let content = `<rect width="${width}" height="${height}" fill="white"/>`;
    content += `<g transform="scale(${scale})" style="color:${INK}">`;
    titleLines.forEach((line, index) => {
      content += `<text x="560" y="${62 + index * 41}" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="700" fill="${INK}">${escape(line)}</text>`;
    });
    content += `<text x="1074" y="${101 + extraTitle}" text-anchor="end" font-family="${FONT}" font-size="17" fill="${INK}">작곡 · ${escape(song.composer || '이름 없는 작곡가')}</text>`;
    content += `<text x="46" y="${121 + extraTitle}" font-family="${FONT}" font-size="16" fill="${INK}">다장조 · ${escape(meter)}박자 · ${meter === '6/8' ? '점4분음표' : '4분음표'} = ${escape(Math.round(Number(song.bpm) || 105))}</text>`;
    content += `<line x1="46" y1="${131 + extraTitle}" x2="1074" y2="${131 + extraTitle}" stroke="${INK}" stroke-opacity="0.15"/>`;
    for (let i = 0; i < 8; i++) {
      const bar = Array.isArray(song.bars) && song.bars[i] ? song.bars[i] : {};
      const x = 46 + (i % 2) * barWidth;
      const y = header + Math.floor(i / 2) * rowHeight;
      content += `<g transform="translate(${x} ${y})">` + measureContent(bar.notes || [], {
        meter, width: barWidth, height: rowHeight, staffGap: 12,
        staffTop: 51, lyricY: 145, showClef: i % 2 === 0, showMeter: i === 0,
        staffStart: i % 2 === 0 ? 8 : -9,
        barNumber: i + 1, chord: bar.chord || '', final: i === 7,
        lyrics: o.lyrics === false ? [] : ((song.lyrics || [])[i] || [])
      }) + '</g>';
    }
    content += `<text x="560" y="${footer}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${INK}" opacity="0.48">DICE MUSIC · 주사위로 만든 여덟 마디</text>`;
    content += '</g>';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(title)} 8마디 악보">${content}</svg>`;
  }

  async function exportPdf(state) {
    const Constructor = root.jspdf && root.jspdf.jsPDF;
    if (!Constructor) throw new Error('PDF 모듈을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    if (!root.document || !root.Image) throw new Error('PDF 내보내기는 브라우저에서 사용할 수 있어요.');
    if (root.document.fonts && root.document.fonts.ready) await root.document.fonts.ready;
    const svg = renderSong(state, { width: 1120, lyrics: true });
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = root.URL.createObjectURL(svgBlob);
    try {
      const img = new root.Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('악보 이미지를 만들지 못했어요. 다시 시도해 주세요.'));
        img.src = url;
      });
      const canvas = root.document.createElement('canvas');
      const ratio = 3;
      canvas.width = Math.ceil(img.naturalWidth * ratio);
      canvas.height = Math.ceil(img.naturalHeight * ratio);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('이 브라우저에서 PDF 이미지를 만들 수 없어요.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pdf = new Constructor({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const factor = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2 - 5) / canvas.height);
      const drawWidth = canvas.width * factor;
      const drawHeight = canvas.height * factor;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageWidth - drawWidth) / 2, margin + 5, drawWidth, drawHeight, undefined, 'FAST');
      pdf.setProperties({ title: String((state || {}).title || '주사위 작곡 악보'), author: String((state || {}).composer || ''), creator: 'Dice Music' });
      return pdf.output('blob');
    } finally {
      root.URL.revokeObjectURL(url);
    }
  }

  const api = { renderMeasure, layoutMeasure, renderSong, exportPdf, escape, meterInfo };
  root.DiceNotation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
