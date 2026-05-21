# CQA Input Tool — 다음 단계 개선 작업 지시서

**대상**: Claude Code (Cursor)  
**Date**: 2026-05-21  
**기반**: PROJECT_STATUS.md (2026-05-20 상태) + GTV CQA Framework v3 합의 내용  
**핵심 목표**: GTV 평가를 **indication-agnostic universal scheme**으로 일관화 + 부수 개선

---

## 0. 작업 컨텍스트

PROJECT_STATUS.md §6 "2026-05-20 정리 완료" 항목들로 이전 피드백 Phase 1은 거의 완성됐습니다. 특히 `subMetricLabels`를 owner-defined로 만든 결정은 indication-agnostic 방향의 큰 진전입니다.

다음은 그 연장선상에서 **남은 indication-aware 잔재를 제거하고 단일 universal scheme으로 통합**하는 작업입니다.

### 설계 원칙 (재확인)

**GTV CQA는 indication-agnostic universal framework이다.**

- 도구가 indication별로 분기하지 않음
- Single-target vs multi-target도 분기하지 않음 (이것 역시 implicit indication categorization)
- Reviewer의 임상 지식이 case-specific 차이를 처리
- 모든 GTV indication에 동일 rubric, 동일 UI, 동일 data schema 적용

이 원칙에 비추어 보면 현재 도구의 한 곳이 아직 indication-aware한 가정을 갖고 있습니다: **GTV Completeness의 2-col 체크박스(Truth + Pred)**. 이건 single-target case (1환자 1lesion)를 가정한 구조라 multi-island (Brain mets 같은 20+ lesion) case에 fit하지 않습니다.

---

## 1. 핵심 변경: Unified Detection Assessment

### 1.1 현재 구조 (PROJECT_STATUS.md §3, §5.B)

```js
// Sparse storage
review.truthAbsent: { vi: { ri: true } }   // default Y, 'N'만 저장
review.predPresent: { vi: { ri: true } }   // default N, 'Y'만 저장

// UI: 2-col checkbox (Truth + Pred)
// → 4-state 자동 derive (TP/FN/FP/TN)
```

문제점:
- Single-target 가정 — 한 환자에 한 lesion 또는 lesion 없음만 표현 가능
- Multi-island case 표현 불가 — 20 lesion 중 18 잡고 2 hallucinated 같은 상황을 단일 "TP"로 collapse하면 정보 손실
- Workaround로 ROI 카테고리화 (`Liver_S7`, `Liver_S4a`) 가능하지만 lesion identity가 아닌 anatomical region 기반이라 다른 종류의 정보

### 1.2 새 구조: 3-input Unified Detection

각 환자 × ROI 셀에서 다음 3개 input:

```
┌──────────────────────────────┐
│ Tumor in reference?  ◉ Y ○ N │  default: Y
│ Missed lesion(s):  [None ▼]  │  None / 1-2 / 3-5 / >5
│ Hallucinated:       [None ▼]  │  None / 1-2 / 3-5 / >5
└──────────────────────────────┘
```

**의미**:
1. **Tumor in reference**: Reference contour에 lesion이 있어야 했나
2. **Missed**: 임상적으로 significant한 lesion 중 AI가 놓친 것 (under-contour/missed-lesion 종합)
3. **Hallucinated**: AI가 그렸지만 reference에 없는 것 (false positive lesion)

**Default**: 가장 흔한 TP case는 `{ tumorPresent: 'Y', missed: 'none', hallucinated: 'none' }`이라 default만으로 처리. 사용자 click 최소화.

### 1.3 자동 derive: 4-state

```js
function deriveDetectionState(detection) {
  const tumor = detection?.tumorPresent ?? 'Y';
  const missed = detection?.missed ?? 'none';
  const hallucinated = detection?.hallucinated ?? 'none';
  
  if (tumor === 'N') {
    return hallucinated === 'none' ? 'TN' : 'FP';
  }
  // tumor === 'Y'
  return missed === 'none' ? 'TP' : 'FN';
}
```

| Tumor | Missed | Hallucinated | State |
|-------|--------|--------------|-------|
| Y | none | none | TP |
| Y | any non-none | * | FN |
| N | N/A | none | TN |
| N | N/A | any non-none | FP |

**Multi-island case도 동일 scheme**:
- 20개 중 18 잡고 2 hallucinated → `{ Y, 'few' (=2개), 'few' (=2개) }` → 4-state는 FN으로 분류되지만 missed/hallucinated count가 풍부한 정보 보존
- 모두 잡음 → `{ Y, 'none', 'none' }` → TP

### 1.4 새 data schema

```js
// 기존 (제거):
// review.truthAbsent
// review.predPresent

// 신규:
review.detection: {
  [vi]: {
    [ri]: {
      tumorPresent: 'Y' | 'N',                          // default 'Y'
      missed: 'none' | 'few' | 'several' | 'many',      // default 'none'
      hallucinated: 'none' | 'few' | 'several' | 'many' // default 'none'
    }
  }
}
```

**Sparse pattern 유지**: Default 값은 저장 안 함. 일부만 default 아닐 때는 해당 field만:

```js
// TP case (모두 default): 저장 안 함 (object 없거나 빈 object)
// FN case (1개 놓침):
review.detection["0"]["0"] = { missed: 'few' }
// FP case (tumor 없는데 hallucination):
review.detection["1"]["0"] = { tumorPresent: 'N', hallucinated: 'few' }
```

### 1.5 UI 변경

**Grid view (compact)**:
- 셀에 single-line indicator로 상태 + count 표시
- 색상 + 좌측 strip은 4-state에 따라 유지
- 예: `✓` (TP), `! M:2` (FN with 2 missed), `? H:1` (FP with 1 hallucinated), `· N` (TN)

**셀 클릭/hover 시 inline editor**:
- 3-input 모두 보여줌
- 키보드 navigation 유지 (Tab/Enter)

**Variant cases (7-8) 영향**: Variant도 OAR/GTV mode 따라가니까 GTV variant case도 같은 unified scheme 적용. 기존 score-only(`'1'..'5'|'❌'`) input은 그대로 둠 — detection은 별도.

### 1.6 Migration code

`migrateReviewSchema(review, indicationCategory)`에 신규 stage 추가:

```js
function migrateGtvDetectionV3(review) {
  // 기존 truthAbsent + predPresent → detection
  if (!review.truthAbsent && !review.predPresent) return review;
  
  const detection = {};
  const visited = new Set();
  
  const addEntry = (vi, ri, truth, pred) => {
    const key = `${vi}_${ri}`;
    if (visited.has(key)) return;
    visited.add(key);
    
    // truth: true = 'N' (absent), undefined = 'Y' (present, default)
    // pred:  true = 'Y' (present), undefined = 'N' (absent, default)
    const tumorPresent = truth ? 'N' : 'Y';
    const aiDrew = !!pred;
    
    // Map old 4-state to new 3-input
    let entry = {};
    if (tumorPresent === 'N') {
      entry.tumorPresent = 'N';
      if (aiDrew) entry.hallucinated = 'few'; // 1-2 (legacy = exactly 1)
    } else {
      // tumorPresent === 'Y' (default)
      if (!aiDrew) entry.missed = 'few'; // 1-2 (legacy = exactly 1)
    }
    
    if (Object.keys(entry).length > 0) {
      if (!detection[vi]) detection[vi] = {};
      detection[vi][ri] = entry;
    }
  };
  
  // truthAbsent와 predPresent의 모든 vi/ri 조합 처리
  for (const vi in (review.truthAbsent || {})) {
    for (const ri in review.truthAbsent[vi]) {
      addEntry(vi, ri, review.truthAbsent[vi][ri], review.predPresent?.[vi]?.[ri]);
    }
  }
  for (const vi in (review.predPresent || {})) {
    for (const ri in review.predPresent[vi]) {
      addEntry(vi, ri, review.truthAbsent?.[vi]?.[ri], review.predPresent[vi][ri]);
    }
  }
  
  return {
    ...review,
    detection,
    // 기존 field는 일단 보존 (rollback 가능하게), 다음 schema version에서 제거
    // truthAbsent: undefined,
    // predPresent: undefined,
  };
}
```

`schemaVersion`을 v3로 bump. v2 → v3 migration은 위 함수.

**중요**: legacy `truthAbsent`/`predPresent` 필드를 즉시 삭제하지 말고 schema v3에서는 유지 (rollback 가능). schema v4에서 제거.

### 1.7 Summary / Stats / Export 업데이트

기존 `getCompState4()`가 single source라서 거기만 unified detection으로 갈아끼우면 UI/stats/export 자동 반영됩니다 (PROJECT_STATUS.md §6 "✅ `getCompState4()` single source 확인").

추가로 필요:

- **Summary에 missed/hallucinated count distribution**: TP/FN/FP/TN 단순 합계뿐 아니라 missed bin 분포 (None / Few / Several / Many)와 hallucinated bin 분포도 같이 보여줌
- **XLSX export**: Detection sheet에 4-state + missed bin + hallucinated bin 3개 column으로
- **PDF/MD export**: Detection summary에 bin distribution 포함

---

## 2. 부수 변경: Project-level Metadata

### 2.1 Modality

각 project에 modality 정보 추가 (informational, branching logic 아님):

```js
projects/{projectId} {
  // ...existing...
  modality: 'CT' | 'MR' | 'PET-CT' | 'multimodal' | string,  // free string OK
  modalityDetail: string  // e.g., "T1c + FLAIR", "Multi-phase CT (arterial + portal venous)"
}
```

UI: 모델명 옆에 모달리티 입력 field. Display는 사이드바 모델 트리에 small text로.

### 2.2 Evaluation Stage

단계적 학습 평가 지원:

```js
projects/{projectId} {
  // ...existing...
  evaluationStage: 'baseline' | 'training_cycle' | 'pre_release' | 'post_deployment' | string,
  modelVersion: string,  // e.g., "v0.3.1", "checkpoint_2026_05_15"
  trainingDataSnapshot: string  // optional
}
```

UI: 메타데이터 카드에 stage selector + model version 텍스트.

### 2.3 표시

사이드바 모델 트리에:
```
▼ GBM_v1 [GTV · MR · pre_release · v0.3]
  • 나 (3분 전)
  • other (1일 전)
```

또는 더 컴팩트하게 indication category icon만 표시하고 hover/click 시 details.

---

## 3. 부수 변경: Negative Case Set 지원

Pillar 3 "없는 병변 평가" 지원. GTV CQA Framework v3 §3 Pillar 3 영역.

### Option A (권장): Project flag

```js
projects/{projectId} {
  // ...existing...
  isNegativeCaseProject: boolean  // default false
}
```

- `true`인 project는 "이 ROI에 lesion이 없어야 하는" 환자들의 모음
- UI에서 detection의 default가 `tumorPresent: 'N'`으로 자동 설정
- Summary에서 false positive rate 강조 표시

### Option B: ROI category

각 ROI에 `isNegativeROI` flag. 더 fine-grained이지만 UI 복잡도 증가.

→ Option A로 시작 (간단). 필요해지면 Option B로 확장.

---

## 4. 부수 변경: Acceptance Criteria 확장

현재 Cutoff 시스템 (A/B/C 타입별 avg + ratio threshold)에 GTV-specific metric 추가.

### 4.1 추가 metric

```js
cutoffDefs.A = {
  avg: number,      // 기존: Clinical Usability 평균 threshold
  rScore: number,   // 기존: 점수 이하 case threshold
  ratio: number,    // 기존: 비율 threshold
  
  // 신규 (GTV 모드에서만 활성):
  sensitivityMin: number,  // 0-1, e.g., 0.95
  fpRateMax: number,        // per case, e.g., 0.05
  missedMaxBin: 'none' | 'few' | 'several' | 'many'  // 최대 허용 missed bin
}
```

### 4.2 비율 정의 명문화 (PROJECT_STATUS.md §6 §F 잔여)

"비율 ≤" 항목 정의를 도구 내에 표시. Tooltip 또는 short label:
> "비율 ≤ X = 점수가 rScore 이하인 case가 전체의 X 이하"

이미 §6에 "Cutoff 정의 한 줄 설명 + 헤더 tooltip" 표시되어 있는데, 비율 정의가 명확한지 한 번 확인 권장.

### 4.3 Asymmetric weighting

GTV의 marginal miss(FN) > over-contour(FP) 임상 risk 반영:
- Default cutoff에서 sensitivity threshold(90%+)를 FP rate threshold보다 엄격하게
- Cutoff Type A (엄격) / B (중간) / C (완화) 각각에 sensitivity-prioritized weighting을 default로 제안

---

## 5. Tech Debt 작업 (이전 피드백에서 보류 중)

이전 피드백 (CQA_Tool_Feedback.md에서 권장했던) 항목 중 아직 미진행:

### 5.1 Smoke Test (Playwright)

PROJECT_STATUS.md §6 "여전히 보류" 항목. Unified Detection migration이 큰 작업이라 **이 작업 직전에 minimum smoke test 도입 권장**.

테스트 시나리오 (10개 정도):
1. Login + 새 project 생성
2. ROI 추가/삭제
3. 환자 ID 일괄 입력
4. Detection 입력 (모든 4-state 한 번씩 + missed/hallucinated bin 변경)
5. Usability 1-5 입력 + 키보드 navigation
6. Sub-metric 체크 입력
7. Save/reload — 상태 보존 확인
8. XLSX export
9. Read-only mode (다른 reviewer 클릭)
10. Schema migration (legacy data load 후 v3 변환 검증)

도입 방법:
```bash
npm init -y
npm install -D @playwright/test
npx playwright install chromium
# tests/smoke.spec.js 작성
```

CI 없어도 됨 — local에서 `npx playwright test` 돌릴 수 있으면 PR 전 regression check 가능.

### 5.2 Script.js Modular 분리

2200줄 → IIFE namespace 패턴으로 분리:

```js
// cqa.state.js
(function() {
  window.CQA = window.CQA || {};
  CQA.state = {
    get: () => ...,
    set: (path, value) => ...,
    // ...
  };
})();

// cqa.render.detection.js
(function() {
  CQA.render = CQA.render || {};
  CQA.render.detection = {
    grid: (state) => ...,
    cell: (state, vi, ri) => ...
  };
})();

// cqa.firestore.js
// cqa.export.xlsx.js
// cqa.migration.js
```

인라인 `onclick` 핸들러와 호환되도록 모든 함수를 `window.CQA.*` 또는 `window.*`로 노출. ES module 도입 안 함.

**제안 분리 단위** (script.js 2200줄 → 8개 file, 각 200-400줄):
1. `cqa.state.js` — state object + actions
2. `cqa.firestore.js` — sync layer + offline persistence
3. `cqa.migration.js` — schema migration (`migrateReviewSchema` + helpers)
4. `cqa.render.grid.js` — detection grid + usability grid render
5. `cqa.render.cards.js` — collapsible cards, sidebar tree
6. `cqa.export.xlsx.js` — xlsx generation
7. `cqa.export.other.js` — PDF/MD/JSON export
8. `cqa.ui.modals.js` — toast, confirm, modals

`script.js`는 entry point만 (load all modules, init).

### 5.3 Render 함수 incremental update (낮은 우선순위)

현재 `renderCompletenessGrid()`가 full re-render. 100+ 환자 × 10+ ROI 시 lag 가능성. 측정 먼저:

```js
// Chrome DevTools Performance tab으로
// 입력 event → paint까지 시간 측정
```

50-60ms 넘으면 incremental DOM patching 도입. 한 셀 update는 그 셀 DOM만 갈아끼움:

```js
function updateDetectionCell(vi, ri) {
  const cellEl = document.querySelector(`[data-vi="${vi}"][data-ri="${ri}"]`);
  if (!cellEl) return;
  const state = deriveDetectionState(getDetection(vi, ri));
  cellEl.className = `cell-${state}`;
  cellEl.innerHTML = renderCellContent(vi, ri);
  // 인접 stats만 업데이트 (summary 등)
  updateSummaryStats();
}
```

---

## 6. 작업 순서 (우선순위)

### Sprint 1: 안전망 + 작은 개선 (1주)

1. **Smoke test 도입** (§5.1) — 10개 test case, regression safety net
2. **Cutoff 정의 명문화** (§4.2) — 비율 ≤ 정의 확인 및 tooltip 보강
3. **Asymmetric weighting default** (§4.3) — Cutoff Type A/B/C에 sensitivity-priority default

### Sprint 2: Unified Detection migration (2주, **핵심 작업**)

4. **Schema v3 migration code 작성** (§1.6) — `migrateGtvDetectionV3`
5. **`getCompState4` → `deriveDetectionState` 교체** (§1.3) — single source 갱신
6. **3-input UI 구현** (§1.5) — 셀 inline editor + grid compact rendering
7. **Cell color/strip logic 업데이트** — 4-state 색상은 유지
8. **Summary stats 업데이트** — bin distribution 표시
9. **XLSX export 업데이트** — detection sheet의 column 구조 변경
10. **Smoke test 갱신** — 신규 schema에 맞춰 case 추가
11. **Legacy data load 검증** — 기존 GTV project를 로드해서 v3 자동 마이그레이션 확인

### Sprint 3: Project Metadata (1주)

12. **Modality field** (§2.1)
13. **Evaluation stage field** (§2.2)
14. **사이드바 표시** (§2.3) — 모델 트리에 메타데이터 indicator
15. **XLSX export 헤더에 메타데이터 포함**

### Sprint 4: Negative Case Set (1주)

16. **`isNegativeCaseProject` flag 도입** (§3 Option A)
17. **Negative project UI 처리** — detection default가 `tumorPresent: 'N'`
18. **Summary에 FP rate 강조**

### Sprint 5: Script.js Modular Split (1주)

19. **§5.2의 8개 module로 분리**
20. **인라인 onclick 호환성 검증** — `window.CQA.*` namespace 노출 확인
21. **Smoke test 통과 확인**

### Sprint 6 (이후): Performance (필요 시)

22. **Render 성능 측정** (§5.3)
23. **필요하면 incremental DOM patching**

---

## 7. Acceptance Criteria (각 sprint 완료 기준)

### Sprint 1
- [ ] `npx playwright test` 실행 시 10개 case 모두 pass
- [ ] Cutoff 입력 UI에서 "비율 ≤" hover 시 정확한 정의 tooltip
- [ ] Default cutoff 생성 시 GTV mode일 때 sensitivity > FP rate priority 표시됨

### Sprint 2 (가장 중요)
- [ ] 신규 project 생성 시 GTV mode → 3-input UI 표시
- [ ] Legacy GTV project 로드 시 자동으로 v3로 migrate, UI 정상 동작
- [ ] Multi-island case (e.g., Brain mets) 평가 가능:
  - 20 lesion 중 18 잡고 2 hallucinated → `Y / few / few` 입력 → 4-state UI에서 FN
- [ ] Save → reload → 데이터 그대로 보존 (sparse pattern)
- [ ] XLSX export에서 4-state + bin 분포 모두 정상
- [ ] Smoke test 11번 case (schema migration) pass

### Sprint 3
- [ ] Project 생성 시 modality 선택 가능 (free string 포함)
- [ ] Evaluation stage 선택 가능
- [ ] 사이드바 모델 트리에 메타데이터 indicator 표시
- [ ] XLSX export 첫 시트에 메타데이터 헤더 포함

### Sprint 4
- [ ] Negative project 생성 시 detection default가 `tumorPresent: 'N'`
- [ ] Negative project Summary에 FP rate가 primary metric으로 강조
- [ ] Negative project에 normal data 로드해서 평가 가능

### Sprint 5
- [ ] script.js의 LOC가 entry point만 남아 200줄 이하
- [ ] 8개 module 각각 200-400줄
- [ ] 인라인 onclick 핸들러 모두 정상 동작
- [ ] Smoke test 전체 pass

---

## 8. Risk 및 주의사항

1. **Sprint 2가 가장 위험한 작업**: Schema migration + UI 대규모 변경. Smoke test가 Sprint 1에서 먼저 들어가야 안전. Migration code는 별도 unit test로 검증 권장 (legacy data sample을 input으로 → 기대 output 비교).

2. **기존 사용자의 작업 데이터 손실 위험**: Legacy `truthAbsent`/`predPresent` 필드를 v3에서 즉시 삭제하지 말 것. Schema v3에서는 유지, v4에서 제거 (충분한 운영 후).

3. **`schemaVersion` bump 시 모든 reviewer의 review doc이 첫 load 때 자동 migration됨**: Firestore write 비용 발생. 대량의 legacy data가 있으면 한 번에 큰 비용 — 모니터링 필요.

4. **3-input UI 도입 시 reviewer adoption**: 기존 2-checkbox에 익숙한 사용자가 있을 수 있음. Migration 후 짧은 onboarding hint (toast 또는 inline help) 권장.

5. **Default 의존성**: Sparse object pattern은 default 값이 코드에 hardcoded되어 있어 위험. `DETECTION_DEFAULTS` 상수로 명시화하고 모든 derive 함수가 거기서 참조하도록.

```js
const DETECTION_DEFAULTS = Object.freeze({
  tumorPresent: 'Y',
  missed: 'none',
  hallucinated: 'none'
});
```

6. **PROJECT_STATUS.md §6 잔여 항목들**: 
   - 공유 config last-write-wins (multi-rater 본격화 전까지 유지 OK)
   - Per-lesion nested data model (이번 unified detection이 multi-island 처리하니까 nested 필요성 감소 — Liver mets 본격화 시 재평가)
   - Stratified analysis export (patient metadata schema 부활 시)

---

## 9. PROJECT_STATUS.md 업데이트

작업 진행하면서 PROJECT_STATUS.md를 incrementally 업데이트해주세요. 특히:

- §3 "현재 기능" — 3-input detection UI 설명 추가
- §4 "데이터 모델" — `detection` schema 추가, `truthAbsent`/`predPresent` legacy 표시
- §5 "핵심 UI/UX 디자인 결정" — §B "GTV Completeness 2-col"을 "Unified detection (Sprint 2)"로 교체
- §6 "정리 완료" — Sprint별 완료 항목 추가
- §8 "피드백 받고 싶은 영역" — 해결된 항목 strikethrough

Cursor + Claude Code 세션 시작 시 이 doc + PROJECT_STATUS.md를 context로 제공하면 일관성 유지 좋습니다.

---

## 10. 참고 문서

이 작업 지시서의 design rationale은 다음 문서에 정리되어 있습니다 (필요 시 reference):

- **GTV_CQA_Framework_v3.md**: Indication-agnostic universal framework methodology
- **PROJECT_STATUS.md** (현재): 도구 현재 상태

---

**작업 분량 요약**: Sprint 1-5 약 6주 estimate. Sprint 2 (unified detection migration)가 가장 큰 작업으로 약 2주. Sprint 1 (smoke test)이 가장 먼저 들어가야 안전망 역할.
