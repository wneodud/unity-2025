import {
  DEFAULT_RULES as R,
  applyGameplayMiss,
  applySuccessfulNote,
  consumeCtrlItem,
  createNotePattern,
  createRunState,
  difficultyAt,
  isOverlapActive,
  isTooEarly,
  judgmentForOffset,
  noteY,
  ratingFromCounts,
  ratingRank,
  registerSpecialTimeBlockSpawn,
  requiredCyclesForModes,
  scoreMultiplierForModes,
  selectNearestLiveNote,
  speedMultiplierForModes,
  targetYForHeight,
  tickBonusModes,
} from './gameLogic.js';
import { ReactionAudio } from './audio.js';
import { rotationAngleFromRemaining, rotatingLaneGeometry } from './rotatingLane.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const ui = {
  score: $('#score'), rating: $('#rating'), combo: $('#combo'), life: $('#life'), modeChip: $('#play-mode-chip'),
  shield: $('#shield-chip'), fever: $('#fever-chip'), judge: $('#judgement'), milestone: $('#milestone'),
  modeWatermark: $('#mode-watermark'), modeBanner: $('#mode-banner'), ctrlGainBanner: $('#ctrl-gain-banner'),
  gogoGauge: $('.side-gauge-left'), specialGauge: $('.side-gauge-right'),
  gogoFill: $('#gogo-fill'), specialFill: $('#special-fill'), gogoCount: $('#gogo-count'), specialCount: $('#special-count'),
  ctrlRack: $('#slow-rack'), ctrlSlots: [...document.querySelectorAll('.slow-slot')], ctrlStatus: $('#slow-status'),
  start: $('#start-screen'), countdown: $('#countdown-screen'), countdownText: $('#countdown-text'),
  pause: $('#pause-screen'), over: $('#gameover-screen'), startBtn: $('#start-button'), resumeBtn: $('#resume-button'), retryBtn: $('#retry-button'),
  settingsBtn: $('#settings-open'), settings: $('#settings'), settingsClose: $('#settings-close'), settingsDone: $('#settings-done'),
  bgm: $('#bgm-volume'), sfx: $('#sfx-volume'), bgmVal: $('#bgm-value'), sfxVal: $('#sfx-value'), resetRecords: $('#records-reset'),
  recScore: $('#record-score'), recCombo: $('#record-combo'), recRating: $('#record-rating'),
  finalScore: $('#final-score'), finalRating: $('#final-rating'), finalCombo: $('#final-combo'), finalTime: $('#final-time'),
  finalPerfect: $('#final-perfect'), finalGood: $('#final-good'), finalMiss: $('#final-miss'),
  modeInputs: [...document.querySelectorAll('input[name="play-mode"]')],
};

const audio = new ReactionAudio();
const SETTINGS_KEY = 'arrowrush.settings.v2';
const RECORDS_KEY = 'leftright.records.v1';
const defaults = { bgm: 55, sfx: 80 };
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
  catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* optional */ }
};

let settings = { ...defaults, ...read(SETTINGS_KEY, {}) };
settings.bgm = Math.max(0, Math.min(100, Number(settings.bgm) || 0));
settings.sfx = Math.max(0, Math.min(100, Number(settings.sfx) || 0));
let records = { highScore: 0, maxCombo: 0, bestRating: '-', ...read(RECORDS_KEY, {}) };

let mode = 'title';
let playMode = 'normal';
let settingsOpen = false;
let state = createRunState();
let notes = [];
let particles = [];
let beams = [];
let elapsed = 0;
let countdownElapsed = 0;
let nextSpawn = 420;
let lastFrame = performance.now();
let countdownLabel = '';
let flash = 0;
let flashKind = 'miss';
let shake = 0;
let width = innerWidth;
let height = innerHeight;
let bannerTimer = null;
let ctrlGainTimer = null;
let spinAnnouncementUntil = 0;
const keysDown = new Set();

const INPUT_BY_CODE = Object.freeze({
  ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'right', Space: 'space',
});
const TOKEN_COLORS = Object.freeze({
  left: '#3cf5ff', up: '#73ff4b', down: '#ff4fd8', right: '#ffe34f', space: '#c98aff',
});

function recordsUi() {
  ui.recScore.textContent = Math.round(records.highScore).toLocaleString();
  ui.recCombo.textContent = String(records.maxCombo);
  ui.recRating.textContent = records.bestRating;
}

function settingsUi() {
  ui.bgm.value = String(settings.bgm);
  ui.sfx.value = String(settings.sfx);
  ui.bgmVal.textContent = `${settings.bgm}%`;
  ui.sfxVal.textContent = `${settings.sfx}%`;
  audio.setVolumes({ bgm: settings.bgm / 100, sfx: settings.sfx / 100 });
}

function gaugeUi() {
  ui.gogoFill.style.height = `${Math.min(100, state.gogoGauge / R.gogoGaugePerfects * 100)}%`;
  ui.specialFill.style.height = `${Math.min(100, state.specialGauge / R.specialGaugeSuccesses * 100)}%`;
  ui.gogoGauge.classList.toggle('active', state.gogoActive);
  ui.specialGauge.classList.toggle('active', state.specialActive);
  if (isOverlapActive(state)) {
    const seconds = Math.max(0, state.overlapRemainingMs / 1000).toFixed(1);
    ui.gogoCount.textContent = `SPIN ${seconds}s`;
    ui.specialCount.textContent = `SPIN ${seconds}s`;
    return;
  }
  ui.gogoCount.textContent = state.gogoActive
    ? `${Math.max(0, state.gogoRemainingMs / 1000).toFixed(1)}s · SPECIAL ONLY`
    : `${state.gogoGauge} / ${R.gogoGaugePerfects}`;
  ui.specialCount.textContent = state.specialActive
    ? `${state.specialBlocksRemaining} BLOCK LEFT · ×5`
    : `${state.specialGauge} / ${R.specialGaugeSuccesses}`;
}

function ctrlUi() {
  ui.ctrlSlots.forEach((slot, index) => slot.classList.toggle('filled', index < state.ctrlItems));
  ui.ctrlRack.classList.remove('active');
  ui.ctrlStatus.textContent = state.ctrlItems > 0 ? `CTRL 파괴 ×${state.ctrlItems}` : 'CTRL 파괴';
}

function hud() {
  ui.score.textContent = Math.round(state.score).toLocaleString();
  ui.combo.textContent = String(state.combo);
  ui.rating.textContent = ratingFromCounts(state.perfect, state.good, state.miss);
  ui.life.textContent = playMode === 'infinite'
    ? '∞'
    : Array.from({ length: R.startingLives }, (_, index) => index < state.lives ? '♥' : '♡').join(' ');
  ui.modeChip.textContent = playMode === 'infinite' ? '∞ LIFE' : playMode === 'hell' ? 'HELL' : 'BASIC';
  ui.modeChip.classList.toggle('infinite', playMode === 'infinite');
  ui.modeChip.classList.toggle('hell', playMode === 'hell');
  ui.shield.classList.toggle('active', state.shieldReady);
  ui.fever.classList.toggle('active', state.fever);
  audio.setFever(state.fever);
  gaugeUi();
  ctrlUi();
}

function overlays() {
  ui.start.classList.toggle('visible', mode === 'title');
  ui.countdown.classList.toggle('visible', mode === 'countdown');
  ui.pause.classList.toggle('visible', mode === 'paused');
  ui.over.classList.toggle('visible', mode === 'gameover');
}

function updateWatermark() {
  const overlap = isOverlapActive(state);
  ui.modeWatermark.className = 'mode-watermark';
  if (overlap) {
    ui.modeWatermark.textContent = '스핀스핀~';
    ui.modeWatermark.classList.add('overlap');
  } else if (state.gogoActive && state.specialActive) {
    ui.modeWatermark.textContent = 'GOGOGO + SPECIAL ×5';
    ui.modeWatermark.classList.add('dual');
  } else if (state.gogoActive) {
    ui.modeWatermark.textContent = 'GOGOGO';
    ui.modeWatermark.classList.add('gogo');
  } else if (state.specialActive) {
    ui.modeWatermark.textContent = 'SPECIAL TIME ×5';
    ui.modeWatermark.classList.add('special');
  } else ui.modeWatermark.textContent = '';
}

function showModeBanner(text, kind) {
  if (bannerTimer) clearTimeout(bannerTimer);
  ui.modeBanner.textContent = text;
  ui.modeBanner.className = `mode-banner ${kind}`;
  void ui.modeBanner.offsetWidth;
  ui.modeBanner.classList.add('show');
  audio.playModeStart(kind);
  bannerTimer = setTimeout(() => ui.modeBanner.classList.remove('show'), 1450);
}

function showCtrlGain() {
  if (ctrlGainTimer) clearTimeout(ctrlGainTimer);
  ui.ctrlGainBanner.classList.remove('show');
  void ui.ctrlGainBanner.offsetWidth;
  ui.ctrlGainBanner.classList.add('show');
  ctrlGainTimer = setTimeout(() => ui.ctrlGainBanner.classList.remove('show'), 1200);
  audio.playItemGain();
  flashKind = 'item';
  flash = Math.max(flash, 0.22);
  burst(width / 2, height * .48, '#ff63b8', 34);
}

function syncModeTransition(before, after) {
  const wasOverlap = isOverlapActive(before);
  const isOverlap = isOverlapActive(after);

  if (!wasOverlap && isOverlap) {
    notes = notes.filter((note) => note.resolved);
    nextSpawn = elapsed + 100;
    spinAnnouncementUntil = elapsed + 1400;
  } else if (wasOverlap && !isOverlap) {
    notes = notes.filter((note) => note.resolved);
    nextSpawn = elapsed + 120;
    spinAnnouncementUntil = 0;
  } else if (!before.gogoActive && after.gogoActive && !isOverlap) {
    showModeBanner('GOGOGO\n10초 특수블록 러시', 'gogo');
  } else if (!before.specialActive && after.specialActive && !isOverlap) {
    showModeBanner('SPECIAL TIME\nSCORE ×5 · 10 BLOCK', 'special');
  }

  audio.setRushMode(after.gogoActive, after.specialActive, false);
  updateWatermark();
  hud();
}

function resetRun() {
  state = createRunState();
  notes = [];
  particles = [];
  beams = [];
  elapsed = 0;
  countdownElapsed = 0;
  nextSpawn = 420;
  countdownLabel = '';
  flash = 0;
  shake = 0;
  spinAnnouncementUntil = 0;
  keysDown.clear();
  audio.setRushMode(false, false, false);
  updateWatermark();
  hud();
}

async function startRun() {
  await audio.ensureStarted();
  const selected = ui.modeInputs.find((input) => input.checked)?.value;
  playMode = selected === 'infinite' ? 'infinite' : selected === 'hell' ? 'hell' : 'normal';
  resetRun();
  mode = 'countdown';
  audio.stopBgm();
  overlays();
}

function pauseGame() {
  if (mode !== 'playing') return;
  mode = 'paused';
  keysDown.clear();
  audio.pauseBgm();
  overlays();
}
function resumeGame() {
  if (mode !== 'paused') return;
  mode = 'playing';
  audio.startBgm();
  overlays();
}
const timeText = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function finishGame() {
  if (mode === 'gameover') return;
  mode = 'gameover';
  keysDown.clear();
  audio.stopBgm();
  const rating = ratingFromCounts(state.perfect, state.good, state.miss);
  ui.finalScore.textContent = Math.round(state.score).toLocaleString();
  ui.finalRating.textContent = rating;
  ui.finalCombo.textContent = String(state.maxCombo);
  ui.finalTime.textContent = timeText(elapsed);
  ui.finalPerfect.textContent = String(state.perfect);
  ui.finalGood.textContent = String(state.good);
  ui.finalMiss.textContent = String(state.miss);
  records.highScore = Math.max(Number(records.highScore) || 0, state.score);
  records.maxCombo = Math.max(Number(records.maxCombo) || 0, state.maxCombo);
  if (ratingRank(rating) > ratingRank(records.bestRating)) records.bestRating = rating;
  save(RECORDS_KEY, records);
  recordsUi();
  overlays();
}

function animateClass(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}
function showJudgement(text, className) {
  ui.judge.textContent = text;
  ui.judge.className = `judgement ${className}`;
  animateClass(ui.judge, 'show');
}
function showMilestone(text) {
  ui.milestone.textContent = text;
  ui.milestone.style.color = state.fever ? '#ffb85c' : '#72f8ff';
  ui.milestone.style.textShadow = `0 0 24px ${state.fever ? '#ff7d30' : '#32dfff'}`;
  animateClass(ui.milestone, 'show');
  audio.playMilestone();
}
function burst(px, py, color, count = 14) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 65 + Math.random() * 155;
    particles.push({ x: px, y: py, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .25 + Math.random() * .36, max: .61, size: 1.5 + Math.random() * 3.2, color });
  }
}
function fireSpecialBeam() { beams.push({ life: .30, max: .30 }); }
function resolveNote(note, result) { note.resolved = true; note.resolvedAt = elapsed; note.result = result; }

function currentRotationGeometry() {
  if (!isOverlapActive(state)) return null;
  const angle = rotationAngleFromRemaining(state.overlapRemainingMs, R.overlapDurationMs);
  return rotatingLaneGeometry(width, height, angle);
}
function currentJudgementPoint() {
  const geometry = currentRotationGeometry();
  return geometry?.targetPoint || { x: width / 2, y: targetYForHeight(height) };
}
function noteLocalY(note, geometry = currentRotationGeometry()) {
  const sy = geometry ? geometry.spawnLocalY : -74;
  const ty = geometry ? geometry.targetLocalY : targetYForHeight(height);
  return noteY(elapsed, note, sy, ty);
}
function localPointToScreen(localY, geometry) {
  if (!geometry) return { x: width / 2, y: localY };
  return {
    x: geometry.centerX - Math.sin(geometry.angle) * localY,
    y: geometry.centerY + Math.cos(geometry.angle) * localY,
  };
}

function hitNote(note, result) {
  const before = state;
  const comboBefore = state.combo;
  const ctrlBefore = state.ctrlItems;
  resolveNote(note, result);
  state = applySuccessfulNote(state, { judgement: result, isSpecial: note.isSpecial, scoreMultiplier: note.scoreMultiplier });

  const fxColor = note.isSpecial ? '#d88cff' : TOKEN_COLORS[note.directions[0]] || '#72f8ff';
  const hitPoint = currentJudgementPoint();
  burst(hitPoint.x, hitPoint.y, fxColor, note.isSpecial ? 28 : (result === 'PERFECT' ? 19 : 11));
  showJudgement(result, result.toLowerCase());
  result === 'PERFECT' ? audio.playPerfect() : audio.playGood();
  if (note.isSpecial) {
    const progress = state.specialActive ? 1 : state.specialGauge / R.specialGaugeSuccesses;
    audio.playSpecialCharge(progress);
    if (result === 'PERFECT') fireSpecialBeam();
  }

  if (state.ctrlItems > ctrlBefore) showCtrlGain();
  if (state.combo === R.shieldCombo && comboBefore < R.shieldCombo) showMilestone('SHIELD READY');
  else if (state.combo === R.feverCombo && comboBefore < R.feverCombo) showMilestone('FEVER! ×1.5');
  else if (state.combo && state.combo % 10 === 0 && state.ctrlItems === ctrlBefore) showMilestone(`${state.combo} COMBO`);

  syncModeTransition(before, state);
}

function miss(reason, note = null) {
  if (mode !== 'playing') return;
  if (note && !note.resolved) resolveNote(note, 'MISS');
  const oldLives = state.lives;
  state = applyGameplayMiss(state, { infiniteLives: playMode === 'infinite' });

  const protectedMiss = Boolean(state.protectedMiss);
  flashKind = protectedMiss ? 'shield' : 'miss';
  flash = protectedMiss ? .30 : .42;
  shake = protectedMiss ? 4 : 11;
  showJudgement(protectedMiss ? 'SHIELD!' : 'MISS', protectedMiss ? 'shielded' : 'miss');
  audio.playMiss(protectedMiss);
  canvas.dataset.lastMissReason = reason;
  hud();
  if (playMode !== 'infinite' && !protectedMiss && oldLives > 0 && state.lives <= 0) {
    mode = 'ending';
    keysDown.clear();
    audio.pauseBgm();
    setTimeout(finishGame, 170);
  }
}

function spawnNote() {
  const beforeSpawn = state;
  const spin = isOverlapActive(beforeSpawn);
  const multiplier = speedMultiplierForModes(beforeSpawn);
  const pattern = createNotePattern(Math.random, R, {
    singleOnly: spin,
    forceSpecial: !spin && beforeSpawn.gogoActive,
    allowSpace: !spin && playMode === 'hell',
    maxTokens: !spin && playMode === 'hell' ? 3 : 2,
  });

  const { fallMs } = difficultyAt(elapsed);
  notes.push({
    id: `${Math.round(elapsed)}-${Math.random().toString(16).slice(2)}`,
    directions: pattern.directions,
    isSpecial: pattern.isSpecial,
    spawnTime: elapsed,
    targetTime: elapsed + fallMs / multiplier,
    resolved: false,
    cyclesRequired: requiredCyclesForModes(beforeSpawn),
    completedCycles: 0,
    cycleHits: new Set(),
    worstJudgement: 'PERFECT',
    scoreMultiplier: scoreMultiplierForModes(beforeSpawn),
  });

  if (beforeSpawn.specialActive) {
    state = registerSpecialTimeBlockSpawn(state);
    if (beforeSpawn.specialActive !== state.specialActive || isOverlapActive(beforeSpawn) !== isOverlapActive(state)) {
      syncModeTransition(beforeSpawn, state);
    }
  }
}

function registerInput(note, token, result) {
  if (note.cycleHits.has(token)) return;
  note.cycleHits.add(token);
  if (result === 'GOOD') note.worstJudgement = 'GOOD';
  if (note.cycleHits.size < note.directions.length) return;
  note.completedCycles += 1;
  note.cycleHits.clear();
  if (note.completedCycles >= note.cyclesRequired) return hitNote(note, note.worstJudgement);
  showJudgement('AGAIN!', 'again');
  audio.playCycleReady();
}

function processGameplayInput(token, inputTime) {
  if (mode !== 'playing' || settingsOpen) return;
  const nearest = selectNearestLiveNote(notes, inputTime);
  if (nearest) {
    const result = judgmentForOffset(inputTime - nearest.targetTime);
    if (result !== 'MISS') {
      if (!nearest.directions.includes(token)) return miss('wrong-input', nearest);
      if (nearest.directions.length === 1 && keysDown.size > 1) return miss('simultaneous-input', nearest);
      registerInput(nearest, token, result);
      return;
    }
  }
  if (isTooEarly(notes, inputTime) || !nearest) miss('too-early-or-empty');
  else miss('late-invalid', nearest);
}

function useCtrlDestroy() {
  if (mode !== 'playing' || settingsOpen || state.ctrlItems <= 0) return;
  const nearest = selectNearestLiveNote(notes, elapsed);
  if (!nearest) return;

  const geometry = currentRotationGeometry();
  const destroyLocalY = noteLocalY(nearest, geometry);
  const destroyPoint = localPointToScreen(destroyLocalY, geometry);
  const beforeItems = state.ctrlItems;
  state = consumeCtrlItem(state);
  if (state.ctrlItems === beforeItems) return;

  nearest.destroyLocalY = destroyLocalY;
  resolveNote(nearest, 'DESTROYED');
  burst(destroyPoint.x, destroyPoint.y, '#ff63b8', 32);
  flashKind = 'item';
  flash = Math.max(flash, .18);
  showJudgement('BREAK!', 'item');
  audio.playItemGain();
  hud();
}

function updateCountdown(dt) {
  if (settingsOpen) return;
  countdownElapsed += dt;
  let label;
  if (countdownElapsed < 700) label = '3';
  else if (countdownElapsed < 1400) label = '2';
  else if (countdownElapsed < 2100) label = '1';
  else if (countdownElapsed < 2800) label = 'START';
  else {
    mode = 'playing'; elapsed = 0; nextSpawn = 420; audio.startBgm(); overlays();
    if (playMode === 'hell') setTimeout(() => showModeBanner('HELL MODE\nSPACE ENABLED', 'hell'), 120);
    return;
  }
  if (label !== countdownLabel) {
    countdownLabel = label;
    ui.countdownText.textContent = label;
    ui.countdownText.style.fontSize = label === 'START' ? 'clamp(68px,15vw,150px)' : '';
    ui.countdownText.style.animation = 'none';
    void ui.countdownText.offsetWidth;
    ui.countdownText.style.animation = 'countdownBeat .55s ease-out';
  }
}

function updateGame(dt) {
  if (settingsOpen) return;
  elapsed += dt;
  const beforeTick = state;
  state = tickBonusModes(state, dt);
  if (
    beforeTick.gogoActive !== state.gogoActive ||
    beforeTick.specialActive !== state.specialActive ||
    isOverlapActive(beforeTick) !== isOverlapActive(state)
  ) syncModeTransition(beforeTick, state);

  let guard = 0;
  while (elapsed >= nextSpawn && guard++ < 18) {
    spawnNote();
    nextSpawn += difficultyAt(elapsed).spawnMs / speedMultiplierForModes(state);
  }
  for (const note of notes) {
    if (!note.resolved && elapsed > note.targetTime + R.goodWindowMs) {
      miss('passed-target', note);
      if (mode !== 'playing') break;
    }
  }
  notes = notes.filter((note) => !note.resolved || elapsed - note.resolvedAt < 260);
  hud();
}

function updateEffects(dt) {
  flash = Math.max(0, flash - dt * 1.7);
  shake = Math.max(0, shake - dt * 30);
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy *= .985; }
  particles = particles.filter((p) => p.life > 0);
  for (const beam of beams) beam.life -= dt;
  beams = beams.filter((beam) => beam.life > 0);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  width = Math.max(1, rect.width); height = Math.max(1, rect.height);
  const pw = Math.round(width * dpr), ph = Math.round(height * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function rgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16 & 255},${value >> 8 & 255},${value & 255},${alpha})`;
}
function drawArrow(px, py, direction, size, color, alpha = 1) {
  const points = [[-.72,-.28],[-.05,-.28],[-.05,-.58],[.82,0],[-.05,.58],[-.05,.28],[-.72,.28]];
  const rotation = ({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 })[direction] ?? 0;
  ctx.save(); ctx.translate(px, py); ctx.rotate(rotation); ctx.globalAlpha = alpha;
  ctx.shadowBlur = 22; ctx.shadowColor = color; ctx.fillStyle = color; ctx.beginPath();
  points.forEach(([a,b], i) => i ? ctx.lineTo(a*size,b*size) : ctx.moveTo(a*size,b*size));
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawSquare(px, py, size, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.shadowBlur = 22; ctx.shadowColor = color;
  ctx.fillStyle = color; ctx.fillRect(px-size*.48,py-size*.48,size*.96,size*.96);
  ctx.fillStyle='rgba(255,255,255,.55)';ctx.fillRect(px-size*.28,py-size*.06,size*.56,size*.12);ctx.restore();
}
function drawToken(px, py, token, size, alpha = 1, hit = false) {
  const color = hit ? '#ffffff' : TOKEN_COLORS[token] || '#ffffff';
  token === 'space' ? drawSquare(px,py,size*.72,color,alpha) : drawArrow(px,py,token,size,color,alpha);
}
function roundedRectPath(x0,y0,rw,rh,radius) {
  const r=Math.min(radius,rw/2,rh/2);ctx.beginPath();ctx.moveTo(x0+r,y0);ctx.arcTo(x0+rw,y0,x0+rw,y0+rh,r);
  ctx.arcTo(x0+rw,y0+rh,x0,y0+rh,r);ctx.arcTo(x0,y0+rh,x0,y0,r);ctx.arcTo(x0,y0,x0+rw,y0,r);ctx.closePath();
}
function drawNote(note, px, py, alpha, scale) {
  if (!note.isSpecial) drawToken(px,py,note.directions[0],42*scale,alpha);
  else {
    const bw=note.directions.length===2?116:154,bh=74;
    ctx.save();ctx.globalAlpha=alpha;ctx.shadowBlur=25;ctx.shadowColor='#d068ff';roundedRectPath(px-bw/2,py-bh/2,bw,bh,17);
    ctx.fillStyle='rgba(92,36,151,.28)';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#e18dff';ctx.stroke();ctx.restore();
    const gap=note.directions.length===2?43:48,start=-((note.directions.length-1)*gap)/2;
    note.directions.forEach((token,i)=>drawToken(px+start+i*gap,py,token,25*scale,alpha,note.cycleHits.has(token)));
  }
  if (note.cyclesRequired>1&&!note.resolved) {
    ctx.save();ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.font='900 12px system-ui';ctx.fillStyle='#f0c8ff';ctx.shadowBlur=12;ctx.shadowColor='#c66dff';
    ctx.fillText(`×2  ${note.completedCycles}/2`,px,py-(note.isSpecial?49:38));ctx.restore();
  }
  if (note.scoreMultiplier>1&&!note.resolved) {
    ctx.save();ctx.globalAlpha=alpha*.9;ctx.textAlign='center';ctx.font='900 10px system-ui';ctx.fillStyle='#ffd36d';
    ctx.fillText('SCORE ×5',px,py+(note.isSpecial?52:39));ctx.restore();
  }
}
function drawBeams(targetY, centerX, reach) {
  for (const beam of beams) {
    const progress=1-beam.life/beam.max,alpha=Math.max(0,beam.life/beam.max),distance=reach*Math.min(1,progress*2.2);
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#f0d8ff';ctx.lineWidth=1.4;ctx.shadowBlur=14;ctx.shadowColor='#d15cff';ctx.beginPath();
    ctx.moveTo(centerX-18,targetY);ctx.lineTo(centerX-distance,targetY);ctx.moveTo(centerX+18,targetY);ctx.lineTo(centerX+distance,targetY);ctx.stroke();ctx.restore();
  }
}
function drawKeyGuide(cx,y) {
  const items=playMode==='hell'?[['left','←'],['up','↑'],['down','↓'],['right','→'],['space','□']]:[['left','←'],['up','↑'],['down','↓'],['right','→']];
  const gap=38,start=-((items.length-1)*gap)/2;ctx.font='900 15px system-ui';ctx.textAlign='center';
  items.forEach(([token,label],i)=>{ctx.fillStyle=TOKEN_COLORS[token];ctx.shadowBlur=9;ctx.shadowColor=TOKEN_COLORS[token];ctx.fillText(label,cx+start+i*gap,y);});
  ctx.shadowBlur=0;if(playMode==='hell'){ctx.font='800 9px system-ui';ctx.fillStyle='rgba(190,202,230,.5)';ctx.fillText('□ = SPACE',cx,y+18);}
}
function drawCenterScore(cx,y) {
  ctx.save();ctx.textAlign='center';ctx.fillStyle='#dcecff';ctx.shadowColor='#4daaff';ctx.shadowBlur=18;ctx.globalAlpha=.40;
  ctx.font=`1000 ${Math.max(44,Math.min(82,width*.055))}px system-ui`;ctx.fillText(String(Math.round(state.score)),cx,y);
  ctx.globalAlpha=.34;ctx.shadowBlur=11;ctx.font=`1000 ${Math.max(24,Math.min(38,width*.026))}px system-ui`;ctx.fillText(String(state.combo),cx,y+Math.max(42,height*.055));ctx.restore();
}
function drawSpinCaption(cx,y) {
  ctx.save();ctx.globalAlpha=elapsed<spinAnnouncementUntil?.88:.60;ctx.textAlign='center';ctx.font=`1000 ${Math.max(18,Math.min(34,width*.03))}px system-ui`;
  ctx.fillStyle='#fff2aa';ctx.shadowBlur=18;ctx.shadowColor='#ff4d7a';ctx.fillText('스핀스핀~',cx,y);ctx.restore();
}
function drawEventField(now) {
  const overlap=isOverlapActive(state),pulse=.5+Math.sin(now/120)*.5;ctx.save();
  if(overlap){ctx.globalAlpha=.06+pulse*.02;ctx.fillStyle='#a63cff';ctx.fillRect(0,0,width,height);ctx.globalAlpha=.32;ctx.strokeStyle='#ffe675';ctx.lineWidth=2;ctx.strokeRect(1,1,width-2,height-2);}
  else if(state.gogoActive){ctx.globalAlpha=.24+pulse*.10;ctx.fillStyle='#45ecff';ctx.fillRect(0,0,width,6+pulse*5);ctx.fillRect(0,height-6-pulse*5,width,6+pulse*5);}
  else if(state.specialActive){ctx.globalAlpha=.20+pulse*.08;ctx.fillStyle='#d86cff';ctx.fillRect(0,0,5+pulse*5,height);ctx.fillRect(width-5-pulse*5,0,5+pulse*5,height);}
  ctx.restore();
}
function drawLaneScene({ overlap, geometry }) {
  const laneWidth=Math.max(190,Math.min(280,width*.22));
  const cx=overlap?0:width/2,laneTop=overlap?geometry.laneTopLocalY:0,laneBottom=overlap?geometry.laneBottomLocalY:height;
  const sy=overlap?geometry.spawnLocalY:-74,ty=overlap?geometry.targetLocalY:targetYForHeight(height),left=cx-laneWidth/2,right=cx+laneWidth/2;
  const lg=ctx.createLinearGradient(left,0,right,0);lg.addColorStop(0,'rgba(32,53,89,.07)');lg.addColorStop(.5,overlap?'rgba(69,72,135,.31)':'rgba(37,66,108,.22)');lg.addColorStop(1,'rgba(32,53,89,.07)');
  ctx.fillStyle=lg;ctx.fillRect(left,laneTop,laneWidth,laneBottom-laneTop);ctx.strokeStyle=overlap?'rgba(255,226,111,.32)':'rgba(116,158,220,.23)';ctx.lineWidth=overlap?1.6:1;
  ctx.beginPath();ctx.moveTo(left,laneTop);ctx.lineTo(left,laneBottom);ctx.moveTo(right,laneTop);ctx.lineTo(right,laneBottom);ctx.stroke();
  drawCenterScore(cx,overlap?-20:height*.44);if(overlap)drawSpinCaption(cx,-Math.min(170,geometry.halfLength*.34));
  const tc=overlap?'#ffe66f':state.specialActive?'#e18dff':state.gogoActive?'#9cffff':state.fever?'#ff9a43':'#67f7ff';
  ctx.save();ctx.shadowBlur=overlap?32:24;ctx.shadowColor=tc;ctx.strokeStyle=rgba(tc,.98);ctx.lineWidth=overlap?4:3;ctx.beginPath();
  ctx.moveTo(cx-112,ty);ctx.lineTo(cx-20,ty);ctx.moveTo(cx+20,ty);ctx.lineTo(cx+112,ty);ctx.moveTo(cx-112,ty-13);ctx.lineTo(cx-112,ty+13);ctx.moveTo(cx+112,ty-13);ctx.lineTo(cx+112,ty+13);ctx.stroke();ctx.restore();
  drawKeyGuide(cx,overlap?ty-50:ty+48);
  for(const note of notes){let py=note.result==='DESTROYED'&&Number.isFinite(note.destroyLocalY)?note.destroyLocalY:noteY(elapsed,note,sy,ty),alpha=1,scale=1;
    if(note.resolved){const age=Math.max(0,elapsed-note.resolvedAt);alpha=Math.max(0,1-age/260);scale*=1+age/760;if(note.result==='MISS')py+=age*.16;else if(note.result!=='DESTROYED')py=ty;}
    drawNote(note,cx,py,alpha,scale);}
  drawBeams(ty,cx,overlap?laneWidth*.78:width*.48);
}
function drawParticles() {
  ctx.save();if(shake)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake*.5);
  for(const p of particles){ctx.globalAlpha=Math.max(0,Math.min(1,p.life/p.max));ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}ctx.globalAlpha=1;ctx.restore();
}
function draw(now) {
  resize();const overlap=isOverlapActive(state),pulse=.5+Math.sin(now/150)*.5;
  const bg=ctx.createRadialGradient(width/2,height*.3,40,width/2,height*.55,Math.max(width,height));
  if(overlap)bg.addColorStop(0,`rgba(75,36,116,${.40+pulse*.06})`);else if(state.gogoActive&&state.specialActive)bg.addColorStop(0,`rgba(63,39,116,${.48+pulse*.08})`);
  else if(state.gogoActive)bg.addColorStop(0,`rgba(13,83,104,${.44+pulse*.10})`);else if(state.specialActive)bg.addColorStop(0,`rgba(76,35,122,${.46+pulse*.10})`);
  else if(state.fever)bg.addColorStop(0,`rgba(76,35,27,${.34+pulse*.09})`);else bg.addColorStop(0,'rgba(20,31,58,.92)');
  bg.addColorStop(.5,'#060a14');bg.addColorStop(1,'#020307');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
  for(let i=0;i<28;i++){const px=(i*191.7+now*(.002+(i%4)*.001))%width,py=(i*97.3+Math.sin(now/1000+i)*14)%height;ctx.fillStyle=i%5===0?'rgba(60,245,255,.14)':'rgba(150,170,220,.07)';ctx.fillRect(px,py,1.4,1.4);}
  drawEventField(now);ctx.save();if(shake)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake*.5);
  if(overlap){const angle=rotationAngleFromRemaining(state.overlapRemainingMs,R.overlapDurationMs),geometry=rotatingLaneGeometry(width,height,angle);ctx.translate(geometry.centerX,geometry.centerY);ctx.rotate(angle);drawLaneScene({overlap:true,geometry});}
  else drawLaneScene({overlap:false,geometry:null});ctx.restore();drawParticles();
  if(flash){if(flashKind==='shield')ctx.fillStyle=`rgba(72,127,255,${flash})`;else if(flashKind==='item')ctx.fillStyle=`rgba(255,68,174,${flash})`;else ctx.fillStyle=`rgba(255,35,75,${flash})`;ctx.fillRect(0,0,width,height);}
}
function frame(now) {
  const dt=Math.min(50,Math.max(0,now-lastFrame));lastFrame=now;
  if(mode==='countdown')updateCountdown(dt);else if(mode==='playing')updateGame(dt);updateEffects(dt/1000);draw(now);requestAnimationFrame(frame);
}
function openSettings(){settingsOpen=true;ui.settings.hidden=false;keysDown.clear();if(mode==='playing')audio.pauseBgm();}
function closeSettings(){settingsOpen=false;ui.settings.hidden=true;if(mode==='playing')audio.startBgm();}

ui.startBtn.addEventListener('click',startRun);
ui.retryBtn.addEventListener('click',()=>{mode='title';overlays();});
ui.resumeBtn.addEventListener('click',resumeGame);
ui.settingsBtn.addEventListener('click',async()=>{await audio.ensureStarted();openSettings();});
ui.settingsClose.addEventListener('click',closeSettings);ui.settingsDone.addEventListener('click',closeSettings);
ui.settings.addEventListener('pointerdown',(event)=>{if(event.target===ui.settings)closeSettings();});
ui.bgm.addEventListener('input',async()=>{await audio.ensureStarted();settings.bgm=Number(ui.bgm.value);save(SETTINGS_KEY,settings);settingsUi();});
ui.sfx.addEventListener('input',async()=>{await audio.ensureStarted();settings.sfx=Number(ui.sfx.value);save(SETTINGS_KEY,settings);settingsUi();});
ui.resetRecords.addEventListener('click',()=>{records={highScore:0,maxCombo:0,bestRating:'-'};save(RECORDS_KEY,records);recordsUi();});

addEventListener('keydown',async(event)=>{
  if(event.code==='Escape'){event.preventDefault();if(settingsOpen)closeSettings();else if(mode==='playing')pauseGame();else if(mode==='paused')resumeGame();return;}
  if(event.code==='ControlLeft'||event.code==='ControlRight'){
    if(mode==='playing'&&!settingsOpen&&!event.repeat){event.preventDefault();await audio.ensureStarted();useCtrlDestroy();}return;
  }
  const token=INPUT_BY_CODE[event.code];if(!token||mode!=='playing'||settingsOpen||event.repeat)return;
  event.preventDefault();await audio.ensureStarted();keysDown.add(event.code);processGameplayInput(token,elapsed);
});
addEventListener('keyup',(event)=>{if(INPUT_BY_CODE[event.code])keysDown.delete(event.code);});
addEventListener('blur',()=>{keysDown.clear();if(mode==='playing'&&!settingsOpen)pauseGame();});
addEventListener('resize',resize);

settingsUi();recordsUi();hud();overlays();requestAnimationFrame(frame);
