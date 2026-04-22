//==================== STATE ====================
const LS_KEY = 'cqa_input_tool_v2';
const CRITERIA = ['3. Anatomical accuracy', '4. Over-segmentation', '5. Under-segmentation', '6. Smoothness'];
const CUTOFF_TYPES = ['A', 'B', 'C'];

function defaultState() {
  return {
    projectName: 'CQA_Result',
    notionLink: '',
    cutoffDefs: {
      A: { avg: 4.0, rScore: 3, ratio: 10 },
      B: { avg: 3.5, rScore: 2, ratio: 20 },
      C: { avg: 3.0, rScore: 2, ratio: 10 }
    },
    rois: ['Prostate', 'SeminalVes'],
    roiCutoffs: ['A', 'A'],
    validations: ['Validation_1', 'Validation_2', 'Validation_3'],
    tests: ['Test_1', 'Test_2'],
    completeness: {},            // [vi][ri] = true (missing)
    completenessComment: {},     // [vi] = comment
    usability: {},               // [vi][ri] = '1'..'5'
    usabilityComment: {},
    variant: {},                 // [ti][ri] = '1'..'5' or '❌'
    variantComment: {},
    specs: {},                   // [ri][ci] = true
    specsComment: {}
  };
}

let state = loadState() || defaultState();

function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) {}
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

//==================== SETUP RENDERING ====================
function renderLists() {
  el('projectName').value = state.projectName;
  el('notionLink').value = state.notionLink;
  el('roiCount').textContent = state.rois.length;
  el('valCount').textContent = state.validations.length;
  el('testCount').textContent = state.tests.length;

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
    input.style.width = Math.max(60, name.length * 8 + 10) + 'px';
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
    input.style.width = Math.max(60, name.length * 8 + 10) + 'px';
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
  } else if (listKey === 'tests') {
    shiftPrimaryKey(state.variant, idx); shiftPrimaryKey(state.variantComment, idx);
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
  el('projectName').oninput = (e) => { state.projectName = e.target.value; saveState(); };
  el('notionLink').oninput = (e) => { state.notionLink = e.target.value; saveState(); };
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== 'tab-' + tab));
    };
  });
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
  let html = openGrid(R, 1);
  html += `<div class="c h rh">PatientID</div>`;
  state.rois.forEach(roi => html += `<div class="c h">${esc(roi)}</div>`);
  html += `<div class="c h cm">Comment</div>`;
  state.validations.forEach((v, vi) => {
    html += `<div class="c rh">${esc(v)}</div>`;
    state.rois.forEach((roi, ri) => {
      const missing = getCell(state.completeness, vi, ri);
      html += `<div class="c"><input type="checkbox" data-vi="${vi}" data-ri="${ri}" class="comp-chk" ${missing ? 'checked' : ''} /></div>`;
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
    html += `<div class="c stat">${(V > 0 ? (V - miss) / V : 0 * 100).toFixed(0)}%</div>`;
  });
  html += `<div class="c stat cm"></div></div>`;
  c.innerHTML = html;
  c.querySelectorAll('.comp-chk').forEach(chk => {
    chk.onchange = (e) => {
      setCell(state.completeness, +e.target.dataset.vi, +e.target.dataset.ri, e.target.checked);
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
      if (getCell(state.completeness, vi, ri)) html += `<div class="c missing">❌</div>`;
      else html += `<div class="c"><input type="text" inputmode="numeric" maxlength="1" data-vi="${vi}" data-ri="${ri}" class="us-inp" value="${esc(getCell(state.usability, vi, ri) || '')}" placeholder="·" /></div>`;
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
      if (valid) { setCell(state.usability, +e.target.dataset.vi, +e.target.dataset.ri, value); saveState(); updateUsabilityStatsRow(); renderSpecsGrid(); renderSummaryView(); }
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
      if (getCell(state.completeness, vi, ri)) continue;
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
  return state.rois.map((_, ri) => {
    let miss = 0; for (let vi = 0; vi < V; vi++) if (getCell(state.completeness, vi, ri)) miss++;
    return { miss, total: V, completeness: V > 0 ? (V - miss) / V : 0 };
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
      html += `<div class="c"><input type="text" maxlength="1" data-ti="${ti}" data-ri="${ri}" class="var-inp" value="${esc(s==='❌'?'❌':s)}" placeholder="·" /></div>`;
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
      if (valid) { if (val === '❌') e.target.value = '❌'; setCell(state.variant, +e.target.dataset.ti, +e.target.dataset.ri, val); saveState(); }
    };
    inp.onkeydown = handleGridKeyNav;
  });
  c.querySelectorAll('.var-comment').forEach(inp => { inp.oninput = (e) => { state.variantComment[+e.target.dataset.ti] = e.target.value; saveState(); }; });
}

function renderSpecsGrid() {
  const c = el('specsGrid'), R = state.rois.length;
  if (R === 0) return c.innerHTML = '<p class="p-4 text-slate-400 text-sm">ROI를 먼저 추가하세요.</p>';
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
  let html = '<table class="summary-table"><thead><tr><th>ROI</th><th>Cutoff</th><th>PASS/FAIL</th><th>Avg</th><th>Ratio(≤2)</th><th>Ratio(≤3)</th><th>Completeness</th><th>Improvement</th></tr></thead><tbody>';
  state.rois.forEach((roi, ri) => {
    const u = us[ri], imp = CRITERIA.filter((_, ci) => getCell(state.specs, ri, ci));
    html += `<tr><td>${esc(roi)}</td><td><b>${state.roiCutoffs[ri]}</b></td><td class="${u.pass==='PASS'?'pass':u.pass==='FAIL'?'fail':''}">${u.pass||'-'}</td><td>${u.avg!==null?u.avg.toFixed(2):'-'}</td><td>${u.r2!==null?(u.r2*100).toFixed(0)+'%':'-'}</td><td>${u.r3!==null?(u.r3*100).toFixed(0)+'%':'-'}</td><td>${(cp[ri].completeness*100).toFixed(0)}%</td><td class="text-xs">${esc(imp.join(', '))}</td></tr>`;
  });
  html += '</tbody></table>';
  html += `<div class="mt-4 text-sm"><p><b>Passed list:</b> <span class="text-green-700">${esc(state.rois.filter((_,ri)=>us[ri].pass==='PASS').join(', ') || '-')}</span></p><p><b>Failed list:</b> <span class="text-red-700">${esc(state.rois.filter((_,ri)=>us[ri].pass==='FAIL').join(', ') || '-')}</span></p></div>`;
  c.innerHTML = html;
}

function renderAll() { renderLists(); renderCompletenessGrid(); renderUsabilityGrid(); renderVariantGrid(); renderSpecsGrid(); renderSummaryView(); }

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

  // Sheet 1, 2, 3
  makeDataSheet('1. ROI Completeness', state.validations, state.completeness, state.completenessComment, 
    (ws, ref, vi, ri) => { if (!getCell(state.completeness, vi, ri)) setC(ws, ref, '-'); },
    (ws, sr) => {
      setC(ws, `A${sr}`, 'Count (missing)', { rowHeader: true }); setC(ws, `A${sr+1}`, 'Completeness', { rowHeader: true });
      state.rois.forEach((_, ri) => {
        const c = colLetter(ri+2);
        setC(ws, `${c}${sr}`, '__formula__', { formula: `COUNTBLANK(${c}2:${c}${V+1})`, type: 'n', rowHeader: true });
        setC(ws, `${c}${sr+1}`, '__formula__', { formula: `(1-COUNTBLANK(${c}2:${c}${V+1})/ROWS(${c}2:${c}${V+1}))`, type: 'n', rowHeader: true });
      });
    }
  );

  makeDataSheet('2. Clinical Usability', state.validations, state.usability, state.usabilityComment,
    (ws, ref, vi, ri) => {
      if (getCell(state.completeness, vi, ri)) setC(ws, ref, '❌');
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

function init() {
  renderLists(); setupAddForms(); setupTabs(); renderAll();
  el('btnDownload').onclick = downloadXLSX; el('btnSave').onclick = exportJSON;
  el('btnLoad').onclick = () => el('fileInput').click();
  el('fileInput').onchange = (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); };
  el('btnClear').onclick = () => {
    if (!confirm('모든 입력을 초기화할까요? (localStorage 포함)')) return;
    localStorage.removeItem(LS_KEY); state = defaultState(); saveState(); renderAll();
  };
}

window.addEventListener('DOMContentLoaded', init);