# CQA Input Tool — 현재 상태 (개선 피드백 요청용)

**Last updated**: 2026-05-21

이 문서는 외부 AI 채팅에 붙여넣어 디자인/아키텍처/UX 개선 피드백을 받기 위한 self-contained 요약입니다.

---

## 1. 프로젝트 개요

**CQA Input Tool** — 임상에서 AI 자동 segmentation 결과를 평가(Clinical Quality Assurance)하는 웹 도구.

- **사용자**: 의료 영상의 contour 데이터를 검토하는 임상의 / 연구자 (사내 RT MD)
- **목적**: AI가 자동으로 그린 contour의 품질을 환자 × ROI별로 평가, 통계 산출, XLSX/PDF 리포트 생성
- **두 평가 모드**:
  - **OAR** (Organs At Risk, 정상 장기): 장기가 존재하는지 binary check + 1-5 quality score
  - **GTV** (Gross Tumor Volume, 종양): **3-input unified detection** (Tumor present / Missed / Hallucinated) + 1-5 quality score. 4-state(TP/FN/FP/TN)는 자동 derive.
- **운영**: https://cqa-input-tool.web.app
- **사용자 규모**: 사내 RT MD 수명. Multi-rater inter-rater agreement(Fleiss κ) 자동 계산 지원.

**설계 원칙 (GTV CQA Framework v3)**: indication-agnostic universal. 도구가 GBM/Cervix/Liver mets 등 indication별로 분기하지 않음. 모든 GTV에 동일 rubric, 동일 UI, 동일 schema 적용. single-target vs multi-target도 분기 없음.

---

## 2. 기술 스택

| 영역 | 선택 |
|------|------|
| Frontend | Vanilla JS + Tailwind CSS (CDN) + Pretendard 한글 폰트 |
| Backend | Firebase Hosting + Firestore + Auth (Google Sign-In, oncosoft.io workspace 제한) |
| Build | 없음 (정적 파일 3개: index.html / script.js / style.css) |
| Excel | xlsx-js-style (CDN, 셀 단위 스타일 지원) |
| SDK | Firebase compat v10 (modular SDK 아님 — 인라인 `onclick` 핸들러 호환 위해) |
| Test | Node-based pure-function tests (`tools/test-migration.js`, 30 assertions) |

**LOC**: script.js ~2700줄, style.css ~1200줄, index.html ~385줄

---

## 3. 현재 기능

### 사이드바 (Models)
- 모델 목록 트리: 모델 → 평가자(reviewers) hierarchy
- 모델 클릭 = 내 평가 로드 / chevron 클릭 = expand → 평가자 리스트
- 타인 평가 클릭 시 자동 **읽기 전용 모드** (노란 배너)
- 모델 / 내 평가지 삭제 (hover 🗑 버튼)
- 모델 ID 복사 버튼 (📋, 다른 평가자 초대용)
- 모델 row에 metadata badge (modality, evaluationStage, modelVersion)
- 모델 ID로 셀프 참여 (invitation code 역할)

### 평가 그리드 (Patient × ROI 매트릭스)

1. **ROI Completeness**:
   - **OAR**: ROI 누락 체크박스 (체크 = missing)
   - **GTV (Framework v3)**: 셀에 **4-state badge(TP/FN/FP/TN)** + 비-default일 때 annotation. 셀 클릭 시 **popover editor**에서 편집:
     - Tumor in reference: Y/N segmented control
     - Missed lesion(s): None / 1-2 / 3-5 / >5
     - Hallucinated: None / 1-2 / 3-5 / >5
     - "이 셀 초기화" link, ESC/바깥 클릭으로 닫힘
   - Default {Y, none, none} → TP (대부분 case 클릭 없이 자동)
   - Multi-island case 자연 표현 (예: 20개 중 18 잡고 2 hallucinated → `{Y, few, few}`)
   - 4-state는 `deriveDetectionState()` single source로 derive — UI/stats/export 모두 사용
2. **Clinical Usability**: 1-5 점수 (키보드 빠른 입력, Tab/Enter 그리드 navigation)
3. **Specifications (3-6)**: 4개 sub-metric 체크. 라벨은 owner-defined (default: Target coverage / Non-target exclusion / Boundary accuracy / Smoothness)
4. **Variant cases (7-8)**: test 환자 점수
5. **A. Summary**: 실시간 PASS/FAIL 통계 + GTV 전체 지표 (TP/FN/FP/TN 합계, FP rate, Miss rate)
6. **Inter-rater agreement** (평가자 2+ 시 활성, collapsible): ROI별 usability Fleiss κ + sub-metric별 specs binary Fleiss κ + Landis & Koch 해석 badge

### 설정 / 메타데이터 (collapsible cards)

- **모델 설정**: 모델명, Notion 링크, indication (OAR / GTV)
- **모델 메타데이터** (Sprint 3, informational): modality, modalityDetail, evaluationStage, modelVersion — free-string, branching logic 없음
- **평가자 노트**: 케이스 난이도 1-5 + failure mode 자유서술 코멘트
- **3-6 Sub-metric 라벨** (owner-defined, framework v3 §4 원칙): 빈 값은 default fallback. 새 indication 진입 시 코드 변경 없이 라벨 변경 가능.
- **Cutoff 정의** (A/B/C 타입별 avg + 임계점수 + 비율): GTV mode일 때 marginal miss 우선 권장 amber hint
- **ROI 목록 / Validation 환자 / Test 환자**: chip + 일괄 입력

### Export

- **XLSX**: 7개 시트 (Cutoff / A. Summary / B. Validation list / 1. ROI Completeness / 2. Clinical Usability / 3. ROI Variant / 3-6. Specifications). 시트 간 cross-reference는 **엑셀 수식** — 사용자 편집 시 자동 재계산.
  - A. Summary에 모델 메타데이터(Indication / Modality / Stage / Version) 블록 + 평가자 노트 블록
  - GTV completeness 셀: `"FN (M:1-2, H:1-2)"` notation
- **PDF**: section별 체크박스로 포함 여부 선택, 별도 print area, accordion 섹션 단위 출력
- **MD 복사**: section별 + 전체 (Notion 호환). Cell notation 동일, bin distribution rows 포함
- **JSON**: state 통째로 저장/불러오기

### 동기화 & Auth

- 입력 → 800ms debounce → Firestore `projects/{id}` + `reviews/{uid}` 동시 set(merge)
- Offline persistence (IndexedDB 큐잉, 복구 시 자동 sync)
- 로그아웃 시 localStorage 폴백
- Google Sign-In (oncosoft.io workspace 제한, client + Firestore rule에서 dual 검증)

### Audit trail

- `audit/{eventId}` collection (append-only, 본인 이벤트만 read)
- Firestore rule: create는 본인 uid + timestamp == request.time 검증, update/delete 금지
- Logged events: `project_create` / `project_delete` / `review_delete` / `join_project`
- flushCloudSave 같은 빈번한 write는 audit 안 함 (cost 절감)
- Best-effort (실패 시 console.warn, 본 동작은 진행)

### Toast notification

- 14개 `alert()` 호출 모두 toast로 교체 (success / error / warning / info)
- 우상단 stack, auto-dismiss (error 6초 / 기타 4초), 좌측 색상 strip
- `confirm()`은 destructive 작업(삭제, mode 전환 등)에 유지

### 디자인

- Design token 80+ (CSS variable)
- 다크 모드: `prefers-color-scheme` 자동 + 수동 토글 (☀/☾), FOUC 방지 인라인 스크립트
- 데스크탑 전용 (모바일 대응 코드 모두 제거)
- 카드 visual weight 최소화 (collapsed = subtle bg + 컴팩트 padding)

---

## 4. 데이터 모델 (Firestore)

```
projects/{projectId}                       # 공유 설정
  ├─ name: string
  ├─ notionLink: string
  ├─ indicationCategory: 'OAR' | 'GTV'
  ├─ subMetricLabels: string[4] | null     # owner-defined sub-metric 라벨 (3-6, framework v3 §4)
  ├─ modality, modalityDetail              # informational (Sprint 3)
  ├─ evaluationStage, modelVersion         # informational (Sprint 3)
  ├─ isNegativeCaseProject: boolean        # ⚠ deprecated, backward compat (Sprint 4 rollback됨)
  ├─ cutoffDefs: { A: {avg, rScore, ratio}, B: {...}, C: {...} }
  ├─ rois: string[]
  ├─ roiCutoffs: string[]                  # ROI별 cutoff 타입 (A/B/C)
  ├─ validations: string[]                 # 환자 ID 리스트
  ├─ tests: string[]                       # variant test 환자
  ├─ owner: uid
  ├─ members: uid[]
  ├─ schemaVersion (3), createdAt, updatedAt
  └─ reviews/{reviewerUid}                 # 평가자별 격리
       ├─ completeness:        { vi: { ri: bool } }   # OAR 모드 (체크 = missing)
       ├─ detection:           { vi: { ri: { tumorPresent?, missed?, hallucinated? } } }  # GTV v3, sparse
       ├─ truthAbsent / predPresent           # V2 legacy (V3 자동 migration, v4에서 제거 예정)
       ├─ usability:           { vi: { ri: '1'..'5' } }
       ├─ variant:             { ti: { ri: '1'..'5'|'❌' } }
       ├─ specs:               { ri: { ci: bool } }
       ├─ *Comment:            { vi/ti/ri: string }
       ├─ reviewerComment, reviewConfidence
       └─ schemaVersion (3), reviewerEmail, updatedAt

evaluations/{evalId}                       # legacy 컬렉션 (구도구 데이터, 읽기 전용)
audit/{eventId}                            # critical action 로그 (본인 것만 read)
```

**핵심 디자인 결정**:
- 공유 config (rois, validations 등)와 평가 데이터 (reviews)를 분리 — 여러 reviewer가 한 모델을 평가
- GTV `detection`은 **sparse object** — default 값 (TP case)은 저장 안 함, Firestore 문서 크기 최소화
- Negative case set이 따로 있는 게 아니라 한 모델에 섞여있음 → per-cell `tumorPresent: 'N'`으로 자연 표현 (project-level flag 없음)
- Migration은 client-side에서 자동 (`migrateReviewSchema()` 단일 진입점 — `loadState` + `applyReviewToState` 둘 다 호출)
- `getCompState4(vi, ri)` = `deriveDetectionState(getDetection(vi, ri))` — UI/stats/export single source

---

## 5. 핵심 UI/UX 디자인 결정 (왜 그렇게 했는가)

### A. 사이드바 트리 (모델 → 평가자)
- 모델 클릭 = 내 평가 로드 (default), chevron = expand (lazy fetch)
- 다른 평가자 클릭 시 자동 read-only — Firestore rule이 본인 review만 write 허용
- **이유**: multi-rater 시나리오에서 동료 평가를 참고할 때 빠르게 토글

### B. GTV Completeness Evolution → 현재 형태 (compact + on-demand popover)

**Evolution**:
1. V1: TP/FN/FP/TN 4-state dropdown 직접 선택 → 사용자 "직접 고르기 어렵다"
2. V2: 실제(Truth) + 추론(Pred) 2 체크박스 → 직관적이지만 single-target 가정
3. V3 (framework v3): 3-input always-visible (Tumor Y/N · Missed bin · Hallucinated bin) → multi-island 표현 가능, but "매번 dropdown 내리기 부담"
4. **V3.1 현재 (2026-05-21)**: compact display + on-demand popover editor
   - 셀 default 상태: 4-state badge (TP/FN/FP/TN)만 노출
   - 셀 비-default: 4-state + 작은 annotation (`M:1-2`, `H:1-2`)
   - 셀 click/Enter/Space → popover editor (3-input 모두 노출)
   - ESC / 바깥 클릭으로 닫기, "이 셀 초기화" link 포함
   - 대부분 TP인 경우 클릭 없이 default 자동, 필요한 셀만 편집

- **이유**: indication-agnostic universal framework (GTV CQA Framework v3). single-target/multi-target 분기 없이 모든 GTV case 동일 schema. 그리고 reviewer의 작업 부담 최소화.

### C. Negative case는 per-cell, project-level flag 없음
- 초기 Sprint 4에서 `isNegativeCaseProject` 모델 flag 도입 → 사용자 피드백: "negative case set이 따로 있는 게 아니라 섞여있어요"
- **변경**: project flag 제거 (state 필드는 backward compat 보존). Negative case는 그 환자의 셀만 `tumorPresent: 'N'`으로 명시
- **이유**: 실제 임상 dataset은 positive/negative가 한 model의 같은 patient pool 안에 섞여있음. 모델 단위 flag는 잘못된 가정.

### D. Indication subtype 시스템 제거
- 초기엔 GBM/LiverMets/Cervix별로 hard-coded patient metadata field set
- 사용자 피드백: "새 indication 들어올 때마다 코드 수정. 유연성 부족"
- **변경**: subtype + Patient Metadata 카드 완전 제거. OAR/GTV 두 모드만 + subMetricLabels owner-defined
- **이유**: 임상 도구는 다양한 cancer site 지원해야 하는데 hard-coded는 확장성 zero. Framework v3 §4 원칙.

### E. 카드 island 줄이기
- 사용자 피드백: "island가 너무 많아 번잡해"
- **변경**: shadow 제거, collapsed 카드 = `bg-subtle` + compact padding, 카드 간 spacing mb-4 → mb-2, radius 12 → 8px

### F. 그리드 cell 폭 cap + PatientID wrap
- 사용자 피드백: "전체화면했을때 너무 넓어져서 어색" / "환자 ID 길면 칸에서 튀어나옴"
- **변경**: `minmax(90px, 140px)` cap, PatientID `-webkit-line-clamp: 2` + hover expand

### G. 데스크탑 전용
- 사용자 피드백: "이거 모바일로 들어가는 사람 없을텐데"
- 모바일 media query / Tailwind `md:*` responsive class 모두 제거

### H. Design token + Dark mode
- 80+ CSS variable로 모든 색상/spacing 추상화
- `:root[data-theme="dark"]` 만 변경하면 다크 모드. `@media (prefers-color-scheme)` 자동 감지 + 수동 토글 (☀/☾)
- FOUC 방지를 위해 head에 인라인 스크립트로 stylesheet 적용 전 data-theme 설정

---

## 6. 알려진 한계 / 결정 보류

### 기능 측면 (남은 항목만)

1. **Stratified analysis export 없음** — patient metadata가 있어도 그것으로 break-down 안 됨. 사용자 정의 metadata 시스템 부활하면 진행.
2. **Per-lesion nested data model 없음** — Liver mets처럼 한 환자에 여러 lesion인 경우, 현재는 사용자가 lesion 카테고리별 ROI를 직접 만듦. 진짜 nested `patient.lesions[]` 구조는 모든 grid render 함수 refactor 필요. 하지만 framework v3 §1 "single-target vs multi-target 분기 없음" 원칙 + V3 unified detection의 `missed: 'few/several/many'` bin이 multi-island count를 충분히 capture하므로 **현재로선 필요성 낮음**.
3. **사용자 정의 patient metadata 없음** — indication별 / 모델별 임상 정보 필드를 사용자가 정의할 수 없음 (subMetricLabels는 owner-defined인데 patient metadata는 자유 텍스트 comment만).
4. **권한 모델 단순** — owner / member 두 단계. read-only viewer, admin 같은 세분화 없음.
5. **초대 흐름 단순** — 모델 ID 공유로 셀프 join. 정식 invitation/approval 흐름 없음.
6. **Multi-rater agreement 부분 구현** — Fleiss κ (usability + specs binary) 완료. Pairwise kappa / ICC / weighted kappa는 미구현.
7. **Sensitivity / FP rate 구조적 cutoff threshold 미구현** — 현재는 usability 평균 기반 cutoff. GTV의 sensitivity/specificity-aware threshold는 미래 추가.

### 데이터 모델 측면

- **공유 config last-write-wins** — 멤버 누구나 ROI/cutoff 수정 가능. 동시 편집 시 충돌 가능성. 본격 multi-rater 시 owner 전용 제한 또는 collaborative editing 고려.
- **Mode 전환 시 데이터 의미 변화** — OAR `completeness=true` (missing)와 GTV `detection`은 자동 매핑 안 됨. 평가 도중 mode 바꾸면 셀 재입력 필요. 데이터 있을 시 confirm dialog 표시.

### 코드 품질 측면

- **2700줄 단일 script.js** — 모듈 분리 안 됨. 인라인 `onclick` 핸들러 호환 위해 ES module 안 씀. 다음 sprint 후보(피드백 권장 IIFE namespace 패턴).
- **Render 함수가 매번 full re-render** — `renderCompletenessGrid()` 호출 시 전체 HTML 재생성. 100+ 환자 × 10+ ROI에서 lag 가능. 측정 후 incremental DOM patching 검토.
- **Test**: pure function smoke test만 (`tools/test-migration.js`, 30 assertions). E2E (Playwright) 미도입.

---

## 7. 완료된 작업 (timeline)

### 2026-05-21 — Compact cell + popover editor (사용자 피드백 반영)
- ✅ Sprint 4 rollback — project-level `isNegativeCaseProject` UI 제거 (state 필드는 deprecated 보존). Negative case는 per-cell `tumorPresent: 'N'`로 자연 처리.
- ✅ GTV cell V3.1: compact 4-state badge + on-demand popover editor. 대부분 TP case는 클릭 없이 default 적용. 필요한 셀만 클릭해서 missed/hallucinated 입력.
- ✅ Summary GTV 박스: single mode (FP rate + Miss rate 둘 다 표시), negative-mode 분기 제거

### 2026-05-21 — Sprint 3: Project metadata
- ✅ state.modality / modalityDetail / evaluationStage / modelVersion (free string, informational)
- ✅ "📐 모델 메타데이터" collapsible card (Reviewer Note 다음, Cutoff 앞)
- ✅ 사이드바 model row badge (modality / stage / version)
- ✅ XLSX A. Summary에 메타데이터 블록 추가
- ✅ Owner-only edit

### 2026-05-21 — GTV CQA Framework v3 적용 (Sprint 1 + 2)
- ✅ Schema v3 — `state.detection[vi][ri] = { tumorPresent?, missed?, hallucinated? }` sparse, default 미저장
- ✅ DETECTION_DEFAULTS / COUNT_BINS 상수 + `deriveDetectionState()` single source
- ✅ Migration V2→V3 (legacy `truthAbsent`/`predPresent`는 보존, v4에서 제거 예정)
- ✅ Stats/Export: 4-state count + Miss rate + Missed bin row + Hallucinated bin row
- ✅ Cutoff GTV hint amber (sensitivity 우선 권장)
- ✅ Smoke test: 30 assertions 통과 (V1→V2, V2→V3, deriveDetectionState)

### 2026-05-20 — 외부 피드백 기반 정리
- ✅ Section 순서 1→2→3-6→7-8→A (numerical reading)
- ✅ Cutoff 정의 한 줄 설명 + 헤더 tooltip
- ✅ `migrateReviewSchema` 단일 진입점 (refactor)
- ✅ Firestore read rule 점검 — 모두 멤버십 확인됨
- ✅ Audit trail collection
- ✅ Toast notification (14개 alert 교체)
- ✅ Inter-rater Fleiss κ (ROI별 usability + sub-metric별 specs binary, 30 assertions test)
- ✅ Sub-metric 라벨 owner-defined (`subMetricLabels`)
- ✅ Mode 전환 confirm
- ✅ 모델 ID 복사 버튼 (📋, hover 시)

---

## 8. 피드백 받고 싶은 영역

### A. 유연한 metadata 시스템
임상 indication별 patient metadata는 다양함 (GBM은 pre-op 여부, Liver는 primary cancer, Cervix는 T-stage 등). hard-coded 방식 (subtype별 META_FIELDS)은 새 indication마다 코드 수정 필요해 제거함.

현재는 자유 텍스트 코멘트 + per-patient/test ID에 임상 노트 작성. 더 정형화된 metadata 시스템이 필요한지, 필요하면 어떤 패턴이 좋을지?

- Option 1: 모델 owner가 생성 시 metadata schema 정의 (JSON array of field defs)
- Option 2: 자유 텍스트 코멘트만 사용 (현재)
- Option 3: Cloud function이 indication별 권장 schema 제공
- 다른 패턴?

(현재 `subMetricLabels`는 Option 1 패턴으로 owner-defined — 미래에 patient metadata도 같은 패턴 확장 가능)

### B. Multi-rater agreement 시각화 (부분 구현됨)
Fleiss κ (usability + sub-metric binary)는 client-side로 계산해서 별도 collapsible section에 표시됨. 추가로:
- Pairwise kappa (reviewer 쌍별 일치도)?
- Per-patient agreement (어느 환자가 가장 ambiguous한지)?
- Weighted kappa (ordinal로 1↔2 일치 vs 1↔5 일치 차별)?
- ICC (continuous metric)?

어디까지 in-app으로 갈지, XLSX 별도 시트로 출력만 할지 외부 의견.

### C. 큰 데이터셋 성능
현재 그리드는 매번 full re-render. 100+ 환자 × 10+ ROI 시나리오는 아직 안 와봤음.
- Virtualization 필요? (clinical scale ~200 case이라 over-engineering 의심)
- Incremental DOM 패치 (한 셀만 업데이트)?
- 측정 우선 — Chrome DevTools Performance tab에서 input event → paint 시간

### D. UI/UX 군더더기
현재 디자인 (https://cqa-input-tool.web.app)에서 어색한 부분이 있는지. 특히:
- Popover editor가 키보드 흐름과 어울리는지 (Tab navigation 등)
- 사이드바 model 트리의 정보 density (badge 4개 + reviewer 리스트)
- Default state cell이 4-state badge만 보이는 게 충분한지, 아니면 더 explicit hint 필요한지

### E. 데이터 모델 / 아키텍처
- V3 `detection` sparse object 패턴 (default 안 저장) — clean한가? Multi-island count(bin)을 객체에 묶은 vs 별도 field 보존이 좋을지?
- `migrateReviewSchema` 단일 진입점 — 미래 V4 등 추가 시 어떻게 확장하면 좋을지
- Firestore rule이 멤버십 확인을 위해 `get()` 호출 — 비용/성능 영향 (현재 800ms debounce라 영향 미미해 보임)

### F. 임상 도메인 측면
- GTV CQA Framework v3 (indication-agnostic universal scheme) 적용이 임상의에게 자연스러운지
- 4-state Completeness를 3-input (Tumor / Missed / Hallucinated)으로 derive하는 게 임상 mental model과 잘 맞는지
- Compact + popover UX가 평가 흐름을 방해하는지 (vs always-visible 3-input)
- Cutoff 시스템 (A/B/C 타입별 avg + 비율) — sensitivity/FP rate 기반 threshold 필요한가, 아니면 현재 usability 평균 기반으로 충분한가

### G. 보안 / 권한
- workspace 도메인 제한 + member-based ACL이 임상 데이터에 충분한가?
- Audit trail은 critical action만 — review save 같은 빈번한 write는 audit 안 함 (cost 우려) — 적절한 trade-off인지
- Firestore 비용 관리 — 대량 쿼리 가드, 잘못된 인덱스 등에 대한 권장 사항

---

## 9. 사용 시나리오 (참고)

### 시나리오 1: 새 GBM CQA 평가 시작 (typical)
1. 사이드바 `＋ 새 모델` → 이름 입력 (예: "GBM_v1_2026Q2")
2. 모델 메타데이터: modality "MR · T1c+FLAIR", stage "pre_release", version "v0.3.1"
3. ROI 목록 추가 (`brain_gtv`)
4. Validation 환자 일괄 입력 (37명 Brain GTV cases)
5. Cutoff 타입 ROI에 지정 (A=엄격)
6. 평가 유형 GTV 선택
7. ROI Completeness 그리드:
   - 대부분 셀은 TP (default, 클릭 없음)
   - AI가 놓친 환자: 셀 클릭 → popover에서 Missed `1-2` 선택 → FN으로 자동 변환
   - Negative case (tumor 없는 환자): 셀 클릭 → Tumor N → TN
   - AI hallucination: Hallucinated `1-2` → FP
8. Usability score 입력 (Tab/Enter 빠른 navigation)
9. Specifications 3-6 체크
10. Summary 탭에서 GTV 전체 지표 확인 → XLSX 다운로드

### 시나리오 2: 동료 평가 검토 / Inter-rater
1. 사이드바에서 동료 모델의 chevron 클릭 → 평가자 리스트 expand
2. 동료 reviewer 클릭 → 그 사람 데이터 read-only로 로드 (노란 배너)
3. 내 평가로 돌아가 → 모델명 클릭
4. Summary 아래 Inter-rater section 펼침 → Fleiss κ + Landis & Koch 해석 확인

### 시나리오 3: 큰 multi-island dataset
- Brain mets 환자 (한 환자에 lesion 20+)
- 셀에 `{Y, few, few}` 입력 → 4-state는 FN으로 분류되지만 count info 보존
- 환자 코멘트에 "21/62, extremely small multiple mets" 같은 노트 추가
- XLSX export에 `"FN (M:1-2, H:1-2)"` 형태로 나옴

---

## 부록: 화면 구성 (text mockup)

```
┌─────────┬──────────────────────────────────────────────────────┐
│ MODELS  │  CQA Input Tool                ☀ 로그아웃 [...] ⬇XLSX  │
│ ＋ 새모델│ ────────────────────────────────────────────────────  │
│ 🔗 참여  │  [모델명: GBM_v1____]   [Notion 링크: _____]          │
│         │  평가 유형 [ OAR │ GTV ]                              │
│ ▼ GBM_v1│  ────────────────────────────────                     │
│  [MR][v0.3]│  ▼ 📐 모델 메타데이터                              │
│  •나(3분)│  ▼ 📝 평가자 노트                                    │
│  •other  │  ▼ 🏷 3-6 Sub-metric 라벨                            │
│   (1일전)│  ▼ 🎚 Cutoff 기준 정의                               │
│         │  ┌───────┬─────────┬─────────┐                       │
│ ▶ Cervix│  │ ROI    │ Val patient│ Test  │                     │
│ ▶ Liver │  └───────┴─────────┴─────────┘                       │
│         │  ▼ 1. ROI Completeness                                │
│         │     [Patient × ROI grid: TP/FN/FP/TN badges]          │
│         │     클릭 → popover (Y/N · Missed · Hallu)              │
│         │  ▼ 2. Clinical Usability                              │
│         │  ▼ 3-6. Specifications                                │
│         │  ▼ 7-8. Variant cases                                 │
│         │  ▼ A. Summary (PASS/FAIL + GTV 지표)                  │
│         │  ▼ 👥 Inter-rater agreement (Fleiss κ)               │
└─────────┴──────────────────────────────────────────────────────┘
```

---

이상이 현재 상태입니다. 어느 영역이든 솔직한 피드백 환영합니다.
