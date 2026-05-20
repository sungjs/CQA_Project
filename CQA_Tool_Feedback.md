# CQA Input Tool — 외부 피드백 (PROJECT_STATUS.md 기반)

이 문서는 PROJECT_STATUS.md를 기반으로 한 외부 시각 피드백입니다. Cursor + Claude 작업 시 reference로 활용하시면 됩니다.

---

## 종합 평가

**Phase 1 (GBM single-target) 운영 가능한 도구로 완성됐다고 봐도 됩니다.** 핵심 UX 결정(2-col checkbox)과 architecture 결정(subtype 제거)이 둘 다 pragmatic하게 잘 잡혔어요. PROJECT_STATUS.md 자체가 self-contained spec으로 완성도 높음 — Cursor Claude productivity의 ceiling이 이 doc quality에 좌우되니까 유지가 중요합니다.

---

## 1. 인상적인 디자인 결정

### A. GTV Completeness 2-col 체크박스 (PROJECT_STATUS.md §5.B)

원래 4-state selector(TP/FN/FP/TN dropdown)가 자연스러운 spec이었는데, 사용자 피드백을 받아 두 binary 체크박스(Truth + Pred)로 pivot한 결정이 매우 좋습니다.

- 임상 mental model과 일치: "환자에 종양 있나?" + "AI가 그렸나?"는 진짜로 분리된 두 판단
- Cognitive load 절감: 4-way classification보다 두 binary 결정이 직관적
- Sparse storage와도 자연스럽게 매칭

### B. Indication subtype 제거 (PROJECT_STATUS.md §5.C)

GBM/Cervix/Liver mets별 hard-coded subtype 안 가져간 결정도 좋습니다. 새 indication마다 코드 수정해야 하는 구조는 확장성 zero. 다만 이 결정의 trade-off는 §3에서 다룸.

### C. Sparse object data model (PROJECT_STATUS.md §4)

`truthAbsent` + `predPresent`로 4-state를 sparse 2 binary로 표현한 구조 매우 clean. Default state(가장 흔한 TP)는 안 저장해서 storage 효율 + migration safety 둘 다 좋음.

---

## 2. 검증된 기타 좋은 결정

- Reviews per-reviewer subcollection — multi-rater 통계 통합은 미구현이지만 데이터 구조는 ready
- Schema versioning + client-side migration — 데이터 evolution path 확보
- Design token + dark mode + FOUC 방지 인라인 스크립트 — 정적 사이트치고 디자인 시스템 잘 잡힘
- Card visual weight / cell 폭 cap iteration — information density 문제를 user feedback으로 잘 풀었음
- 데스크탑 전용 단순화 결정 — 모바일 미사용 시 옳은 결정

---

## 3. Forward-looking 우려사항 (phase별 정리)

### 우려 1: Sub-metric (3-6)이 GBM 형태로 고정됨

현재 4개 sub-metric(Target coverage / Non-target exclusion / Boundary accuracy / Smoothness)은 GBM에 잘 맞지만:

- **단기 (GBM 단독)**: 문제 없음 — 그대로 사용
- **중기 (Cervix 진입 시)**: Parametrial/vaginal extension이 별도 dimension이라 4개 sub-metric으로 capture 안 됨
- **장기 (Liver mets 진입 시)**: "Missed lesion count"가 사실상 별도 metric인데 현재 구조에 안 들어감

이게 indication subtype 제거의 trade-off. **Cervix 진입 전에 sub-metric을 어떻게 indication-aware하게 만들지 결정 필요**. 가능한 패턴:

1. Sub-metric 자체를 indication별로 swap (subtype 부활의 다른 이름이 될 수도)
2. Generic sub-metric 4개 유지 + sub-item을 indication별로 동적 로드 (각 sub-metric 아래 checklist가 indication별로 다름)
3. Project owner가 sub-metric set을 자유 정의 (metadata schema 패턴과 동일)

권장: **3번 (owner-defined)** 또는 **2번 (generic + dynamic sub-items)**. 1번은 subtype 부활과 같아서 §2의 결정과 모순됨.

### 우려 2: Multi-target (Liver mets) 본질적 한계

Liver_S7, Liver_S4a 식 ROI 카테고리화 workaround는 **anatomical region 기반**이지 **lesion identity 기반**이 아님:

- Region 기반: "S7 segment에 lesion이 있냐 없냐"
- Identity 기반: "환자에 lesion 7개 있는데 AI가 4개 잡았다"

Liver mets에서 가장 critical metric인 "missed lesion count"는 후자가 필요한데, 현재 workaround는 전자만 가능. **Liver mets phase 진입 시 이 limitation이 표면화될 것**.

진짜 해결책: Patient → Lesion[] nested data model 도입. 이는 grid render 함수 전반 refactor를 의미 (PROJECT_STATUS.md §6에서 이미 인지하고 있음). Phase 2 진입 직전이 적기.

### 우려 3: 2000줄 single script.js + 테스트 zero

Phase 2 (multi-target nested) 진입 시 가장 큰 risk. Cursor Claude로 코드 generation 빠르지만 confident refactor는 test coverage가 있어야 가능.

권장 action items:

- **Smoke test 도입**: Playwright headless로 e2e flow 10개 정도 ("load → input → save → reload → verify"). 첫 도입 시간이 들지만 이후 refactor마다 회수됨
- **Script.js modular 분리**: ES module이 인라인 onclick과 충돌하면 IIFE pattern + namespace 분리만이라도 (`window.CQA.completeness.render(...)`)
- 분리 가능한 module candidates:
  - `cqa.state.js` (state object + actions)
  - `cqa.firestore.js` (sync layer)
  - `cqa.render.completeness.js`
  - `cqa.render.usability.js`
  - `cqa.export.xlsx.js`
  - `cqa.export.md.js`
  - `cqa.migration.js`

### 우려 4: Full re-render 성능

100+ patient × 10+ ROI 시나리오는 아직 안 와봤겠지만 cell 입력마다 grid 전체 재생성은 lag 가능성:

1. **우선 측정**: Chrome DevTools Performance tab에서 input event → paint 시간
2. **50-60ms 넘으면 perceptible**, 이 시점에서 incremental DOM patching 도입 (cell update는 cell DOM만)
3. Virtualization (react-virtual 등)은 clinical use volume(~200 case)에선 over-engineering

---

## 4. PROJECT_STATUS.md §8 질문 답변

### A. 유연한 metadata 시스템

**Option 1 (owner가 모델 생성 시 schema 정의) 기반 hybrid 권장**:

- 모델 생성 시 owner가 JSON schema 정의: `[{key, label, type: text/number/select/checkbox, options}]`
- 사내 "common schema templates" preset 몇 개 제공 ("Brain template", "Abdomen template" 등)
- Template 적용 후 owner가 자유 add/remove/edit
- Schema는 project document에 저장 (owner controls, cloud-enforced X)

Cloud function 강제 schema(Option 3)는 임상 도구에서 거의 항상 backfire — "이 케이스는 예외" 시나리오가 항상 생김.

### B. Multi-rater agreement 시각화

**별도 "Inter-rater" 카드/탭이 best**:

- Summary에 섞으면 single-reviewer 시 빈 영역
- XLSX-only는 in-app visibility 낮음
- Inter-rater 탭은 multi-rater일 때만 활성화하면 깔끔

계산은 **client-side에서 충분**:

- Cohen's kappa (2-rater): 단순 contingency table
- Fleiss' kappa (>2-rater): 직접 구현 가능
- 50명 reviewer × 50환자 × 10 ROI까진 client-side OK
- Firebase Function은 cost/cold start 단점이 client-side 단점보다 큼

표시 방식 권장:

- ROI별 single agreement metric (Fleiss' kappa) primary
- Reviewer pairwise는 expandable detail로
- **Per-sub-metric agreement도 같이** — "어느 dimension에서 합의 어려운가" 가시화 (이게 sub-metric 자체 validity 점검 용도로 가장 가치 있음)

### C. 큰 데이터셋 성능

§3 우려 4에서 다룸. 요약:

1. 측정 먼저 (DevTools Performance)
2. 50-60ms 넘으면 incremental DOM patching
3. Virtualization은 clinical scale에선 over-engineering
4. 페이지네이션은 keyboard navigation flow 깨뜨려서 비권장

### D. UI/UX 즉각적 인상

PROJECT_STATUS.md mockup 기반 (form 직접 인터랙트 X, 한정 시각):

- **Cutoff 정의 표 4 columns 학습 부담**: Type/평균≥/점수이하/비율≤가 처음 사용자에게 의미 파악 어려움. **Inline help tooltip이나 한 줄 설명 추가 권장**
- **Section 순서**: 현재 1 → 2 → 7-8 → 3-6 → A 인데, numerical reading 자연스러움은 1 → 2 → 3-6 → 7-8 → A. 7-8을 1-2-3-6 사이에 끼는 이유가 doc에서 unclear — 의도된 거면 명시, 아니면 reorder 권장
- 사이드바 read-only 진입 명확성(노란 배너) — 좋음
- Card collapse/expand UX — well thought

### E. 데이터 모델 / 아키텍처

**Q: `truthAbsent` + `predPresent` 2 sparse objects로 4-state 표현 — clean한가?**

매우 clean. Default state 안 저장해서 storage 효율적. 다만 derive function을 한 곳에 모아두면 가독성 ↑:

```js
function deriveCompletenessState(vi, ri, review) {
  const truth = !review.truthAbsent?.[vi]?.[ri];  // default true
  const pred = !!review.predPresent?.[vi]?.[ri];  // default false
  if (truth && pred) return 'TP';
  if (truth && !pred) return 'FN';
  if (!truth && pred) return 'FP';
  return 'TN';
}
```

이 derive function이 render / export / summary 모두에서 호출되는 single source of truth가 되도록.

**Q: Migration code가 loadState + applyReviewToState 두 군데 — single source 가능?**

가능. 별도 함수로 추출:

```js
function migrateReviewSchema(review, fromVersion, toVersion) {
  // single source of truth for all schema migrations
  let r = review;
  if (fromVersion < 2 && toVersion >= 2) r = migrateGtvCompletenessV2(r);
  // ... future migrations
  return r;
}
```

두 entry point에서 동일 함수 호출.

**Q: Firestore rule `get()` 비용 / 성능?**

- Write당 1 read 추가됨
- 800ms debounce면 second 단위 쓰기 빈도 안 나오니까 비용 미미
- Read latency 50-100ms 정도라 user-perceptible 영향 없음
- Multi-rater 본격화되어 thousands of writes/day 되면 그때 재평가 (Cloud Firestore Free Tier 50k reads/day 기준)

### F. 임상 도메인 측면

**Q: OAR과 GTV 본질적 차이 반영?**

좋음. Completeness 4-state 분리, sub-metric의 Coverage/Exclusion 분리(under vs over contour 비대칭 인정)가 핵심 잡힘. **다만 sub-metric의 indication 미스매치는 §3 우려 1로 처리**.

**Q: 4-state Completeness를 2-col 체크박스 — 임상의에 직관적인가?**

매우 직관적. "환자에 종양 있나?(Y/N) → AI가 그렸나?(Y/N)"는 임상 사고 흐름이라 자연스러움. 이 결정은 유지.

**Q: Cutoff 시스템 (A/B/C 타입별 avg + ratio threshold) 합리적인가?**

대체로 합리적이나 다음 한계:

- **"비율 ≤" 기준이 무엇 비율인지 doc에서 불명확**: cutoff 점수 이하 case의 비율인지? 정확한 정의 명문화 필요
- **GTV에선 "miss rate (FN/(FN+TP))"가 별도 critical metric일 가능성**: Type별 cutoff에 미포함됐다면 추가 검토
- **Asymmetric clinical risk 미반영**: marginal miss(under-contour) >> over-contour인데 cutoff system이 symmetric. Sub-metric별 가중치 또는 별도 weighted score 도입 검토

### G. 보안 / 권한

**Q: Workspace + member ACL이 임상 데이터에 충분한가?**

사내 internal tool로는 적절. 단:

- Patient ID anonymization은 application 외부 책임 — 정책으로 처리
- **Audit trail 추가 권장**: 누가 언제 어느 환자 데이터 본/입력했는지 trace 가능하면 incident 대응 가능. Firestore의 별도 audit collection으로 write event 기록
- **Firestore rule이 read도 멤버 only인지 확인**: write만 제한이면 인증된 비-멤버가 read 가능할 수 있음. Read rule도 멤버십 확인 필수

**Q: Firestore 비용 가드?**

- Unbounded query에 `limit()` 강제
- Client-side caching으로 같은 데이터 반복 fetch 안 하는지 점검
- Long-tail collection (예: legacy `evaluations`)에 listen 안 거는지 확인
- Firestore Usage Dashboard 정기 모니터링

---

## 5. 추천 다음 단계 (priority order)

### Phase 1 마무리 (현재 단계 polish)

- [ ] Cutoff "비율 ≤" 정의 명문화 + UI tooltip 추가
- [ ] Section 순서 1 → 2 → 3-6 → 7-8로 reorder (또는 현재 순서 유지 이유 doc에 명시)
- [ ] `deriveCompletenessState` 함수 추출 — render/export/summary single source
- [ ] `migrateReviewSchema` 함수 추출 — single migration entry point
- [ ] Firestore read rule이 멤버십 확인하는지 검증 + 필요 시 보강
- [ ] Audit trail collection 도입 (write event 기록)

### Phase 1.5 (Cervix 진입 전 architecture 정리)

- [ ] Smoke test 도입 (Playwright headless, 10개 e2e flow)
- [ ] Script.js modular 분리 (IIFE namespace 패턴, 위 module candidates 참고)
- [ ] Sub-metric flexibility 패턴 결정 (owner-defined schema 또는 generic + dynamic sub-items)
- [ ] Inter-rater agreement 카드/탭 + per-sub-metric agreement 가시화

### Phase 2 (Liver mets multi-target)

- [ ] Patient → Lesion[] nested data model 도입
- [ ] Grid render 함수들 lesion-aware refactor
- [ ] Lesion-level cutoff + missed lesion rate metric
- [ ] XLSX export nested sheet 구조 (Patient sheet + Lesion sheet, foreign key)

### Phase 3 (Polish + multi-rater 본격화)

- [ ] Owner-defined metadata schema 시스템
- [ ] Inter-rater agreement 자동 계산 (Cohen/Fleiss kappa, ICC)
- [ ] Toast/Notification system (alert() 대체)
- [ ] Stratified analysis export
- [ ] Performance optimization (incremental DOM patching, 측정 후 결정)

---

## 6. Cursor Claude 협업 팁

PROJECT_STATUS.md 같은 self-contained spec이 AI assistant productivity의 ceiling입니다. 유지 권장:

- 큰 refactor 전후로 PROJECT_STATUS.md 업데이트하면 다음 Cursor 세션에서 context drift 방지
- 우려사항 / TODO를 doc에 명시해두면 Cursor가 "이 작업이 어디 fit하는지" 일관성 있게 판단 가능
- Test 도입 시 test 의도(`spec/intent`)도 doc에 한 줄씩 — 단순 test list보다 의도 기록이 다음 작업 시 valuable
- 작업 단위는 phase별 priority order 따라 한 phase씩 끝내고 PROJECT_STATUS.md 업데이트 후 다음 phase로

---

## 부록: 본 피드백의 한계

- Form 직접 인터랙트 안 함 (PROJECT_STATUS.md + 화면 fetch 기반)
- 실제 코드 직접 read 안 함 (architecture 추론은 doc 기반)
- Clinical reviewer 실사용 관찰 안 함 (UX 평가는 mockup + doc 기반)

→ 따라서 본 피드백은 "외부 시각 + 임상 도메인 + 소프트웨어 아키텍처 hybrid" 수준. 실제 사용자 피드백을 대체하지 않음.
