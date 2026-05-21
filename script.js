//==================== STATE ====================
const LS_KEY = 'cqa_input_tool_v2';
const LAST_PROJECT_LS_KEY = (uid) => `cqa_last_project_${uid}`;
const SCHEMA_VERSION = 4;

// GTV pass criteria default (heuristic, user study refinement 전 starting point)
// Spec: GTV_Pass_Criteria_Spec.md §3
const GTV_CUTOFF_DEFAULTS = {
  A: { // 엄격 (pre-release / production)
    sensitivityMin: 0.95,
    fpRateMax: 0.05,
    severeMissAllowed: 0,
    significantMissRateMax: 0.05,
    majorInclusionRateMax: 0.05,
    significantArtifactRateMax: 0.10,
  },
  B: { // 중간 (validation / iteration)
    sensitivityMin: 0.90,
    fpRateMax: 0.15,
    severeMissAllowed: 1,
    significantMissRateMax: 0.10,
    majorInclusionRateMax: 0.10,
    significantArtifactRateMax: 0.20,
  },
  C: { // 완화 (early training / research)
    sensitivityMin: 0.85,
    fpRateMax: 0.30,
    severeMissAllowed: 2,
    significantMissRateMax: 0.20,
    majorInclusionRateMax: 0.20,
    significantArtifactRateMax: 0.30,
  },
};
const GTV_DIMENSION_LABELS = {
  detection: 'Detection',
  quality: 'Quality',
  subMetric: 'Sub-metric',
};

// ===== Unified Detection (Schema v3, framework v3) =====
// GTV mode: 환자×ROI별로 tumorPresent / missed / hallucinated 3-input 평가
// Default: TP case (가장 흔함) — 셀에 아무 입력 없으면 자동 TP로 derive
const DETECTION_DEFAULTS = Object.freeze({
  tumorPresent: 'Y',     // Y | N
  missed:       'none',  // none | few (1-2) | several (3-5) | many (>5)
  hallucinated: 'none'   // none | few | several | many
});
const COUNT_BINS = ['none', 'few', 'several', 'many'];
const COUNT_BIN_LABEL = { none: 'None', few: '1-2', several: '3-5', many: '>5' };
const CRITERIA_OAR = ['3. Anatomical accuracy', '4. Over-segmentation', '5. Under-segmentation', '6. Smoothness'];
// GTV 공통 sub-metric — subtype(GBM/Cervix/Liver mets) 무관하게 동일 라벨 사용
const CRITERIA_GTV = ['3. Target coverage', '4. Non-target exclusion', '5. Boundary accuracy', '6. Smoothness / technical'];
// 호환성: 일부 외부 참조용. 신규 코드는 getCriteria() 사용
const CRITERIA = CRITERIA_OAR;
const CUTOFF_TYPES = ['A', 'B', 'C'];
const REVIEW_KEYS = ['completeness', 'completenessComment', 'usability', 'usabilityComment', 'variant', 'variantComment', 'specs', 'specsComment', 'patientMeta', 'testMeta', 'truthAbsent', 'predPresent', 'detection', 'reviewerComment', 'reviewConfidence'];
const GTV_COMPLETENESS_STATES = ['TP', 'FN', 'FP', 'TN'];

function getDefaultCriteria() {
  return isGtvMode() ? CRITERIA_GTV : CRITERIA_OAR;
}
function getCriteria() {
  const def = getDefaultCriteria();
  const custom = state.subMetricLabels;
  if (!Array.isArray(custom) || custom.length === 0) return def;
  // 빈 라벨은 default로 fallback
  return def.map((d, i) => {
    const c = custom[i];
    return (typeof c === 'string' && c.trim()) ? c.trim() : d;
  });
}

function isGtvMode() { return state.indicationCategory === 'GTV'; }

// V3 unified detection helpers
function getDetection(vi, ri) {
  return state.detection?.[vi]?.[ri] || null;
}
// Detection default — 항상 동일 (negative case는 per-cell로 처리, project-level flag 없음)
function getDetectionDefault(field) {
  return DETECTION_DEFAULTS[field];
}
// 4-state 파생 (V3): detection {tumorPresent, missed, hallucinated} → 'TP'|'FN'|'FP'|'TN'
function deriveDetectionState(detection) {
  const d = detection || {};
  const tumor = d.tumorPresent || DETECTION_DEFAULTS.tumorPresent;
  const missed = d.missed || DETECTION_DEFAULTS.missed;
  const hallucinated = d.hallucinated || DETECTION_DEFAULTS.hallucinated;
  if (tumor === 'N') return hallucinated === 'none' ? 'TN' : 'FP';
  return missed === 'none' ? 'TP' : 'FN';
}
// 호환성 유지: 기존 호출처(stats, export 등)가 위 derive를 단일 함수로 사용
function getCompState4(vi, ri) {
  return deriveDetectionState(getDetection(vi, ri));
}
// missed/hallucinated bin 분포 집계 (Summary용)
function getDetectionBin(vi, ri, key) {
  const d = getDetection(vi, ri);
  return (d && d[key]) || DETECTION_DEFAULTS[key];
}
// Detection popover editor — 현재 열려있는 셀 (한 번에 하나만)
let detPopoverEl = null;
let detPopoverContext = null; // { vi, ri, anchor }

function closeDetectionEditor() {
  if (detPopoverEl) { detPopoverEl.remove(); detPopoverEl = null; }
  detPopoverContext = null;
  document.removeEventListener('mousedown', onDetectionEditorOutside, true);
  document.removeEventListener('keydown', onDetectionEditorKey, true);
}
function onDetectionEditorOutside(e) {
  if (!detPopoverEl) return;
  if (detPopoverEl.contains(e.target)) return;
  // 다른 cell 클릭이면 popover만 닫힘 (그쪽 cell의 click이 새 popover 열음)
  closeDetectionEditor();
}
function onDetectionEditorKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeDetectionEditor(); }
}

function openDetectionEditor(vi, ri, anchor) {
  // 이미 같은 cell이면 토글 닫음
  if (detPopoverContext && detPopoverContext.vi === vi && detPopoverContext.ri === ri) {
    closeDetectionEditor();
    return;
  }
  closeDetectionEditor();

  const d = getDetection(vi, ri) || {};
  const t = d.tumorPresent || DETECTION_DEFAULTS.tumorPresent;
  const m = d.missed || DETECTION_DEFAULTS.missed;
  const h = d.hallucinated || DETECTION_DEFAULTS.hallucinated;
  const patientLabel = state.validations[vi] || `#${vi}`;
  const roiLabel = state.rois[ri] || `#${ri}`;
  const isCurrentlyEditable = !currentReadOnly;

  const bins = COUNT_BINS;
  const mOpts = bins.map(b => `<option value="${b}" ${m === b ? 'selected' : ''}>${COUNT_BIN_LABEL[b]}</option>`).join('');
  const hOpts = bins.map(b => `<option value="${b}" ${h === b ? 'selected' : ''}>${COUNT_BIN_LABEL[b]}</option>`).join('');

  const pop = document.createElement('div');
  pop.className = 'det-popover';
  pop.innerHTML = `
    <div class="det-popover-title">
      <span class="det-popover-patient">${esc(patientLabel)}</span>
      <span class="det-popover-sep">·</span>
      <span class="det-popover-roi">${esc(roiLabel)}</span>
      <button type="button" class="det-popover-close" aria-label="닫기">×</button>
    </div>
    <div class="det-popover-body">
      <div class="det-popover-row">
        <span class="det-popover-label">Tumor in reference</span>
        <div class="segmented det-popover-seg">
          <label><input type="radio" name="det-t-pop" value="Y" ${t === 'Y' ? 'checked' : ''} ${isCurrentlyEditable ? '' : 'disabled'}/>Y (present)</label>
          <label><input type="radio" name="det-t-pop" value="N" ${t === 'N' ? 'checked' : ''} ${isCurrentlyEditable ? '' : 'disabled'}/>N (absent)</label>
        </div>
      </div>
      <div class="det-popover-row">
        <span class="det-popover-label">Missed lesion(s)</span>
        <select id="popDetMissed" class="plain det-popover-select" ${isCurrentlyEditable ? '' : 'disabled'}>${mOpts}</select>
      </div>
      <div class="det-popover-row">
        <span class="det-popover-label">Hallucinated</span>
        <select id="popDetHallu" class="plain det-popover-select" ${isCurrentlyEditable ? '' : 'disabled'}>${hOpts}</select>
      </div>
    </div>
    <div class="det-popover-footer">
      <button type="button" class="btn-link det-popover-reset" ${isCurrentlyEditable ? '' : 'disabled'}>이 셀 초기화</button>
      <span class="det-popover-hint">ESC 또는 바깥 클릭으로 닫기</span>
    </div>
  `;

  document.body.appendChild(pop);
  detPopoverEl = pop;
  detPopoverContext = { vi, ri, anchor };

  // 위치 계산 — anchor 셀 아래
  const r = anchor.getBoundingClientRect();
  const popW = 280;
  let left = r.left + window.scrollX;
  const docW = document.documentElement.clientWidth;
  if (left + popW > docW - 8) left = Math.max(8, docW - popW - 8);
  let top = r.bottom + window.scrollY + 6;
  // 화면 아래로 넘치면 위에 표시
  if (top + 220 > window.scrollY + window.innerHeight) {
    top = r.top + window.scrollY - 220 - 6;
  }
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  // 핸들러
  const update = (field, value) => {
    setDetection(vi, ri, field, value);
    saveState();
    renderCompletenessGrid(); // popover는 closeDetectionEditor 호출됨 (cell이 교체됨)
    renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
    // 새로 그려진 cell을 anchor로 popover 재오픈
    const newAnchor = el('completenessGrid').querySelector(`.det-cell[data-vi="${vi}"][data-ri="${ri}"]`);
    if (newAnchor) openDetectionEditor(vi, ri, newAnchor);
  };
  pop.querySelectorAll('input[name="det-t-pop"]').forEach(rb => {
    rb.onchange = (e) => update('tumorPresent', e.target.value);
  });
  el('popDetMissed').onchange = (e) => update('missed', e.target.value);
  el('popDetHallu').onchange = (e) => update('hallucinated', e.target.value);

  pop.querySelector('.det-popover-close').onclick = closeDetectionEditor;
  pop.querySelector('.det-popover-reset').onclick = () => {
    if (!confirm('이 셀의 detection을 default (TP — Tumor 있음, missed/hallucinated 없음)로 초기화할까요?')) return;
    if (state.detection?.[vi]?.[ri]) {
      delete state.detection[vi][ri];
      if (Object.keys(state.detection[vi]).length === 0) delete state.detection[vi];
    }
    saveState();
    closeDetectionEditor();
    renderCompletenessGrid();
    renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
  };

  document.addEventListener('mousedown', onDetectionEditorOutside, true);
  document.addEventListener('keydown', onDetectionEditorKey, true);

  // Focus first input (편집 가능 시)
  if (isCurrentlyEditable) {
    const firstRadio = pop.querySelector('input[name="det-t-pop"]:checked');
    if (firstRadio) firstRadio.focus();
  }
}

// detection 셀에 field 변경 적용 (default 값이면 entry 정리 — sparse 유지)
function setDetection(vi, ri, field, value) {
  if (!state.detection) state.detection = {};
  const isDefault = value === DETECTION_DEFAULTS[field];
  if (isDefault) {
    if (state.detection[vi] && state.detection[vi][ri]) {
      delete state.detection[vi][ri][field];
      if (Object.keys(state.detection[vi][ri]).length === 0) delete state.detection[vi][ri];
      if (Object.keys(state.detection[vi]).length === 0) delete state.detection[vi];
    }
  } else {
    if (!state.detection[vi]) state.detection[vi] = {};
    if (!state.detection[vi][ri]) state.detection[vi][ri] = {};
    state.detection[vi][ri][field] = value;
  }
}

// completeness 셀이 usability 점수 불가 상태인지 판단
function isUnscoreable(vi, ri) {
  if (isGtvMode()) {
    const s = getCompState4(vi, ri);
    return s === 'FN' || s === 'TN'; // AI 추론 없음 → 점수 불가
  }
  return getCell(state.completeness, vi, ri) === true; // OAR: missing
}

// ===== Schema migration — single source of truth =====
// review 데이터 한 덩이를 받아 in-place로 최신 schema로 변환.
// loadState (localStorage) + applyReviewToState (Firestore) 둘 다 이 함수를 호출.
// indicationCategory도 인자로 받음 (review 자체엔 그 정보 없음 → 호출자가 제공).
function migrateReviewSchema(review, indicationCategory) {
  if (!review || typeof review !== 'object') return review;
  let totalMigrated = 0;

  // V1 → V2: GTV completeness 문자열 ('TP'/'FN'/'FP'/'TN') → truthAbsent + predPresent
  if (indicationCategory === 'GTV') {
    const oldComp = review.completeness || {};
    if (!review.truthAbsent) review.truthAbsent = {};
    if (!review.predPresent) review.predPresent = {};
    Object.keys(oldComp).forEach(vi => {
      const vc = oldComp[vi]; if (!vc || typeof vc !== 'object') return;
      Object.keys(vc).forEach(ri => {
        const v = vc[ri];
        if (typeof v !== 'string' || !['TP','FN','FP','TN'].includes(v)) return;
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

  // V2 → V3: GTV truthAbsent + predPresent → detection
  // 주의: V2 default (둘 다 비어있음 = FN)은 V3에서 정보 손실 (V3 default = TP).
  // 명시적으로 마킹된 entry만 보존됨. 사용자가 평가 도중이면 ROI별로 미입력 셀이 의미 바뀜 — onboarding hint 권장.
  if (indicationCategory === 'GTV' && (review.truthAbsent || review.predPresent)) {
    const detection = review.detection || {};
    let v3migrated = 0;
    const visited = new Set();
    const addEntry = (vi, ri, truthAbsent, predPresent) => {
      const key = `${vi}_${ri}`;
      if (visited.has(key)) return;
      visited.add(key);
      let entry = {};
      if (truthAbsent === true) {
        entry.tumorPresent = 'N';
        if (predPresent === true) entry.hallucinated = 'few'; // FP — legacy 표현은 1개로 가정
      } else {
        if (predPresent !== true) entry.missed = 'few'; // FN — legacy 표현은 1개
        // tumorPresent === 'Y' (default), missed === 'none' (default) → TP, entry 빈 객체
      }
      if (Object.keys(entry).length > 0) {
        if (!detection[vi]) detection[vi] = {};
        if (!detection[vi][ri]) { detection[vi][ri] = entry; v3migrated++; }
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
    review.detection = detection;
    if (v3migrated > 0) {
      totalMigrated += v3migrated;
      // legacy 필드는 v3에서 보존 (rollback 가능). v4에서 제거.
      console.log(`[migrate] V2 → V3: ${v3migrated} cells (legacy truthAbsent/predPresent 보존)`);
    }
  }

  if (totalMigrated > 0) console.log(`[migrate] review schema → V3: total ${totalMigrated} cells`);
  return review;
}

// 1-5 scale anchor (tooltip) — OAR/GTV 공통
function getUsabilityAnchor() {
  if (isGtvMode()) {
    return '5: Approve as-is · 4: Minor edit · 3: Boundary 조정 · 2: Major edit · 1: Scratch부터 재contour';
  }
  return '5: Approve · 4: Minor · 3: Moderate · 2: Major · 1: Unusable';
}

// Firebase 핸들 (init에서 채워짐, 미설정 시 null 유지)
let firebaseApp = null, fbAuth = null, fbDb = null, firebaseReady = false;

// 클라우드 동기화 상태
let currentUser = null;
let currentProjectId = null;
let currentReviewerId = null;   // 현재 보고 있는 평가자의 uid (null = legacy 모드)
let currentReadOnly = false;    // legacy or 타인 평가 보기 시 true — 모든 쓰기 차단
let userProjects = [];
const modelReviewersCache = new Map();   // modelId -> [{ uid, reviewerEmail, updatedAt, ... }]
const expandedModels = new Set();
let saveTimer = null;
let saveInFlight = null;
let pendingDirty = false;
let suppressSave = false;

// cutoffDefs에 gtv sub-object가 없으면 default heuristic 채우기 (V3 → V4 lazy migration)
function ensureGtvCutoffDefaults(cutoffDefs) {
  if (!cutoffDefs) return;
  ['A', 'B', 'C'].forEach(t => {
    if (!cutoffDefs[t]) return;
    if (!cutoffDefs[t].gtv) cutoffDefs[t].gtv = { ...GTV_CUTOFF_DEFAULTS[t] };
    else {
      // 일부 field가 빠진 경우 default 채움
      const fields = Object.keys(GTV_CUTOFF_DEFAULTS[t]);
      fields.forEach(f => {
        if (cutoffDefs[t].gtv[f] === undefined) cutoffDefs[t].gtv[f] = GTV_CUTOFF_DEFAULTS[t][f];
      });
    }
  });
}

function defaultState() {
  return {
    projectName: 'CQA_Result',
    notionLink: '',
    // Indication framework (Phase 1+)
    indicationCategory: 'OAR',   // 'OAR' | 'GTV'
    gtvSubtype: null,            // null | 'GBM' | 'Cervix' | 'LiverMets' (deprecated)
    // Sprint 3 — Project metadata (informational, branching logic 아님)
    modality: '',                // 자유 입력: 'CT', 'MR', 'PET-CT', 'multimodal' 등
    modalityDetail: '',          // e.g., 'T1c + FLAIR', 'Multi-phase CT'
    evaluationStage: '',         // 자유 입력: 'baseline', 'training_cycle_3', 'pre_release', 'post_deployment'
    modelVersion: '',            // e.g., 'v0.3.1', 'checkpoint_2026_05_15'
    // Sprint 4 — Negative case project (Pillar 3)
    isNegativeCaseProject: false,
    cutoffDefs: {
      A: { avg: 4.0, rScore: 3, ratio: 10, gtv: { ...GTV_CUTOFF_DEFAULTS.A } },
      B: { avg: 3.5, rScore: 2, ratio: 20, gtv: { ...GTV_CUTOFF_DEFAULTS.B } },
      C: { avg: 3.0, rScore: 2, ratio: 10, gtv: { ...GTV_CUTOFF_DEFAULTS.C } }
    },
    rois: ['Prostate', 'SeminalVes'],
    roiCutoffs: ['A', 'A'],
    validations: ['Validation_1', 'Validation_2', 'Validation_3'],
    tests: ['Test_1', 'Test_2'],
    completeness: {},            // OAR: [vi][ri] = true (missing); GTV: [vi][ri] = 'TP'|'FN'|'FP'|'TN'
    completenessComment: {},
    usability: {},               // [vi][ri] = '1'..'5'
    usabilityComment: {},
    variant: {},                 // [ti][ri] = '1'..'5' or '❌'
    variantComment: {},
    specs: {},                   // [ri][ci] = true
    specsComment: {},
    patientMeta: {},             // [vi] = { preOp, newlyDiagnosed, ... } (GBM/Cervix/LiverMets별)
    testMeta: {},                // [ti] = { ... }
    // Sub-metric 라벨 — null이면 default (OAR/GTV별 4개) 사용. owner-defined.
    subMetricLabels: null,
    // GTV mode (Schema v3, framework v3): unified detection
    // [vi][ri] = { tumorPresent?, missed?, hallucinated? } — sparse, default 값은 저장 안 함
    detection: {},
    // Legacy GTV (v2 schema, v3에서 자동 마이그레이션됨, rollback용으로 보존)
    truthAbsent: {},
    predPresent: {},
    // Reviewer-level metadata (per-reviewer per-model)
    reviewerComment: '',         // 자유서술 (failure mode 노트 등)
    reviewConfidence: ''         // '' | '1'..'5' — 케이스 난이도 (1=쉬움, 5=어려움/애매함)
  };
}

let state = loadState() || defaultState();

function saveState() {
  if (suppressSave) return;
  if (currentReadOnly) return;   // legacy 평가는 변경사항 저장 안 함
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) {}
  scheduleCloudSave();
}
function loadState() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s);
    const def = defaultState();
    for (const k of Object.keys(def)) if (!(k in parsed)) parsed[k] = def[k];
    if (!parsed.roiCutoffs) parsed.roiCutoffs = parsed.rois.map(() => 'A');
    while (parsed.roiCutoffs.length < parsed.rois.length) parsed.roiCutoffs.push('A');
    parsed.roiCutoffs = parsed.roiCutoffs.slice(0, parsed.rois.length);
    ensureGtvCutoffDefaults(parsed.cutoffDefs);
    // 모든 schema migration을 single function이 처리
    migrateReviewSchema(parsed, parsed.indicationCategory);
    return parsed;
  } catch(e) { return null; }
}

//==================== UTILS ====================
function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function getCell(obj, i, j) { return obj?.[i]?.[j]; }
function setCell(obj, i, j, val) {
  if (!obj[i]) obj[i] = {};
  if (val === '' || val === null || val === undefined || val === false) {
    delete obj[i][j];
    if (Object.keys(obj[i]).length === 0) delete obj[i];
  } else {
    obj[i][j] = val;
  }
}

//==================== CLOUD SYNC ====================
function projectConfigFromState() {
  return {
    name: state.projectName || 'Untitled',
    notionLink: state.notionLink || '',
    indicationCategory: state.indicationCategory || 'OAR',
    gtvSubtype: state.gtvSubtype || null,
    subMetricLabels: Array.isArray(state.subMetricLabels) ? state.subMetricLabels : null,
    modality:        state.modality || '',
    modalityDetail:  state.modalityDetail || '',
    evaluationStage: state.evaluationStage || '',
    modelVersion:    state.modelVersion || '',
    isNegativeCaseProject: !!state.isNegativeCaseProject,
    cutoffDefs: state.cutoffDefs,
    rois: state.rois, roiCutoffs: state.roiCutoffs,
    validations: state.validations, tests: state.tests,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}
function reviewFromState() {
  const r = { schemaVersion: SCHEMA_VERSION, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if (currentUser?.email) r.reviewerEmail = currentUser.email;
  REVIEW_KEYS.forEach(k => {
    const v = state[k];
    r[k] = (v === undefined || v === null) ? (REVIEW_STRING_KEYS.has(k) ? '' : {}) : v;
  });
  return r;
}

function setSyncStatus(kind, text) {
  const elS = el('syncStatus');
  if (!elS) return;
  elS.className = ''; if (kind) elS.classList.add('sync-' + kind);
  elS.textContent = text;
}

function scheduleCloudSave() {
  if (!firebaseReady || !currentUser || !currentProjectId) return;
  if (currentReadOnly) return;
  pendingDirty = true;
  setSyncStatus('pending', '저장 중…');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCloudSave, 800);
}

async function flushCloudSave() {
  if (!firebaseReady || !currentUser || !currentProjectId) return;
  if (saveInFlight) await saveInFlight;
  if (!pendingDirty) return;
  pendingDirty = false;
  const projectRef = fbDb.collection('projects').doc(currentProjectId);
  const reviewRef  = projectRef.collection('reviews').doc(currentUser.uid);
  saveInFlight = (async () => {
    try {
      await Promise.all([
        projectRef.set(projectConfigFromState(), { merge: true }),
        reviewRef.set(reviewFromState(),         { merge: true }),
      ]);
      // 평가자 캐시 무효화 — 다음 expand 시 최신 updatedAt 반영
      modelReviewersCache.delete(currentProjectId);
      setSyncStatus('saved', '☁ 저장됨');
    } catch (e) {
      console.error('Cloud save failed:', e);
      setSyncStatus('error', '⚠ 저장 실패 (재시도 대기)');
      pendingDirty = true;
      setTimeout(flushCloudSave, 5000);
    }
  })();
  await saveInFlight;
  saveInFlight = null;
}

function applyProjectConfigToState(projectData) {
  const def = defaultState();
  suppressSave = true;
  try {
    state.projectName       = projectData.name || def.projectName;
    state.notionLink        = projectData.notionLink || '';
    state.indicationCategory = projectData.indicationCategory || 'OAR';
    state.gtvSubtype        = projectData.gtvSubtype || null;
    state.subMetricLabels   = Array.isArray(projectData.subMetricLabels) ? projectData.subMetricLabels : null;
    state.modality          = projectData.modality || '';
    state.modalityDetail    = projectData.modalityDetail || '';
    state.evaluationStage   = projectData.evaluationStage || '';
    state.modelVersion      = projectData.modelVersion || '';
    state.isNegativeCaseProject = !!projectData.isNegativeCaseProject;
    state.cutoffDefs        = projectData.cutoffDefs || def.cutoffDefs;
    ensureGtvCutoffDefaults(state.cutoffDefs);
    state.rois              = projectData.rois || [];
    state.roiCutoffs        = projectData.roiCutoffs || state.rois.map(() => 'A');
    state.validations       = projectData.validations || [];
    state.tests             = projectData.tests || [];
  } finally { suppressSave = false; }
}
const REVIEW_STRING_KEYS = new Set(['reviewerComment', 'reviewConfidence']);
function applyReviewToState(reviewData) {
  suppressSave = true;
  try {
    REVIEW_KEYS.forEach(k => {
      const v = reviewData && reviewData[k];
      state[k] = (v !== undefined && v !== null) ? v : (REVIEW_STRING_KEYS.has(k) ? '' : {});
    });
    migrateReviewSchema(state, state.indicationCategory);
  } finally { suppressSave = false; }
}

// modelId의 특정 평가자 데이터 로드. reviewerUid가 currentUser와 다르면 자동 읽기 전용.
async function loadReviewerEvaluation(modelId, reviewerUid) {
  if (!firebaseReady || !currentUser) return false;
  if (pendingDirty) await flushCloudSave();
  try {
    setSyncStatus('pending', '불러오는 중…');
    const projectRef = fbDb.collection('projects').doc(modelId);
    const reviewRef  = projectRef.collection('reviews').doc(reviewerUid);
    const [pSnap, rSnap] = await Promise.all([projectRef.get(), reviewRef.get()]);
    if (!pSnap.exists) { toast('error', '모델을 찾을 수 없습니다.'); return false; }
    applyProjectConfigToState(pSnap.data());
    applyReviewToState(rSnap.exists ? rSnap.data() : null);
    currentProjectId = modelId;
    currentReviewerId = reviewerUid;
    currentReadOnly = reviewerUid !== currentUser.uid;
    try { localStorage.setItem(LAST_PROJECT_LS_KEY(currentUser.uid), modelId); } catch(e) {}
    renderAll();
    updateReadOnlyBanner();
    renderProjectPicker();
    setSyncStatus(currentReadOnly ? 'offline' : 'saved', currentReadOnly ? '🔒 타인 평가 (읽기 전용)' : '☁ 저장됨');
    return true;
  } catch (e) {
    console.error('Load reviewer failed:', e);
    setSyncStatus('error', '⚠ 불러오기 실패');
    return false;
  }
}

// 통합 진입점. legacy면 별도 분기, 일반 모델이면 본인 review 로드.
async function loadProjectFromCloud(projectId) {
  if (!firebaseReady || !currentUser) return false;
  if (pendingDirty) await flushCloudSave();

  const entry = userProjects.find(p => p.id === projectId);
  const isLegacy = !!entry?._legacy;

  if (isLegacy) {
    try {
      setSyncStatus('pending', '불러오는 중…');
      const ref = fbDb.collection('evaluations').doc(projectId);
      const snap = await ref.get();
      if (!snap.exists) { toast('error', 'Legacy 평가를 찾을 수 없습니다.'); return false; }
      applyLegacyEvaluationToState(snap.data());
      currentProjectId = projectId;
      currentReviewerId = null;
      currentReadOnly = true;
      renderAll();
      updateReadOnlyBanner();
      renderProjectPicker();
      setSyncStatus('offline', '🔒 읽기 전용 (Legacy)');
      return true;
    } catch (e) {
      console.error('Load legacy failed:', e);
      setSyncStatus('error', '⚠ 불러오기 실패');
      return false;
    }
  }
  return loadReviewerEvaluation(projectId, currentUser.uid);
}

function slugifyProjectId(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'project';
  return `${base}_${Date.now().toString(36)}`;
}

async function createCloudProject(name, seedFromCurrentState) {
  if (!firebaseReady || !currentUser) return null;
  const projectId = slugifyProjectId(name);
  const baseConfig = seedFromCurrentState
    ? { ...projectConfigFromState(), name }
    : { ...projectConfigFromState(), name, rois: [], roiCutoffs: [], validations: [], tests: [] };
  const projectDoc = {
    ...baseConfig,
    owner: currentUser.uid,
    members: [currentUser.uid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const projectRef = fbDb.collection('projects').doc(projectId);
  await projectRef.set(projectDoc);
  if (seedFromCurrentState) {
    await projectRef.collection('reviews').doc(currentUser.uid).set(reviewFromState());
  }
  logAuditEvent('project_create', projectId, { name, seeded: !!seedFromCurrentState });
  return projectId;
}

async function fetchUserProjects() {
  if (!firebaseReady || !currentUser) return [];
  try {
    const snap = await fbDb.collection('projects')
      .where('members', 'array-contains', currentUser.uid).get();
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    return list;
  } catch (e) {
    console.error('fetchUserProjects failed:', e);
    setSyncStatus('error', '⚠ 목록 로드 실패: ' + (e.code || e.message));
    return [];
  }
}

async function fetchModelReviewers(modelId) {
  if (modelReviewersCache.has(modelId)) return modelReviewersCache.get(modelId);
  if (!firebaseReady || !currentUser) return [];
  try {
    const snap = await fbDb.collection('projects').doc(modelId).collection('reviews').get();
    const list = [];
    snap.forEach(d => list.push({ uid: d.id, ...d.data() }));
    list.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    modelReviewersCache.set(modelId, list);
    return list;
  } catch (e) {
    console.error('fetchModelReviewers failed:', e);
    return [];
  }
}

async function toggleModelExpand(modelId) {
  if (expandedModels.has(modelId)) {
    expandedModels.delete(modelId);
  } else {
    expandedModels.add(modelId);
    await fetchModelReviewers(modelId);
  }
  renderProjectPicker();
}

async function fetchLegacyEvaluations() {
  if (!firebaseReady || !currentUser) return [];
  try {
    const snap = await fbDb.collection('evaluations').get();
    const list = [];
    snap.forEach(d => {
      const data = d.data() || {};
      list.push({
        id: d.id,
        _legacy: true,
        name: data.projectName || data.name || d.id,
        updatedAt: data.updatedAt || data.createdAt || null,
        owner: null,
        ...data,
      });
    });
    list.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    return list;
  } catch (e) {
    console.warn('fetchLegacyEvaluations failed (스킵):', e);
    return [];
  }
}

function applyLegacyEvaluationToState(data) {
  const def = defaultState();
  suppressSave = true;
  try {
    state.projectName       = data.projectName || data.name || def.projectName;
    state.notionLink        = data.notionLink || '';
    state.indicationCategory = data.indicationCategory || 'OAR'; // legacy는 OAR로 가정
    state.gtvSubtype        = data.gtvSubtype || null;
    state.subMetricLabels   = Array.isArray(data.subMetricLabels) ? data.subMetricLabels : null;
    state.modality          = data.modality || '';
    state.modalityDetail    = data.modalityDetail || '';
    state.evaluationStage   = data.evaluationStage || '';
    state.modelVersion      = data.modelVersion || '';
    state.isNegativeCaseProject = !!data.isNegativeCaseProject;
    state.cutoffDefs        = data.cutoffDefs || def.cutoffDefs;
    ensureGtvCutoffDefaults(state.cutoffDefs);
    state.rois              = data.rois || [];
    state.roiCutoffs        = data.roiCutoffs || state.rois.map(() => 'A');
    state.validations       = data.validations || [];
    state.tests             = data.tests || [];
    REVIEW_KEYS.forEach(k => { state[k] = data[k] || {}; });
  } finally { suppressSave = false; }
}

function updateReadOnlyBanner() {
  document.body.classList.toggle('read-only', !!currentReadOnly);
  const banner = el('readOnlyBanner');
  if (!banner) return;
  banner.classList.toggle('hidden', !currentReadOnly);
  if (!currentReadOnly) return;
  const entry = userProjects.find(p => p.id === currentProjectId);
  if (entry?._legacy) {
    banner.innerHTML = '🔒 <b>읽기 전용 (Legacy 평가)</b> · 변경 내용은 저장되지 않습니다. XLSX/PDF/MD 내보내기는 가능합니다.';
  } else if (currentReviewerId && currentReviewerId !== currentUser?.uid) {
    banner.innerHTML = '🔒 <b>다른 평가자의 데이터 보기</b> · 변경 내용은 저장되지 않습니다. 내 평가로 돌아가려면 사이드바에서 모델명을 클릭하세요.';
  }
}

function formatRelativeTime(ts) {
  if (!ts || !ts.toMillis) return '';
  const diffMs = Date.now() - ts.toMillis();
  if (diffMs < 60_000) return '방금';
  if (diffMs < 3600_000) return Math.floor(diffMs / 60_000) + '분 전';
  if (diffMs < 86400_000) return Math.floor(diffMs / 3600_000) + '시간 전';
  if (diffMs < 30 * 86400_000) return Math.floor(diffMs / 86400_000) + '일 전';
  return new Date(ts.toMillis()).toLocaleDateString('ko-KR');
}

function renderProjectPicker() {
  const list = el('projectList'); if (!list) return;
  list.innerHTML = '';
  if (userProjects.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '모델이 없습니다';
    list.appendChild(li);
    return;
  }
  userProjects.forEach(p => {
    const li = document.createElement('li');
    li.className = 'model-item';
    if (p.id === currentProjectId) li.classList.add('active');
    if (p._legacy) li.classList.add('legacy');
    li.title = p.id + (p._legacy ? ' (Legacy 평가, 읽기 전용)' : '');

    const row = document.createElement('div');
    row.className = 'model-row';

    if (p._legacy) {
      const lock = document.createElement('span');
      lock.className = 'chevron chevron-disabled';
      lock.textContent = '🔒';
      row.appendChild(lock);
    } else {
      const chevron = document.createElement('button');
      chevron.type = 'button';
      chevron.className = 'chevron';
      chevron.textContent = expandedModels.has(p.id) ? '▼' : '▶';
      chevron.onclick = (e) => { e.stopPropagation(); toggleModelExpand(p.id); };
      row.appendChild(chevron);
    }

    const nameWrap = document.createElement('div');
    nameWrap.className = 'model-name-wrap';
    const time = formatRelativeTime(p.updatedAt);
    let tag = '';
    if (p._legacy) tag = ' · <span class="legacy-tag">Legacy</span>';
    else if (p.owner !== currentUser?.uid) tag = ' · <span class="shared-tag">공유</span>';
    // Metadata badges (modality, stage)
    const badges = [];
    if (p.modality) badges.push(`<span class="meta-badge" title="Modality">${esc(p.modality)}</span>`);
    if (p.evaluationStage) badges.push(`<span class="meta-badge" title="Stage">${esc(p.evaluationStage)}</span>`);
    if (p.modelVersion) badges.push(`<span class="meta-badge" title="Model version">${esc(p.modelVersion)}</span>`);
    const badgesHtml = badges.length ? `<div class="model-badges">${badges.join('')}</div>` : '';
    nameWrap.innerHTML = `<span class="project-name">${esc(p.name || p.id)}</span><span class="project-meta">${time}${tag}</span>${badgesHtml}`;
    nameWrap.onclick = () => {
      if (p._legacy) {
        if (p.id !== currentProjectId) loadProjectFromCloud(p.id);
      } else {
        // 모델명 클릭 = 내 평가 로드
        if (p.id !== currentProjectId || currentReviewerId !== currentUser?.uid) {
          loadReviewerEvaluation(p.id, currentUser.uid);
        }
      }
    };
    row.appendChild(nameWrap);

    // hover action buttons: owner면 삭제 가능, legacy 아닌 모든 모델에서 ID 복사 가능
    if (!p._legacy) {
      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'row-action';
      copyBtn.title = '모델 ID 복사 (다른 평가자에게 공유)';
      copyBtn.textContent = '📋';
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        const ok = await clipboardWrite(p.id);
        toast(ok ? 'success' : 'error', ok ? `모델 ID 복사됨: ${p.id}` : '복사 실패');
      };
      actions.appendChild(copyBtn);

      if (p.owner === currentUser?.uid) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'row-action row-delete';
        delBtn.title = '모델 삭제';
        delBtn.textContent = '🗑';
        delBtn.onclick = (e) => { e.stopPropagation(); handleDeleteModel(p.id); };
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);
    }
    li.appendChild(row);

    // 펼친 상태이고 legacy가 아니면 평가자 리스트
    if (!p._legacy && expandedModels.has(p.id)) {
      const reviewers = modelReviewersCache.get(p.id) || [];
      const ul = document.createElement('ul');
      ul.className = 'reviewer-list';
      // 본인이 reviewers에 없으면 placeholder로 추가 (아직 평가 안 한 상태)
      const hasSelf = reviewers.some(r => r.uid === currentUser?.uid);
      const allReviewers = hasSelf ? reviewers : [{ uid: currentUser.uid, reviewerEmail: currentUser.email, _placeholder: true }, ...reviewers];
      if (allReviewers.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'reviewer-empty';
        empty.textContent = '평가자 없음';
        ul.appendChild(empty);
      } else {
        allReviewers.forEach(r => {
          const rLi = document.createElement('li');
          rLi.className = 'reviewer-item';
          if (p.id === currentProjectId && r.uid === currentReviewerId) rLi.classList.add('active');
          const isSelf = r.uid === currentUser?.uid;
          const shortName = (r.reviewerEmail || r.uid).split('@')[0];
          const selfTag = isSelf ? ' <span class="self-tag">(나)</span>' : '';
          const meta = r._placeholder ? '<span class="placeholder">미평가</span>' : formatRelativeTime(r.updatedAt);
          rLi.innerHTML = `<span class="reviewer-name">👤 ${esc(shortName)}${selfTag}</span><span class="reviewer-meta">${meta}</span>`;
          rLi.onclick = (e) => {
            e.stopPropagation();
            if (!(p.id === currentProjectId && r.uid === currentReviewerId)) {
              loadReviewerEvaluation(p.id, r.uid);
            }
          };
          // 자기 평가만 삭제 가능 (placeholder는 아직 만들지도 않은 상태라 삭제 불필요)
          if (isSelf && !r._placeholder) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'row-delete';
            delBtn.title = '내 평가 데이터 삭제';
            delBtn.textContent = '🗑';
            delBtn.onclick = (e) => { e.stopPropagation(); handleDeleteMyReview(p.id); };
            rLi.appendChild(delBtn);
          }
          ul.appendChild(rLi);
        });
      }
      li.appendChild(ul);
    }

    list.appendChild(li);
  });
}

// ===== Inter-rater agreement (Fleiss kappa, usability 1-5 ordinal) =====
async function fetchAllReviewersFull(modelId) {
  if (!firebaseReady || !modelId) return [];
  try {
    const snap = await fbDb.collection('projects').doc(modelId).collection('reviews').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (e) {
    console.error('fetchAllReviewersFull failed:', e);
    return [];
  }
}

// Generic Fleiss kappa — `counts[i][j]` = i번째 unit에서 j번째 category 받은 rater 수
// n = 모든 unit에서 동일한 rater 수. categoryCount = j 범위
function fleissKappa(counts, n, categoryCount) {
  const N = counts.length;
  if (N === 0 || n < 2) return null;
  const p_j = new Array(categoryCount).fill(0);
  counts.forEach(row => row.forEach((c, j) => p_j[j] += c));
  for (let j = 0; j < categoryCount; j++) p_j[j] /= (N * n);
  const P_i = counts.map(row => {
    const sumSq = row.reduce((s, c) => s + c * c, 0);
    return (sumSq - n) / (n * (n - 1));
  });
  const P_bar = P_i.reduce((s, p) => s + p, 0) / N;
  const Pe = p_j.reduce((s, p) => s + p * p, 0);
  if (Pe === 1) return 1;
  return (P_bar - Pe) / (1 - Pe);
}

// Fleiss kappa for ROI ri (usability scores 1-5 as nominal categories)
function fleissKappaForRoi(reviewers, ri, V) {
  const n = reviewers.length;
  if (n < 2 || V === 0) return null;
  const counts = [];
  let validCases = 0;
  for (let vi = 0; vi < V; vi++) {
    const row = [0, 0, 0, 0, 0];
    let raters = 0;
    reviewers.forEach(r => {
      const s = r.usability?.[vi]?.[ri];
      if (s && !isNaN(+s) && +s >= 1 && +s <= 5) { row[+s - 1]++; raters++; }
    });
    if (raters === n) { counts.push(row); validCases++; }
  }
  const k = fleissKappa(counts, n, 5);
  return { kappa: k, validCases, n };
}

// Fleiss kappa for sub-metric ci (specs binary across all ROIs)
function fleissKappaForSubmetric(reviewers, ci, R) {
  const n = reviewers.length;
  if (n < 2 || R === 0) return null;
  // binary: [not-checked, checked]
  const counts = [];
  for (let ri = 0; ri < R; ri++) {
    let c1 = 0, c0 = 0;
    reviewers.forEach(r => {
      const v = r.specs?.[ri]?.[ci];
      if (v === true) c1++;
      else c0++;
    });
    counts.push([c0, c1]);
  }
  const k = fleissKappa(counts, n, 2);
  return { kappa: k, validCount: R, n };
}

function kappaLabel(k) {
  if (k === null || k === undefined || isNaN(k)) return { text: '-', cls: '' };
  if (k < 0)    return { text: 'Poor',           cls: 'k-poor' };
  if (k < 0.2)  return { text: 'Slight',         cls: 'k-slight' };
  if (k < 0.4)  return { text: 'Fair',           cls: 'k-fair' };
  if (k < 0.6)  return { text: 'Moderate',       cls: 'k-moderate' };
  if (k < 0.8)  return { text: 'Substantial',    cls: 'k-substantial' };
  return { text: 'Almost perfect', cls: 'k-perfect' };
}

async function renderInterraterAgreement() {
  const target = el('interraterContent');
  const status = el('interraterStatus');
  if (!target) return;
  if (!firebaseReady || !currentUser || !currentProjectId) {
    target.innerHTML = '<p class="text-sm text-slate-500">로그인 후 모델을 선택하세요.</p>';
    if (status) status.textContent = '대기 중';
    return;
  }
  target.innerHTML = '<p class="text-sm text-slate-500">불러오는 중…</p>';
  const reviewers = await fetchAllReviewersFull(currentProjectId);
  const n = reviewers.length;
  if (n < 2) {
    target.innerHTML = `<p class="text-sm text-slate-500">현재 모델 평가자 ${n}명. 2명 이상의 평가가 있을 때 Fleiss κ를 계산합니다.</p>`;
    if (status) status.textContent = `평가자 ${n}명`;
    return;
  }
  if (status) status.textContent = `평가자 ${n}명 · Fleiss κ`;

  const V = state.validations.length;
  const R = state.rois.length;
  if (V === 0 || R === 0) {
    target.innerHTML = '<p class="text-sm text-slate-500">ROI / Validation 환자가 필요합니다.</p>';
    return;
  }

  // ROI별 usability kappa
  const roiKappas = state.rois.map((roi, ri) => {
    const result = fleissKappaForRoi(reviewers, ri, V);
    return { roi, ...result };
  });

  // Sub-metric별 specs kappa
  const CRITERIA = getCriteria();
  const subKappas = CRITERIA.map((label, ci) => {
    const result = fleissKappaForSubmetric(reviewers, ci, R);
    return { label, ...result };
  });

  // 평가자 리스트 (이메일 short)
  const reviewerList = reviewers.map(r => (r.reviewerEmail || r.uid).split('@')[0]).join(' · ');

  let html = `<div class="text-xs text-slate-500 mb-3">
    평가자(${n}): <b class="text-slate-700">${esc(reviewerList)}</b>
  </div>`;

  html += `<h4 class="text-xs font-semibold text-slate-500 mb-2" style="letter-spacing:0.06em">USABILITY 점수 일치도 (ROI별)</h4>`;
  html += `<table class="summary-table"><thead><tr>
    <th>ROI</th><th>κ</th><th>해석</th><th>유효 케이스</th><th>평가자 수</th>
  </tr></thead><tbody>`;
  roiKappas.forEach(r => {
    if (r.kappa === null) {
      html += `<tr><td>${esc(r.roi)}</td><td>-</td><td class="text-slate-400">데이터 부족</td><td>${r.validCases}/${V}</td><td>${r.n}</td></tr>`;
    } else {
      const lbl = kappaLabel(r.kappa);
      html += `<tr><td>${esc(r.roi)}</td><td><b>${r.kappa.toFixed(3)}</b></td><td><span class="kappa-badge ${lbl.cls}">${lbl.text}</span></td><td>${r.validCases}/${V}</td><td>${r.n}</td></tr>`;
    }
  });
  html += `</tbody></table>`;

  // Sub-metric별 specs 일치도
  html += `<h4 class="text-xs font-semibold text-slate-500 mt-5 mb-2" style="letter-spacing:0.06em">3-6 SPECIFICATIONS 체크 일치도 (sub-metric별, ROI 통합)</h4>`;
  html += `<table class="summary-table"><thead><tr>
    <th class="text-left pl-3">Sub-metric</th><th>κ</th><th>해석</th><th>ROI 수</th><th>평가자 수</th>
  </tr></thead><tbody>`;
  subKappas.forEach(s => {
    if (s.kappa === null) {
      html += `<tr><td class="text-left pl-3">${esc(s.label)}</td><td>-</td><td class="text-slate-400">데이터 부족</td><td>${s.validCount}</td><td>${s.n}</td></tr>`;
    } else {
      const lbl = kappaLabel(s.kappa);
      html += `<tr><td class="text-left pl-3">${esc(s.label)}</td><td><b>${s.kappa.toFixed(3)}</b></td><td><span class="kappa-badge ${lbl.cls}">${lbl.text}</span></td><td>${s.validCount}</td><td>${s.n}</td></tr>`;
    }
  });
  html += `</tbody></table>`;

  // 해석 가이드
  html += `<details class="mt-4 text-xs text-slate-500">
    <summary class="cursor-pointer hover:text-slate-700">Fleiss κ 해석 기준 (Landis & Koch, 1977)</summary>
    <ul class="mt-2 leading-relaxed">
      <li>< 0: Poor — 우연보다 못함</li>
      <li>0.00 – 0.20: Slight — 약함</li>
      <li>0.21 – 0.40: Fair — 보통</li>
      <li>0.41 – 0.60: Moderate — 중간</li>
      <li>0.61 – 0.80: Substantial — 상당함</li>
      <li>0.81 – 1.00: Almost perfect — 거의 완전 일치</li>
    </ul>
    <p class="mt-2"><b>유효 케이스</b>: 모든 평가자가 점수를 매긴 환자 수. ❌ 또는 빈 셀이 한 명이라도 있으면 제외.</p>
  </details>`;

  target.innerHTML = html;
}

// 토글 + (펼침일 때만) 자동 데이터 갱신
async function toggleInterraterSection(btn) {
  toggleSection(btn);
  const wrap = btn.closest('.section-wrap');
  const bd = wrap.querySelector('.section-bd');
  if (bd && bd.style.display !== 'none') {
    await renderInterraterAgreement();
  }
}

// ===== Toast notification (alert 대체) =====
// kind: 'success' | 'error' | 'warning' | 'info'
// duration: ms, default 4000 (error는 6000)
function toast(kind, message, opts) {
  const stack = el('toastStack'); if (!stack) { console.log(`[${kind}] ${message}`); return; }
  opts = opts || {};
  const duration = opts.duration || (kind === 'error' ? 6000 : 4000);
  const icons = { success: '✓', error: '⚠', warning: '⚠', info: 'ℹ' };
  const div = document.createElement('div');
  div.className = `toast toast-${kind}`;
  div.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  div.innerHTML = `<span class="toast-icon">${icons[kind] || '·'}</span>
    <div class="toast-body">${esc(message)}</div>
    <button class="toast-close" aria-label="닫기">×</button>`;
  stack.appendChild(div);

  const dismiss = () => {
    if (!div.parentNode) return;
    div.classList.add('toast-leaving');
    setTimeout(() => div.remove(), 180);
  };
  div.querySelector('.toast-close').onclick = dismiss;
  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}

// ===== Audit trail — critical action 추적 (best-effort, 실패해도 본 동작은 진행) =====
async function logAuditEvent(action, projectId, metadata) {
  if (!firebaseReady || !currentUser) return;
  try {
    await fbDb.collection('audit').add({
      uid: currentUser.uid,
      email: currentUser.email || '',
      action: action,
      projectId: projectId || null,
      metadata: metadata || {},
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('Audit log failed (non-fatal):', e.message);
  }
}

// 모델 전체 삭제 (owner만 가능). reviews 서브컬렉션도 같이 정리
async function deleteCloudProject(modelId) {
  if (!firebaseReady || !currentUser) return false;
  try {
    const projectRef = fbDb.collection('projects').doc(modelId);
    const reviewsSnap = await projectRef.collection('reviews').get();
    const reviewerCount = reviewsSnap.size;
    const batch = fbDb.batch();
    reviewsSnap.forEach(d => batch.delete(d.ref));
    batch.delete(projectRef);
    await batch.commit();
    modelReviewersCache.delete(modelId);
    expandedModels.delete(modelId);
    logAuditEvent('project_delete', modelId, { reviewerCount });
    return true;
  } catch (e) {
    console.error('Delete project failed:', e);
    toast('error', '모델 삭제 실패: ' + (e.code || e.message));
    return false;
  }
}

// 자기 평가 데이터만 삭제 (모델 자체는 유지)
async function deleteMyReview(modelId) {
  if (!firebaseReady || !currentUser) return false;
  try {
    await fbDb.collection('projects').doc(modelId).collection('reviews').doc(currentUser.uid).delete();
    modelReviewersCache.delete(modelId);
    logAuditEvent('review_delete', modelId, {});
    return true;
  } catch (e) {
    console.error('Delete review failed:', e);
    toast('error', '내 평가 삭제 실패: ' + (e.code || e.message));
    return false;
  }
}

// 모델 삭제 후 처리 — 사이드바 갱신, 다른 모델로 전환
async function handleDeleteModel(modelId) {
  const entry = userProjects.find(p => p.id === modelId);
  if (!entry) return;
  const name = entry.name || modelId;
  if (!confirm(`정말 모델 "${name}"을(를) 삭제할까요?\n이 모델의 모든 평가자 데이터까지 함께 사라집니다. (되돌릴 수 없음)`)) return;
  if (pendingDirty) await flushCloudSave();
  setSyncStatus('pending', '삭제 중…');
  const ok = await deleteCloudProject(modelId);
  if (!ok) return;
  const [projects, legacies] = await Promise.all([fetchUserProjects(), fetchLegacyEvaluations()]);
  userProjects = [...projects, ...legacies];
  renderProjectPicker();
  if (modelId === currentProjectId) {
    // 현재 보던 모델 삭제됨 → 다른 모델 로드 or 빈 상태
    currentProjectId = null; currentReviewerId = null; currentReadOnly = false;
    if (userProjects.length > 0) {
      await loadProjectFromCloud(userProjects[0].id);
    } else {
      Object.assign(state, defaultState());
      renderAll();
      setSyncStatus('saved', '모델 없음');
    }
  } else {
    setSyncStatus('saved', '☁ 저장됨');
  }
}

async function handleDeleteMyReview(modelId) {
  if (!confirm(`이 모델에 대한 내 평가 데이터를 삭제할까요?\n(모델 자체와 다른 평가자의 데이터는 유지됩니다)`)) return;
  if (pendingDirty) await flushCloudSave();
  setSyncStatus('pending', '삭제 중…');
  const ok = await deleteMyReview(modelId);
  if (!ok) return;
  // 현재 본 모델이면 다시 로드 (빈 review로 복귀)
  if (modelId === currentProjectId) {
    await loadProjectFromCloud(modelId);
  } else {
    setSyncStatus('saved', '☁ 저장됨');
  }
}

async function joinCloudProject(projectId) {
  if (!firebaseReady || !currentUser) return false;
  try {
    const projectRef = fbDb.collection('projects').doc(projectId);
    const snap = await projectRef.get();
    if (!snap.exists) { toast('error', '모델 ID를 찾을 수 없습니다.'); return false; }
    const data = snap.data();
    if (!data.members?.includes(currentUser.uid)) {
      await projectRef.update({
        members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      logAuditEvent('join_project', projectId, { name: data.name || '' });
    }
    userProjects = await fetchUserProjects();
    renderProjectPicker();
    await loadProjectFromCloud(projectId);
    return true;
  } catch (e) {
    console.error('Join failed:', e);
    toast('error', '모델 참여 실패: ' + e.message);
    return false;
  }
}

//==================== AUTH ====================
function updateAuthUI(user) {
  const signInBtn = el('btnSignIn');
  const userInfo  = el('userInfo');
  const userEmail = el('userEmail');
  const sidebar   = el('sidebar');
  if (!signInBtn) return;
  if (user) {
    signInBtn.classList.add('hidden');
    userInfo.classList.remove('hidden');
    userEmail.textContent = user.email;
    sidebar.classList.remove('hidden');
    syncSidebarOpenBtn();
  } else {
    signInBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
    sidebar.classList.add('hidden');
    el('btnSidebarOpen').classList.add('hidden');
    setSyncStatus('offline', '로컬 모드');
  }
}

function syncSidebarOpenBtn() {
  // collapsed 상태일 때만 햄버거 오픈 버튼 노출
  const openBtn = el('btnSidebarOpen');
  const collapsed = document.body.classList.contains('sidebar-collapsed');
  const loggedIn = !!currentUser;
  openBtn.classList.toggle('hidden', !(loggedIn && collapsed));
}

function toggleSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('cqa_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0'); } catch(e) {}
  syncSidebarOpenBtn();
}

// 테마 (light/dark) — 명시 저장 없으면 시스템 prefers 따라감
function getActiveTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.setAttribute('data-theme', 'light');
  try { localStorage.setItem('cqa_theme', theme); } catch(e) {}
  syncThemeButtonTitle();
}
function toggleTheme() {
  applyTheme(getActiveTheme() === 'dark' ? 'light' : 'dark');
}
function syncThemeButtonTitle() {
  const btn = el('btnTheme'); if (!btn) return;
  btn.title = getActiveTheme() === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
}

async function handleSignIn() {
  if (!firebaseReady) {
    toast('error', 'Firebase가 설정되지 않았습니다. firebase-config.js를 확인하세요.');
    return;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ hd: window.CQA_ALLOWED_EMAIL_DOMAIN, prompt: 'select_account' });
    const result = await fbAuth.signInWithPopup(provider);
    if (!result.user.email || !result.user.email.endsWith('@' + window.CQA_ALLOWED_EMAIL_DOMAIN)) {
      await fbAuth.signOut();
      toast('error', `@${window.CQA_ALLOWED_EMAIL_DOMAIN} 계정만 사용할 수 있습니다.`);
    }
  } catch (e) {
    console.error('Sign in failed:', e);
    if (e.code !== 'auth/popup-closed-by-user') toast('error', '로그인 실패: ' + e.message);
  }
}

async function handleSignOut() {
  try {
    if (pendingDirty) await flushCloudSave();
    await fbAuth.signOut();
  } catch (e) { console.error('Sign out failed:', e); }
}

async function onUserAuthenticated(user) {
  currentUser = user;
  updateAuthUI(user);
  setSyncStatus('pending', '모델 목록 불러오는 중…');

  const [projects, legacies] = await Promise.all([
    fetchUserProjects(),
    fetchLegacyEvaluations(),
  ]);
  userProjects = [...projects, ...legacies];
  renderProjectPicker();

  // 목록 로드 실패 시 (sync status가 error) 더 진행하지 않음
  if (el('syncStatus').classList.contains('sync-error')) return;

  if (userProjects.length === 0) {
    const hasLocal = !!localStorage.getItem(LS_KEY)
      && (state.rois.length > 0 || state.validations.length > 0 || Object.keys(state.usability).length > 0);
    let projectName = null, seedFromLocal = false;
    if (hasLocal) {
      const yes = confirm('로컬에 저장된 평가 데이터를 클라우드 새 모델로 업로드할까요?\n(취소 시 빈 모델로 시작)');
      if (yes) {
        projectName = prompt('모델명:', state.projectName || 'My Model') || state.projectName;
        seedFromLocal = !!projectName;
      }
    }
    if (!projectName) projectName = prompt('첫 모델명을 입력하세요:', 'My Model');
    if (!projectName) { setSyncStatus('offline', '모델 미선택'); return; }
    const projectId = await createCloudProject(projectName, seedFromLocal);
    userProjects = await fetchUserProjects();
    renderProjectPicker();
    await loadProjectFromCloud(projectId);
  } else {
    const lastId = localStorage.getItem(LAST_PROJECT_LS_KEY(user.uid));
    const targetId = userProjects.find(p => p.id === lastId)?.id || userProjects[0].id;
    await loadProjectFromCloud(targetId);
  }
}

function onUserSignedOut() {
  currentUser = null; currentProjectId = null; currentReviewerId = null;
  currentReadOnly = false; userProjects = [];
  modelReviewersCache.clear(); expandedModels.clear();
  updateAuthUI(null);
  updateReadOnlyBanner();
  const cached = loadState();
  if (cached) Object.assign(state, cached);
  renderAll();
}

function initFirebase() {
  const cfg = window.CQA_FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === 'REPLACE_ME') {
    setSyncStatus('offline', '로컬 모드 (Firebase 미설정)');
    el('btnSignIn').classList.remove('hidden');
    return;
  }
  try {
    firebaseApp = firebase.initializeApp(cfg);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    // Offline persistence (compat API)
    fbDb.enablePersistence({ synchronizeTabs: true }).catch((e) => {
      if (e.code === 'failed-precondition') console.warn('Persistence: 다중 탭 모두 활성화 불가');
      else if (e.code === 'unimplemented') console.warn('Persistence: 브라우저 미지원');
    });
    firebaseReady = true;
    setSyncStatus('pending', '인증 확인 중…');
    fbAuth.onAuthStateChanged(async (user) => {
      if (user) {
        if (!user.email || !user.email.endsWith('@' + window.CQA_ALLOWED_EMAIL_DOMAIN)) {
          await fbAuth.signOut();
          toast('error', `@${window.CQA_ALLOWED_EMAIL_DOMAIN} 계정만 사용할 수 있습니다.`);
          return;
        }
        await onUserAuthenticated(user);
      } else {
        onUserSignedOut();
      }
    });
  } catch (e) {
    console.error('Firebase 초기화 실패:', e);
    setSyncStatus('error', '⚠ Firebase 초기화 실패');
    el('btnSignIn').classList.remove('hidden');
  }
}

//==================== SETUP RENDERING ====================
function renderLists() {
  el('projectName').value = state.projectName;
  el('notionLink').value = state.notionLink;
  // Reviewer note (per-reviewer)
  const rc = el('reviewConfidence'); if (rc) rc.value = state.reviewConfidence || '';
  const rcm = el('reviewerComment'); if (rcm) rcm.value = state.reviewerComment || '';
  el('roiCount').textContent = state.rois.length;
  el('valCount').textContent = state.validations.length;
  el('testCount').textContent = state.tests.length;

  // Indication selector 동기화
  document.querySelectorAll('input[name="indicationCategory"]').forEach(r => {
    r.checked = r.value === (state.indicationCategory || 'OAR');
  });

  renderROIChips();
  renderChipList('valList', state.validations, (i, newVal) => { state.validations[i] = newVal; }, (i) => { removeAtIndex('validations', i); });
  renderChipList('testList', state.tests, (i, newVal) => { state.tests[i] = newVal; }, (i) => { removeAtIndex('tests', i); });
  renderCutoffTable();
}

function syncCutoffHint() {
  const hint = el('cutoffGtvHint');
  if (hint) hint.classList.toggle('hidden', !isGtvMode());
}

function renderCutoffTable() {
  syncCutoffHint();
  ensureGtvCutoffDefaults(state.cutoffDefs);
  const tbody = el('cutoffBody');
  let html = '';
  const typeDesc = { A: '엄격 (고성능 요구)', B: '중간', C: '완화' };
  CUTOFF_TYPES.forEach(t => {
    const d = state.cutoffDefs[t];
    html += `<tr class="border-t">
      <td class="py-1 font-bold">${t}</td>
      <td class="py-1"><input type="number" step="0.1" class="plain cutoff-input text-center" data-t="${t}" data-k="avg" value="${d.avg}" /></td>
      <td class="py-1">
        <select class="plain" data-t="${t}" data-k="rScore">
          <option value="2" ${d.rScore===2?'selected':''}>2점 이하</option>
          <option value="3" ${d.rScore===3?'selected':''}>3점 이하</option>
        </select>
      </td>
      <td class="py-1"><input type="number" step="1" class="plain cutoff-input text-center" data-t="${t}" data-k="ratio" value="${d.ratio}" /> <span class="text-xs text-slate-400">%</span></td>
      <td class="py-1 pl-4 text-xs text-slate-500">${typeDesc[t]} · 평균 ${d.avg}점 이상이면서, ${d.rScore}점 이하 비율이 ${d.ratio}% 이하일 때 PASS</td>
    </tr>`;
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('input, select').forEach(inp => {
    inp.onchange = (e) => {
      const t = e.target.dataset.t, k = e.target.dataset.k;
      const val = k === 'rScore' ? +e.target.value : parseFloat(e.target.value);
      if (!isNaN(val)) state.cutoffDefs[t][k] = val;
      saveState(); renderCutoffTable(); renderSpecsGrid(); renderUsabilityGrid(); renderSummaryView();
    };
  });

  // GTV cutoff section (3-dimension, Spec §2-§3)
  renderGtvCutoffTable();
}

function renderGtvCutoffTable() {
  const section = el('gtvCutoffSection');
  const tbody = el('gtvCutoffBody');
  if (!section || !tbody) return;
  const gtv = isGtvMode();
  section.classList.toggle('hidden', !gtv);
  if (!gtv) return;

  // owner-only edit
  const isOwner = (() => {
    if (!currentUser || !currentProjectId) return true;
    const entry = userProjects.find(p => p.id === currentProjectId);
    return !entry || entry.owner === currentUser.uid;
  })();
  const ro = !isOwner || currentReadOnly;

  // GTV value field 정의 (sub-object 안의 6개 field, 모두 0-1 또는 정수)
  const fields = [
    { k: 'sensitivityMin',           pct: true,  step: 0.01 },
    { k: 'fpRateMax',                pct: true,  step: 0.01 },
    { k: 'severeMissAllowed',        pct: false, step: 1, integer: true },
    { k: 'significantMissRateMax',   pct: true,  step: 0.01 },
    { k: 'majorInclusionRateMax',    pct: true,  step: 0.01 },
    { k: 'significantArtifactRateMax', pct: true, step: 0.01 },
  ];

  let html = '';
  CUTOFF_TYPES.forEach(t => {
    const g = state.cutoffDefs[t].gtv;
    html += `<tr class="border-t"><td class="py-1 font-bold">${t}</td>`;
    fields.forEach(f => {
      const raw = g[f.k] ?? GTV_CUTOFF_DEFAULTS[t][f.k];
      const displayVal = f.pct ? (raw * 100).toFixed(0) : raw;
      const suffix = f.pct ? '<span class="text-slate-400" style="font-size:10px">%</span>' : '';
      html += `<td class="py-1 text-center">
        <input type="number" step="${f.pct ? 1 : 1}" min="0" ${f.pct ? 'max="100"' : ''}
               class="plain cutoff-input text-center" style="width:56px"
               data-t="${t}" data-k="${f.k}" data-pct="${f.pct}" value="${displayVal}" ${ro ? 'disabled' : ''} />
        ${suffix}
      </td>`;
    });
    html += `</tr>`;
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('input').forEach(inp => {
    inp.onchange = (e) => {
      const t = e.target.dataset.t, k = e.target.dataset.k, pct = e.target.dataset.pct === 'true';
      let v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      if (pct) v = v / 100;
      state.cutoffDefs[t].gtv[k] = v;
      saveState();
      renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
    };
  });
}

function resetGtvCutoffsToDefault() {
  if (!confirm('GTV cutoff 3-dimension threshold를 모두 heuristic default로 초기화할까요?')) return;
  CUTOFF_TYPES.forEach(t => {
    state.cutoffDefs[t].gtv = { ...GTV_CUTOFF_DEFAULTS[t] };
  });
  saveState();
  renderCutoffTable(); renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
  toast('info', 'GTV cutoff threshold를 default로 초기화했습니다');
}

function renderROIChips() {
  const c = el('roiList'); c.innerHTML = '';
  state.rois.forEach((name, i) => {
    const chip = document.createElement('span'); chip.className = 'chip';
    const input = document.createElement('input'); input.value = name;
    input.style.width = Math.min(180, Math.max(60, name.length * 8 + 10)) + 'px';
    input.onchange = () => { state.rois[i] = input.value; saveState(); renderAll(); };
    const sel = document.createElement('select');
    CUTOFF_TYPES.forEach(t => {
      const opt = document.createElement('option'); opt.value = t; opt.textContent = t;
      if (state.roiCutoffs[i] === t) opt.selected = true; sel.appendChild(opt);
    });
    sel.onchange = () => { state.roiCutoffs[i] = sel.value; saveState(); renderAll(); };
    const btn = document.createElement('button'); btn.innerHTML = '×'; btn.title = '삭제';
    btn.onclick = () => { removeAtIndex('rois', i); saveState(); renderAll(); };
    chip.appendChild(input); chip.appendChild(sel); chip.appendChild(btn); c.appendChild(chip);
  });
}

function renderChipList(containerId, arr, onRename, onRemove) {
  const c = el(containerId); c.innerHTML = '';
  arr.forEach((name, i) => {
    const chip = document.createElement('span'); chip.className = 'chip';
    const input = document.createElement('input'); input.value = name;
    input.style.width = Math.min(180, Math.max(60, name.length * 8 + 10)) + 'px';
    input.onchange = () => { onRename(i, input.value); saveState(); renderAll(); };
    const btn = document.createElement('button'); btn.innerHTML = '×'; btn.title = '삭제';
    btn.onclick = () => { onRemove(i); saveState(); renderAll(); };
    chip.appendChild(input); chip.appendChild(btn); c.appendChild(chip);
  });
}

function removeAtIndex(listKey, idx) {
  state[listKey].splice(idx, 1);
  if (listKey === 'rois') {
    state.roiCutoffs.splice(idx, 1);
    shiftSecondaryKey(state.completeness, idx); shiftSecondaryKey(state.usability, idx);
    shiftSecondaryKey(state.variant, idx); shiftPrimaryKey(state.specs, idx);
    if (state.truthAbsent)  shiftSecondaryKey(state.truthAbsent, idx);
    if (state.predPresent)  shiftSecondaryKey(state.predPresent, idx);
    if (state.detection)    shiftSecondaryKey(state.detection, idx);
  } else if (listKey === 'validations') {
    shiftPrimaryKey(state.completeness, idx); shiftPrimaryKey(state.usability, idx);
    shiftPrimaryKey(state.completenessComment, idx); shiftPrimaryKey(state.usabilityComment, idx);
    if (state.patientMeta)  shiftPrimaryKey(state.patientMeta, idx);
    if (state.truthAbsent)  shiftPrimaryKey(state.truthAbsent, idx);
    if (state.predPresent)  shiftPrimaryKey(state.predPresent, idx);
    if (state.detection)    shiftPrimaryKey(state.detection, idx);
  } else if (listKey === 'tests') {
    shiftPrimaryKey(state.variant, idx); shiftPrimaryKey(state.variantComment, idx);
    if (state.testMeta) shiftPrimaryKey(state.testMeta, idx);
  }
}
function shiftPrimaryKey(obj, removedIdx) {
  const keys = Object.keys(obj).map(Number).sort((a,b)=>a-b);
  for (const k of keys) {
    if (k === removedIdx) delete obj[k];
    else if (k > removedIdx) { obj[k - 1] = obj[k]; delete obj[k]; }
  }
}
function shiftSecondaryKey(obj, removedIdx) {
  for (const i in obj) {
    const keys = Object.keys(obj[i]).map(Number).sort((a,b)=>a-b);
    for (const k of keys) {
      if (k === removedIdx) delete obj[i][k];
      else if (k > removedIdx) { obj[i][k - 1] = obj[i][k]; delete obj[i][k]; }
    }
    if (Object.keys(obj[i]).length === 0) delete obj[i];
  }
}

function setupAddForms() {
  el('roiAddForm').onsubmit = (e) => { e.preventDefault(); const v = el('roiAddInput').value.trim(); if (v) { state.rois.push(v); state.roiCutoffs.push('A'); el('roiAddInput').value = ''; saveState(); renderAll(); } };
  el('valAddForm').onsubmit = (e) => { e.preventDefault(); const v = el('valAddInput').value.trim(); if (v) { state.validations.push(v); el('valAddInput').value = ''; saveState(); renderAll(); } };
  el('testAddForm').onsubmit = (e) => { e.preventDefault(); const v = el('testAddInput').value.trim(); if (v) { state.tests.push(v); el('testAddInput').value = ''; saveState(); renderAll(); } };
  el('valBulkBtn').onclick = () => {
    const input = prompt('환자 ID를 콤마나 줄바꿈으로 구분해 입력하세요.');
    if (!input) return;
    const arr = input.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    state.validations.push(...arr); saveState(); renderAll();
  };
  el('testBulkBtn').onclick = () => {
    const input = prompt('Test ID를 콤마나 줄바꿈으로 구분해 입력하세요.');
    if (!input) return;
    const arr = input.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    state.tests.push(...arr); saveState(); renderAll();
  };
  el('projectName').oninput = (e) => { state.projectName = e.target.value; saveState(); };
  el('notionLink').oninput = (e) => { state.notionLink = e.target.value; saveState(); };
  document.querySelectorAll('input[name="indicationCategory"]').forEach(r => {
    r.addEventListener('change', (e) => {
      const newCat = e.target.value;
      const oldCat = state.indicationCategory || 'OAR';
      if (newCat === oldCat) return;
      // 데이터 있을 때만 confirm
      const hasData =
        Object.keys(state.completeness || {}).length > 0 ||
        Object.keys(state.truthAbsent || {}).length > 0 ||
        Object.keys(state.predPresent || {}).length > 0;
      const meaning = c => c === 'OAR' ? '체크 = 누락' : '실제/추론 4-state (TP/FN/FP/TN)';
      if (hasData && !confirm(
        `평가 유형을 ${oldCat} → ${newCat}로 변경하면 Completeness 데이터의 해석이 바뀝니다.\n\n` +
        `${oldCat}: ${meaning(oldCat)}\n${newCat}: ${meaning(newCat)}\n\n` +
        `데이터는 보존되지만 자동 매핑은 안 됩니다. 계속하시겠습니까?`
      )) {
        // revert radio UI
        document.querySelectorAll('input[name="indicationCategory"]').forEach(r2 => {
          r2.checked = r2.value === oldCat;
        });
        return;
      }
      state.indicationCategory = newCat;
      saveState();
      renderAll();
    });
  });
  el('reviewConfidence').addEventListener('change', (e) => {
    state.reviewConfidence = e.target.value; saveState();
  });
  el('reviewerComment').addEventListener('input', (e) => {
    state.reviewerComment = e.target.value; saveState();
  });
  document.querySelectorAll('.sub-metric-input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      applySubMetricLabel(+e.target.dataset.idx, e.target.value);
    });
  });
  el('btnResetSubMetric').onclick = resetSubMetricLabels;
  const btnResetGtv = el('btnResetGtvCutoff');
  if (btnResetGtv) btnResetGtv.onclick = resetGtvCutoffsToDefault;

  // Project metadata fields (Sprint 3)
  el('metaModality').addEventListener('input', (e) => { state.modality = e.target.value; saveState(); renderProjectMetadata(); renderProjectPicker(); });
  el('metaModalityDetail').addEventListener('input', (e) => { state.modalityDetail = e.target.value; saveState(); });
  el('metaStage').addEventListener('input', (e) => { state.evaluationStage = e.target.value; saveState(); renderProjectMetadata(); renderProjectPicker(); });
  el('metaModelVersion').addEventListener('input', (e) => { state.modelVersion = e.target.value; saveState(); renderProjectMetadata(); renderProjectPicker(); });
}

// 카드 접기/펼치기 (cutoff, ROI/Val/Test) — inline onclick="toggleCard(this)"에서 호출
function toggleCard(headerEl) {
  const card = headerEl.closest('.card.collapsible');
  if (card) card.classList.toggle('collapsed');
}

function toggleSection(btn) {
  const body = btn.closest('.section-wrap').querySelector('.section-bd');
  const isNowCollapsed = body.style.display !== 'none';
  body.style.display = isNowCollapsed ? 'none' : '';
  btn.textContent = isNowCollapsed ? '▼ 펼치기' : '▲ 접기';
}

const ROWHEAD_W = 180; const CELL_W = 90; const COMMENT_W = 220;
const CELL_MAX = 140;       // 셀이 너무 wide하게 stretch되지 않도록 cap
const COMMENT_MAX = 360;
function gridCols(nRoi, extraCols) {
  let s = `${ROWHEAD_W}px`;
  // ROI cell: 최소 CELL_W, 최대 CELL_MAX (와이드 모니터에서 과한 stretch 방지)
  for (let i = 0; i < nRoi; i++) s += ` minmax(${CELL_W}px, ${CELL_MAX}px)`;
  for (let i = 0; i < extraCols; i++) s += ` minmax(${COMMENT_W}px, ${COMMENT_MAX}px)`;
  return s;
}
function openGrid(nRoi, extraCols) { return `<div class="g" style="grid-template-columns:${gridCols(nRoi, extraCols)}">`; }

function renderCompletenessGrid() {
  const c = el('completenessGrid');
  const V = state.validations.length, R = state.rois.length;
  if (V === 0 || R === 0) return c.innerHTML = '<p class="p-4 text-slate-400 text-sm">Validation과 ROI를 먼저 추가하세요.</p>';
  const gtv = isGtvMode();

  const hint = el('completenessHint');
  if (hint) hint.textContent = gtv
    ? '각 셀에는 4-state(TP/FN/FP/TN)가 자동 표시됩니다. 셀 클릭 시 팝오버에서 Tumor 유무 / Missed / Hallucinated를 편집하세요. 입력 없는 셀은 default TP — Negative case는 그 환자의 셀만 Tumor=N으로 변경.'
    : '각 환자에서 ROI가 누락됐으면 체크하세요. (체크=누락, 빈칸=존재). xlsx에는 존재 셀이 - 로, 누락 셀이 빈칸으로 저장됩니다.';

  let html;
  if (gtv) {
    // GTV unified detection compact: ROI 1 column, cell에 4-state badge + (있을 때) annotation
    // 클릭 시 popover editor (필요한 셀만 missed/hallucinated 입력)
    html = openGrid(R, 1);
    html += `<div class="c h rh">PatientID</div>`;
    state.rois.forEach(roi => {
      html += `<div class="c h" title="${esc(roi)} · 셀 클릭으로 편집">${esc(roi)}</div>`;
    });
    html += `<div class="c h cm">Comment</div>`;

    const bins = COUNT_BINS;
    // Compact display: 셀에 4-state badge만, click 시 popover editor 노출
    state.validations.forEach((v, vi) => {
      html += `<div class="c rh">${esc(v)}</div>`;
      state.rois.forEach((roi, ri) => {
        const d = getDetection(vi, ri) || {};
        const m = d.missed || 'none';
        const h = d.hallucinated || 'none';
        const st = deriveDetectionState(d);
        const cls = st === 'TP' ? 'comp-tp' : st === 'FN' ? 'comp-fn' : st === 'FP' ? 'comp-fp' : 'comp-tn';
        // Compact badge: 상태 + (있을 때만) missed/hallucinated indicator
        const annots = [];
        if (m !== 'none') annots.push(`M:${COUNT_BIN_LABEL[m]}`);
        if (h !== 'none') annots.push(`H:${COUNT_BIN_LABEL[h]}`);
        const annotsHtml = annots.length ? `<span class="det-annots">${annots.join(' · ')}</span>` : '';
        const tip = `${st}${annots.length ? ' · ' + annots.join(', ') : ''} · 클릭하여 편집`;
        html += `<div class="c det-cell ${cls}" data-vi="${vi}" data-ri="${ri}" tabindex="0" role="button" title="${esc(tip)}">
          <span class="det-state">${st}</span>${annotsHtml}
        </div>`;
      });
      html += `<div class="c cm"><input type="text" data-vi="${vi}" class="comp-comment" value="${esc(state.completenessComment[vi] || '')}" /></div>`;
    });

    // Stats: 4-state count (per-ROI)
    GTV_COMPLETENESS_STATES.forEach(st => {
      html += `<div class="c rh stat">${st}</div>`;
      state.rois.forEach((_, ri) => {
        let n = 0; for (let vi = 0; vi < V; vi++) if (getCompState4(vi, ri) === st) n++;
        const cls = st === 'FN' ? 'fail' : st === 'TP' ? 'pass' : '';
        html += `<div class="c stat ${cls}">${n || ''}</div>`;
      });
      html += `<div class="c stat cm"></div>`;
    });
    // Miss rate
    html += `<div class="c rh stat">Miss rate</div>`;
    state.rois.forEach((_, ri) => {
      let tp = 0, fn = 0;
      for (let vi = 0; vi < V; vi++) {
        const s = getCompState4(vi, ri);
        if (s === 'TP') tp++; else if (s === 'FN') fn++;
      }
      const denom = tp + fn;
      html += `<div class="c stat">${denom ? ((fn/denom)*100).toFixed(0)+'%' : '-'}</div>`;
    });
    html += `<div class="c stat cm"></div>`;
    // Missed/Hallucinated bin 분포 합계 (Sprint 2-C 일부)
    ['missed', 'hallucinated'].forEach(key => {
      html += `<div class="c rh stat" style="font-size:10px;">${key === 'missed' ? 'Missed' : 'Hallu'} bins</div>`;
      state.rois.forEach((_, ri) => {
        const tally = { none: 0, few: 0, several: 0, many: 0 };
        for (let vi = 0; vi < V; vi++) tally[getDetectionBin(vi, ri, key)]++;
        const nonNone = tally.few + tally.several + tally.many;
        const text = nonNone === 0 ? '·' : `${tally.few}+${tally.several}+${tally.many}`;
        html += `<div class="c stat" style="font-size:10.5px;" title="None ${tally.none} · Few ${tally.few} · Several ${tally.several} · Many ${tally.many}">${text}</div>`;
      });
      html += `<div class="c stat cm"></div>`;
    });
    html += `</div>`;
  } else {
    // OAR mode (기존)
    html = openGrid(R, 1);
    html += `<div class="c h rh">PatientID</div>`;
    state.rois.forEach(roi => html += `<div class="c h">${esc(roi)}</div>`);
    html += `<div class="c h cm">Comment</div>`;
    state.validations.forEach((v, vi) => {
      html += `<div class="c rh">${esc(v)}</div>`;
      state.rois.forEach((roi, ri) => {
        const val = getCell(state.completeness, vi, ri);
        html += `<div class="c"><input type="checkbox" data-vi="${vi}" data-ri="${ri}" class="comp-chk" ${val ? 'checked' : ''} /></div>`;
      });
      html += `<div class="c cm"><input type="text" data-vi="${vi}" class="comp-comment" value="${esc(state.completenessComment[vi] || '')}" /></div>`;
    });
    html += `<div class="c rh stat">Count (missing)</div>`;
    state.rois.forEach((_, ri) => {
      let miss = 0; for (let vi = 0; vi < V; vi++) if (getCell(state.completeness, vi, ri)) miss++;
      html += `<div class="c stat">${miss}</div>`;
    });
    html += `<div class="c stat cm"></div><div class="c rh stat">Completeness</div>`;
    state.rois.forEach((_, ri) => {
      let miss = 0; for (let vi = 0; vi < V; vi++) if (getCell(state.completeness, vi, ri)) miss++;
      html += `<div class="c stat">${(V > 0 ? ((V - miss) / V) * 100 : 0).toFixed(0)}%</div>`;
    });
    html += `<div class="c stat cm"></div></div>`;
  }
  c.innerHTML = html;

  // OAR 체크박스
  c.querySelectorAll('.comp-chk').forEach(chk => {
    chk.onchange = (e) => {
      setCell(state.completeness, +e.target.dataset.vi, +e.target.dataset.ri, e.target.checked);
      saveState(); renderCompletenessGrid(); renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
    };
  });
  // GTV cell click → popover editor 열기 (compact mode, on-demand expand)
  c.querySelectorAll('.det-cell').forEach(cell => {
    cell.onclick = (e) => openDetectionEditor(+cell.dataset.vi, +cell.dataset.ri, cell);
    cell.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetectionEditor(+cell.dataset.vi, +cell.dataset.ri, cell); }
    };
  });
  c.querySelectorAll('.comp-comment').forEach(inp => { inp.oninput = (e) => { state.completenessComment[+e.target.dataset.vi] = e.target.value; saveState(); }; });
}

function validateScoreInput(val) {
  const s = val.trim();
  if (s === '') return { value: '', valid: true };
  if (['1','2','3','4','5'].includes(s)) return { value: s, valid: true };
  return { value: s, valid: false };
}

function renderUsabilityGrid() {
  const c = el('usabilityGrid');
  const V = state.validations.length, R = state.rois.length;
  if (V === 0 || R === 0) return c.innerHTML = '<p class="p-4 text-slate-400 text-sm">Validation과 ROI를 먼저 추가하세요.</p>';
  let html = openGrid(R, 1);
  html += `<div class="c h rh">PatientID</div>`;
  state.rois.forEach(roi => html += `<div class="c h">${esc(roi)}</div>`);
  html += `<div class="c h cm">Comment</div>`;
  state.validations.forEach((v, vi) => {
    html += `<div class="c rh">${esc(v)}</div>`;
    state.rois.forEach((roi, ri) => {
      if (isUnscoreable(vi, ri)) html += `<div class="c missing">❌</div>`;
      else {
        const sv = getCell(state.usability, vi, ri) || '';
        const sc = sv ? (+sv <= 2 ? ' score-low' : +sv === 3 ? ' score-mid' : '') : '';
        html += `<div class="c${sc}"><input type="text" inputmode="numeric" maxlength="1" data-vi="${vi}" data-ri="${ri}" class="us-inp" value="${esc(sv)}" placeholder="·" /></div>`;
      }
    });
    html += `<div class="c cm"><input type="text" data-vi="${vi}" class="us-comment" value="${esc(state.usabilityComment[vi] || '')}" /></div>`;
  });
  const stats = computeUsabilityStats();
  const statLabels = [
    ['Average', s => s.avg===null?'-':s.avg.toFixed(2), 'stat-avg'],
    ['Ratio (2점이하)', s => s.r2===null?'-':(s.r2*100).toFixed(0)+'%', 'stat-r2'],
    ['Ratio (3점이하)', s => s.r3===null?'-':(s.r3*100).toFixed(0)+'%', 'stat-r3']
  ];
  statLabels.forEach(([label, fn, cls]) => {
    html += `<div class="c rh stat">${label}</div>`;
    stats.forEach((s, ri) => html += `<div class="c stat ${cls}" data-ri="${ri}">${fn(s)}</div>`);
    html += `<div class="c stat cm"></div>`;
  });
  html += `<div class="c rh stat">Cutoff type</div>`;
  state.roiCutoffs.forEach(t => html += `<div class="c stat"><b>${esc(t)}</b></div>`);
  html += `<div class="c stat cm"></div><div class="c rh stat">PASS / FAIL</div>`;
  stats.forEach((s, ri) => html += `<div class="c stat stat-pass ${s.pass==='PASS'?'pass':s.pass==='FAIL'?'fail':''}" data-ri="${ri}">${s.pass||'-'}</div>`);
  html += `<div class="c stat cm"></div></div>`;
  c.innerHTML = html;
  c.querySelectorAll('.us-inp').forEach(inp => {
    inp.oninput = (e) => {
      const { value, valid } = validateScoreInput(e.target.value);
      e.target.classList.toggle('invalid-score', !valid && e.target.value.trim() !== '');
      if (valid) {
        setCell(state.usability, +e.target.dataset.vi, +e.target.dataset.ri, value); saveState();
        const div = e.target.parentElement;
        div.classList.remove('score-low', 'score-mid');
        if (value && +value <= 2) div.classList.add('score-low');
        else if (value && +value === 3) div.classList.add('score-mid');
        updateUsabilityStatsRow(); renderSpecsGrid(); renderSummaryView();
      }
    };
    inp.onkeydown = handleGridKeyNav;
  });
  c.querySelectorAll('.us-comment').forEach(inp => { inp.oninput = (e) => { state.usabilityComment[+e.target.dataset.vi] = e.target.value; saveState(); }; });
}

function updateUsabilityStatsRow() {
  const c = el('usabilityGrid'); if (!c) return;
  computeUsabilityStats().forEach((s, ri) => {
    const a = c.querySelector(`.stat-avg[data-ri="${ri}"]`), r2 = c.querySelector(`.stat-r2[data-ri="${ri}"]`), r3 = c.querySelector(`.stat-r3[data-ri="${ri}"]`), p = c.querySelector(`.stat-pass[data-ri="${ri}"]`);
    if (a) a.textContent = s.avg===null?'-':s.avg.toFixed(2);
    if (r2) r2.textContent = s.r2===null?'-':(s.r2*100).toFixed(0)+'%';
    if (r3) r3.textContent = s.r3===null?'-':(s.r3*100).toFixed(0)+'%';
    if (p) { p.textContent = s.pass||'-'; p.classList.remove('pass','fail'); if (s.pass) p.classList.add(s.pass.toLowerCase()); }
  });
}

function handleGridKeyNav(e) {
  const cells = Array.from(document.querySelectorAll('.' + e.target.classList[0]));
  const idx = cells.indexOf(e.target); if (idx === -1) return;
  let next = -1;
  if (e.key === 'Enter' || e.key === 'ArrowDown') { next = idx + state.rois.length; e.preventDefault(); }
  else if (e.key === 'ArrowUp') { next = idx - state.rois.length; e.preventDefault(); }
  else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) { next = idx + 1; e.preventDefault(); }
  else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) { next = idx - 1; e.preventDefault(); }
  if (next >= 0 && next < cells.length) cells[next].focus();
}

function computeUsabilityStats() {
  const V = state.validations.length;
  const gtv = isGtvMode();
  const subRates = gtv ? computeAggregateSubMetricRates() : null;
  // GTV mode: 한 번 미리 completeness stat을 가져옴 (sensitivity 등 계산)
  const compStats = gtv ? computeCompletenessStats() : null;
  return state.rois.map((_, ri) => {
    const scores = [];
    for (let vi = 0; vi < V; vi++) {
      if (isUnscoreable(vi, ri)) continue;
      const s = getCell(state.usability, vi, ri);
      if (s && !isNaN(+s)) scores.push(+s);
    }
    const cutoffType = state.roiCutoffs[ri] || 'A';
    const def = state.cutoffDefs[cutoffType];

    let avg = null, r2 = null, r3 = null;
    if (scores.length) {
      avg = scores.reduce((a,b)=>a+b,0)/scores.length;
      r2 = scores.filter(x=>x<=2).length/scores.length;
      r3 = scores.filter(x=>x<=3).length/scores.length;
    }

    // Pass logic — indication mode에 따라 분기
    let pass = null, passDetail = null;
    if (gtv) {
      passDetail = checkGtvPass(compStats[ri], { avg, r2, r3 }, subRates, def);
      pass = passDetail.overall ? 'PASS' : 'FAIL';
    } else {
      // OAR mode: 기존 로직
      if (!scores.length) pass = null;
      else pass = (avg >= def.avg && (def.rScore===2?r2:r3) <= def.ratio/100) ? 'PASS' : 'FAIL';
    }
    return { avg, r2, r3, pass, passDetail };
  });
}

function computeCompletenessStats() {
  const V = state.validations.length;
  const gtv = isGtvMode();
  return state.rois.map((_, ri) => {
    let miss = 0, tp = 0, fn = 0, fp = 0, tn = 0;
    let severeMissCount = 0;  // missed='many' count (only meaningful in GTV)
    for (let vi = 0; vi < V; vi++) {
      if (gtv) {
        const s = getCompState4(vi, ri);
        const d = getDetection(vi, ri) || {};
        if (s === 'TP') tp++;
        else if (s === 'FN') {
          fn++; miss++;
          if (d.missed === 'many') severeMissCount++;
        }
        else if (s === 'FP') fp++;
        else if (s === 'TN') tn++;
      } else {
        if (getCell(state.completeness, vi, ri)) miss++;
      }
    }
    let completeness;
    let sensitivity = null, fpRate = null;
    if (gtv) {
      const denomPos = tp + fn;  // tumor present cases
      const denomNeg = fp + tn;  // tumor absent cases
      completeness = denomPos ? tp / denomPos : 0;
      sensitivity = denomPos ? tp / denomPos : null;  // TP/(TP+FN)
      fpRate = denomNeg ? fp / denomNeg : null;        // FP/(FP+TN) = 1-Specificity
    } else {
      completeness = V > 0 ? (V - miss) / V : 0;
    }
    return { miss, total: V, completeness, tp, fn, fp, tn, sensitivity, fpRate, severeMissCount };
  });
}

// 전체 ROI 통합 sub-metric rate (체크된 ROI / 전체 ROI)
// Spec §2 note: "초기 구현은 binary 기반 (체크된 비율 cap)으로 시작 가능"
function computeAggregateSubMetricRates() {
  const R = state.rois.length;
  if (R === 0) return { significantMiss: 0, majorInclusion: 0, significantBoundary: 0, significantArtifact: 0 };
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let ri = 0; ri < R; ri++) {
    for (let ci = 0; ci < 4; ci++) {
      if (getCell(state.specs, ri, ci)) counts[ci]++;
    }
  }
  return {
    significantMiss:     counts[0] / R,  // ci 0 = Target coverage 체크 비율
    majorInclusion:      counts[1] / R,  // ci 1 = Non-target exclusion
    significantBoundary: counts[2] / R,  // ci 2 = Boundary accuracy
    significantArtifact: counts[3] / R,  // ci 3 = Smoothness
  };
}

// 3-dimension AND pass logic (GTV mode)
// Returns { overall, detection, quality, subMetric }
//   각 dimension: { pass: bool, fails: [readable reason strings] }
function checkGtvPass(comp, us, subRates, def) {
  const g = def?.gtv || GTV_CUTOFF_DEFAULTS.A;

  // Dimension 1: Detection
  const detFails = [];
  if (comp.sensitivity !== null && comp.sensitivity < g.sensitivityMin) {
    detFails.push(`Sensitivity ${(comp.sensitivity*100).toFixed(0)}% < ${(g.sensitivityMin*100).toFixed(0)}%`);
  }
  if (comp.fpRate !== null && comp.fpRate > g.fpRateMax) {
    detFails.push(`FP rate ${(comp.fpRate*100).toFixed(0)}% > ${(g.fpRateMax*100).toFixed(0)}%`);
  }
  if (comp.severeMissCount > g.severeMissAllowed) {
    detFails.push(`Severe miss (>5) ${comp.severeMissCount} > allowed ${g.severeMissAllowed}`);
  }
  const detection = { pass: detFails.length === 0, fails: detFails };

  // Dimension 2: Quality
  const qFails = [];
  if (us.avg !== null) {
    if (us.avg < def.avg) qFails.push(`Avg ${us.avg.toFixed(2)} < ${def.avg}`);
    const ratioObs = def.rScore === 2 ? us.r2 : us.r3;
    const ratioThr = def.ratio / 100;
    if (ratioObs !== null && ratioObs > ratioThr) {
      qFails.push(`Ratio (≤${def.rScore}점) ${(ratioObs*100).toFixed(0)}% > ${(ratioThr*100).toFixed(0)}%`);
    }
  } else {
    // No scoreable cases — quality undefined. Detection dimension만 의미.
    // GTV에서 모든 case가 FN/TN이면 usability가 없음. 그 경우 quality는 N/A로 pass 간주.
  }
  const quality = { pass: qFails.length === 0, fails: qFails };

  // Dimension 3: Sub-metric (aggregate across all ROIs)
  const smFails = [];
  if (subRates.significantMiss > g.significantMissRateMax) {
    smFails.push(`Sig miss ${(subRates.significantMiss*100).toFixed(0)}% > ${(g.significantMissRateMax*100).toFixed(0)}%`);
  }
  if (subRates.majorInclusion > g.majorInclusionRateMax) {
    smFails.push(`Major incl ${(subRates.majorInclusion*100).toFixed(0)}% > ${(g.majorInclusionRateMax*100).toFixed(0)}%`);
  }
  if (subRates.significantArtifact > g.significantArtifactRateMax) {
    smFails.push(`Sig artifact ${(subRates.significantArtifact*100).toFixed(0)}% > ${(g.significantArtifactRateMax*100).toFixed(0)}%`);
  }
  const subMetric = { pass: smFails.length === 0, fails: smFails };

  return {
    overall: detection.pass && quality.pass && subMetric.pass,
    detection, quality, subMetric,
  };
}

function renderVariantGrid() {
  const c = el('variantGrid'); const T = state.tests.length, R = state.rois.length;
  if (T === 0 || R === 0) return c.innerHTML = '<p class="p-4 text-slate-400 text-sm">Test 환자와 ROI를 먼저 추가하세요.</p>';
  let html = openGrid(R, 1);
  html += `<div class="c h rh">PatientID</div>`; state.rois.forEach(roi => html += `<div class="c h">${esc(roi)}</div>`); html += `<div class="c h cm">Comment</div>`;
  state.tests.forEach((t, ti) => {
    html += `<div class="c rh">${esc(t)}</div>`;
    state.rois.forEach((roi, ri) => {
      const s = getCell(state.variant, ti, ri) || '';
      const sc = s && s !== '❌' ? (+s <= 2 ? ' score-low' : +s === 3 ? ' score-mid' : '') : '';
      html += `<div class="c${sc}"><input type="text" maxlength="1" data-ti="${ti}" data-ri="${ri}" class="var-inp" value="${esc(s==='❌'?'❌':s)}" placeholder="·" /></div>`;
    });
    html += `<div class="c cm"><input type="text" data-ti="${ti}" class="var-comment" value="${esc(state.variantComment[ti] || '')}" /></div>`;
  });
  html += `<div class="c rh stat">Average</div>`;
  state.rois.forEach((_, ri) => {
    const scores = []; for (let ti = 0; ti < T; ti++) { const s = getCell(state.variant, ti, ri); if (s && !isNaN(+s)) scores.push(+s); }
    html += `<div class="c stat">${scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2) : '-'}</div>`;
  });
  html += `<div class="c stat cm"></div></div>`; c.innerHTML = html;
  c.querySelectorAll('.var-inp').forEach(inp => {
    inp.oninput = (e) => {
      const raw = e.target.value.trim(); let val = '', valid = true;
      if (raw === '') val = ''; else if (['1','2','3','4','5'].includes(raw)) val = raw; else if (raw.toLowerCase() === 'x' || raw === '❌') val = '❌'; else { valid = false; val = raw; }
      e.target.classList.toggle('invalid-score', !valid);
      if (valid) {
        if (val === '❌') e.target.value = '❌';
        setCell(state.variant, +e.target.dataset.ti, +e.target.dataset.ri, val); saveState();
        const div = e.target.parentElement;
        div.classList.remove('score-low', 'score-mid');
        if (val && val !== '❌' && +val <= 2) div.classList.add('score-low');
        else if (val && val !== '❌' && +val === 3) div.classList.add('score-mid');
      }
    };
    inp.onkeydown = handleGridKeyNav;
  });
  c.querySelectorAll('.var-comment').forEach(inp => { inp.oninput = (e) => { state.variantComment[+e.target.dataset.ti] = e.target.value; saveState(); }; });
}

function renderSpecsGrid() {
  const c = el('specsGrid'), R = state.rois.length;
  if (R === 0) return c.innerHTML = '<p class="p-4 text-slate-400 text-sm">ROI를 먼저 추가하세요.</p>';
  const CRITERIA = getCriteria();
  const us = computeUsabilityStats(), cp = computeCompletenessStats();
  const specCols = '180px 80px 80px 100px 100px ' + Array(CRITERIA.length).fill('minmax(110px,140px)').join(' ') + ' minmax(220px,320px) minmax(240px,320px)';
  let html = `<div class="g" style="grid-template-columns:${specCols}">`;
  html += `<div class="c h rh">ROI</div><div class="c h">Cutoff</div><div class="c h">Comp.</div><div class="c h">PASS/FAIL</div><div class="c h">Avg</div>`;
  CRITERIA.forEach(cr => html += `<div class="c h">${esc(cr)}</div>`);
  html += `<div class="c h cm">Comment</div><div class="c h cm">Improvement required</div>`;
  state.rois.forEach((roi, ri) => {
    const u = us[ri], imp = []; CRITERIA.forEach((cr, ci) => { if (getCell(state.specs, ri, ci)) imp.push(cr); });
    html += `<div class="c rh">${esc(roi)}</div><div class="c">${esc(state.roiCutoffs[ri])}</div><div class="c">${(cp[ri].completeness*100).toFixed(0)}%</div><div class="c ${u.pass==='PASS'?'pass':u.pass==='FAIL'?'fail':''}">${u.pass||'-'}</div><div class="c">${u.avg!==null?u.avg.toFixed(2):'-'}</div>`;
    CRITERIA.forEach((cr, ci) => {
      const chk = !!getCell(state.specs, ri, ci);
      html += `<div class="c"><label style="cursor:pointer;display:flex;align-items:center;gap:4px;"><input type="checkbox" data-ri="${ri}" data-ci="${ci}" class="spec-chk" ${chk?'checked':''} />${chk?`<span style="font-size:11px;color:#64748b;">(${Math.round(u.avg)})</span>`:''}</label></div>`;
    });
    html += `<div class="c cm"><input type="text" data-ri="${ri}" class="spec-comment" value="${esc(state.specsComment[ri] || '')}" /></div><div class="c cm" style="font-size:11px;">${esc(imp.join(', '))}</div>`;
  });
  html += `</div>`; c.innerHTML = html;
  c.querySelectorAll('.spec-chk').forEach(chk => { chk.onchange = (e) => { setCell(state.specs, +e.target.dataset.ri, +e.target.dataset.ci, e.target.checked); saveState(); renderSpecsGrid(); renderSummaryView(); }; });
  c.querySelectorAll('.spec-comment').forEach(inp => { inp.oninput = (e) => { state.specsComment[+e.target.dataset.ri] = e.target.value; saveState(); }; });
}

function renderSummaryView() {
  const c = el('summaryView'), us = computeUsabilityStats(), cp = computeCompletenessStats();
  const gtv = isGtvMode();
  const CRITERIA = getCriteria();
  let html = '<table class="summary-table"><thead><tr><th>ROI</th><th>Cutoff</th><th>PASS/FAIL</th><th>Avg</th><th>Ratio(≤2)</th><th>Ratio(≤3)</th>';
  if (gtv) html += '<th>Miss rate</th><th>FP count</th>';
  html += '<th>Completeness</th><th>Improvement</th></tr></thead><tbody>';
  state.rois.forEach((roi, ri) => {
    const u = us[ri], imp = CRITERIA.filter((_, ci) => getCell(state.specs, ri, ci));
    const cps = cp[ri];
    const barColor = u.pass === 'PASS' ? '#059669' : u.avg !== null && u.avg >= 3 ? '#d97706' : '#dc2626';
    const barWidth = u.avg !== null ? (u.avg / 5 * 100).toFixed(0) : 0;
    const avgCell = u.avg !== null
      ? `<div style="display:flex;align-items:center;gap:6px;justify-content:center;">${u.avg.toFixed(2)}<div class="prog-bar"><div class="prog-fill" style="width:${barWidth}%;background:${barColor}"></div></div></div>`
      : '-';
    let row = `<tr><td>${esc(roi)}</td><td><b>${state.roiCutoffs[ri]}</b></td><td class="${u.pass==='PASS'?'pass':u.pass==='FAIL'?'fail':''}">${u.pass||'-'}</td><td>${avgCell}</td><td>${u.r2!==null?(u.r2*100).toFixed(0)+'%':'-'}</td><td>${u.r3!==null?(u.r3*100).toFixed(0)+'%':'-'}</td>`;
    if (gtv) {
      const denom = cps.tp + cps.fn;
      const missRate = denom ? (cps.fn / denom * 100).toFixed(0) + '%' : '-';
      row += `<td class="${cps.fn > 0 ? 'fail' : ''}">${missRate}</td><td>${cps.fp || '-'}</td>`;
    }
    row += `<td>${(cps.completeness*100).toFixed(0)}%</td><td class="text-xs">${esc(imp.join(', '))}</td></tr>`;
    html += row;
  });
  html += '</tbody></table>';
  if (gtv) {
    // 전체 patient-level 집계 — positive & negative case 자연스럽게 섞여있음
    let totalFn = 0, totalFp = 0, totalTp = 0, totalTn = 0;
    cp.forEach(s => { totalFn += s.fn; totalFp += s.fp; totalTp += s.tp; totalTn += s.tn; });
    const overallMiss = (totalTp + totalFn) ? (totalFn / (totalTp + totalFn) * 100).toFixed(1) : '-';
    const totalN = totalFp + totalTn;
    const fpRate = totalN ? (totalFp / totalN * 100).toFixed(1) : '-';

    html += `<div class="gtv-summary-box">
      <div class="gtv-summary-title">GTV 전체 지표</div>
      <div class="gtv-summary-stats">
        <span class="stat-chip stat-tp"><span class="stat-label">TP</span><span class="stat-val">${totalTp}</span></span>
        <span class="stat-chip stat-fn"><span class="stat-label">FN <small>missed</small></span><span class="stat-val">${totalFn}</span></span>
        <span class="stat-chip stat-fp"><span class="stat-label">FP <small>spurious</small></span><span class="stat-val">${totalFp}</span></span>
        <span class="stat-chip stat-tn"><span class="stat-label">TN</span><span class="stat-val">${totalTn}</span></span>
        ${totalN > 0 ? `<span class="stat-chip"><span class="stat-label">FP rate <small>FP/(FP+TN)</small></span><span class="stat-val">${fpRate}%</span></span>` : ''}
        <span class="stat-chip stat-miss stat-emphasis"><span class="stat-label">Miss rate <small>FN/(FN+TP)</small></span><span class="stat-val">${overallMiss}%</span></span>
      </div>
    </div>`;

    // 3-dimension PASS/FAIL breakdown per ROI (Spec §4, §5)
    const anyHasDetail = us.some(u => u.passDetail);
    if (anyHasDetail) {
      html += `<div class="gtv-cutoff-box">
        <div class="gtv-cutoff-title">GTV 3-Dimension Cutoff (Detection · Quality · Sub-metric — AND logic)</div>
        <table class="summary-table cutoff-breakdown-table">
          <thead><tr><th>ROI</th><th>Type</th><th>Overall</th><th>Detection</th><th>Quality</th><th>Sub-metric</th></tr></thead>
          <tbody>`;
      state.rois.forEach((roi, ri) => {
        const detail = us[ri].passDetail; if (!detail) return;
        const cell = (dim) => {
          const okCls = dim.pass ? 'pass' : 'fail';
          const txt = dim.pass ? '✓' : '✗ ' + dim.fails.join(' · ');
          return `<td class="${okCls} cutoff-cell" title="${esc(dim.fails.join('; ') || 'pass')}">${esc(txt)}</td>`;
        };
        const overall = detail.overall ? 'pass' : 'fail';
        html += `<tr>
          <td><b>${esc(roi)}</b></td>
          <td>${state.roiCutoffs[ri]}</td>
          <td class="${overall}"><b>${detail.overall ? 'PASS' : 'FAIL'}</b></td>
          ${cell(detail.detection)}${cell(detail.quality)}${cell(detail.subMetric)}
        </tr>`;
      });
      html += `</tbody></table>
      <p class="text-xs text-slate-500 mt-2">Detection: sensitivity / FP rate / severe miss · Quality: usability avg + ratio · Sub-metric: aggregate sig miss / major incl / sig artifact</p>
      </div>`;
    }
  }
  html += `<div class="mt-4 text-sm"><p><b>Passed list:</b> <span class="text-green-700">${esc(state.rois.filter((_,ri)=>us[ri].pass==='PASS').join(', ') || '-')}</span></p><p><b>Failed list:</b> <span class="text-red-700">${esc(state.rois.filter((_,ri)=>us[ri].pass==='FAIL').join(', ') || '-')}</span></p></div>`;
  c.innerHTML = html;
}

function renderAll() {
  renderLists();
  renderProjectMetadata();
  renderSubMetricLabels();
  renderCompletenessGrid();
  renderUsabilityGrid();
  renderVariantGrid();
  renderSpecsGrid();
  renderSummaryView();
  // tooltip 갱신
  const anchor = el('usabilityAnchor');
  if (anchor) anchor.textContent = '1-5 anchor — ' + getUsabilityAnchor();
}

// Project metadata 카드 (modality / stage / version / negative flag) 동기화
function renderProjectMetadata() {
  const m = el('metaModality'); if (m) m.value = state.modality || '';
  const md = el('metaModalityDetail'); if (md) md.value = state.modalityDetail || '';
  const s = el('metaStage'); if (s) s.value = state.evaluationStage || '';
  const v = el('metaModelVersion'); if (v) v.value = state.modelVersion || '';
  const filled = [state.modality, state.evaluationStage, state.modelVersion].filter(x => x && x.trim()).length;
  const status = el('projectMetaStatus');
  if (status) status.textContent = filled > 0 ? `(${filled} 항목)` : '';
  const isOwner = (() => {
    if (!currentUser || !currentProjectId) return true;
    const entry = userProjects.find(p => p.id === currentProjectId);
    return !entry || entry.owner === currentUser.uid;
  })();
  ['metaModality', 'metaModalityDetail', 'metaStage', 'metaModelVersion'].forEach(id => {
    const elem = el(id);
    if (elem) elem.disabled = !isOwner || currentReadOnly;
  });
}

// Sub-metric 라벨 카드 동기화
function renderSubMetricLabels() {
  const defaults = getDefaultCriteria();
  const custom = state.subMetricLabels;
  const isCustom = Array.isArray(custom) && custom.some(c => typeof c === 'string' && c.trim());
  const status = el('subMetricStatus');
  if (status) status.textContent = isCustom ? '(사용자 정의)' : '';
  // owner 외에는 readonly
  const isOwner = (() => {
    if (!currentUser || !currentProjectId) return true; // 로컬 모드는 항상 가능
    const entry = userProjects.find(p => p.id === currentProjectId);
    if (!entry) return true;
    return entry.owner === currentUser.uid;
  })();
  document.querySelectorAll('.sub-metric-input').forEach((inp, i) => {
    const val = custom?.[i];
    inp.value = (typeof val === 'string') ? val : '';
    inp.placeholder = defaults[i] || '';
    inp.disabled = !isOwner || currentReadOnly;
  });
}

function applySubMetricLabel(idx, value) {
  const arr = Array.isArray(state.subMetricLabels) ? state.subMetricLabels.slice() : [null, null, null, null];
  while (arr.length < 4) arr.push(null);
  arr[idx] = (typeof value === 'string' && value.trim()) ? value.trim() : null;
  const allEmpty = arr.every(x => !x);
  state.subMetricLabels = allEmpty ? null : arr;
  saveState();
  renderAll();
}
function resetSubMetricLabels() {
  state.subMetricLabels = null;
  saveState();
  renderAll();
  toast('info', '기본 라벨로 초기화했습니다');
}

//==================== XLSX GENERATION (with Styles) ====================
function buildWorkbook() {
  const V = state.validations.length, R = state.rois.length, T = state.tests.length;
  const wb = XLSX.utils.book_new();

  // Excel Cell 생성 + 스타일 입히는 통합 헬퍼
  function setC(ws, ref, value, opts = {}) {
    if (value === null || value === undefined || value === '') return;
    const cell = {};
    if (opts.formula) {
      cell.t = opts.type || 'n'; cell.f = opts.formula;
      if (value !== '__formula__') cell.v = value;
    } else if (typeof value === 'number') {
      cell.t = 'n'; cell.v = value;
    } else {
      cell.t = 's'; cell.v = String(value);
    }

    // 기본 스타일: 테두리 얇게, 가운데 정렬
    let style = {
      font: { name: '맑은 고딕', sz: 10 },
      alignment: { vertical: 'center', horizontal: 'center' },
      border: {
        top: { style: 'thin', color: { auto: 1 } },
        bottom: { style: 'thin', color: { auto: 1 } },
        left: { style: 'thin', color: { auto: 1 } },
        right: { style: 'thin', color: { auto: 1 } }
      }
    };

    // Header 배경색 (연한 파랑/회색)
    if (opts.header) {
      style.fill = { fgColor: { rgb: "F1F5F9" } };
      style.font.bold = true;
    }
    // Row Header 배경색
    if (opts.rowHeader) {
      style.fill = { fgColor: { rgb: "F8FAFC" } };
      style.font.bold = true;
    }
    // PASS / FAIL 글자색 강조
    if (value === 'PASS' || opts.pass) {
      style.font.color = { rgb: "059669" };
      style.font.bold = true;
    }
    if (value === 'FAIL' || opts.fail) {
      style.font.color = { rgb: "DC2626" };
      style.font.bold = true;
    }
    if (value === '❌') {
      style.font.color = { rgb: "DC2626" };
    }
    
    // 왼쪽 정렬 예외 처리 (Comment 등)
    if (opts.alignLeft) style.alignment.horizontal = 'left';

    cell.s = style;
    ws[ref] = cell;
  }
  function updateRange(ws, cols, rows) { ws['!ref'] = `A1:${colLetter(cols)}${rows}`; }

  // ---------- Sheet: Cutoff ----------
  {
    const ws = {};
    setC(ws, 'A1', 'Cutoff type', { header: true }); setC(ws, 'B1', '평균 ( )점 이상', { header: true });
    setC(ws, 'C1', '( )점 이하가', { header: true }); setC(ws, 'D1', '( )% 이하', { header: true });
    CUTOFF_TYPES.forEach((t, i) => {
      const d = state.cutoffDefs[t];
      setC(ws, `A${i+2}`, t, { rowHeader: true }); setC(ws, `B${i+2}`, d.avg);
      setC(ws, `C${i+2}`, d.rScore); setC(ws, `D${i+2}`, d.ratio);
    });
    updateRange(ws, 4, 4); ws['!cols'] = [{wch:12},{wch:18},{wch:18},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'Cutoff');
  }

  // ---------- Sheet: A. Summary ----------
  {
    const ws = {};
    const h = ['ROI List', 'Cutoff type', 'Pass or Fail', 'Average of clinical usability score', 'Ratio (2점이하)', 'Ratio (3점이하)', 'Improvement required'];
    h.forEach((name, i) => setC(ws, `${colLetter(i+1)}1`, name, { header: true }));

    const usStats = computeUsabilityStats();
    for (let ri = 0; ri < R; ri++) {
      const r = ri + 2, col = colLetter(ri + 2);
      setC(ws, `A${r}`, state.rois[ri], { rowHeader: true });
      setC(ws, `B${r}`, state.roiCutoffs[ri], { rowHeader: true });
      
      const pass = usStats[ri].pass; 
      // formula 결과에 따라 동적 서식이 어려우므로 js에서 판별된 pass를 기반으로 서식 적용
      setC(ws, `C${r}`, '__formula__', { formula: `IF(AND($D${r}>=VLOOKUP($B${r},Cutoff!$A$2:$D$4,2,FALSE),IF(VLOOKUP($B${r},Cutoff!$A$2:$D$4,3,FALSE)=2,$E${r}*100,$F${r}*100)<=VLOOKUP($B${r},Cutoff!$A$2:$D$4,4,FALSE)),"PASS","FAIL")`, type: 's', pass: pass === 'PASS', fail: pass === 'FAIL' });
      
      setC(ws, `D${r}`, '__formula__', { formula: `'2. Clinical Usability'!${col}${V+2}`, type: 'n' });
      setC(ws, `E${r}`, '__formula__', { formula: `'2. Clinical Usability'!${col}${V+3}`, type: 'n' });
      setC(ws, `F${r}`, '__formula__', { formula: `'2. Clinical Usability'!${col}${V+4}`, type: 'n' });
      setC(ws, `G${r}`, '__formula__', { formula: `IF('3-6. Specifications'!J${r}="","", '3-6. Specifications'!J${r})`, type: 's' });
    }

    const cRow = R + 3;
    setC(ws, `A${cRow}`, 'Comment', { header: true }); setC(ws, `B${cRow}`, 'Passed list', { rowHeader: true });
    setC(ws, `C${cRow}`, state.rois.filter((_, ri) => usStats[ri].pass === 'PASS').join(', '), { pass: true, alignLeft: true });
    setC(ws, `B${cRow+1}`, 'Failed list', { rowHeader: true });
    setC(ws, `C${cRow+1}`, state.rois.filter((_, ri) => usStats[ri].pass === 'FAIL').join(', '), { fail: true, alignLeft: true });
    setC(ws, `B${cRow+2}`, '총평', { rowHeader: true }); setC(ws, `C${cRow+2}`, state.notionLink, { alignLeft: true });

    // Project metadata (modality / stage / version / negative)
    let mRow = cRow + 3;
    const metaItems = [
      ['Indication',     state.indicationCategory || 'OAR'],
      ['Modality',       state.modality + (state.modalityDetail ? ` (${state.modalityDetail})` : '') || '-'],
      ['Evaluation stage', state.evaluationStage || '-'],
      ['Model version',  state.modelVersion || '-'],
      ['Negative case set', state.isNegativeCaseProject ? 'YES (Pillar 3)' : '-'],
    ];
    const metaActive = metaItems.filter(([_, v]) => v && v !== '-');
    if (metaActive.length > 0) {
      setC(ws, `A${mRow}`, '모델 메타데이터', { header: true });
      metaItems.forEach(([k, v], i) => {
        setC(ws, `B${mRow + i}`, k, { rowHeader: true });
        setC(ws, `C${mRow + i}`, v || '-', { alignLeft: true });
      });
      mRow += metaItems.length;
    }

    // Reviewer-level note
    let extra = mRow - cRow - 3;
    if (currentUser?.email || state.reviewConfidence || state.reviewerComment) {
      setC(ws, `A${mRow}`, '평가자', { header: true });
      setC(ws, `B${mRow}`, 'Email', { rowHeader: true }); setC(ws, `C${mRow}`, currentUser?.email || '-', { alignLeft: true });
      setC(ws, `B${mRow+1}`, '케이스 난이도', { rowHeader: true }); setC(ws, `C${mRow+1}`, state.reviewConfidence ? state.reviewConfidence + '/5' : '-', { alignLeft: true });
      setC(ws, `B${mRow+2}`, '코멘트', { rowHeader: true }); setC(ws, `C${mRow+2}`, state.reviewerComment || '-', { alignLeft: true });
      extra += 3; mRow += 3;
    }

    // GTV 3-dimension breakdown (Sprint 6, Spec §5)
    if (gtvX) {
      setC(ws, `A${mRow}`, 'GTV 3-Dim Cutoff', { header: true });
      const hdrRow = mRow + 1;
      ['ROI', 'Type', 'Overall', 'Detection', 'Quality', 'Sub-metric'].forEach((h, i) => {
        setC(ws, `${colLetter(i+1)}${hdrRow}`, h, { rowHeader: true });
      });
      for (let ri = 0; ri < R; ri++) {
        const r = hdrRow + 1 + ri;
        const detail = usStats[ri].passDetail;
        if (!detail) continue;
        setC(ws, `A${r}`, state.rois[ri]);
        setC(ws, `B${r}`, state.roiCutoffs[ri]);
        setC(ws, `C${r}`, detail.overall ? 'PASS' : 'FAIL', detail.overall ? { pass: true } : { fail: true });
        setC(ws, `D${r}`, detail.detection.pass ? 'PASS' : ('FAIL: ' + detail.detection.fails.join('; ')), detail.detection.pass ? { pass: true } : { fail: true, alignLeft: true });
        setC(ws, `E${r}`, detail.quality.pass   ? 'PASS' : ('FAIL: ' + detail.quality.fails.join('; ')),   detail.quality.pass   ? { pass: true } : { fail: true, alignLeft: true });
        setC(ws, `F${r}`, detail.subMetric.pass ? 'PASS' : ('FAIL: ' + detail.subMetric.fails.join('; ')), detail.subMetric.pass ? { pass: true } : { fail: true, alignLeft: true });
      }
      extra += 1 + 1 + R;
    }

    updateRange(ws, 7, cRow + 2 + extra);
    ws['!cols'] = [{wch:18},{wch:12},{wch:14},{wch:38},{wch:16},{wch:16},{wch:40}];
    XLSX.utils.book_append_sheet(wb, ws, 'A. Summary');
  }

  // ---------- Sheet: B. Validation list ----------
  {
    const ws = {};
    setC(ws, 'A1', 'Patient NameList', { header: true }); setC(ws, 'B1', '7-8 Test Data', { header: true });
    setC(ws, 'D1', '전체모델 평가시 활용한 데이터 목록', { header: true }); setC(ws, 'D3', 'ROI List', { header: true });
    state.validations.forEach((v, i) => setC(ws, `A${i+2}`, v));
    state.tests.forEach((t, i) => setC(ws, `B${i+2}`, t));
    state.rois.forEach((r, i) => setC(ws, `D${i+4}`, r));
    updateRange(ws, 4, Math.max(V, T, R + 2) + 1); ws['!cols'] = [{wch:24},{wch:20},{wch:4},{wch:30}];
    XLSX.utils.book_append_sheet(wb, ws, 'B. Validation list');
  }

  // ---------- Helper for Grids ----------
  function makeDataSheet(name, rowList, dataObj, commentObj, renderCellFn, extraStatsFn) {
    const ws = {};
    setC(ws, 'A1', 'Patient Name', { header: true });
    state.rois.forEach((r, ri) => setC(ws, `${colLetter(ri+2)}1`, r, { header: true }));
    setC(ws, `${colLetter(R+2)}1`, 'Comment', { header: true });
    
    rowList.forEach((rv, vi) => {
      const r = vi + 2; setC(ws, `A${r}`, rv, { rowHeader: true });
      state.rois.forEach((roi, ri) => renderCellFn(ws, `${colLetter(ri+2)}${r}`, vi, ri));
      if (commentObj[vi]) setC(ws, `${colLetter(R+2)}${r}`, commentObj[vi], { alignLeft: true });
    });
    
    if (extraStatsFn) extraStatsFn(ws, rowList.length + 2);
    updateRange(ws, R + 2, rowList.length + 5);
    const cols = [{wch: 24}]; for(let i=0; i<R; i++) cols.push({wch: 14}); cols.push({wch: 32});
    ws['!cols'] = cols; XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const gtvX = isGtvMode();
  // Sheet 1: Completeness — OAR (blank/-) vs GTV (state + bin notation)
  function gtvCellLabel(vi, ri) {
    const st = getCompState4(vi, ri);
    const d = getDetection(vi, ri) || {};
    const m = d.missed || 'none';
    const h = d.hallucinated || 'none';
    const annots = [];
    if (m !== 'none') annots.push(`M:${COUNT_BIN_LABEL[m]}`);
    if (h !== 'none') annots.push(`H:${COUNT_BIN_LABEL[h]}`);
    return annots.length ? `${st} (${annots.join(', ')})` : st;
  }
  makeDataSheet('1. ROI Completeness', state.validations, state.completeness, state.completenessComment,
    (ws, ref, vi, ri) => {
      if (gtvX) setC(ws, ref, gtvCellLabel(vi, ri));
      else { if (!getCell(state.completeness, vi, ri)) setC(ws, ref, '-'); }
    },
    (ws, sr) => {
      if (gtvX) {
        // GTV: TP/FN/FP/TN count rows + miss rate + missed/hallucinated bin sums
        // 셀 값이 "TP" 또는 "FN (M:1-2)" 같은 형태라 wildcard로 COUNTIF
        GTV_COMPLETENESS_STATES.forEach((st, i) => {
          setC(ws, `A${sr+i}`, st, { rowHeader: true });
          state.rois.forEach((_, ri) => {
            const c = colLetter(ri+2);
            setC(ws, `${c}${sr+i}`, '__formula__', { formula: `COUNTIF(${c}2:${c}${V+1},"${st}*")`, type: 'n', rowHeader: true });
          });
        });
        const mr = sr + GTV_COMPLETENESS_STATES.length;
        setC(ws, `A${mr}`, 'Miss rate (FN/(TP+FN))', { rowHeader: true });
        state.rois.forEach((_, ri) => {
          const c = colLetter(ri+2);
          setC(ws, `${c}${mr}`, '__formula__', { formula: `IFERROR(COUNTIF(${c}2:${c}${V+1},"FN*")/(COUNTIF(${c}2:${c}${V+1},"TP*")+COUNTIF(${c}2:${c}${V+1},"FN*")),"")`, type: 'n', rowHeader: true });
        });
        // bin distribution (text 한 줄: "Few X / Several Y / Many Z")
        const missedRow = sr + GTV_COMPLETENESS_STATES.length + 1;
        const halluRow  = sr + GTV_COMPLETENESS_STATES.length + 2;
        setC(ws, `A${missedRow}`, 'Missed bins', { rowHeader: true });
        setC(ws, `A${halluRow}`,  'Hallucinated bins', { rowHeader: true });
        state.rois.forEach((_, ri) => {
          const c = colLetter(ri+2);
          ['missed', 'hallucinated'].forEach((key, idx) => {
            const row = idx === 0 ? missedRow : halluRow;
            const tally = { few: 0, several: 0, many: 0 };
            for (let vi = 0; vi < V; vi++) {
              const v = getDetectionBin(vi, ri, key);
              if (v in tally) tally[v]++;
            }
            const text = (tally.few + tally.several + tally.many) === 0 ? '-' : `Few ${tally.few} · Several ${tally.several} · Many ${tally.many}`;
            setC(ws, `${c}${row}`, text, { rowHeader: true });
          });
        });
      } else {
        setC(ws, `A${sr}`, 'Count (missing)', { rowHeader: true }); setC(ws, `A${sr+1}`, 'Completeness', { rowHeader: true });
        state.rois.forEach((_, ri) => {
          const c = colLetter(ri+2);
          setC(ws, `${c}${sr}`, '__formula__', { formula: `COUNTBLANK(${c}2:${c}${V+1})`, type: 'n', rowHeader: true });
          setC(ws, `${c}${sr+1}`, '__formula__', { formula: `(1-COUNTBLANK(${c}2:${c}${V+1})/ROWS(${c}2:${c}${V+1}))`, type: 'n', rowHeader: true });
        });
      }
    }
  );

  makeDataSheet('2. Clinical Usability', state.validations, state.usability, state.usabilityComment,
    (ws, ref, vi, ri) => {
      if (isUnscoreable(vi, ri)) setC(ws, ref, '❌');
      else { const s = getCell(state.usability, vi, ri); if (s && !isNaN(+s)) setC(ws, ref, +s); }
    },
    (ws, sr) => {
      const labels = ['Average', 'Ratio (2점이하)', 'Ratio (3점이하)', 'Cutoff type', 'PASS/FAIL'];
      labels.forEach((L, i) => setC(ws, `A${sr+i}`, L, { rowHeader: true }));
      state.rois.forEach((_, ri) => {
        const c = colLetter(ri+2), rg = `${c}$2:${c}$${V+1}`;
        setC(ws, `${c}${sr}`, '__formula__', { formula: `IFERROR(AVERAGE(${rg}),"")`, type: 'n', rowHeader: true });
        setC(ws, `${c}${sr+1}`, '__formula__', { formula: `IFERROR((COUNTIF(${rg},1)+COUNTIF(${rg},2))/COUNT(${rg}),"")`, type: 'n', rowHeader: true });
        setC(ws, `${c}${sr+2}`, '__formula__', { formula: `IFERROR((COUNTIF(${rg},1)+COUNTIF(${rg},2)+COUNTIF(${rg},3))/COUNT(${rg}),"")`, type: 'n', rowHeader: true });
        setC(ws, `${c}${sr+3}`, '__formula__', { formula: `'A. Summary'!B${ri+2}`, type: 's', rowHeader: true });
        setC(ws, `${c}${sr+4}`, '__formula__', { formula: `'A. Summary'!C${ri+2}`, type: 's', rowHeader: true });
      });
    }
  );

  makeDataSheet('3. ROI Variant', state.tests, state.variant, state.variantComment,
    (ws, ref, ti, ri) => {
      const s = getCell(state.variant, ti, ri);
      if (s === '❌') setC(ws, ref, '❌'); else if (s && !isNaN(+s)) setC(ws, ref, +s);
    },
    (ws, sr) => {
      setC(ws, `A${sr}`, 'Average', { rowHeader: true });
      state.rois.forEach((_, ri) => setC(ws, `${colLetter(ri+2)}${sr}`, '__formula__', { formula: `IFERROR(AVERAGE(${colLetter(ri+2)}$2:${colLetter(ri+2)}${T+1}),"")`, type: 'n', rowHeader: true }));
    }
  );

  // ---------- Sheet: 3-6. Specifications ----------
  {
    const ws = {};
    const CRITERIA = getCriteria();
    const hd = ['ROI', 'Cutoff type', 'Completeness', 'PASS/FAIL', 'Avg (rounded)', ...CRITERIA, 'Comment', 'Improvement required'];
    hd.forEach((n, i) => setC(ws, `${colLetter(i+1)}1`, n, { header: true }));

    for (let ri = 0; ri < R; ri++) {
      const r = ri + 2;
      setC(ws, `A${r}`, state.rois[ri], { rowHeader: true }); setC(ws, `B${r}`, state.roiCutoffs[ri]);
      setC(ws, `C${r}`, '__formula__', { formula: `'1. ROI Completeness'!${colLetter(ri+2)}${V+3}`, type: 'n' });
      setC(ws, `D${r}`, '__formula__', { formula: `'A. Summary'!C${ri+2}`, type: 's' });
      setC(ws, `E${r}`, '__formula__', { formula: `IFERROR(ROUND('A. Summary'!D${ri+2},0),"")`, type: 'n' });
      CRITERIA.forEach((cr, ci) => {
        if (getCell(state.specs, ri, ci)) setC(ws, `${colLetter(6+ci)}${r}`, '__formula__', { formula: `IFERROR(ROUND('A. Summary'!D${ri+2},0),"")`, type: 'n' });
      });
      if (state.specsComment[ri]) setC(ws, `${colLetter(6+CRITERIA.length)}${r}`, state.specsComment[ri], { alignLeft: true });
      const flg = CRITERIA.filter((_, ci) => getCell(state.specs, ri, ci));
      if (flg.length) setC(ws, `${colLetter(7+CRITERIA.length)}${r}`, flg.join(', '), { alignLeft: true });
    }
    updateRange(ws, 7 + CRITERIA.length, R + 1);
    const cols = [{wch:18},{wch:10},{wch:14},{wch:10},{wch:12}, ...CRITERIA.map(()=>({wch:18})), {wch:24}, {wch:30}];
    ws['!cols'] = cols; XLSX.utils.book_append_sheet(wb, ws, '3-6. Specifications');
  }

  return wb;
}

function downloadXLSX() {
  const V = state.validations.length, R = state.rois.length;
  const incomplete = [];
  for (let vi = 0; vi < V; vi++) {
    for (let ri = 0; ri < R; ri++) {
      if (!getCell(state.completeness, vi, ri) && !getCell(state.usability, vi, ri))
        incomplete.push(`${state.validations[vi]} / ${state.rois[ri]}`);
    }
  }
  if (incomplete.length > 0) {
    const preview = incomplete.slice(0, 5).join('\n') + (incomplete.length > 5 ? `\n...외 ${incomplete.length - 5}개` : '');
    if (!confirm(`Usability 점수가 비어있는 셀 ${incomplete.length}개:\n\n${preview}\n\n그래도 다운로드할까요?`)) return;
  }
  const wb = buildWorkbook();
  const fname = (state.projectName || 'CQA_Result').replace(/[^\w.\-\uAC00-\uD7A3]+/g, '_') + '.xlsx';
  XLSX.writeFile(wb, fname);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = (state.projectName || 'CQA_Result') + '.json'; a.click(); URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      state = JSON.parse(e.target.result);
      const def = defaultState(); for (const k of Object.keys(def)) if (!(k in state)) state[k] = def[k];
      if (!state.roiCutoffs) state.roiCutoffs = state.rois.map(() => 'A');
      while (state.roiCutoffs.length < state.rois.length) state.roiCutoffs.push('A');
      saveState(); renderAll();
    } catch (err) { toast('error', 'JSON 파싱 실패: ' + err.message); }
  };
  reader.readAsText(file);
}

//==================== MARKDOWN COPY ====================
function toMdTable(headers, rows) {
  const escape = s => String(s ?? '').replace(/\|/g, '\\|');
  return [
    '| ' + headers.map(escape).join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map(r => '| ' + r.map(escape).join(' | ') + ' |')
  ].join('\n');
}

function generateMdCompleteness() {
  const V = state.validations.length, R = state.rois.length;
  if (!V || !R) return '';
  const gtv = isGtvMode();
  const headers = ['PatientID', ...state.rois, 'Comment'];
  const rows = state.validations.map((v, vi) => [
    v,
    ...state.rois.map((_, ri) => {
      if (gtv) {
        const st = getCompState4(vi, ri);
        const d = getDetection(vi, ri) || {};
        const m = d.missed || 'none', h = d.hallucinated || 'none';
        const tag = [];
        if (m !== 'none') tag.push(`M:${COUNT_BIN_LABEL[m]}`);
        if (h !== 'none') tag.push(`H:${COUNT_BIN_LABEL[h]}`);
        return tag.length ? `${st} (${tag.join(', ')})` : st;
      }
      const c = getCell(state.completeness, vi, ri);
      return c ? '' : '-';
    }),
    state.completenessComment[vi] || ''
  ]);
  if (gtv) {
    GTV_COMPLETENESS_STATES.forEach(st => {
      const counts = state.rois.map((_, ri) => {
        let n = 0; for (let vi = 0; vi < V; vi++) if (getCompState4(vi, ri) === st) n++;
        return String(n);
      });
      rows.push([`**${st}**`, ...counts, '']);
    });
    const missRates = state.rois.map((_, ri) => {
      let tp = 0, fn = 0;
      for (let vi = 0; vi < V; vi++) {
        const s = getCompState4(vi, ri);
        if (s === 'TP') tp++; else if (s === 'FN') fn++;
      }
      return (tp+fn) ? (fn/(tp+fn)*100).toFixed(0)+'%' : '-';
    });
    rows.push(['**Miss rate**', ...missRates, '']);
    // Bin distribution rows
    ['missed', 'hallucinated'].forEach(key => {
      const label = key === 'missed' ? '**Missed bins**' : '**Hallu bins**';
      const cells = state.rois.map((_, ri) => {
        const tally = { few: 0, several: 0, many: 0 };
        for (let vi = 0; vi < V; vi++) {
          const b = getDetectionBin(vi, ri, key);
          if (b in tally) tally[b]++;
        }
        return (tally.few + tally.several + tally.many) === 0 ? '-' : `${tally.few}/${tally.several}/${tally.many}`;
      });
      rows.push([label, ...cells, key === 'missed' ? '(1-2 / 3-5 / >5)' : '(1-2 / 3-5 / >5)']);
    });
  } else {
    const missCounts = state.rois.map((_, ri) => {
      let miss = 0; for (let vi = 0; vi < V; vi++) if (getCell(state.completeness, vi, ri)) miss++;
      return miss;
    });
    rows.push(['**Count (missing)**', ...missCounts.map(String), '']);
    rows.push(['**Completeness**', ...missCounts.map(m => ((V - m) / V * 100).toFixed(0) + '%'), '']);
  }
  return toMdTable(headers, rows);
}

function generateMdUsability() {
  const V = state.validations.length, R = state.rois.length;
  if (!V || !R) return '';
  const headers = ['PatientID', ...state.rois, 'Comment'];
  const rows = state.validations.map((v, vi) => [
    v,
    ...state.rois.map((_, ri) => isUnscoreable(vi, ri) ? '❌' : (getCell(state.usability, vi, ri) || '')),
    state.usabilityComment[vi] || ''
  ]);
  const stats = computeUsabilityStats();
  rows.push(['**Average**', ...stats.map(s => s.avg !== null ? s.avg.toFixed(2) : '-'), '']);
  rows.push(['**Ratio (≤2)**', ...stats.map(s => s.r2 !== null ? (s.r2 * 100).toFixed(0) + '%' : '-'), '']);
  rows.push(['**Ratio (≤3)**', ...stats.map(s => s.r3 !== null ? (s.r3 * 100).toFixed(0) + '%' : '-'), '']);
  rows.push(['**Cutoff type**', ...state.roiCutoffs, '']);
  rows.push(['**PASS / FAIL**', ...stats.map(s => s.pass || '-'), '']);
  return toMdTable(headers, rows);
}

function generateMdVariant() {
  const T = state.tests.length, R = state.rois.length;
  if (!T || !R) return '';
  const headers = ['PatientID', ...state.rois, 'Comment'];
  const rows = state.tests.map((t, ti) => [
    t,
    ...state.rois.map((_, ri) => getCell(state.variant, ti, ri) || ''),
    state.variantComment[ti] || ''
  ]);
  const avgs = state.rois.map((_, ri) => {
    const scores = []; for (let ti = 0; ti < T; ti++) { const s = getCell(state.variant, ti, ri); if (s && !isNaN(+s)) scores.push(+s); }
    return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '-';
  });
  rows.push(['**Average**', ...avgs, '']);
  return toMdTable(headers, rows);
}

function generateMdSpecs() {
  const R = state.rois.length;
  if (!R) return '';
  const CRITERIA = getCriteria();
  const us = computeUsabilityStats(), cp = computeCompletenessStats();
  const headers = ['ROI', 'Cutoff', 'Comp.', 'PASS/FAIL', 'Avg', ...CRITERIA, 'Comment', 'Improvement required'];
  const rows = state.rois.map((roi, ri) => {
    const u = us[ri];
    const imp = CRITERIA.filter((_, ci) => getCell(state.specs, ri, ci));
    return [
      roi,
      state.roiCutoffs[ri],
      (cp[ri].completeness * 100).toFixed(0) + '%',
      u.pass || '-',
      u.avg !== null ? u.avg.toFixed(2) : '-',
      ...CRITERIA.map((_, ci) => getCell(state.specs, ri, ci) ? String(Math.round(u.avg)) : ''),
      state.specsComment[ri] || '',
      imp.join(', ')
    ];
  });
  return toMdTable(headers, rows);
}

function generateMdSummary() {
  const us = computeUsabilityStats(), cp = computeCompletenessStats();
  const headers = ['ROI', 'Cutoff', 'PASS/FAIL', 'Avg', 'Ratio(≤2)', 'Ratio(≤3)', 'Completeness', 'Improvement'];
  const rows = state.rois.map((roi, ri) => {
    const u = us[ri];
    const imp = CRITERIA.filter((_, ci) => getCell(state.specs, ri, ci));
    return [
      roi, state.roiCutoffs[ri], u.pass || '-',
      u.avg !== null ? u.avg.toFixed(2) : '-',
      u.r2 !== null ? (u.r2 * 100).toFixed(0) + '%' : '-',
      u.r3 !== null ? (u.r3 * 100).toFixed(0) + '%' : '-',
      (cp[ri].completeness * 100).toFixed(0) + '%',
      imp.join(', ')
    ];
  });
  const passed = state.rois.filter((_, ri) => us[ri].pass === 'PASS').join(', ') || '-';
  const failed = state.rois.filter((_, ri) => us[ri].pass === 'FAIL').join(', ') || '-';
  let md = toMdTable(headers, rows);
  md += `\n\n**Passed list:** ${passed}\n**Failed list:** ${failed}`;
  if (state.notionLink) md += `\n**총평:** ${state.notionLink}`;
  return md;
}

function generateMdReviewerNote() {
  const hasAny = currentUser?.email || state.reviewConfidence || state.reviewerComment;
  if (!hasAny) return '';
  const lines = [];
  if (currentUser?.email) lines.push(`- **평가자:** ${currentUser.email}`);
  if (state.reviewConfidence) lines.push(`- **케이스 난이도:** ${state.reviewConfidence} / 5`);
  if (state.reviewerComment) lines.push(`- **코멘트:** ${state.reviewerComment}`);
  return lines.join('\n');
}

function generateMdAll() {
  const sections = [
    ['## 📝 평가자 노트', generateMdReviewerNote()],
    ['## 1. ROI Completeness', generateMdCompleteness()],
    ['## 2. Clinical Usability', generateMdUsability()],
    ['## 7-8. Variant cases', generateMdVariant()],
    ['## 3-6. Specifications', generateMdSpecs()],
    ['## A. Summary', generateMdSummary()],
  ];
  return sections.filter(s => s[1]).map(s => `${s[0]}\n\n${s[1]}`).join('\n\n---\n\n');
}

async function clipboardWrite(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:0;outline:0;opacity:0;';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

async function copyTabMd(tab) {
  const generators = {
    completeness: generateMdCompleteness,
    usability: generateMdUsability,
    variant: generateMdVariant,
    specs: generateMdSpecs,
    summary: generateMdSummary
  };
  const md = generators[tab]?.();
  if (!md) { toast('warning', '복사할 데이터가 없습니다.'); return; }
  const btn = document.querySelector(`#section-${tab} .copy-md-btn`);
  const ok = await clipboardWrite(md);
  if (btn) {
    btn.textContent = ok ? '✅ 복사됨' : '❌ 복사 실패'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋 MD 복사'; btn.classList.remove('copied'); }, 1500);
  }
  if (!ok) toast('error', '클립보드 복사에 실패했습니다. 브라우저 권한을 확인하세요.');
}

//==================== PDF EXPORT ====================
function exportPDF() {
  const selected = Array.from(document.querySelectorAll('.pdf-chk:checked'))
    .map(cb => cb.closest('.section-wrap').dataset.section);
  if (!selected.length) { toast('warning', 'PDF에 포함할 섹션을 하나 이상 체크하세요.'); return; }

  const e = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function tbl(headers, rows) {
    const head = '<tr>' + headers.map(h => `<th>${e(h)}</th>`).join('') + '</tr>';
    const body = rows.map(r => '<tr>' + r.map(c => {
      const cls = c === 'PASS' ? ' class="pass"' : c === 'FAIL' ? ' class="fail"' : '';
      return `<td${cls}>${e(c)}</td>`;
    }).join('') + '</tr>').join('');
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  const V = state.validations.length, R = state.rois.length, T = state.tests.length;
  const sections = [];

  if (selected.includes('completeness') && V && R) {
    const headers = ['PatientID', ...state.rois, 'Comment'];
    const rows = state.validations.map((v, vi) => [v, ...state.rois.map((_, ri) => getCell(state.completeness, vi, ri) ? '' : '-'), state.completenessComment[vi] || '']);
    const miss = state.rois.map((_, ri) => { let m=0; for(let vi=0;vi<V;vi++) if(getCell(state.completeness,vi,ri)) m++; return m; });
    rows.push(['Count (missing)', ...miss.map(String), '']);
    rows.push(['Completeness', ...miss.map(m => ((V-m)/V*100).toFixed(0)+'%'), '']);
    sections.push(`<section><h2>1. ROI Completeness</h2>${tbl(headers, rows)}</section>`);
  }

  if (selected.includes('usability') && V && R) {
    const headers = ['PatientID', ...state.rois, 'Comment'];
    const rows = state.validations.map((v, vi) => [v, ...state.rois.map((_, ri) => getCell(state.completeness,vi,ri) ? '❌' : (getCell(state.usability,vi,ri)||'')), state.usabilityComment[vi]||'']);
    const stats = computeUsabilityStats();
    rows.push(['Average', ...stats.map(s => s.avg!==null?s.avg.toFixed(2):'-'), '']);
    rows.push(['Ratio (≤2)', ...stats.map(s => s.r2!==null?(s.r2*100).toFixed(0)+'%':'-'), '']);
    rows.push(['Ratio (≤3)', ...stats.map(s => s.r3!==null?(s.r3*100).toFixed(0)+'%':'-'), '']);
    rows.push(['Cutoff type', ...state.roiCutoffs, '']);
    rows.push(['PASS / FAIL', ...stats.map(s => s.pass||'-'), '']);
    sections.push(`<section><h2>2. Clinical Usability</h2>${tbl(headers, rows)}</section>`);
  }

  if (selected.includes('variant') && T && R) {
    const headers = ['PatientID', ...state.rois, 'Comment'];
    const rows = state.tests.map((t, ti) => [t, ...state.rois.map((_, ri) => getCell(state.variant,ti,ri)||''), state.variantComment[ti]||'']);
    const avgs = state.rois.map((_, ri) => { const sc=[]; for(let ti=0;ti<T;ti++){const s=getCell(state.variant,ti,ri);if(s&&!isNaN(+s))sc.push(+s);} return sc.length?(sc.reduce((a,b)=>a+b,0)/sc.length).toFixed(2):'-'; });
    rows.push(['Average', ...avgs, '']);
    sections.push(`<section><h2>7-8. Variant cases</h2>${tbl(headers, rows)}</section>`);
  }

  if (selected.includes('specs') && R) {
    const CRITERIA = getCriteria();
    const us = computeUsabilityStats(), cp = computeCompletenessStats();
    const headers = ['ROI', 'Cutoff', 'Comp.', 'PASS/FAIL', 'Avg', ...CRITERIA, 'Comment', 'Improvement required'];
    const rows = state.rois.map((roi, ri) => {
      const u = us[ri], imp = CRITERIA.filter((_, ci) => getCell(state.specs,ri,ci));
      return [roi, state.roiCutoffs[ri], (cp[ri].completeness*100).toFixed(0)+'%', u.pass||'-', u.avg!==null?u.avg.toFixed(2):'-', ...CRITERIA.map((_,ci) => getCell(state.specs,ri,ci)?String(Math.round(u.avg)):''), state.specsComment[ri]||'', imp.join(', ')];
    });
    sections.push(`<section><h2>3-6. Specifications</h2>${tbl(headers, rows)}</section>`);
  }

  if (selected.includes('summary')) {
    const CRITERIA = getCriteria();
    const us = computeUsabilityStats(), cp = computeCompletenessStats();
    const headers = ['ROI', 'Cutoff', 'PASS/FAIL', 'Avg', 'Ratio(≤2)', 'Ratio(≤3)', 'Completeness', 'Improvement'];
    const rows = state.rois.map((roi, ri) => {
      const u = us[ri], imp = CRITERIA.filter((_,ci) => getCell(state.specs,ri,ci));
      return [roi, state.roiCutoffs[ri], u.pass||'-', u.avg!==null?u.avg.toFixed(2):'-', u.r2!==null?(u.r2*100).toFixed(0)+'%':'-', u.r3!==null?(u.r3*100).toFixed(0)+'%':'-', (cp[ri].completeness*100).toFixed(0)+'%', imp.join(', ')];
    });
    const passed = state.rois.filter((_,ri) => us[ri].pass==='PASS').join(', ')||'-';
    const failed = state.rois.filter((_,ri) => us[ri].pass==='FAIL').join(', ')||'-';
    sections.push(`<section><h2>A. Summary</h2>${tbl(headers, rows)}<p><b>Passed:</b> <span class="pass">${e(passed)}</span></p><p><b>Failed:</b> <span class="fail">${e(failed)}</span></p>${state.notionLink?`<p><b>총평:</b> ${e(state.notionLink)}</p>`:''}</section>`);
  }

  if (!sections.length) { toast('warning', '선택한 섹션에 출력할 데이터가 없습니다.'); return; }

  const area = document.getElementById('pdf-print-area');
  area.innerHTML = `
    <h1>${e(state.projectName)} — CQA Report</h1>
    <div class="pdf-meta">${new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'})}</div>
    ${sections.join('\n')}
  `;
  window.print();
}

function init() {
  renderLists(); setupAddForms(); renderAll();
  el('btnDownload').onclick = downloadXLSX; el('btnSave').onclick = exportJSON;
  el('btnLoad').onclick = () => el('fileInput').click();
  el('fileInput').onchange = (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); };
  el('btnClear').onclick = () => {
    const scope = currentUser && currentProjectId
      ? '현재 모델의 내 평가 데이터를 초기화할까요? (다른 평가자의 데이터와 모델 설정은 유지됩니다)'
      : '모든 입력을 초기화할까요? (localStorage 포함)';
    if (!confirm(scope)) return;
    if (currentUser && currentProjectId) {
      REVIEW_KEYS.forEach(k => { state[k] = {}; });
      saveState(); renderAll();
    } else {
      localStorage.removeItem(LS_KEY); state = defaultState(); saveState(); renderAll();
    }
  };
  el('btnCopyAll').onclick = async () => {
    const md = generateMdAll();
    if (!md) { toast('warning', '복사할 데이터가 없습니다.'); return; }
    const btn = el('btnCopyAll');
    const ok = await clipboardWrite(md);
    btn.textContent = ok ? '✅ 복사됨' : '❌ 복사 실패';
    setTimeout(() => { btn.textContent = '📋 전체 MD 복사'; }, 1500);
    if (!ok) toast('error', '클립보드 복사에 실패했습니다. 브라우저 권한을 확인하세요.');
  };
  el('btnExportPdf').onclick = exportPDF;

  // 사이드바 토글
  el('btnSidebarToggle').onclick = toggleSidebar;
  el('btnSidebarOpen').onclick = toggleSidebar;
  try {
    if (localStorage.getItem('cqa_sidebar_collapsed') === '1') {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch(e) {}

  // 테마 토글 (초기값은 head에서 이미 적용됨)
  el('btnTheme').onclick = toggleTheme;
  syncThemeButtonTitle();

  // 클라우드 / 인증 wiring
  el('btnSignIn').onclick = handleSignIn;
  el('btnSignOut').onclick = handleSignOut;
  el('btnNewProject').onclick = async () => {
    if (!currentUser) return;
    const name = prompt('새 모델명을 입력하세요:', 'New Model');
    if (!name) return;
    if (pendingDirty) await flushCloudSave();
    const projectId = await createCloudProject(name, false);
    const [projects, legacies] = await Promise.all([fetchUserProjects(), fetchLegacyEvaluations()]);
    userProjects = [...projects, ...legacies];
    renderProjectPicker();
    await loadProjectFromCloud(projectId);
  };
  el('btnJoinProject').onclick = async () => {
    if (!currentUser) return;
    const projectId = prompt('참여할 모델 ID를 입력하세요:');
    if (!projectId) return;
    if (pendingDirty) await flushCloudSave();
    await joinCloudProject(projectId.trim());
  };

  window.addEventListener('beforeunload', () => {
    if (pendingDirty) { try { flushCloudSave(); } catch(e) {} }
  });

  initFirebase();
}

window.addEventListener('DOMContentLoaded', init);