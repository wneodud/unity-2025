export const DIRECTIONS = Object.freeze(['left', 'up', 'down', 'right']);
export const INPUT_TOKENS = Object.freeze([...DIRECTIONS, 'space']);

const BASE_PERFECT_WINDOW_MS = 80;
const BASE_GOOD_WINDOW_MS = 155;
let liveJudgementWindowMultiplier = 1;

export const DEFAULT_RULES = Object.freeze({
  startingLives: 5,
  get perfectWindowMs() { return BASE_PERFECT_WINDOW_MS * liveJudgementWindowMultiplier; },
  get goodWindowMs() { return BASE_GOOD_WINDOW_MS * liveJudgementWindowMultiplier; },
  basePerfectWindowMs: BASE_PERFECT_WINDOW_MS,
  baseGoodWindowMs: BASE_GOOD_WINDOW_MS,
  spinJudgementWindowMultiplier: 1.5,
  shieldCombo: 10,
  feverCombo: 30,
  feverMultiplier: 1.5,
  specialTimeScoreMultiplier: 5,
  initialFallMs: 1500,
  minimumFallMs: 620,
  initialSpawnMs: 920,
  minimumSpawnMs: 300,
  specialChance: 0.30,
  hellThreeInputChance: 0.28,
  gogoGaugePerfects: 50,
  gogoDurationMs: 10000,
  specialGaugeSuccesses: 10,
  specialTimeBlocks: 10,
  specialTimeCycles: 2,
  overlapAngularSpeedRadPerSec: Math.PI * 2 / 10,
  overlapTurns: 1,
  overlapDurationMs: 10000,
  overlapSpeedMultiplier: 1,
  ctrlSuccessInterval: 10,
  ctrlMaxItems: 4,
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function overlapPredicate(state) {
  return Boolean(state.gogoActive && state.specialActive && state.overlapRemainingMs > 0);
}

function syncLiveJudgementWindow(state) {
  liveJudgementWindowMultiplier = overlapPredicate(state)
    ? DEFAULT_RULES.spinJudgementWindowMultiplier
    : 1;
  return state;
}

export function judgmentForOffset(offsetMs, rules = DEFAULT_RULES) {
  const absolute = Math.abs(offsetMs);
  if (absolute <= rules.perfectWindowMs) return 'PERFECT';
  if (absolute <= rules.goodWindowMs) return 'GOOD';
  return 'MISS';
}

export function scoreForJudgement(judgement, comboAfterHit, fever, rules = DEFAULT_RULES, bonusMultiplier = 1) {
  const base = judgement === 'PERFECT' ? 100 : judgement === 'GOOD' ? 60 : 0;
  if (!base) return 0;
  const comboMultiplier = 1 + Math.min(comboAfterHit, 50) * 0.02;
  const feverMultiplier = fever ? rules.feverMultiplier : 1;
  return Math.round(base * comboMultiplier * feverMultiplier * Math.max(1, bonusMultiplier));
}

export function createRunState(rules = DEFAULT_RULES) {
  return syncLiveJudgementWindow({
    score: 0,
    combo: 0,
    maxCombo: 0,
    lives: rules.startingLives,
    perfect: 0,
    good: 0,
    miss: 0,
    successfulNotes: 0,
    shieldReady: false,
    fever: false,
    gogoGauge: 0,
    specialGauge: 0,
    gogoActive: false,
    specialActive: false,
    gogoRemainingMs: 0,
    specialBlocksRemaining: 0,
    overlapRemainingMs: 0,
    overlapLatched: false,
    ctrlItems: 0,
    protectedMiss: false,
  });
}

export function isOverlapActive(state) {
  syncLiveJudgementWindow(state);
  return overlapPredicate(state);
}

export function armOverlapIfNeeded(state, rules = DEFAULT_RULES) {
  const bothActive = Boolean(state.gogoActive && state.specialActive);
  if (!bothActive) {
    if (!state.overlapLatched && state.overlapRemainingMs <= 0) return syncLiveJudgementWindow({ ...state });
    return syncLiveJudgementWindow({ ...state, overlapLatched: false, overlapRemainingMs: 0 });
  }
  if (state.overlapLatched) return syncLiveJudgementWindow({ ...state });
  return syncLiveJudgementWindow({ ...state, overlapLatched: true, overlapRemainingMs: rules.overlapDurationMs });
}

export function applyHit(state, judgement, rules = DEFAULT_RULES, bonusMultiplier = 1) {
  if (judgement !== 'PERFECT' && judgement !== 'GOOD') return { ...state };
  const combo = state.combo + 1;
  const shieldReady = state.shieldReady || combo >= rules.shieldCombo;
  const fever = combo >= rules.feverCombo;
  const gained = scoreForJudgement(judgement, combo, fever, rules, bonusMultiplier);
  return {
    ...state,
    score: state.score + gained,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    perfect: state.perfect + (judgement === 'PERFECT' ? 1 : 0),
    good: state.good + (judgement === 'GOOD' ? 1 : 0),
    shieldReady,
    fever,
    protectedMiss: false,
  };
}

export function applyMiss(state) {
  const protectedMiss = Boolean(state.shieldReady);
  return {
    ...state,
    combo: 0,
    lives: Math.max(0, state.lives - (protectedMiss ? 0 : 1)),
    miss: state.miss + 1,
    shieldReady: false,
    fever: false,
    protectedMiss,
  };
}

export function applyGameplayMiss(state, { infiniteLives = false } = {}) {
  const next = applyMiss(state);
  return infiniteLives ? { ...next, lives: state.lives } : next;
}

export function applySuccessfulNote(state, { judgement, isSpecial, scoreMultiplier = 1 }, rules = DEFAULT_RULES) {
  let next = applyHit(state, judgement, rules, scoreMultiplier);
  let gogoGauge = next.gogoGauge;
  let specialGauge = next.specialGauge;
  let gogoActive = next.gogoActive;
  let specialActive = next.specialActive;
  let gogoRemainingMs = next.gogoRemainingMs;
  let specialBlocksRemaining = next.specialBlocksRemaining;
  let ctrlItems = next.ctrlItems;
  const successfulNotes = next.successfulNotes + 1;

  if (!gogoActive && judgement === 'PERFECT') {
    gogoGauge = Math.min(rules.gogoGaugePerfects, gogoGauge + 1);
  }
  if (!specialActive && isSpecial) {
    specialGauge = Math.min(rules.specialGaugeSuccesses, specialGauge + 1);
  }

  if (!gogoActive && gogoGauge >= rules.gogoGaugePerfects) {
    gogoActive = true;
    gogoRemainingMs = rules.gogoDurationMs;
  }
  if (!specialActive && specialGauge >= rules.specialGaugeSuccesses) {
    specialActive = true;
    specialBlocksRemaining = rules.specialTimeBlocks;
  }

  if (successfulNotes % rules.ctrlSuccessInterval === 0 && ctrlItems < rules.ctrlMaxItems) {
    ctrlItems += 1;
  }

  next = {
    ...next,
    successfulNotes,
    gogoGauge,
    specialGauge,
    gogoActive,
    specialActive,
    gogoRemainingMs,
    specialBlocksRemaining,
    ctrlItems,
  };
  return armOverlapIfNeeded(next, rules);
}

export function registerSpecialTimeBlockSpawn(state) {
  if (!state.specialActive || isOverlapActive(state)) return { ...state };
  const specialBlocksRemaining = Math.max(0, state.specialBlocksRemaining - 1);
  if (specialBlocksRemaining > 0) return { ...state, specialBlocksRemaining };
  return armOverlapIfNeeded({
    ...state,
    specialActive: false,
    specialBlocksRemaining: 0,
    specialGauge: 0,
  });
}

export function consumeCtrlItem(state) {
  if (state.ctrlItems <= 0) return { ...state };
  return { ...state, ctrlItems: state.ctrlItems - 1 };
}

export function resetEventGaugesAfterSpin(state) {
  return syncLiveJudgementWindow({
    ...state,
    gogoGauge: 0,
    specialGauge: 0,
    gogoActive: false,
    specialActive: false,
    gogoRemainingMs: 0,
    specialBlocksRemaining: 0,
    overlapRemainingMs: 0,
    overlapLatched: false,
  });
}

export function tickBonusModes(state, realDeltaMs, rules = DEFAULT_RULES) {
  const delta = Math.max(0, realDeltaMs);
  let next = armOverlapIfNeeded(state, rules);
  const overlapWasActive = isOverlapActive(next);

  if (overlapWasActive) {
    next.overlapRemainingMs = Math.max(0, next.overlapRemainingMs - delta);
    if (next.overlapRemainingMs <= 0) return resetEventGaugesAfterSpin(next);
    return syncLiveJudgementWindow(next);
  }

  if (next.gogoActive) {
    const remaining = Math.max(0, next.gogoRemainingMs - delta);
    if (remaining > 0) next.gogoRemainingMs = remaining;
    else {
      next.gogoActive = false;
      next.gogoRemainingMs = 0;
      next.gogoGauge = 0;
    }
  }

  return armOverlapIfNeeded(next, rules);
}

export function speedMultiplierForModes(state, rules = DEFAULT_RULES) {
  return isOverlapActive(state) ? rules.overlapSpeedMultiplier : 1;
}

export function requiredCyclesForModes(state, rules = DEFAULT_RULES) {
  if (isOverlapActive(state)) return 1;
  return state.specialActive ? rules.specialTimeCycles : 1;
}

export function scoreMultiplierForModes(state, rules = DEFAULT_RULES) {
  return state.specialActive ? rules.specialTimeScoreMultiplier : 1;
}

function pickDistinctArrows(rng, count) {
  const pool = [...DIRECTIONS];
  const picked = [];
  while (picked.length < count && pool.length) {
    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

export function createNotePattern(
  rng = Math.random,
  rules = DEFAULT_RULES,
  { forceSpecial = false, allowSpace = false, maxTokens = 2, singleOnly = false } = {},
) {
  if (singleOnly) {
    const index = Math.min(DIRECTIONS.length - 1, Math.floor(rng() * DIRECTIONS.length));
    return { isSpecial: false, directions: [DIRECTIONS[index]] };
  }

  const isSpecial = forceSpecial || rng() < rules.specialChance;
  if (!isSpecial) {
    const index = Math.min(DIRECTIONS.length - 1, Math.floor(rng() * DIRECTIONS.length));
    return { isSpecial: false, directions: [DIRECTIONS[index]] };
  }

  const canUseThree = allowSpace && maxTokens >= 3;
  const useThree = canUseThree && rng() < rules.hellThreeInputChance;
  if (!useThree) return { isSpecial: true, directions: pickDistinctArrows(rng, 2) };

  const [first, second] = pickDistinctArrows(rng, 2);
  return { isSpecial: true, directions: [first, 'space', second] };
}

export function overlapDirectionForSpawn(index) {
  return Math.max(0, Number(index) || 0) % 2 === 0 ? 'left' : 'right';
}

export function ratingFromCounts(perfect, good, miss) {
  const total = perfect + good + miss;
  if (total <= 0) return '-';
  const accuracy = (perfect + good * 0.65) / total;
  if (accuracy >= 0.94) return 'S';
  if (accuracy >= 0.85) return 'A';
  if (accuracy >= 0.72) return 'B';
  if (accuracy >= 0.58) return 'C';
  return 'D';
}

export function ratingRank(rating) {
  return ({ '-': 0, D: 1, C: 2, B: 3, A: 4, S: 5 })[rating] ?? 0;
}

export function difficultyAt(elapsedMs, rules = DEFAULT_RULES) {
  const seconds = Math.max(0, elapsedMs / 1000);
  const fallMs = Math.max(rules.minimumFallMs, rules.initialFallMs - seconds * 10);
  let spawnMs;
  if (fallMs > rules.minimumFallMs) spawnMs = Math.max(620, rules.initialSpawnMs - seconds * 4);
  else {
    const capReachedAt = (rules.initialFallMs - rules.minimumFallMs) / 10;
    spawnMs = Math.max(rules.minimumSpawnMs, 620 - Math.max(0, seconds - capReachedAt) * 5);
  }
  return { fallMs, spawnMs };
}

export function targetYForHeight(height) {
  return height * 0.80;
}

export function noteY(now, note, spawnY, targetY) {
  const travel = note.targetTime - note.spawnTime;
  if (travel <= 0) return targetY;
  const progress = (now - note.spawnTime) / travel;
  return spawnY + (targetY - spawnY) * progress;
}

export function selectNearestLiveNote(notes, inputTime) {
  let best = null;
  let bestDistance = Infinity;
  for (const note of notes) {
    if (note.resolved) continue;
    const distance = Math.abs(note.targetTime - inputTime);
    if (distance < bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }
  return best;
}

export function isTooEarly(notes, inputTime, rules = DEFAULT_RULES) {
  const upcoming = notes
    .filter((note) => !note.resolved && note.targetTime > inputTime)
    .sort((a, b) => a.targetTime - b.targetTime)[0];
  return Boolean(upcoming && inputTime < upcoming.targetTime - rules.goodWindowMs);
}
