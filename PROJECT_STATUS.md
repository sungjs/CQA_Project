# CQA Input Tool — 현재 상태 (개선 피드백 요청용)

이 문서는 외부 AI 채팅에 붙여넣어 디자인/아키텍처/UX 개선 피드백을 받기 위한 self-contained 요약입니다.

---

## 1. 프로젝트 개요

**CQA Input Tool** — 임상에서 AI 자동 segmentation 결과를 평가(Clinical Quality Assurance)하는 웹 도구.

- **사용자**: 의료 영상의 contour 데이터를 검토하는 임상의 / 연구자
- **목적**: AI가 자동으로 그린 contour의 품질을 환자 × ROI(또는 lesion)별로 평가, 통계 산출, XLSX/PDF 리포트 생성
- **두 평가 모드**:
  - **OAR** (Organs At Risk, 정상 장기): 장기가 존재하는지 binary check + 1-5 quality score
  - **GTV** (Gross Tumor Volume, 종양): TP/FN/FP/TN 4-state classification + 1-5 quality score
- **운영**: https://cqa-input-tool.web.app
- **사용자 규모**: 사내 의료 AI 회사 reviewer 수명 (multi-rater 분석은 미래 작업)

---

## 2. 기술 스택

| 영역 | 선택 |
|------|------|
| Frontend | Vanilla JS + Tailwind CSS (CDN) + Pretendard 한글 폰트 |
| Backend | Firebase Hosting + Firestore + Auth (Google Sign-In, oncosoft.io workspace 제한) |
| Build | 없음 (정적 파일 3개: index.html / script.js / style.css) |
| Excel | xlsx-js-style (CDN, 셀 단위 스타일 지원) |
| SDK | Firebase compat v10 (modular SDK 아님 — 인라인 `onclick` 핸들러 호환 위해) |

**LOC**: script.js ~2000줄, style.css ~900줄, index.html ~270줄

---

## 3. 현재 기능

### Inter-rater agreement (신규, 2026-05-20)
- Summary 다음에 별도 collapsible section
- Fleiss κ 계산 (usability 1-5 점수를 nominal 5 카테고리로 처리)
- ROI별 κ + Landis & Koch 해석 badge (Poor/Slight/Fair/Moderate/Substantial/Almost perfect)
- 평가자 2명 이상일 때 활성, 1명 이하면 안내 placeholder
- 펼침 시에만 데이터 fetch (모든 reviewers의 review doc 한 번에)
- Client-side 계산 (50명×50환자×10ROI까진 충분)

### Toast notification (신규, 2026-05-20)
- alert() 14개 호출 모두 toast로 교체 (success/error/warning/info 4 종)
- 우상단 stack, auto-dismiss (error 6초 / 기타 4초), 좌측 색상 strip
- `confirm()`은 그대로 유지 (Y/N 답이 필요한 destructive 작업)

### Audit trail (신규, 2026-05-20)
- 별도 `audit/{eventId}` collection (append-only, 본인 이벤트만 read)
- Firestore rule: create는 본인 uid + timestamp == request.time 검증, update/delete 금지
- Logged events: project_create / project_delete / review_delete / join_project
- flushCloudSave 같은 빈번한 write는 audit 안 함 (cost 절감)
- Best-effort (실패 시 console.warn, 본 동작은 진행)

### 사이드바 (Models)
- 모델 목록 트리: 모델 → 평가자(reviewers) hierarchy
- 모델 클릭 = 내 평가 로드 / chevron 클릭 = expand → 평가자 리스트 표시
- 타인 평가 클릭 시 자동 **읽기 전용 모드**
- 모델 / 내 평가지 삭제 (hover 🗑 버튼)
- 모델 ID로 셀프 참여 (invitation code 역할)

### 평가 그리드 (Patient × ROI 매트릭스)
1. **ROI Completeness**:
   - OAR: ROI 누락 체크박스
   - GTV: 실제(Truth) + 추론(Pred) **2-column 체크박스** → TP/FN/FP/TN 자동 파생, 셀 배경색 + 좌측 strip
2. **Clinical Usability**: 1-5 점수 (키보드 빠른 입력)
3. **Variant cases (7-8)**: test 환자 점수
4. **Specifications (3-6)**: 4개 sub-metric 체크 (Target coverage / Non-target exclusion / Boundary accuracy / Smoothness)
5. **A. Summary**: 실시간 PASS/FAIL 통계 + GTV 전체 지표 (TP/FN/FP/TN 합계, Miss rate)

### 설정 / 메타데이터
- 모델명, Notion 링크
- Cutoff 정의 (A/B/C 타입별 avg/ratio threshold)
- ROI 목록 (각각 cutoff 타입 지정), Validation 환자, Test 환자 리스트
- 평가자 노트 (케이스 난이도 1-5 + 자유 코멘트)

### Export
- **XLSX**: 7개 시트 (Cutoff / A.Summary / B.Validation / 1.Completeness / 2.Usability / 3.ROI Variant / 3-6.Specifications). 시트 간 cross-reference는 **엑셀 수식**으로 — 사용자 편집 시 자동 재계산.
- **PDF**: section별 체크박스로 포함 여부 선택, 별도 print area
- **MD 복사**: section별 + 전체 (Notion 호환)
- **JSON**: state 통째로 저장/불러오기

### 동기화
- 입력 → 800ms debounce → Firestore `projects/{id}` + `reviews/{uid}` 동시 set(merge)
- Offline persistence (IndexedDB 큐잉)
- 로그아웃 시 localStorage 폴백

### 디자인
- Design token 80+ (CSS variable)
- 다크 모드: `prefers-color-scheme` 자동 + 수동 토글 (☀/☾)
- 데스크탑 전용 (모바일 대응 코드 모두 제거)
- 카드 visual weight 최소화 (collapsed = subtle bg + 컴팩트 padding)

---

## 4. 데이터 모델 (Firestore)

```
projects/{projectId}                       # 공유 설정
  ├─ name: string
  ├─ notionLink: string
  ├─ indicationCategory: 'OAR' | 'GTV'
  ├─ cutoffDefs: { A: {avg, rScore, ratio}, B: {...}, C: {...} }
  ├─ rois: string[]
  ├─ roiCutoffs: string[]                  # ROI별 cutoff 타입 (A/B/C)
  ├─ validations: string[]                 # 환자 ID 리스트
  ├─ tests: string[]                       # variant test 환자
  ├─ owner: uid
  ├─ members: uid[]
  ├─ schemaVersion, createdAt, updatedAt
  └─ reviews/{reviewerUid}                 # 평가자별 격리
       ├─ completeness: { vi: { ri: bool } }   # OAR 모드 (체크 = missing)
       ├─ detection:    { vi: { ri: { tumorPresent?, missed?, hallucinated? } } }  # GTV v3, sparse
       ├─ truthAbsent / predPresent          # V2 legacy (v3 자동 migration, v4에서 제거)
       ├─ usability:    { vi: { ri: '1'..'5' } }
       ├─ variant:      { ti: { ri: '1'..'5'|'❌' } }
       ├─ specs:        { ri: { ci: bool } }
       ├─ *Comment:     { vi/ti/ri: string }
       ├─ reviewerComment, reviewConfidence
       └─ schemaVersion, reviewerEmail, updatedAt

evaluations/{evalId}                       # legacy 컬렉션 (구도구 데이터, 읽기 전용)
```

**핵심 디자인 결정**:
- 공유 config (rois, validations 등)와 평가 데이터(reviews)를 분리 — 여러 reviewer가 한 모델을 평가
- GTV의 `truthAbsent` / `predPresent`는 **default 상태를 저장하지 않는 sparse object** — Firestore 문서 크기 최소화
- Migration은 client-side에서 자동 (loadState + applyReviewToState 시 `migrateGtvCompletenessV2`)

---

## 5. 핵심 UI/UX 디자인 결정 (왜 그렇게 했는가)

### A. 사이드바 트리 (모델 → 평가자)
- 모델 클릭 = 내 평가 로드 (default), chevron = expand (lazy fetch)
- 다른 평가자 클릭 시 자동 read-only — Firestore rule이 본인 review만 write 허용하므로 어차피 저장 안 됨, UI에 명확히 표시
- **이유**: multi-rater 시나리오에서 동료 평가를 참고하고 싶을 때 빠르게 토글

### B. GTV Completeness를 3-input unified detection으로 (2026-05-21 갱신, framework v3)
**Evolution**:
1. V1: TP/FN/FP/TN 4-state dropdown 직접 선택 → 사용자 "직접 고르기 어렵다"
2. V2: 실제(Truth) + 추론(Pred) 2 체크박스 → 직관적이지만 single-target 가정
3. **V3 (현재)**: 3-input (Tumor Y/N · Missed bin · Hallucinated bin) — multi-island case 자연 표현

- 각 cell: T (Y/N) · Missed (none/1-2/3-5/>5) · Hallucinated (none/1-2/3-5/>5)
- Default {Y, none, none} → TP (대부분 case 클릭 없이 자동)
- Multi-island: 20개 중 18 잡고 2 hallucinated → `{Y, few, few}` (4-state로는 FN이지만 count info 보존)
- 4-state는 derive (deriveDetectionState)로 자동 — UI/stats/export 모두 single source
- **이유**: indication-agnostic universal framework (GTV CQA Framework v3). single-target/multi-target 분기 없이 모든 GTV case 동일 schema

### C. Indication subtype 시스템 제거
- 초기엔 GBM/LiverMets/Cervix별로 hard-coded patient metadata field set (Pre-op 체크박스, Primary cancer 드롭다운, T-stage 등)
- 사용자 피드백: "새 indication 들어올 때마다 코드 수정. 유연성 부족"
- **변경**: subtype + Patient Metadata 카드 완전 제거. OAR/GTV 두 모드만 유지
- **이유**: 임상 도구는 다양한 cancer site를 지원해야 하는데 hard-coded는 확장성 zero. 미래에 cloud-side schema 또는 free-form metadata로 대체 예정

### D. 카드 island 줄이기
- 초기엔 모든 카드가 동일 visual weight (border + shadow + 일관된 padding)
- 사용자 피드백: "island가 너무 많아 번잡해"
- **변경**:
  - shadow 제거 (border만)
  - collapsed 카드 = `bg-subtle` + padding 10px (헤더만 보이는 컴팩트 line)
  - expanded 카드 = `bg-card` + 정상 padding
  - 카드 간 spacing mb-4 → mb-2
  - radius 12 → 8px

### E. 그리드 cell 폭 cap
- 초기엔 `minmax(N, 1fr)`로 와이드 모니터에서 stretch
- 사용자 피드백: "전체화면했을때 너무 넓어져서 어색"
- **변경**: `minmax(90px, 140px)` 등 max cap. 와이드 모니터에서도 셀이 데이터 양에 적절한 크기

### F. PatientID 셀 2줄 wrap + hover expand
- 환자 ID가 길면 (`Adrenal-ACC-Ki67-Seg_Adrenal_Ki67_Seg_013_SerInd=1` 같은) 잘림
- 변경: `-webkit-line-clamp: 2` + hover 시 clamp 해제 (z-index로 다른 셀 위에)

### G. 데스크탑 전용
- 사용자 피드백: "이거 모바일로 들어가는 사람 없을텐데"
- 모바일 media query 모두 제거, Tailwind `md:*` responsive class도 제거 → 단순화

### H. Design token + Dark mode
- 50+ CSS variable로 모든 색상/spacing 추상화
- `:root[data-theme="dark"]` 만 변경하면 다크 모드. `@media (prefers-color-scheme)` 자동 감지 + 수동 토글 (☀/☾)
- FOUC 방지를 위해 head에 인라인 스크립트로 stylesheet 적용 전 data-theme 설정

---

## 6. 알려진 한계 / 결정 보류

### 기능 측면
1. ~~**Multi-rater agreement 자동 계산 없음**~~ — **2026-05-20 부분 완료**: Fleiss κ (usability 점수 기준) 추가. Pairwise kappa / per-sub-metric agreement는 아직.
2. **Stratified analysis export 없음** — patient metadata가 있어도 그것으로 break-down 안 됨 (Pre-op vs Post-op 평균 score 같은). 어차피 metadata 카드를 제거했으니 현재로선 의미 없음.
3. **Per-lesion nested data model 없음** — Liver mets처럼 한 환자에 여러 lesion이 있는 경우, 현재는 사용자가 lesion 카테고리별 ROI를 직접 만들어야 함 (`Liver_S7`, `Liver_S4a` 등). 진짜 nested `patient.lesions[]` 구조는 모든 grid render 함수 refactor 필요해 보류.
4. **사용자 정의 metadata 없음** — indication별 / 모델별 임상 정보 필드를 사용자가 정의할 수 없음.
5. **권한 모델 단순** — owner / member 두 단계만. read-only viewer, admin 같은 세분화 없음.
6. **초대 흐름 단순** — 모델 ID 공유로 셀프 join. 정식 invitation/approval 흐름 없음.
7. ~~**Toast/Notification 없음**~~ — **2026-05-20 완료**: 14개 alert() → toast로 교체.
8. ~~**Sub-metric (3-6) flexibility 없음**~~ — **2026-05-20 완료**: `subMetricLabels: string[4]` owner-defined. 빈 값은 default fallback. Cervix/Liver mets 진입 시 라벨만 바꾸면 됨.
9. **여전히 보류 (피드백 §5 Phase 1.5+)**:
   - Smoke test (Playwright headless) — 미도입
   - script.js modular 분리 (IIFE namespace) — 미도입 (2200+ 줄)
   - Per-lesion nested data model (Phase 2) — Liver mets 본격화 전까지 보류
   - Stratified analysis export — patient metadata 시스템 부활 시

### 데이터 모델 측면
- **공유 config last-write-wins** — 멤버 누구나 ROI 리스트, cutoff 수정 가능. 동시 편집 시 충돌 가능성. 본격 multi-rater 시 owner 전용 제한 또는 collaborative editing 필요.
- **Mode 전환 시 데이터 의미 변화** — OAR `completeness=true` (missing)와 GTV의 `truthAbsent + predPresent`는 자동 매핑 안 됨. 평가 도중 mode 바꾸면 셀 재입력 필요.

### 코드 품질 측면
- **2200줄 단일 script.js** — 모듈 분리 안 됨. 인라인 `onclick` 핸들러 호환을 위해 ES module 안 씀
- **Render 함수가 매번 full re-render** — `renderCompletenessGrid()` 호출 시 전체 HTML 재생성. 큰 데이터셋에서 성능 우려
- **Test 없음** — 정적 사이트 + 빌드 없음 / 테스트 프레임워크 없음

### 2026-05-21 — GTV CQA Framework v3 적용 (Sprint 1 + 2)

**핵심 변화**: GTV completeness가 2-col checkbox → **3-input unified detection** (Tumor present / Missed bin / Hallucinated bin). Multi-island case (Brain mets 20개 lesion 등) 자연스럽게 표현 가능.

- ✅ **Schema v3**: `state.detection[vi][ri] = { tumorPresent?, missed?, hallucinated? }` (sparse, default 미저장)
  - `DETECTION_DEFAULTS` 상수: `{ tumorPresent: 'Y', missed: 'none', hallucinated: 'none' }` (가장 흔한 TP case)
  - `COUNT_BINS = ['none', 'few', 'several', 'many']` — 1-2 / 3-5 / >5 lesion 카운트
  - `deriveDetectionState()`: tumor 'N' + hallucinated → FP / tumor 'N' + clean → TN / tumor 'Y' + missed → FN / 외 TP
- ✅ **자동 migration V2 → V3**: `migrateReviewSchema`에 V3 stage 추가. Legacy `truthAbsent`/`predPresent`는 보존 (v4에서 제거 예정)
- ✅ **3-input UI**: GTV mode completeness cell에 3개 micro select (T / Missed bin / Hallucinated bin). 색상 + tooltip은 4-state 유지. `det-warn` class로 non-none bin 강조
- ✅ **Stats 확장**: 4-state count + Miss rate + Missed bin row + Hallucinated bin row (cell HTML grid)
- ✅ **XLSX export**: 셀에 `"TP"` 또는 `"FN (M:1-2, H:1-2)"` notation, COUNTIF wildcard로 stats. Missed/Hallucinated bin 별도 row.
- ✅ **MD export**: 동일 cell notation + bin row
- ✅ **Cutoff GTV hint**: GTV mode일 때 marginal miss 우선 권장 amber hint (구조적 sensitivity threshold는 향후 추가 예정)
- ✅ **Smoke test**: `node tools/test-migration.js` — V1→V2, V2→V3, deriveDetectionState 22개 assertion 통과

### 2026-05-20 정리 완료 (외부 피드백 기반)
- ✅ Section 순서 1→2→3-6→7-8→A (numerical reading 자연스러움)
- ✅ Cutoff 정의 한 줄 설명 + 헤더 tooltip
- ✅ `migrateReviewSchema(review, indicationCategory)` 단일 진입점 (loadState + applyReviewToState 둘 다 호출)
- ✅ `getCompState4()` single source 확인 (UI/stats/export 모두 사용)
- ✅ Firestore read rule 점검 — 모두 멤버십 확인됨 (변경 불필요)
- ✅ Audit trail collection 추가
- ✅ Toast notification 시스템
- ✅ Inter-rater Fleiss κ section (ROI별 usability + sub-metric별 specs binary)
- ✅ **Sub-metric 라벨 owner-defined** (피드백 §3 우려 1 해결): `state.subMetricLabels` 추가. 새 카드 "🏷 3-6 Sub-metric 라벨"에서 owner가 자유 정의. 비우면 default(OAR/GTV별 기본 4개) 사용. Cervix/Liver mets 진입 시 코드 수정 없이 라벨 변경 가능.
- ✅ Mode 전환 시 confirm — 데이터 있는 상태에서 OAR↔GTV 토글 시 의미 변화 경고
- ✅ 사이드바 모델 ID 복사 버튼 (📋, hover 시) — invitation code 공유 편의

---

## 7. 사용 시나리오 (참고)

### 시나리오 1: 새 모델 평가 시작
1. 사이드바 `＋ 새 모델` → 이름 입력
2. ROI 목록 추가 (`Prostate`, `SeminalVes` 등)
3. 환자 ID 일괄 입력 (Validation patients)
4. Cutoff 타입을 각 ROI에 지정 (A=엄격, B=중간, C=완화)
5. 평가 유형 선택 (OAR / GTV)
6. ROI Completeness → Usability → Specs 순서로 평가
7. Summary 탭에서 PASS/FAIL 확인 → XLSX 다운로드

### 시나리오 2: 동료 평가 검토
1. 사이드바에서 동료 모델의 chevron 클릭 → 평가자 리스트 expand
2. 동료 reviewer 클릭 → 그 사람의 데이터 read-only로 로드
3. 노란 배너에 "🔒 다른 평가자의 데이터" 표시
4. 내 평가로 돌아가려면 모델명 다시 클릭

### 시나리오 3: 큰 데이터셋 평가 (37 환자 × 1 ROI Brain GTV)
- 키보드 빠른 입력: Tab/Enter로 다음 셀, Shift+Tab으로 이전
- usabilityComment에 failure mode 노트 ("2개 놓침", "혈관을 오인" 등)
- 작업 중간 저장 → 자동 ☁ 저장됨 (Firestore)

---

## 8. 피드백 받고 싶은 영역 (구체적 질문)

다음에 대한 외부 시각의 의견을 받고 싶습니다:

### A. 유연한 metadata 시스템
임상 indication별로 필요한 patient metadata는 다양 (GBM은 pre-op 여부, Liver는 primary cancer, Cervix는 T-stage 등). hard-coded 방식 (subtype별 META_FIELDS)은 새 indication마다 코드 수정 필요해 제거함. 어떤 패턴이 좋을까요?
- **Option 1**: 모델 owner가 모델 생성 시 metadata schema를 정의 (e.g. JSON array of field defs). 다른 reviewer는 그 schema 따라 입력
- **Option 2**: 자유 텍스트 코멘트만 사용 (현재). 통계 분석은 수동
- **Option 3**: Cloud function이 indication별 권장 schema 제공
- 다른 패턴 추천?

### B. Multi-rater agreement 시각화
같은 모델을 여러 reviewer가 평가한 후, 평가 일치도를 어디서/어떻게 보여줄지?
- 별도 "Inter-rater" 카드/탭?
- Summary에 통합 (ROI별 평균/표준편차)?
- XLSX export에만 (별도 시트)?
- Kappa / ICC를 client-side에서 계산할지, Firebase Function으로 server-side?

### C. 큰 데이터셋 성능
현재 그리드는 `state` 객체에서 매번 HTML 생성. 100+ 환자 × 10+ ROI 시 어떻게 될지 모름.
- Virtualization 필요? (e.g. react-virtual 같은 기법)
- 또는 incremental DOM 패치 (한 셀만 업데이트)?
- 또는 그냥 페이지네이션 (10명씩)?

### D. UI/UX 군더더기
현재 디자인 (https://cqa-input-tool.web.app)에서 아직 어색하거나 개선할 수 있는 부분이 있을지 — 외부 시각에서 본 즉각적 인상.

### E. 데이터 모델 / 아키텍처
- `truthAbsent` + `predPresent` 두 sparse object로 4-state 표현 — clean한가?
- migration 코드가 `loadState` + `applyReviewToState` 두 군데에 있음 — single source of truth 가능한가?
- Firestore rule이 멤버십 확인을 위해 `get()` 호출 — 비용 / 성능 영향?

### F. 임상 도메인 측면
- OAR과 GTV 평가의 본질적 차이를 잘 반영했는지?
- 4-state Completeness (TP/FN/FP/TN)를 2-col 체크박스로 표현한 게 임상의에게 직관적인지?
- Cutoff 시스템 (A/B/C 타입별 avg + ratio threshold)이 합리적인지?

### G. 보안 / 권한
- workspace 도메인 제한 + member-based ACL이 임상 데이터에 충분한가?
- 환자 ID는 anonymized인 가정인데, 만약 식별 가능한 데이터가 들어오면?
- Firestore 비용 관리 (대량 미수 쿼리 / 잘못된 인덱스 등)에 대한 가드?

---

## 부록: 화면 구성 (text mockup)

```
┌─────────┬─────────────────────────────────────────────────┐
│ MODELS  │  CQA Input Tool                ☀ 로그아웃 [...] ⬇XLSX │
│ ＋ 새모델 │ ─────────────────────────────────────────────  │
│ 🔗 참여   │  [모델명: GBM_v1____]  [Notion 링크: _____]    │
│         │  평가 유형 [ OAR │ GTV ]                        │
│ ▼ GBM_v1│  ─────────────────────────────                  │
│  •나     │  ▼ Cutoff 기준 정의                            │
│   (3분전)│  ▼ 평가자 노트                                 │
│  •other │  ┌──────┬──────┬──────┐                        │
│   (1일전)│  │ ROI   │ Val   │ Test │                       │
│         │  └──────┴──────┴──────┘                        │
│ ▶ Cervix│  ▼ 1. ROI Completeness                          │
│ ▶ Liver │     [Patient × ROI 그리드: TP/FN/FP/TN]         │
│         │  ▼ 2. Clinical Usability                        │
│         │  ▼ 7-8. Variant cases                           │
│         │  ▼ 3-6. Specifications                          │
│         │  ▼ A. Summary (PASS/FAIL 통계)                  │
└─────────┴─────────────────────────────────────────────────┘
```

---

이상이 현재 상태입니다. 어느 영역이든 솔직한 피드백 환영합니다.
