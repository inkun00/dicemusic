(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Music = window.DiceMusic, Notation = window.DiceNotation, Audio = window.DiceAudio, Video = window.DiceVideo;
  const STORAGE_KEY = 'dice-melody-studio-v1';
  const chordNames = { I: '으뜸화음', IV: '버금딸림화음', V: '딸림화음' };
  const instrumentNames = { musicbox: '크리스탈 뮤직박스', piano: '따뜻한 피아노', marimba: '나무 마림바', strings: '부드러운 스트링' };
  const emptyLyrics = () => Array.from({ length: 8 }, () => []);
  let state = { meter: '4/4', bpm: 105, instrument: 'musicbox', volume: .65, bars: Music.generateSong('4/4'), lyrics: emptyLyrics(), locks: Array(8).fill(false), title: '', composer: '' };
  let selected = 0, pausedOffset = 0, activeBar = -1, activeNote = -1, rolling = false, exporting = false, previewing = false, videoUrl = null, exportController = null, toastTimer, rollTimer, rollAnimation, previousCleared = null;
  let storageAvailable = true;
  let lyricActiveBar = -1, lyricActiveNote = -1;

  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function time(seconds) { const s = Math.max(0, Math.floor(seconds || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function complete() { return state.bars.length === 8 && state.bars.every(b => b && Music.validateBar(b, state.meter)); }
  function duration() { return 8 * Music.METERS[state.meter].quarterBeats * 60 / state.bpm / Music.METERS[state.meter].tempoUnit; }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { if (storageAvailable) toast('브라우저 저장 공간을 사용할 수 없어요. 파일로 저장해 주세요.'); storageAvailable = false; }
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Music.METERS[saved.meter] || !Array.isArray(saved.bars) || saved.bars.length !== 8) return;
      if (!saved.bars.every((b, i) => !b || (Music.validateBar(b, saved.meter) && b.chord === Music.FLOW_CHORDS[i] && b.dice >= 1 && b.dice <= 6 && (i !== 7 || /C[45]/.test(b.notes.at(-1).pitch))))) return;
      state = { ...state, meter:saved.meter, bars:saved.bars, bpm:Math.max(50,Math.min(180,Number(saved.bpm)||105)), instrument:instrumentNames[saved.instrument] ? saved.instrument : 'musicbox', volume:Math.max(0,Math.min(1,Number(saved.volume)||0)), title:String(saved.title||'').slice(0,40), composer:String(saved.composer||'').slice(0,30), locks:Array.from({length:8},(_,i)=>!!saved.locks?.[i]), lyrics:Array.from({length:8},(_,i)=>Array.from({length:saved.bars[i]?.notes.length||0},(_,n)=>String(saved.lyrics?.[i]?.[n]||'').slice(0,4))) };
    } catch { /* An unavailable or stale draft does not prevent composing. */ }
  }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3800); }
  function setDice(value) {
    const centers = { 1:[[40,40]], 2:[[23,23],[57,57]], 3:[[23,23],[40,40],[57,57]], 4:[[23,23],[57,23],[23,57],[57,57]], 5:[[23,23],[57,23],[40,40],[23,57],[57,57]], 6:[[23,23],[57,23],[23,40],[57,40],[23,57],[57,57]] };
    $('dice-pips').innerHTML = centers[value].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="4.5"/>`).join('');
  }
  function updateSettings() {
    document.querySelectorAll('[data-meter]').forEach(b => { const chosen = b.dataset.meter === state.meter; b.classList.toggle('selected',chosen); b.setAttribute('aria-pressed',chosen); });
    $('instrument').value = state.instrument; $('tempo').value = state.bpm; $('volume').value = Math.round(state.volume * 100);
    $('tempo-value').innerHTML = state.bpm + ' <small>BPM</small>';
    $('tempo-unit').textContent = (state.meter === '6/8' ? '♩. = ' : '♩ = ') + state.bpm;
  }
  function updateSelected() {
    $('selected-bar').textContent = selected + 1;
    $('selected-chord').textContent = chordNames[Music.FLOW_CHORDS[selected]] + ' · ' + Music.FLOW_CHORDS[selected];
    setDice(state.bars[selected]?.dice || 1);
    document.querySelectorAll('.bar-card').forEach((card,i) => { card.classList.toggle('selected',i===selected); card.querySelector('.bar-select').setAttribute('aria-pressed',i===selected); });
    $('roll-button').disabled = rolling || state.locks[selected]; $('dice').disabled = rolling || state.locks[selected];
  }
  function renderBars() {
    $('bar-grid').innerHTML = state.bars.map((bar,i) => {
      const score = bar ? Notation.renderMeasure(bar.notes,{meter:state.meter,width:240,height:140,staffGap:8.5,showClef:i===0,showMeter:i===0,final:i===7,activeNote:activeBar===i ? activeNote:-1,ink:'#254641'}) : '<div class="empty-bar"><span>＋</span>새 가락을 기다려요</div>';
      return `<article class="bar-card ${i===selected?'selected ':''}${i===7?'ending ':''}${i===activeBar?'playing':''}" data-bar="${i}"><div class="bar-card-heading"><span>${String(i+1).padStart(2,'0')} 번째 마디</span><button class="bar-lock" data-lock="${i}" aria-label="${i+1}마디 ${state.locks[i]?'잠금 해제':'잠그기'}" aria-pressed="${state.locks[i]}" title="${state.locks[i]?'잠금 해제':'이 마디 유지하기'}">${state.locks[i]?'▣':'◇'}</button></div><button class="bar-select" data-select="${i}" aria-label="${i+1}마디 선택" aria-pressed="${i===selected}">${score}</button><div class="bar-card-footer"><span>${Music.FLOW_CHORDS[i]} ${bar?'· 눈금 '+bar.dice:''}</span>${i===7?'<span class="ending-label">FINALE · 끝맺음</span>':''}<button class="bar-preview" data-preview="${i}" aria-label="${i+1}마디 미리 듣기" ${bar?'':'disabled'}>▷</button></div></article>`;
    }).join('');
    $('completion').textContent = state.bars.filter(Boolean).length + ' / 8 마디';
    $('song-button').disabled = !complete() || rolling; $('music-file-button').disabled = !complete() || exporting || rolling;
    updateSelected();
  }
  function renderPlayer(elapsed = 0) {
    $('player-time').textContent = time(elapsed) + ' / ' + time(duration());
    $('play-progress').style.width = Math.min(100,elapsed/duration()*100) + '%';
    $('play-icon').textContent = Audio.isPlaying && !previewing ? 'Ⅱ' : '▶';
    $('play-button').setAttribute('aria-label',Audio.isPlaying && !previewing ? '연주 일시정지' : pausedOffset > 0 ? '연주 이어 듣기' : '전체 곡 재생');
    $('lyric-preview').textContent = Audio.isPlaying && !previewing ? '■ 연주 정지' : '▶ 가락 듣기';
    $('lyric-preview').setAttribute('aria-pressed', String(Audio.isPlaying && !previewing));
  }
  function stopPlayback() { Audio.stop(); previewing=false; pausedOffset=0; activeBar=-1; activeNote=-1; highlightLyrics(); renderPlayer(); $('player-label').textContent='당신의 가락을 들어보세요'; renderBars(); }
  async function previewBar(bar) {
    previewing=true;pausedOffset=0;
    try { await Audio.play({...state,bars:[bar]},{onEnd:()=>{previewing=false;renderPlayer();$('player-label').textContent='당신의 가락을 들어보세요';}});$('player-label').textContent='한 마디의 가락을 미리 듣고 있어요';renderPlayer(); }
    catch(error){previewing=false;throw error;}
  }
  function invalidateClear() { previousCleared=null; $('clear-button').innerHTML='처음부터 <span aria-hidden="true">↺</span>'; }
  function changed() { stopPlayback(); invalidateClear(); save(); }
  function nextUnlocked(index) { for(let n=1;n<=8;n++){ const next=(index+n)%8; if(!state.locks[next]) return next; } return index; }
  async function roll() {
    if(rolling || state.locks[selected]) return;
    changed(); rolling=true; const index=selected;
    $('roll-button').disabled=true; $('auto-button').disabled=true; $('dice').disabled=true; $('dice').classList.add('rolling'); $('song-button').disabled=true; $('music-file-button').disabled=true;
    document.querySelectorAll('[data-meter]').forEach(b=>b.disabled=true);
    rollAnimation=setInterval(()=>setDice(1+Math.floor(Math.random()*6)),75);
    rollTimer=setTimeout(async()=>{
      clearInterval(rollAnimation); const result=1+Math.floor(Math.random()*6);
      const previous=state.bars[index];
      state.bars[index]=Music.generateMeasure({meter:state.meter,dice:result,chord:Music.FLOW_CHORDS[index],barIndex:index,previous,previousLastPitch:state.bars[index-1]?.notes.at(-1)?.pitch}); state.lyrics[index]=[];
      setDice(result); $('dice').classList.remove('rolling'); rolling=false;
      $('auto-button').disabled=false; document.querySelectorAll('[data-meter]').forEach(b=>b.disabled=false);
      selected=nextUnlocked(index); renderBars(); save();
      try { await previewBar(state.bars[index]); } catch(error) { toast(error.message); }
    },720);
  }
  function regenerate() {
    if(rolling) return;
    if(state.locks.every(Boolean)){toast('모든 마디가 잠겨 있어요. 자물쇠를 눌러 풀어주세요.');return;}
    changed(); const newBars=Music.generateSong(state.meter,state.bars);
    state.bars=state.bars.map((bar,i)=>state.locks[i]?bar:newBars[i]); state.lyrics=state.lyrics.map((lyrics,i)=>state.locks[i]?lyrics:[]);
    selected=state.locks.findIndex(lock=>!lock); renderBars(); save();
    toast('새 가락이 준비됐어요. 잠근 마디는 간직했어요.');
  }
  async function togglePlay() {
    if(rolling)return;
    if(previewing){stopPlayback();}
    if(Audio.isPlaying){ pausedOffset=Audio.pause(); activeBar=-1;activeNote=-1;highlightLyrics();renderBars();renderPlayer(pausedOffset);$('player-label').textContent='잠시 쉬어가는 중이에요';return; }
    if(!state.bars.some(Boolean)){toast('먼저 주사위를 굴려 가락을 만들어주세요.');return;}
    try {
      await Audio.play(state,{startOffset:pausedOffset,onProgress:info=>{
        if(info.barIndex!==activeBar || info.noteIndex!==activeNote){activeBar=info.barIndex;activeNote=info.noteIndex;renderBars();}
        highlightLyrics(info.barIndex, info.noteIndex);
        renderPlayer(info.elapsed);$('player-label').textContent=info.barIndex>=0?`${info.barIndex+1}번째 마디를 여행하는 중`:'가락이 잔잔하게 마무리돼요';
      },onEnd:()=>{pausedOffset=0;activeBar=-1;activeNote=-1;highlightLyrics();renderPlayer();renderBars();$('player-label').textContent='여덟 마디의 여행을 마쳤어요';}});
      renderPlayer(pausedOffset);
    } catch(error){highlightLyrics();toast(error.message);renderPlayer();}
  }
  function lyricMeasureOptions(index, playingNote = -1) {
    return {meter:state.meter,width:540,height:176,staffGap:10,staffTop:51,lyricY:143,showClef:index%2===0,showMeter:index===0,final:index===7,barNumber:index+1,chord:state.bars[index].chord,ink:'#254641',activeNote:playingNote};
  }
  function highlightLyrics(barIndex = -1, noteIndex = -1) {
    if (!$('song-dialog').open) { barIndex = -1; noteIndex = -1; }
    if (barIndex === lyricActiveBar && noteIndex === lyricActiveNote) return;
    const previousBar = lyricActiveBar;
    const affectedBars = new Set([previousBar, barIndex]);
    lyricActiveBar = barIndex; lyricActiveNote = noteIndex;
    affectedBars.forEach(index => {
      if (index < 0 || !state.bars[index]) return;
      const measure = $('lyric-score').querySelector(`[data-lyric-measure="${index}"]`);
      if (!measure) return;
      const playingNote = index === barIndex ? noteIndex : -1;
      // Replace only the SVG: lyric inputs, their values, focus and caret stay intact.
      measure.querySelector('svg').outerHTML = Notation.renderMeasure(state.bars[index].notes, lyricMeasureOptions(index, playingNote));
      measure.classList.toggle('is-playing', playingNote >= 0);
      measure.querySelectorAll('.lyric-field').forEach(field => {
        const playing = Number(field.dataset.lyricNote) === playingNote;
        field.classList.toggle('is-playing', playing);
        if (playing) field.setAttribute('aria-current', 'true'); else field.removeAttribute('aria-current');
      });
    });
    if (barIndex >= 0 && barIndex !== previousBar) {
      const measure = $('lyric-score').querySelector(`[data-lyric-measure="${barIndex}"]`);
      if (!measure) return;
      const viewport = $('lyric-score');
      const bounds = viewport.getBoundingClientRect(), barBounds = measure.getBoundingClientRect();
      if (barBounds.top < bounds.top || barBounds.bottom > bounds.bottom) {
        viewport.scrollTo({top:viewport.scrollTop + barBounds.top - bounds.top - 12,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      }
    }
  }
  function updateLyricCount() {
    let total=0,filled=0;state.bars.forEach((bar,i)=>bar?.notes.forEach((note,n)=>{if(note.pitch!=='REST'){total++;if(state.lyrics[i]?.[n]?.trim())filled++;}}));
    $('lyric-count').textContent=`가사 ${filled} / ${total} 음표`;
  }
  function showLyrics() {
    if(rolling)return;
    if(!complete()){toast('여덟 마디를 먼저 완성해 주세요.');return;}
    stopPlayback();
    $('song-meter').textContent = `${state.meter} 박자 · C장조 · ${state.bpm} BPM`;
    $('lyric-score').innerHTML='<div class="lyric-score-grid">'+state.bars.map((bar,i)=>{
      const options=lyricMeasureOptions(i);
      const positions=Notation.layoutMeasure(bar.notes,options);
      const fields=positions.filter(p=>!p.rest).map(p=>{
        const next=positions[p.index+1]?.x || 523; const prev=positions[p.index-1]?.x ?? p.x-55;const width=Math.min(52,next-p.x-7,p.x-prev-7);
        return `<input class="lyric-field" data-lyric-bar="${i}" data-lyric-note="${p.index}" style="--lyric-left:${p.x/540*100}%;--lyric-top:${(p.lyricY-14)/176*100}%;--lyric-width:${width/540*100}%" aria-label="${i+1}마디 ${p.index+1}번째 음표 가사" placeholder="가사" maxlength="4" value="${escape(state.lyrics[i]?.[p.index]||'')}" autocomplete="off">`;
      }).join('');
      return `<div class="lyric-measure" data-lyric-measure="${i}">${Notation.renderMeasure(bar.notes,options)}${fields}</div>`;
    }).join('')+'</div>';
    updateLyricCount(); $('lyric-score').scrollTop=0; $('song-dialog').showModal();
  }
  function safeFilename(title) { return (title||'나의 멜로디').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().slice(0,80)||'나의 멜로디'; }
  function download(blob,filename) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000); }
  async function makePdf(event) {
    event.preventDefault(); if(!$('metadata-form').reportValidity())return;
    state.title=$('song-title').value.trim();state.composer=$('composer').value.trim();
    if(!state.title||!state.composer){$('pdf-status').textContent='제목과 작곡가 이름을 입력해 주세요.';return;}
    save();$('pdf-button').disabled=true;$('pdf-status').textContent='당신의 악보를 정성껏 만드는 중이에요…';
    try{const blob=await Notation.exportPdf(JSON.parse(JSON.stringify(state)));download(blob,safeFilename(state.title)+'.pdf');$('pdf-status').textContent='PDF 악보가 완성됐어요. 다운로드를 확인해 주세요.';toast('제목과 가사를 담은 PDF 악보를 저장했어요.');}catch(error){$('pdf-status').textContent=error.message;}
    finally{$('pdf-button').disabled=false;}
  }
  async function makeVideo() {
    if(rolling||exporting||!complete())return;stopPlayback();exporting=true;
    const snapshot=JSON.parse(JSON.stringify(state)); const button=$('music-file-button');button.disabled=true;
    const controller=new AbortController();exportController=controller;
    $('exported-video').pause();$('export-progress').value=0;$('export-status').textContent='음악과 가사의 박자를 맞추고 있어요.';$('export-cancel').disabled=false;$('export-cancel').textContent='제작 취소';
    $('export-dialog').showModal();
    try{
      const blob=await Video.exportMp4(snapshot,info=>{
        const percent=Math.round(info.progress*100);$('export-progress').value=percent;button.textContent=`MP4 만드는 중 ${percent}%`;
        $('export-status').textContent=info.phase==='rendering'?'악기 소리와 반주를 준비하고 있어요.':info.phase==='recording'?`흰색 가사를 영상에 담고 있어요. ${time(info.elapsed)} / ${time(info.duration)}`:info.phase==='complete'?'음악 영상이 완성됐어요.':'MP4 파일을 마무리하고 있어요.';
      },{signal:controller.signal});
      if(controller.signal.aborted)return;
      if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=URL.createObjectURL(blob);
      $('exported-video').src=videoUrl;$('exported-video').load();$('video-download').href=videoUrl;$('video-download').download=safeFilename(snapshot.title)+'.mp4';
      $('video-summary').textContent=`${snapshot.title||'나의 멜로디'} · ${snapshot.meter}박자 · ${instrumentNames[snapshot.instrument]} · 1280 × 720`;
      $('export-dialog').close();$('video-dialog').showModal();$('exported-video').play().catch(()=>{});toast('가사와 음악을 담은 MP4가 완성됐어요.');
    }catch(error){toast(error.name==='AbortError'?'영상 제작을 취소했어요.':error.message);}
    finally{exportController=null;exporting=false;if($('export-dialog').open)$('export-dialog').close();button.innerHTML='<span aria-hidden="true">↓</span> 음악 파일 만들기 <small>MP4</small>';button.disabled=!complete();}
  }
  function cancelVideoExport() { if(!exportController)return;exportController.abort();$('export-cancel').disabled=true;$('export-cancel').textContent='취소하는 중…';$('export-status').textContent='영상 제작을 멈추고 있어요.'; }

  load();updateSettings();renderBars();renderPlayer();
  $('roll-button').addEventListener('click',roll);$('dice').addEventListener('click',roll);$('auto-button').addEventListener('click',regenerate);
  $('bar-grid').addEventListener('click',async event=>{
    const lock=event.target.closest('[data-lock]'),select=event.target.closest('[data-select]'),preview=event.target.closest('[data-preview]');
    if(lock){if(rolling)return;const i=Number(lock.dataset.lock);state.locks[i]=!state.locks[i];renderBars();save();return;}
    if(select){if(rolling)return;selected=Number(select.dataset.select);updateSelected();return;}
    if(preview){if(rolling)return;stopPlayback();try{await previewBar(state.bars[Number(preview.dataset.preview)]);}catch(error){toast(error.message);}}
  });
  $('meter-options').addEventListener('click',event=>{
    const button=event.target.closest('[data-meter]');if(!button||rolling||button.dataset.meter===state.meter)return;
    changed();state.meter=button.dataset.meter;state.bars=Music.generateSong(state.meter);state.lyrics=emptyLyrics();state.locks=Array(8).fill(false);selected=0;updateSettings();renderBars();renderPlayer();save();
    toast(`${state.meter}박자 가락이 준비됐어요.`);
  });
  $('instrument').addEventListener('change',()=>{changed();state.instrument=$('instrument').value;save();});
  $('tempo').addEventListener('input',()=>{Audio.stop();previewing=false;pausedOffset=0;activeBar=-1;activeNote=-1;highlightLyrics();state.bpm=Number($('tempo').value);updateSettings();renderPlayer();renderBars();save();$('player-label').textContent='새로운 빠르기로 들어보세요';});
  $('volume').addEventListener('input',()=>{const playing=Audio.isPlaying;state.volume=Number($('volume').value)/100;save();if(playing){stopPlayback();toast('음량을 바꿨어요. 재생 버튼으로 다시 들어주세요.');}});
  $('play-button').addEventListener('click',togglePlay);$('stop-button').addEventListener('click',stopPlayback);
  $('clear-button').addEventListener('click',()=>{
    if(rolling)return;stopPlayback();
    if(previousCleared){state=previousCleared;previousCleared=null;invalidateClear();updateSettings();renderBars();renderPlayer();save();toast('이전 가락을 되돌렸어요.');return;}
    previousCleared=JSON.parse(JSON.stringify(state));state.bars=Array(8).fill(null);state.lyrics=emptyLyrics();state.locks=Array(8).fill(false);state.title='';state.composer='';selected=0;renderBars();save();$('clear-button').innerHTML='되돌리기 <span aria-hidden="true">↶</span>';toast('새로 시작해요. 되돌리기를 눌러 이전 곡을 복원할 수 있어요.');
  });
  $('song-button').addEventListener('click',showLyrics);$('music-file-button').addEventListener('click',makeVideo);
  $('lyric-score').addEventListener('input',event=>{if(!event.target.matches('.lyric-field'))return;const i=Number(event.target.dataset.lyricBar),n=Number(event.target.dataset.lyricNote);state.lyrics[i][n]=event.target.value;updateLyricCount();save();});
  $('lyric-preview').addEventListener('click',()=>{if(Audio.isPlaying){stopPlayback();return;}togglePlay();});
  $('make-score').addEventListener('click',()=>{stopPlayback();$('song-title').value=state.title;$('composer').value=state.composer;$('pdf-status').textContent='';$('metadata-dialog').showModal();});
  $('metadata-form').addEventListener('submit',makePdf);
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',() => $(button.dataset.close).close()));
  $('song-dialog').addEventListener('close',()=>{stopPlayback();$('lyric-preview').textContent='▶ 가락 듣기';});
  $('video-dialog').addEventListener('close',()=>$('exported-video').pause());
  $('export-cancel').addEventListener('click',cancelVideoExport);
  $('export-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelVideoExport();});
  $('export-dialog').addEventListener('close',()=>{if(exporting)cancelVideoExport();});
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));
  window.addEventListener('pagehide',()=>{stopPlayback();cancelVideoExport();$('exported-video').pause();if(videoUrl)URL.revokeObjectURL(videoUrl);clearTimeout(rollTimer);clearInterval(rollAnimation);rolling=false;previewing=false;$('dice').classList.remove('rolling');$('auto-button').disabled=false;document.querySelectorAll('[data-meter]').forEach(b=>b.disabled=false);renderBars();});
})();
