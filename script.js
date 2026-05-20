//==================== STATE ====================
const LS_KEY = 'cqa_input_tool_v2';
const LAST_PROJECT_LS_KEY = (uid) => `cqa_last_project_${uid}`;
const SCHEMA_VERSION = 1;
const CRITERIA_OAR = ['3. Anatomical accuracy', '4. Over-segmentation', '5. Under-segmentation', '6. Smoothness'];
const CRITERIA_GBM = ['3. Target coverage', '4. Non-target exclusion', '5. Boundary accuracy', '6. Smoothness / technical'];
const CRITERIA_LIVERMETS = ['3. Per-lesion coverage', '4. Lesion count completeness', '5. Non-target exclusion', '6. Boundary + smoothness'];
const CRITERIA_CERVIX = ['3. Primary tumor coverage', '4. Parametrial / vaginal extension', '5. Non-target exclusion', '6. Boundary + smoothness'];
// 호환성: 일부 외부 참조용. 신규 코드는 getCriteria() 사용
const CRITERIA = CRITERIA_OAR;
const CUTOFF_TYPES = ['A', 'B', 'C'];
const REVIEW_KEYS = ['completeness', 'completenessComment', 'usability', 'usabilityComment', 'variant', 'variantComment', 'specs', 'specsComment', 'patientMeta', 'testMeta'];
const GTV_COMPLETENESS_STATES = ['TP', 'FN', 'FP', 'TN'];

function getCriteria() {
  if (state.indicationCategory !== 'GTV') return CRITERIA_OAR;
  switch (state.gtvSubtype) {
    case 'GBM':       return CRITERIA_GBM;
    case 'LiverMets': return CRITERIA_LIVERMETS;
    case 'Cervix':    return CRITERIA_CERVIX;
    default:          return CRITERIA_OAR;
  }
}

function isGtvMode() { return state.indicationCategory === 'GTV'; }

// completeness 셀이 usability 점수 불가 상태인지 판단
function isUnscoreable(vi, ri) {
  const v = getCell(state.completeness, vi, ri);
  if (isGtvMode()) return v === 'FN' || v === 'TN'; // AI 추론 없음 → 점수 불가
  return v === true; // OAR: missing
}

// indication별 1-5 scale anchor (tooltip)
function getUsabilityAnchor() {
  if (isGtvMode()) {
    if (state.gtvSubtype === 'GBM') {
      return '5: Approve as-is · 4: Minor edit(<5%) · 3: Boundary 조정 · 2: Major edit(≥5%) · 1: Scratch부터 재contour';
    }
    if (state.gtvSubtype === 'LiverMets') {
      return '5: Approve · 4: Minor edit · 3: Boundary 조정 · 2: Major edit(per-lesion) · 1: Unusable (재contour)';
    }
    if (state.gtvSubtype === 'Cervix') {
      return '5: Approve · 4: Minor · 3: Boundary 조정 · 2: Major · 1: Unusable';
    }
  }
  return '5: Approve · 4: Minor · 3: Moderate · 2: Major · 1: Unusable';
}

// Subtype별 patient metadata 필드 정의
const META_FIELDS = {
  GBM: [
    { key: 'preOp',          label: 'Post-op (cavity 있음)', type: 'checkbox' },
    { key: 'newlyDiagnosed', label: 'Newly diagnosed',       type: 'checkbox' },
    { key: 'recurrence',     label: 'Recurrence',            type: 'checkbox' },
  ],
  LiverMets: [
    { key: 'primaryCancer',  label: 'Primary cancer',
      type: 'select', options: ['', 'CRC', 'Breast', 'Lung', 'Melanoma', 'Pancreas', 'Stomach', 'Other'] },
    { key: 'expectedLesions', label: 'Expected lesions (#)', type: 'number', min: 0, max: 99 },
    { key: 'imagingPhase',   label: 'Imaging phase',
      type: 'select', options: ['', 'Arterial', 'Portal venous', 'Delayed', 'Multi-phase'] },
  ],
  Cervix: [
    { key: 'tStage',         label: 'T-stage',
      type: 'select', options: ['', 'T1', 'T2', 'T3', 'T4'] },
    { key: 'treatment',      label: 'Treatment',
      type: 'select', options: ['', 'EBRT only', 'EBRT + brachy'] },
  ],
};
function getMetaFields() {
  if (!isGtvMode()) return null;
  return META_FIELDS[state.gtvSubtype] || null;
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

function defaultState() {
  return {
    projectName: 'CQA_Result',
    notionLink: '',
    // Indication framework (Phase 1+)
    indicationCategory: 'OAR',   // 'OAR' | 'GTV'
    gtvSubtype: null,            // null | 'GBM' | 'Cervix' | 'LiverMets'
    cutoffDefs: {
      A: { avg: 4.0, rScore: 3, ratio: 10 },
      B: { avg: 3.5, rScore: 2, ratio: 20 },
      C: { avg: 3.0, rScore: 2, ratio: 10 }
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
    testMeta: {}                 // [ti] = { ... }
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
  REVIEW_KEYS.forEach(k => { r[k] = state[k] || {}; });
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
    state.cutoffDefs        = projectData.cutoffDefs || def.cutoffDefs;
    state.rois              = projectData.rois || [];
    state.roiCutoffs        = projectData.roiCutoffs || state.rois.map(() => 'A');
    state.validations       = projectData.validations || [];
    state.tests             = projectData.tests || [];
  } finally { suppressSave = false; }
}
function applyReviewToState(reviewData) {
  suppressSave = true;
  try {
    REVIEW_KEYS.forEach(k => { state[k] = (reviewData && reviewData[k]) || {}; });
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
    if (!pSnap.exists) { alert('모델을 찾을 수 없습니다.'); return false; }
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
      if (!snap.exists) { alert('Legacy 평가를 찾을 수 없습니다.'); return false; }
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
    state.cutoffDefs        = data.cutoffDefs || def.cutoffDefs;
    state.rois              = data.rois || [];
    state.roiCutoffs        = data.roiCutoffs || state.rois.map(() => 'A');
    state.validations       = data.validations || [];
    state.tests             = data.tests || [];
    REVIEW_KEYS.forEach(k => { state[k] = data[k] || {}; });
  } finally { suppressSave = false; }
}

function updateReadOnlyBanner() {
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
    nameWrap.innerHTML = `<span class="project-name">${esc(p.name || p.id)}</span><span class="project-meta">${time}${tag}</span>`;
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
          ul.appendChild(rLi);
        });
      }
      li.appendChild(ul);
    }

    list.appendChild(li);
  });
}

async function joinCloudProject(projectId) {
  if (!firebaseReady || !currentUser) return false;
  try {
    const projectRef = fbDb.collection('projects').doc(projectId);
    const snap = await projectRef.get();
    if (!snap.exists) { alert('모델 ID를 찾을 수 없습니다.'); return false; }
    const data = snap.data();
    if (!data.members?.includes(currentUser.uid)) {
      await projectRef.update({
        members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    userProjects = await fetchUserProjects();
    renderProjectPicker();
    await loadProjectFromCloud(projectId);
    return true;
  } catch (e) {
    console.error('Join failed:', e);
    alert('모델 참여 실패: ' + e.message);
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

async function handleSignIn() {
  if (!firebaseReady) {
    alert('Firebase가 설정되지 않았습니다. firebase-config.js를 확인하세요.');
    return;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ hd: window.CQA_ALLOWED_EMAIL_DOMAIN, prompt: 'select_account' });
    const result = await fbAuth.signInWithPopup(provider);
    if (!result.user.email || !result.user.email.endsWith('@' + window.CQA_ALLOWED_EMAIL_DOMAIN)) {
      await fbAuth.signOut();
      alert(`@${window.CQA_ALLOWED_EMAIL_DOMAIN} 계정만 사용할 수 있습니다.`);
    }
  } catch (e) {
    console.error('Sign in failed:', e);
    if (e.code !== 'auth/popup-closed-by-user') alert('로그인 실패: ' + e.message);
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
          alert(`@${window.CQA_ALLOWED_EMAIL_DOMAIN} 계정만 사용할 수 있습니다.`);
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
  el('roiCount').textContent = state.rois.length;
  el('valCount').textContent = state.validations.length;
  el('testCount').textContent = state.tests.length;

  // Indication selector 동기화
  document.querySelectorAll('input[name="indicationCategory"]').forEach(r => {
    r.checked = r.value === (state.indicationCategory || 'OAR');
  });
  const gtvWrap = el('gtvSubtypeWrap');
  if (gtvWrap) gtvWrap.classList.toggle('hidden', state.indicationCategory !== 'GTV');
  const gtvSel = el('gtvSubtype');
  if (gtvSel) gtvSel.value = state.gtvSubtype || 'GBM';

  renderROIChips();
  renderChipList('valList', state.validations, (i, newVal) => { state.validations[i] = newVal; }, (i) => { removeAtIndex('validations', i); });
  renderChipList('testList', state.tests, (i, newVal) => { state.tests[i] = newVal; }, (i) => { removeAtIndex('tests', i); });
  renderCutoffTable();
}

function renderCutoffTable() {
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
  } else if (listKey === 'validations') {
    shiftPrimaryKey(state.completeness, idx); shiftPrimaryKey(state.usability, idx);
    shiftPrimaryKey(state.completenessComment, idx); shiftPrimaryKey(state.usabilityComment, idx);
    if (state.patientMeta) shiftPrimaryKey(state.patientMeta, idx);
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
      state.indicationCategory = e.target.value;
      if (state.indicationCategory === 'GTV' && !state.gtvSubtype) state.gtvSubtype = 'GBM';
      saveState();
      renderAll();
    });
  });
  el('gtvSubtype').addEventListener('change', (e) => {
    state.gtvSubtype = e.target.value; saveState(); renderAll();
  });
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

const ROWHEAD_W = 160; const CELL_W = 90; const COMMENT_W = 220;
function gridCols(nRoi, extraCols) {
  let s = `${ROWHEAD_W}px`;
  for (let i = 0; i < nRoi; i++) s += ` ${CELL_W}px`;
  for (let i = 0; i < extraCols; i++) s += ` ${COMMENT_W}px`;
  return s;
}
function openGrid(nRoi, extraCols) { return `<div class="g" style="grid-template-columns:${gridCols(nRoi, extraCols)}">`; }

function renderCompletenessGrid() {
  const c = el('completenessGrid');
  const V = state.validations.length, R = state.rois.length;
  if (V === 0 || R === 0) return c.innerHTML = '<p class="p-4 text-slate-400 text-sm">Validation과 ROI를 먼저 추가하세요.</p>';
  const gtv = isGtvMode();

  // 상단 안내문
  const hint = el('completenessHint');
  if (hint) hint.textContent = gtv
    ? '각 환자의 ROI에 대해 TP/FN/FP/TN을 선택하세요. (TP=정답 검출, FN=놓침-critical, FP=환각, TN=정답 미검출)'
    : '각 환자에서 ROI가 누락됐으면 체크하세요. (체크=누락, 빈칸=존재)';

  let html = openGrid(R, 1);
  html += `<div class="c h rh">PatientID</div>`;
  state.rois.forEach(roi => html += `<div class="c h">${esc(roi)}</div>`);
  html += `<div class="c h cm">Comment</div>`;
  state.validations.forEach((v, vi) => {
    html += `<div class="c rh">${esc(v)}</div>`;
    state.rois.forEach((roi, ri) => {
      const val = getCell(state.completeness, vi, ri);
      if (gtv) {
        const opts = ['', ...GTV_COMPLETENESS_STATES].map(s => {
          const label = s || '·';
          return `<option value="${s}" ${val === s ? 'selected' : ''}>${label}</option>`;
        }).join('');
        const cls = val === 'FN' ? 'comp-fn' : val === 'FP' ? 'comp-fp' : val === 'TP' ? 'comp-tp' : val === 'TN' ? 'comp-tn' : '';
        html += `<div class="c ${cls}"><select data-vi="${vi}" data-ri="${ri}" class="comp-sel">${opts}</select></div>`;
      } else {
        html += `<div class="c"><input type="checkbox" data-vi="${vi}" data-ri="${ri}" class="comp-chk" ${val ? 'checked' : ''} /></div>`;
      }
    });
    html += `<div class="c cm"><input type="text" data-vi="${vi}" class="comp-comment" value="${esc(state.completenessComment[vi] || '')}" /></div>`;
  });

  if (gtv) {
    // GTV: TP/FN/FP/TN count rows
    GTV_COMPLETENESS_STATES.forEach(st => {
      html += `<div class="c rh stat">${st}</div>`;
      state.rois.forEach((_, ri) => {
        let n = 0; for (let vi = 0; vi < V; vi++) if (getCell(state.completeness, vi, ri) === st) n++;
        html += `<div class="c stat ${st === 'FN' ? 'fail' : st === 'TP' ? 'pass' : ''}">${n}</div>`;
      });
      html += `<div class="c stat cm"></div>`;
    });
    // Missed lesion rate (FN / (TP+FN))
    html += `<div class="c rh stat">Miss rate (FN)</div>`;
    state.rois.forEach((_, ri) => {
      let tp = 0, fn = 0;
      for (let vi = 0; vi < V; vi++) {
        const s = getCell(state.completeness, vi, ri);
        if (s === 'TP') tp++; else if (s === 'FN') fn++;
      }
      const denom = tp + fn;
      html += `<div class="c stat">${denom ? ((fn/denom)*100).toFixed(0)+'%' : '-'}</div>`;
    });
    html += `<div class="c stat cm"></div>`;
  } else {
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
    html += `<div class="c stat cm"></div>`;
  }
  html += `</div>`;
  c.innerHTML = html;

  c.querySelectorAll('.comp-chk').forEach(chk => {
    chk.onchange = (e) => {
      setCell(state.completeness, +e.target.dataset.vi, +e.target.dataset.ri, e.target.checked);
      saveState(); renderCompletenessGrid(); renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
    };
  });
  c.querySelectorAll('.comp-sel').forEach(sel => {
    sel.onchange = (e) => {
      setCell(state.completeness, +e.target.dataset.vi, +e.target.dataset.ri, e.target.value);
      saveState(); renderCompletenessGrid(); renderUsabilityGrid(); renderSummaryView(); renderSpecsGrid();
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
  return state.rois.map((_, ri) => {
    const scores = [];
    for (let vi = 0; vi < V; vi++) {
      if (isUnscoreable(vi, ri)) continue;
      const s = getCell(state.usability, vi, ri);
      if (s && !isNaN(+s)) scores.push(+s);
    }
    if (!scores.length) return { avg: null, r2: null, r3: null, pass: null };
    const avg = scores.reduce((a,b)=>a+b,0)/scores.length, r2 = scores.filter(x=>x<=2).length/scores.length, r3 = scores.filter(x=>x<=3).length/scores.length;
    const def = state.cutoffDefs[state.roiCutoffs[ri] || 'A'];
    const pass = (avg >= def.avg && (def.rScore===2?r2:r3) <= def.ratio/100) ? 'PASS' : 'FAIL';
    return { avg, r2, r3, pass };
  });
}

function computeCompletenessStats() {
  const V = state.validations.length;
  const gtv = isGtvMode();
  return state.rois.map((_, ri) => {
    let miss = 0, tp = 0, fn = 0, fp = 0, tn = 0;
    for (let vi = 0; vi < V; vi++) {
      const v = getCell(state.completeness, vi, ri);
      if (gtv) {
        if (v === 'TP') tp++;
        else if (v === 'FN') { fn++; miss++; }
        else if (v === 'FP') fp++;
        else if (v === 'TN') tn++;
      } else {
        if (v) miss++;
      }
    }
    // completeness 정의: GTV는 (TP)/(TP+FN), OAR은 (V-miss)/V
    let completeness;
    if (gtv) {
      const denom = tp + fn;
      completeness = denom ? tp / denom : 0;
    } else {
      completeness = V > 0 ? (V - miss) / V : 0;
    }
    return { miss, total: V, completeness, tp, fn, fp, tn };
  });
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
  const specCols = '160px 80px 80px 100px 100px ' + Array(CRITERIA.length).fill('110px').join(' ') + ' 220px 240px';
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
    // 전체 patient-level 집계
    let totalFn = 0, totalFp = 0, totalTp = 0, totalTn = 0;
    cp.forEach(s => { totalFn += s.fn; totalFp += s.fp; totalTp += s.tp; totalTn += s.tn; });
    const overallMiss = (totalTp + totalFn) ? (totalFn / (totalTp + totalFn) * 100).toFixed(1) : '-';
    html += `<div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
      <b>GTV 전체 지표</b> · TP: ${totalTp} · <span class="text-red-700">FN(missed): ${totalFn}</span> · <span class="text-amber-700">FP(hallucination): ${totalFp}</span> · TN: ${totalTn} · <b>Miss rate: ${overallMiss}%</b>
    </div>`;
  }
  html += `<div class="mt-4 text-sm"><p><b>Passed list:</b> <span class="text-green-700">${esc(state.rois.filter((_,ri)=>us[ri].pass==='PASS').join(', ') || '-')}</span></p><p><b>Failed list:</b> <span class="text-red-700">${esc(state.rois.filter((_,ri)=>us[ri].pass==='FAIL').join(', ') || '-')}</span></p></div>`;
  c.innerHTML = html;
}

function renderAll() {
  renderLists();
  renderPatientMetaCard();
  renderCompletenessGrid();
  renderUsabilityGrid();
  renderVariantGrid();
  renderSpecsGrid();
  renderSummaryView();
  // tooltip 갱신
  const anchor = el('usabilityAnchor');
  if (anchor) anchor.textContent = '1-5 anchor — ' + getUsabilityAnchor();
}

function renderPatientMetaCard() {
  const card = el('patientMetaCard');
  if (!card) return;
  const fields = getMetaFields();
  card.classList.toggle('hidden', !fields);
  if (!fields) return;

  const title = el('patientMetaTitle');
  if (title) title.textContent = `Patient Metadata — ${state.gtvSubtype}`;

  const grid = el('patientMetaGrid');
  const V = state.validations.length;
  if (V === 0) { grid.innerHTML = '<p class="p-4 text-slate-400 text-sm">Validation 환자를 먼저 추가하세요.</p>'; return; }

  // grid columns 가로폭: select/number는 좀 더 넓게
  const colW = fields.map(f => f.type === 'select' ? '180px' : f.type === 'number' ? '120px' : '160px');
  const cols = `${ROWHEAD_W}px ` + colW.join(' ');
  let html = `<div class="g" style="grid-template-columns:${cols}">`;
  html += `<div class="c h rh">PatientID</div>`;
  fields.forEach(f => html += `<div class="c h">${esc(f.label)}</div>`);
  state.validations.forEach((v, vi) => {
    html += `<div class="c rh">${esc(v)}</div>`;
    const meta = state.patientMeta[vi] || {};
    fields.forEach(f => {
      const val = meta[f.key];
      if (f.type === 'checkbox') {
        html += `<div class="c"><input type="checkbox" class="pmeta-fld" data-vi="${vi}" data-key="${f.key}" data-type="checkbox" ${val ? 'checked' : ''} /></div>`;
      } else if (f.type === 'select') {
        const opts = (f.options || []).map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${o || '—'}</option>`).join('');
        html += `<div class="c"><select class="pmeta-fld" data-vi="${vi}" data-key="${f.key}" data-type="select">${opts}</select></div>`;
      } else if (f.type === 'number') {
        const min = f.min != null ? `min="${f.min}"` : '';
        const max = f.max != null ? `max="${f.max}"` : '';
        html += `<div class="c"><input type="number" ${min} ${max} class="pmeta-fld" data-vi="${vi}" data-key="${f.key}" data-type="number" value="${val != null ? esc(val) : ''}" placeholder="·" /></div>`;
      } else {
        html += `<div class="c"><input type="text" class="pmeta-fld" data-vi="${vi}" data-key="${f.key}" data-type="text" value="${esc(val || '')}" /></div>`;
      }
    });
  });
  html += `</div>`;
  grid.innerHTML = html;

  grid.querySelectorAll('.pmeta-fld').forEach(inp => {
    const ev = (inp.dataset.type === 'select' || inp.dataset.type === 'checkbox') ? 'change' : 'input';
    inp.addEventListener(ev, (e) => {
      const vi = +e.target.dataset.vi, key = e.target.dataset.key, type = e.target.dataset.type;
      if (!state.patientMeta[vi]) state.patientMeta[vi] = {};
      let v;
      if (type === 'checkbox') v = e.target.checked || undefined;
      else if (type === 'number') { const n = e.target.value === '' ? null : Number(e.target.value); v = isNaN(n) ? null : n; }
      else v = e.target.value;
      if (v === null || v === undefined || v === '' || v === false) delete state.patientMeta[vi][key];
      else state.patientMeta[vi][key] = v;
      if (Object.keys(state.patientMeta[vi]).length === 0) delete state.patientMeta[vi];
      saveState();
    });
  });
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

    updateRange(ws, 7, cRow + 2);
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
  // Sheet 1: Completeness — OAR (blank/-) vs GTV (TP/FN/FP/TN)
  makeDataSheet('1. ROI Completeness', state.validations, state.completeness, state.completenessComment,
    (ws, ref, vi, ri) => {
      const v = getCell(state.completeness, vi, ri);
      if (gtvX) { if (v) setC(ws, ref, v); }
      else      { if (!v) setC(ws, ref, '-'); }
    },
    (ws, sr) => {
      if (gtvX) {
        // GTV: TP/FN/FP/TN count rows + miss rate
        GTV_COMPLETENESS_STATES.forEach((st, i) => {
          setC(ws, `A${sr+i}`, st, { rowHeader: true });
          state.rois.forEach((_, ri) => {
            const c = colLetter(ri+2);
            setC(ws, `${c}${sr+i}`, '__formula__', { formula: `COUNTIF(${c}2:${c}${V+1},"${st}")`, type: 'n', rowHeader: true });
          });
        });
        // Miss rate = FN/(TP+FN)
        const mr = sr + GTV_COMPLETENESS_STATES.length;
        setC(ws, `A${mr}`, 'Miss rate (FN/(TP+FN))', { rowHeader: true });
        state.rois.forEach((_, ri) => {
          const c = colLetter(ri+2);
          setC(ws, `${c}${mr}`, '__formula__', { formula: `IFERROR(COUNTIF(${c}2:${c}${V+1},"FN")/(COUNTIF(${c}2:${c}${V+1},"TP")+COUNTIF(${c}2:${c}${V+1},"FN")),"")`, type: 'n', rowHeader: true });
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

  // ---------- Sheet: Patient Metadata (subtype별) ----------
  {
    const fields = getMetaFields();
    if (gtvX && fields && V > 0) {
      const ws = {};
      setC(ws, 'A1', 'Patient', { header: true });
      fields.forEach((f, i) => setC(ws, `${colLetter(i+2)}1`, f.label, { header: true }));
      state.validations.forEach((v, vi) => {
        const r = vi + 2;
        setC(ws, `A${r}`, v, { rowHeader: true });
        const meta = state.patientMeta[vi] || {};
        fields.forEach((f, i) => {
          const val = meta[f.key];
          if (val === undefined || val === null || val === '') return;
          if (f.type === 'checkbox') setC(ws, `${colLetter(i+2)}${r}`, '✓');
          else if (f.type === 'number') setC(ws, `${colLetter(i+2)}${r}`, val);
          else setC(ws, `${colLetter(i+2)}${r}`, String(val), { alignLeft: true });
        });
      });
      updateRange(ws, 1 + fields.length, V + 1);
      ws['!cols'] = [{wch:24}, ...fields.map(()=>({wch:22}))];
      XLSX.utils.book_append_sheet(wb, ws, 'Patient Metadata');
    }
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
    } catch (err) { alert('JSON 파싱 실패: ' + err.message); }
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
      const c = getCell(state.completeness, vi, ri);
      if (gtv) return c || '';
      return c ? '' : '-';
    }),
    state.completenessComment[vi] || ''
  ]);
  if (gtv) {
    GTV_COMPLETENESS_STATES.forEach(st => {
      const counts = state.rois.map((_, ri) => {
        let n = 0; for (let vi = 0; vi < V; vi++) if (getCell(state.completeness, vi, ri) === st) n++;
        return String(n);
      });
      rows.push([`**${st}**`, ...counts, '']);
    });
    const missRates = state.rois.map((_, ri) => {
      let tp = 0, fn = 0;
      for (let vi = 0; vi < V; vi++) {
        const s = getCell(state.completeness, vi, ri);
        if (s === 'TP') tp++; else if (s === 'FN') fn++;
      }
      return (tp+fn) ? (fn/(tp+fn)*100).toFixed(0)+'%' : '-';
    });
    rows.push(['**Miss rate**', ...missRates, '']);
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

function generateMdAll() {
  const sections = [
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
  if (!md) { alert('복사할 데이터가 없습니다.'); return; }
  const btn = document.querySelector(`#section-${tab} .copy-md-btn`);
  const ok = await clipboardWrite(md);
  if (btn) {
    btn.textContent = ok ? '✅ 복사됨' : '❌ 복사 실패'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋 MD 복사'; btn.classList.remove('copied'); }, 1500);
  }
  if (!ok) alert('클립보드 복사에 실패했습니다. 브라우저 권한을 확인하세요.');
}

//==================== PDF EXPORT ====================
function exportPDF() {
  const selected = Array.from(document.querySelectorAll('.pdf-chk:checked'))
    .map(cb => cb.closest('.section-wrap').dataset.section);
  if (!selected.length) { alert('PDF에 포함할 섹션을 하나 이상 체크하세요.'); return; }

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

  if (!sections.length) { alert('선택한 섹션에 출력할 데이터가 없습니다.'); return; }

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
    if (!md) { alert('복사할 데이터가 없습니다.'); return; }
    const btn = el('btnCopyAll');
    const ok = await clipboardWrite(md);
    btn.textContent = ok ? '✅ 복사됨' : '❌ 복사 실패';
    setTimeout(() => { btn.textContent = '📋 전체 MD 복사'; }, 1500);
    if (!ok) alert('클립보드 복사에 실패했습니다. 브라우저 권한을 확인하세요.');
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