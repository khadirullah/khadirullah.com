// Animated timeline for Bug 1: why a plain for: 5m never fires on a crash
// loop, and why max_over_time does. Times are in minutes. Simplified to the
// phase after the back-off reached its 5 minute cap, with the 75 s gap
// measured in the second run.
(function () {
  const root = document.getElementById('clb-timeline');
  if (!root) return;

  const CYCLE = 5;      // back-off cap, minutes between restarts
  const GAP = 1.25;     // 75 s with no CrashLoopBackOff value after each restart
  const END = 20;       // four cycles
  const FOR = 5;        // the rule's for: 5m
  const MINUTE_MS = 900;
  const DWELL_MS = 3500;

  const steps = [
    { t: 0,     text: 'Before this, the pod already restarted 5 times, and Kubernetes doubled the wait each time: 10, 20, 40, 80 and 160 seconds. The next would be 320, but the wait stops growing at 5 minutes, which is 300 seconds.' },
    { t: 0,     text: 'The wait goes back to 10 seconds only if the container runs for 10 minutes without crashing. This container crashes straight away every time, so every restart from now on waits 5 minutes.' },
    { t: 0,     text: 'Restart 6. The container crashes straight away, and Kubernetes waits 5 minutes before it tries again. The pod stays broken the whole time.' },
    { t: 0.6,   text: 'For the first 75 seconds, the pod is not marked as CrashLoopBackOff yet. The metric has no value, so the graph is blank. Blank means nothing, not 0.' },
    { t: 1.25,  text: 'Now the pod shows CrashLoopBackOff, and the metric is 1. Both rules start counting toward 5 minutes.' },
    { t: 5,     text: 'Next restart, and the blank comes back. The plain rule (without max_over_time) loses the metric, so its count goes back to zero. It only reached 3 minutes 45 seconds.' },
    { t: 5.6,   text: 'The rule with max_over_time looks back over the last 5 minutes, not only at this moment. The metric was 1 just before the restart, so the answer is still 1, and the rule keeps counting.' },
    { t: 6.25,  text: 'It reaches 5 minutes and sends the alert.' },
    { t: 15,    text: 'Another restart, another reset. The plain rule only ever reaches 3 minutes 45 seconds, so it never sends an alert. The pod stays crashed, and nobody finds out until users report the problem.' },
    { t: 20,    text: 'In short, the pod waits 5 minutes between restarts, and the first 75 seconds of each wait is blank. The blank resets the plain rule, so it never alerts. The rule with max_over_time looks back 5 minutes, so the blank never resets it, and the alert goes out.' },
  ];

  const plainTimer = m => { const c = m % CYCLE; return c < GAP ? 0 : c - GAP; };
  const motTimer = m => (m < GAP ? 0 : Math.min(m - GAP, FOR));
  const pct = m => (100 * m / END).toFixed(3) + '%';
  const fmt = m => { const s = Math.round(m * 60); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // Timer lines drawn in a 1000 x 100 box, stretched to the track width
  const timerPoints = fn => {
    const pts = [];
    for (let m = 0; m <= END + 1e-9; m += 0.05) pts.push((1000 * m / END).toFixed(1) + ',' + (95 - 85 * fn(m) / FOR).toFixed(1));
    return pts.join(' ');
  };

  let podTrack = '', rawTrack = '';
  for (let m = 0; m < END; m += CYCLE) {
    podTrack += `<div class="clb-wait" style="left:${pct(m)};width:calc(${pct(CYCLE)} - 2px)"><span>waits 5 min</span></div>`;
    rawTrack += `<div class="clb-blank" style="left:${pct(m)};width:${pct(GAP)}"><span>blank</span></div>`;
    rawTrack += `<div class="clb-dash" style="left:${pct(m + GAP)};width:calc(${pct(CYCLE - GAP)} - 2px)"></div>`;
  }
  for (let m = 0; m <= END; m += CYCLE) podTrack += `<div class="clb-restart" style="left:${pct(m)}"></div>`;

  const timerSvg = (fn, cls) => `
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="10" x2="1000" y2="10" class="clb-threshold" vector-effect="non-scaling-stroke"/>
      <polyline points="${timerPoints(fn)}" class="${cls}" vector-effect="non-scaling-stroke"/>
    </svg>`;

  const row = (title, sub, track, extra = '', tall = false) => `
    <div class="clb-row">
      <div class="clb-head"><div><strong>${title}</strong><span class="clb-sub">${sub}</span></div>${extra}</div>
      <div class="clb-track${tall ? ' clb-tall' : ''}"><div class="clb-reveal">${track}</div><div class="clb-playhead"></div></div>
    </div>`;

  root.className = 'clb not-prose';
  root.innerHTML = `
    <style>
      .clb { --bg:#f8fafc; --panel:#ffffff; --line:#e2e8f0; --muted:#64748b; --wait:#bfdbfe; --waittext:#1e3a8a;
             --red:#dc2626; --green:#16a34a; --orange:#d97706; --blue:#2563eb; --grid:#e2e8f0; }
      html.dark .clb { --bg:#111827; --panel:#1e293b; --line:#334155; --muted:#94a3b8; --wait:#1e3a8a; --waittext:#bfdbfe;
             --red:#ef4444; --green:#22c55e; --orange:#f59e0b; --blue:#60a5fa; --grid:#1f2937; }
      .clb { background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:14px; margin:1.5rem 0; font-size:15px; line-height:1.45; }
      .clb-caption { background:var(--panel); border-left:4px solid var(--blue); border-radius:6px; padding:10px 12px; }
      .clb-clock { font-family:'JetBrains Mono','DejaVu Sans Mono',monospace; color:var(--blue); margin-right:6px; }
      .clb-controls { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 4px; }
      .clb-controls button { background:var(--panel); color:inherit; border:1px solid var(--line); border-radius:6px; padding:5px 12px; font-size:14px; cursor:pointer; }
      .clb-controls button.clb-primary { background:#2563eb; border-color:#2563eb; color:#fff; }
      .clb-voice { display:flex; align-items:center; gap:6px; font-size:14px; margin-left:4px; }
      .clb-row { margin-top:12px; }
      .clb-head { display:flex; justify-content:space-between; align-items:flex-end; gap:8px; margin-bottom:4px; }
      .clb-sub { display:block; color:var(--muted); font-size:13px; }
      .clb-state { white-space:nowrap; font-size:13px; text-align:right; }
      .clb-chip { display:inline-block; border-radius:4px; padding:1px 6px; font-weight:700; font-size:12px; margin-left:4px; }
      .clb-chip.inactive { background:var(--line); color:var(--muted); }
      .clb-chip.pending { background:#facc15; color:#422006; }
      .clb-chip.firing { background:var(--red); color:#fff; }
      .clb-track { position:relative; height:30px; background:repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 25%); }
      .clb-track.clb-tall { height:64px; }
      .clb-reveal { position:absolute; inset:0; }
      .clb-wait { position:absolute; top:5px; height:20px; background:var(--wait); border-radius:3px; color:var(--waittext); font-size:12px; overflow:hidden; white-space:nowrap; }
      .clb-wait span { padding-left:8px; line-height:20px; }
      .clb-restart { position:absolute; top:0; width:3px; height:30px; margin-left:-1px; background:var(--red); }
      .clb-blank { position:absolute; top:0; height:30px; color:var(--muted); font-size:11px; text-align:center; line-height:30px; overflow:hidden; }
      .clb-dash { position:absolute; top:13px; height:5px; background:var(--green); border-radius:2px; }
      .clb-track svg { position:absolute; inset:0; width:100%; height:100%; }
      .clb-threshold { stroke:var(--muted); stroke-width:1; stroke-dasharray:5 4; }
      .clb-plain { fill:none; stroke:var(--orange); stroke-width:2.5; }
      .clb-mot { fill:none; stroke:var(--blue); stroke-width:2.5; }
      .clb-playhead { position:absolute; top:-2px; bottom:-2px; width:2px; margin-left:-1px; background:currentColor; opacity:.6; }
      .clb-axis { position:relative; height:18px; margin-top:4px; color:var(--muted); font-size:12px; }
      .clb-axis span { position:absolute; transform:translateX(-50%); white-space:nowrap; }
      .clb-axis span:first-child { transform:none; }
      .clb-axis span:last-child { transform:translateX(-100%); }
      .clb-note { color:var(--muted); font-size:13px; margin-top:8px; }
      @media (max-width:520px) { .clb-wait span, .clb-blank span { display:none; } }
    </style>
    <div class="clb-caption"><span class="clb-clock">0:00</span><span class="clb-text">Press Play, or step through with Next.</span></div>
    <div class="clb-controls">
      <button class="clb-play clb-primary">Play</button>
      <button class="clb-back">Back</button>
      <button class="clb-next">Next</button>
      <button class="clb-reset">Start again</button>
      <label class="clb-voice"><input type="checkbox" class="clb-voice-box"> Read the steps aloud</label>
    </div>
    ${row('Pod', 'restarts every 5 minutes, broken the whole time', podTrack)}
    ${row('Raw CrashLoopBackOff metric', 'what the plain rule checks', rawTrack)}
    ${row('Plain rule (without max_over_time)', 'for: 5m, the count resets at every blank, so no alert is ever sent', timerSvg(plainTimer, 'clb-plain'),
          '<div class="clb-state"><span class="clb-plain-time">0:00</span> of 5:00 <span class="clb-chip clb-plain-chip inactive">NO ALERT</span></div>', true)}
    ${row('Rule with max_over_time', 'for: 5m, looks back 5 minutes, so blanks do not reset the count', timerSvg(motTimer, 'clb-mot'),
          '<div class="clb-state"><span class="clb-mot-time">0:00</span> of 5:00 <span class="clb-chip clb-mot-chip inactive">NO ALERT</span></div>', true)}
    <div class="clb-axis">${[0, 5, 10, 15, 20].map(m => `<span style="left:${pct(m)}">${m} min</span>`).join('')}</div>
    <div class="clb-note">Simplified to the phase after the back-off reached its 5 minute cap. The dashed line is the 5 minutes a rule must count before it sends an alert. Prometheus calls the three states inactive (no alert), pending (counting) and firing (alert sent).</div>`;

  const $ = sel => root.querySelector(sel);
  const reveals = root.querySelectorAll('.clb-reveal');
  const playheads = root.querySelectorAll('.clb-playhead');
  const playBtn = $('.clb-play');

  let now = 0, shown = -1, playing = false, lastFrame = null;
  // Every pause, jump or reset bumps one of these counters. A timer or voice
  // callback from before that moment sees a stale number and does nothing,
  // so only one animation loop and one step pause can ever be active.
  let loopId = 0, holdId = 0, holding = false;

  function setChip(chip, timeEl, value, state) {
    timeEl.textContent = fmt(value);
    chip.textContent = { inactive: 'NO ALERT', pending: 'COUNTING', firing: 'ALERT SENT' }[state];
    chip.className = chip.className.replace(/\b(inactive|pending|firing)\b/, state);
  }

  function render() {
    const p = 100 * now / END;
    reveals.forEach(r => { r.style.clipPath = `inset(0 ${(100 - p).toFixed(3)}% 0 0)`; });
    playheads.forEach(h => { h.style.left = p.toFixed(3) + '%'; });
    $('.clb-clock').textContent = fmt(now);
    const plain = plainTimer(now);
    setChip($('.clb-plain-chip'), $('.clb-plain-time'), plain, plain > 0 ? 'pending' : 'inactive');
    const mot = motTimer(now);
    setChip($('.clb-mot-chip'), $('.clb-mot-time'), mot, now < GAP ? 'inactive' : mot >= FOR ? 'firing' : 'pending');
  }

  const canSpeak = 'speechSynthesis' in window;
  const voiceOn = () => canSpeak && $('.clb-voice-box').checked;
  if (!canSpeak) $('.clb-voice').style.display = 'none';

  // Reads the text aloud and calls done when it ends. Some devices have no
  // voice and never report the end, so a time limit moves things on anyway.
  // If the voice fails or ends almost at once, the step still gets the
  // normal pause so the animation never races ahead.
  function speak(textToSay, done) {
    speechSynthesis.cancel();
    const say = new SpeechSynthesisUtterance(textToSay);
    say.rate = 0.95;
    const started = Date.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(limit);
      const elapsed = Date.now() - started;
      setTimeout(done, elapsed < 1000 ? DWELL_MS - elapsed : 300);
    };
    const limit = setTimeout(finish, 2000 + textToSay.split(' ').length * 450);
    say.onend = finish;
    say.onerror = finish;
    speechSynthesis.speak(say);
  }

  function showStep(i) {
    shown = i;
    $('.clb-text').textContent = steps[i].text;
  }

  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
  }

  function cancelHold() {
    holdId++;
    holding = false;
    if (canSpeak) speechSynthesis.cancel();
  }

  function startLoop() {
    const me = ++loopId;
    lastFrame = null;
    requestAnimationFrame(ts => tick(ts, me));
  }

  // Pause on a step: read it aloud, or wait a moment, then carry on if playing
  function holdOn(i) {
    const me = ++holdId;
    holding = true;
    const carryOn = () => {
      if (me !== holdId) return;
      holding = false;
      if (playing) startLoop();
    };
    if (voiceOn()) speak(steps[i].text, carryOn);
    else setTimeout(carryOn, DWELL_MS);
  }

  function tick(ts, me) {
    if (me !== loopId || !playing || holding) return;
    if (lastFrame !== null) now = Math.min(END, now + (ts - lastFrame) / MINUTE_MS);
    lastFrame = ts;
    const next = shown + 1;
    if (next < steps.length && now >= steps[next].t) {
      now = steps[next].t;
      render();
      showStep(next);
      holdOn(next);
      return;
    }
    render();
    if (now < END) requestAnimationFrame(t => tick(t, me));
    else setPlaying(false);
  }

  // Back and Next move to a step by hand. They always pause and stay silent;
  // Play carries on from that step.
  function jumpTo(i) {
    cancelHold();
    loopId++;
    setPlaying(false);
    now = steps[i].t;
    showStep(i);
    render();
  }

  playBtn.onclick = () => {
    if (playing) {
      setPlaying(false);
      cancelHold();
      loopId++;
      return;
    }
    if (now >= END) { now = 0; shown = -1; render(); }
    setPlaying(true);
    // Sitting on a step's caption: finish that pause before moving on
    if (shown >= 0 && now === steps[shown].t) holdOn(shown);
    else startLoop();
  };
  $('.clb-next').onclick = () => jumpTo(Math.min(shown + 1, steps.length - 1));
  $('.clb-back').onclick = () => jumpTo(Math.max(shown - 1, 0));
  $('.clb-reset').onclick = () => {
    cancelHold();
    loopId++;
    setPlaying(false);
    now = 0;
    shown = -1;
    $('.clb-text').textContent = 'Press Play, or step through with Next.';
    render();
  };

  // Size the caption box to the tallest caption at this width, so the chart
  // below it never moves when the text changes.
  function fitCaption() {
    const box = $('.clb-caption'), txt = $('.clb-text');
    const current = txt.textContent;
    box.style.minHeight = '0';
    let tallest = 0;
    for (const step of steps) { txt.textContent = step.text; tallest = Math.max(tallest, box.offsetHeight); }
    txt.textContent = current;
    box.style.minHeight = tallest + 'px';
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitCaption, 150); });

  fitCaption();
  render();
})();
