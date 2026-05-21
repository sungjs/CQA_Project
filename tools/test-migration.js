/**
 * Smoke tests for schema migration correctness.
 * 실행: node tools/test-migration.js
 *
 * 이 테스트는 script.js의 핵심 pure 함수 두 가지를 검증:
 *   1. migrateReviewSchema (V1 GTV 'TP/FN/FP/TN' string → V2 truthAbsent/predPresent)
 *   2. migrateGtvDetectionV3 (V2 → V3: truthAbsent/predPresent → detection)
 *
 * 함수는 script.js와 인라인 동일 구현 (환경 의존성 X).
 * Sprint 2 migration이 끝나면 이 test도 script.js의 deriveDetectionState 추가 검증.
 */

// ===== V1 → V2 migration (현재 production) =====
function migrateReviewSchema(review, indicationCategory) {
  if (!review || typeof review !== 'object') return review;
  let totalMigrated = 0;
  if (indicationCategory === 'GTV') {
    const oldComp = review.completeness || {};
    if (!review.truthAbsent) review.truthAbsent = {};
    if (!review.predPresent) review.predPresent = {};
    Object.keys(oldComp).forEach(vi => {
      const vc = oldComp[vi]; if (!vc || typeof vc !== 'object') return;
      Object.keys(vc).forEach(ri => {
        const v = vc[ri];
        if (typeof v !== 'string' || !['TP', 'FN', 'FP', 'TN'].includes(v)) return;
        const viN = +vi, riN = +ri;
        if (v === 'TP') {
          if (!review.predPresent[viN]) review.predPresent[viN] = {};
          review.predPresent[viN][riN] = true;
        } else if (v === 'FP') {
          if (!review.truthAbsent[viN]) review.truthAbsent[viN] = {};
          if (!review.predPresent[viN]) review.predPresent[viN] = {};
          review.truthAbsent[viN][riN] = true; review.predPresent[viN][riN] = true;
        } else if (v === 'TN') {
          if (!review.truthAbsent[viN]) review.truthAbsent[viN] = {};
          review.truthAbsent[viN][riN] = true;
        }
        delete vc[ri];
        totalMigrated++;
      });
      if (Object.keys(vc).length === 0) delete oldComp[vi];
    });
  }
  return review;
}

// ===== V2 → V3 migration (Sprint 2 도입 예정) =====
// truthAbsent + predPresent → detection.{tumorPresent, missed, hallucinated}
function migrateGtvDetectionV3(review) {
  if (!review.truthAbsent && !review.predPresent) return review;
  const detection = review.detection || {};
  const visited = new Set();
  const addEntry = (vi, ri, truthAbsent, predPresent) => {
    const key = `${vi}_${ri}`;
    if (visited.has(key)) return;
    visited.add(key);
    let entry = {};
    if (truthAbsent === true) {
      // 실제 없음 → tumorPresent: 'N'
      entry.tumorPresent = 'N';
      if (predPresent === true) entry.hallucinated = 'few'; // FP
      // 둘 다 false면 TN — entry는 tumorPresent: 'N'만 (default 'Y'에서 벗어남)
    } else {
      // 실제 있음 (default 'Y')
      if (predPresent !== true) entry.missed = 'few'; // FN → missed 1-2
      // pred true면 TP — entry 빈 객체 (default 그대로)
    }
    if (Object.keys(entry).length > 0) {
      if (!detection[vi]) detection[vi] = {};
      detection[vi][ri] = entry;
    }
  };
  for (const vi in (review.truthAbsent || {})) {
    for (const ri in review.truthAbsent[vi]) {
      addEntry(vi, ri, review.truthAbsent[vi][ri] === true, review.predPresent?.[vi]?.[ri] === true);
    }
  }
  for (const vi in (review.predPresent || {})) {
    for (const ri in review.predPresent[vi]) {
      addEntry(vi, ri, review.truthAbsent?.[vi]?.[ri] === true, review.predPresent[vi][ri] === true);
    }
  }
  return { ...review, detection };
}

// ===== Detection state derive (Sprint 2 + Sprint 4 negative case context) =====
const DETECTION_DEFAULTS = Object.freeze({ tumorPresent: 'Y', missed: 'none', hallucinated: 'none' });

function getDetectionDefault(field, ctx) {
  if (field === 'tumorPresent' && ctx && ctx.isNegativeCaseProject) return 'N';
  return DETECTION_DEFAULTS[field];
}
function deriveDetectionState(detection, ctx) {
  const d = detection || {};
  const tumor = d.tumorPresent || getDetectionDefault('tumorPresent', ctx);
  const missed = d.missed || getDetectionDefault('missed', ctx);
  const hallucinated = d.hallucinated || getDetectionDefault('hallucinated', ctx);
  if (tumor === 'N') return hallucinated === 'none' ? 'TN' : 'FP';
  return missed === 'none' ? 'TP' : 'FN';
}

// ===== Test harness =====
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (ok) { console.log(`✅ ${name}`); pass++; }
  else { console.log(`❌ ${name}\n   actual:   ${a}\n   expected: ${e}`); fail++; process.exitCode = 1; }
}

console.log('=== V1 → V2 migration (GTV completeness 문자열 → truthAbsent/predPresent) ===\n');

// 1) TP: completeness 'TP' → predPresent only
let r = { completeness: { 0: { 0: 'TP' } }, truthAbsent: {}, predPresent: {} };
migrateReviewSchema(r, 'GTV');
eq(r.completeness, {}, 'V1→V2: TP — completeness 비워짐');
eq(r.predPresent, { 0: { 0: true } }, 'V1→V2: TP — predPresent[0][0]=true');
eq(r.truthAbsent, {}, 'V1→V2: TP — truthAbsent 비어있음');

// 2) FN: completeness 'FN' → default (둘 다 비어있음)
r = { completeness: { 1: { 0: 'FN' } }, truthAbsent: {}, predPresent: {} };
migrateReviewSchema(r, 'GTV');
eq(r.completeness, {}, 'V1→V2: FN — completeness 비워짐 (default 상태)');
eq(r.predPresent, {}, 'V1→V2: FN — predPresent 비어있음');
eq(r.truthAbsent, {}, 'V1→V2: FN — truthAbsent 비어있음');

// 3) FP: completeness 'FP' → 둘 다 true
r = { completeness: { 2: { 0: 'FP' } }, truthAbsent: {}, predPresent: {} };
migrateReviewSchema(r, 'GTV');
eq(r.predPresent, { 2: { 0: true } }, 'V1→V2: FP — predPresent true');
eq(r.truthAbsent, { 2: { 0: true } }, 'V1→V2: FP — truthAbsent true');

// 4) TN: completeness 'TN' → truthAbsent only
r = { completeness: { 3: { 0: 'TN' } }, truthAbsent: {}, predPresent: {} };
migrateReviewSchema(r, 'GTV');
eq(r.predPresent, {}, 'V1→V2: TN — predPresent 비어있음');
eq(r.truthAbsent, { 3: { 0: true } }, 'V1→V2: TN — truthAbsent true');

// 5) OAR mode: 변환 없음 — boolean completeness 유지
r = { completeness: { 0: { 0: true } }, truthAbsent: {}, predPresent: {} };
migrateReviewSchema(r, 'OAR');
eq(r.completeness, { 0: { 0: true } }, 'OAR mode: completeness 유지');

console.log('\n=== V2 → V3 migration (truthAbsent/predPresent → detection) ===\n');

// 6) TP (default in V2 = predPresent only) → detection 비어있음 (default)
r = { truthAbsent: {}, predPresent: { 0: { 0: true } } };
r = migrateGtvDetectionV3(r);
eq(r.detection, {}, 'V2→V3: TP → detection 비어있음 (모두 default)');

// 7) FN (default in V2 = 둘 다 빈) → 이 case는 V2에선 storage 없음. V3 detection도 빈 entry 비저장.
// 단, 실제로 FN을 명시적으로 표현하려면 missed: 'few' 등 필요. V2 default에서는 정보 손실.
// 대신 V2 default에서 V3로 가면 그대로 default — V3에서도 missed bin 미지정 = none.
// 즉, V2 default(=FN을 의도)는 V3 default(=TP)로 해석됨 → 정보 손실 발생.
// 이 한계는 migration plan에 명시되어 있음 (Sprint 2 plan §1.6).

// 8) FP (truthAbsent + predPresent 둘 다 true) → tumorPresent:'N', hallucinated:'few'
r = { truthAbsent: { 0: { 0: true } }, predPresent: { 0: { 0: true } } };
r = migrateGtvDetectionV3(r);
eq(r.detection, { 0: { 0: { tumorPresent: 'N', hallucinated: 'few' } } }, 'V2→V3: FP → tumorPresent:N, hallucinated:few');

// 9) TN (truthAbsent only) → tumorPresent:'N' (hallucinated 미지정 = none default)
r = { truthAbsent: { 0: { 0: true } }, predPresent: {} };
r = migrateGtvDetectionV3(r);
eq(r.detection, { 0: { 0: { tumorPresent: 'N' } } }, 'V2→V3: TN → tumorPresent:N, hallucinated 미지정 (default none)');

// 10) FN: truthAbsent 없음, predPresent도 없음 — V2 표현이 모호하다. V2에선 default가 FN임.
// 따라서 V2에 entry가 없으면 detection도 entry 없이 default 유지. V3 default는 TP.
// 명시적으로 FN을 V3에서 표현하려면 user가 새로 입력해야 함.
// 이건 acceptable한 정보 손실 (Sprint 2 plan §1.6 명시).

console.log('\n=== deriveDetectionState (V3 4-state) ===\n');

// 11) Empty detection → default TP
eq(deriveDetectionState({}), 'TP', 'derive: empty → TP (default)');
eq(deriveDetectionState(undefined), 'TP', 'derive: undefined → TP (default)');

// 12) tumorPresent:'N', no hallucinated → TN
eq(deriveDetectionState({ tumorPresent: 'N' }), 'TN', 'derive: N + no hallucinated → TN');

// 13) tumorPresent:'N', hallucinated:'few' → FP
eq(deriveDetectionState({ tumorPresent: 'N', hallucinated: 'few' }), 'FP', 'derive: N + hallucinated → FP');
eq(deriveDetectionState({ tumorPresent: 'N', hallucinated: 'many' }), 'FP', 'derive: N + hallucinated many → FP');

// 14) tumorPresent:'Y' (default), missed:'few' → FN
eq(deriveDetectionState({ missed: 'few' }), 'FN', 'derive: missed → FN');
eq(deriveDetectionState({ missed: 'many' }), 'FN', 'derive: missed many → FN');

// 15) tumorPresent:'Y', missed:'none', hallucinated:'few' → TP (hallucinated 무관, missed가 결정)
// Wait: multi-island case에서 18 잡고 2 hallucinated → missed=few(=2), hallucinated=few(=2). 위 derive로는 FN.
// 만약 missed=none + hallucinated=few인 경우 (tumor 있고 다 잡고 spurious만 추가) → 4-state는?
// Plan §1.3 표: Y / none / * → TP. 즉 missed=none이면 hallucinated 무관 TP.
eq(deriveDetectionState({ missed: 'none', hallucinated: 'few' }), 'TP', 'derive: tumor present + caught all + spurious → TP (with hallucinated info)');

console.log('\n=== Sprint 6: GTV 3-dimension pass logic ===\n');

// checkGtvPass 인라인 (script.js와 동일 구현)
function checkGtvPass(comp, us, subRates, def) {
  const g = def.gtv;
  const detFails = [];
  if (comp.sensitivity !== null && comp.sensitivity < g.sensitivityMin) {
    detFails.push('sensitivity');
  }
  if (comp.fpRate !== null && comp.fpRate > g.fpRateMax) {
    detFails.push('fpRate');
  }
  if (comp.severeMissCount > g.severeMissAllowed) {
    detFails.push('severeMiss');
  }
  const detection = { pass: detFails.length === 0, fails: detFails };
  const qFails = [];
  if (us.avg !== null) {
    if (us.avg < def.avg) qFails.push('avg');
    const ratioObs = def.rScore === 2 ? us.r2 : us.r3;
    const ratioThr = def.ratio / 100;
    if (ratioObs !== null && ratioObs > ratioThr) qFails.push('ratio');
  }
  const quality = { pass: qFails.length === 0, fails: qFails };
  const smFails = [];
  if (subRates.significantMiss > g.significantMissRateMax) smFails.push('sigMiss');
  if (subRates.majorInclusion > g.majorInclusionRateMax) smFails.push('majorIncl');
  if (subRates.significantArtifact > g.significantArtifactRateMax) smFails.push('sigArtifact');
  const subMetric = { pass: smFails.length === 0, fails: smFails };
  return {
    overall: detection.pass && quality.pass && subMetric.pass,
    detection, quality, subMetric,
  };
}

const TYPE_B = {
  avg: 3.5, rScore: 2, ratio: 20,
  gtv: {
    sensitivityMin: 0.90, fpRateMax: 0.15, severeMissAllowed: 1,
    significantMissRateMax: 0.10, majorInclusionRateMax: 0.10, significantArtifactRateMax: 0.20,
  }
};

// Test 1: 완벽 — 모두 pass
r = checkGtvPass(
  { sensitivity: 0.95, fpRate: 0.05, severeMissCount: 0 },
  { avg: 4.0, r2: 0.05, r3: 0.10 },
  { significantMiss: 0.05, majorInclusion: 0.05, significantArtifact: 0.10 },
  TYPE_B
);
eq(r.overall, true, '3-dim: 모두 통과 → overall PASS');
eq(r.detection.pass, true, '3-dim: detection PASS');
eq(r.quality.pass, true, '3-dim: quality PASS');
eq(r.subMetric.pass, true, '3-dim: subMetric PASS');

// Test 2: Detection만 fail (낮은 sensitivity)
r = checkGtvPass(
  { sensitivity: 0.85, fpRate: 0.05, severeMissCount: 0 },
  { avg: 4.0, r2: 0.05, r3: 0.10 },
  { significantMiss: 0.05, majorInclusion: 0.05, significantArtifact: 0.10 },
  TYPE_B
);
eq(r.overall, false, '3-dim: detection만 fail → overall FAIL');
eq(r.detection.pass, false, '3-dim: detection FAIL');
eq(r.detection.fails.includes('sensitivity'), true, '3-dim: sensitivity fail reason');
eq(r.quality.pass, true, '3-dim: detection fail이어도 quality는 PASS');

// Test 3: Severe miss 1개 (allowed=1, equal OK)
r = checkGtvPass(
  { sensitivity: 0.92, fpRate: 0.05, severeMissCount: 1 },
  { avg: 4.0, r2: 0.05, r3: 0.10 },
  { significantMiss: 0.05, majorInclusion: 0.05, significantArtifact: 0.10 },
  TYPE_B
);
eq(r.overall, true, '3-dim: severe miss = allowed → PASS');

// Test 4: Severe miss 2개 (allowed=1, exceed)
r = checkGtvPass(
  { sensitivity: 0.92, fpRate: 0.05, severeMissCount: 2 },
  { avg: 4.0, r2: 0.05, r3: 0.10 },
  { significantMiss: 0.05, majorInclusion: 0.05, significantArtifact: 0.10 },
  TYPE_B
);
eq(r.overall, false, '3-dim: severe miss > allowed → FAIL');
eq(r.detection.fails.includes('severeMiss'), true, '3-dim: severeMiss fail reason');

// Test 5: Sub-metric fail (sig miss rate 초과)
r = checkGtvPass(
  { sensitivity: 0.95, fpRate: 0.05, severeMissCount: 0 },
  { avg: 4.0, r2: 0.05, r3: 0.10 },
  { significantMiss: 0.15, majorInclusion: 0.05, significantArtifact: 0.10 },
  TYPE_B
);
eq(r.overall, false, '3-dim: sub-metric만 fail → overall FAIL');
eq(r.subMetric.pass, false, '3-dim: subMetric FAIL');
eq(r.subMetric.fails.includes('sigMiss'), true, '3-dim: sigMiss fail reason');

// Test 6: Quality avg 미달
r = checkGtvPass(
  { sensitivity: 0.95, fpRate: 0.05, severeMissCount: 0 },
  { avg: 3.0, r2: 0.05, r3: 0.10 },
  { significantMiss: 0.05, majorInclusion: 0.05, significantArtifact: 0.10 },
  TYPE_B
);
eq(r.overall, false, '3-dim: avg 미달 → overall FAIL');
eq(r.quality.fails.includes('avg'), true, '3-dim: avg fail reason');

// Test 7: usability null (no scoreable cases, e.g., 모두 negative)
r = checkGtvPass(
  { sensitivity: null, fpRate: 0.0, severeMissCount: 0 },
  { avg: null, r2: null, r3: null },
  { significantMiss: 0.0, majorInclusion: 0.0, significantArtifact: 0.0 },
  TYPE_B
);
eq(r.overall, true, '3-dim: no scoreable cases → 빈 fail list → PASS');

console.log('\n=== Sprint 4: Negative case project default ===\n');

// Negative project context: 빈 detection → TN (tumor 'N' default)
const negCtx = { isNegativeCaseProject: true };
eq(deriveDetectionState({}, negCtx), 'TN', 'negative ctx: empty → TN (tumor=N default)');
eq(deriveDetectionState(undefined, negCtx), 'TN', 'negative ctx: undefined → TN');

// Negative project + 명시 hallucinated → FP (spurious contour)
eq(deriveDetectionState({ hallucinated: 'few' }, negCtx), 'FP', 'negative ctx + hallucinated → FP');
eq(deriveDetectionState({ hallucinated: 'many' }, negCtx), 'FP', 'negative ctx + many hallucinated → FP');

// Negative project + tumorPresent 'Y' 명시 (예외적으로 한 환자에 tumor 있다는 표시) → 일반 로직
eq(deriveDetectionState({ tumorPresent: 'Y' }, negCtx), 'TP', 'negative ctx + explicit Y → TP');
eq(deriveDetectionState({ tumorPresent: 'Y', missed: 'few' }, negCtx), 'FN', 'negative ctx + explicit Y + missed → FN');

// Normal project context: 동일 입력 → TP/FN/FP/TN
const normalCtx = { isNegativeCaseProject: false };
eq(deriveDetectionState({}, normalCtx), 'TP', 'normal ctx: empty → TP');
eq(deriveDetectionState({}, undefined), 'TP', 'no ctx: empty → TP (DETECTION_DEFAULTS)');

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
