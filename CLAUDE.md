# CQA Input Tool

OAR autosegmentation 평가용 단일 페이지 웹 도구. Firebase Hosting + Firestore 백엔드. GTV 평가(GBM/Cervix/Liver mets) 지원을 위한 확장 작업 진행 중.

배포: https://cqa-input-tool.web.app/

## 현재 작업

GTV 확장 사양은 [CQA_Input_Tool_GTV_Extension_Spec.md](./CQA_Input_Tool_GTV_Extension_Spec.md)에 정의.

- **Phase 0 (완료)**: localStorage → Firestore 마이그레이션, Google Sign-In (oncosoft.io workspace 제한), 모델별 데이터 격리, multi-reviewer 데이터 모델, Legacy `evaluations` 컬렉션 읽기 전용 노출, 사이드바 트리(모델 → 평가자), 카드 collapsible
- **Phase 1 (미착수)**: GBM single-target 지원 (Indication selector, 4-state Completeness, GBM sub-metric, patient metadata) — 스펙 §결정사항 6개 답 확정 필요
- **Phase 2 (미착수)**: Liver mets multi-target (Patient → Lesion nested data model)
- **Phase 3 (미착수)**: Cervix + reviewer metadata + stratified analysis

## 아키텍처

빌드 도구 없는 정적 파일 + Firebase:

- `index.html` — Tailwind/xlsx-js-style/Firebase compat SDK CDN, 좌측 사이드바(모델→평가자 트리), 아코디언 섹션 구조 (`section-wrap`), collapsible 카드 (Cutoff/ROI/Validation/Test)
- `script.js` — **비모듈 일반 스크립트**. 인라인 `onclick` 핸들러(`toggleSection`, `toggleCard`, `copyTabMd` 등)와 호환 필요. 상태/렌더링/엑셀/MD/PDF/클라우드 동기화 전부 여기.
- `style.css` — 그리드/칩/섹션/카드/PDF 인쇄/sync 상태/사이드바 트리 스타일
- `firebase-config.js` — `window.CQA_FIREBASE_CONFIG` 전역 노출 (비모듈). 로컬에서 채우고 Hosting 시 함께 배포.
- `firestore.rules` — 도메인 제한(`@oncosoft.io`) + 멤버 기반 권한 + 셀프 join + `evaluations` 읽기 허용
- `firebase.json` — Hosting + Firestore 설정 (script.js/style.css 캐시 비활성화)
- `firestore.indexes.json` — 빈 인덱스

### 왜 modular SDK가 아니라 compat SDK?

index.html에 `onclick="toggleSection(this)"`, `onclick="toggleCard(this)"`, `onclick="copyTabMd(...)"` 등 인라인 핸들러 다수 → script.js 함수들이 `window` 글로벌이어야 함 → ES 모듈 전환 시 모두 깨짐. Firebase **compat SDK** (`firebase-app-compat.js` 등)를 사용해 전역 `firebase` 객체로 통일.

### 데이터 모델

```
projects/{projectId}                       # 모델(공유 설정: rois, validations, cutoff 등)
  ├─ name, notionLink, cutoffDefs, rois[], roiCutoffs[], validations[], tests[]
  ├─ owner: uid, members: [uid, ...]
  └─ reviews/{reviewerUid}                 # per-reviewer 평가 데이터
       └─ completeness, usability, variant, specs (+ comments), reviewerEmail

evaluations/{evalId}                       # Legacy (구버전 도구 데이터, 읽기 전용)
  └─ projectName 또는 name, rois, validations, completeness, usability, ...
```

- **모델 = `projects/{id}`** (UI 라벨은 "모델", 데이터 컬렉션은 `projects` 유지)
- 같은 모델을 여러 reviewer가 열어도 **각자의 `reviews/{uid}` 문서만 수정**
- 공유 config은 모든 멤버가 수정 가능 (last-write-wins) — 본격 multi-rater 시 owner 전용 제한 고려
- 모델 ID = `{slug}_{base36 timestamp}` → invitation code 역할. 셀프 join 가능
- `evaluations`는 이전 도구의 legacy 평가. 새 도구에서는 **읽기 전용** + 사이드바에 🔒 + `Legacy` 태그로 표시

### 상태 모델 (`script.js`)

In-memory `state` 객체는 클라우드/로컬 양쪽 모두 같은 shape. 모드 식별자:

- `currentUser` — 로그인된 Firebase Auth user
- `currentProjectId` — 현재 보고 있는 모델 ID
- `currentReviewerId` — 현재 보고 있는 평가자의 uid (legacy면 null)
- `currentReadOnly` — true이면 모든 쓰기 차단 (legacy 또는 타인 평가 보기)
- `firebaseReady` — config가 실제로 채워졌는지
- `suppressSave` — Firestore에서 데이터 로드 중 echo write 방지
- `modelReviewersCache: Map<modelId, [reviewers]>` — 사이드바 확장 시 lazy fetch + 캐시 (저장 시 invalidate)
- `expandedModels: Set<modelId>` — 사이드바 펼침 상태

`loadState()`는 localStorage 폴백 (로그아웃 시). `saveState()`는 localStorage 즉시 + `scheduleCloudSave`로 800ms 디바운스 후 Firestore 쓰기. 읽기 전용 모드면 saveState 자체가 skip.

### 클라우드 동기화 흐름

- `initFirebase()` (init 마지막) — config가 placeholder면 로컬 모드 유지, 아니면 compat SDK 초기화 + persistence + `onAuthStateChanged`
- 로그인: 도메인 검증 → `onUserAuthenticated` → `fetchUserProjects` + `fetchLegacyEvaluations` 병렬 → 사이드바 렌더 → 마지막 사용 모델 로드 (없으면 마이그레이션 prompt)
- 모델 클릭 → `loadProjectFromCloud(id)` → legacy면 별도 분기, 일반이면 `loadReviewerEvaluation(modelId, currentUser.uid)`
- 평가자 클릭 → `loadReviewerEvaluation(modelId, otherUid)` → uid 다르면 자동 `currentReadOnly = true`
- 자동 저장: input → `saveState` → 디바운스 → `projects/{id}` + `reviews/{uid}` 동시 `set(merge)` → `modelReviewersCache.delete(currentProjectId)`
- Offline persistence: `fbDb.enablePersistence({ synchronizeTabs: true })` → IndexedDB 큐잉
- 페이지 닫기: `beforeunload`로 best-effort flush

### UI 구조

- **사이드바** (로그인 시 노출, ☰로 접기/펼치기): 모델 트리 + `＋ 새 모델` + `🔗 모델 ID로 참여`
  - 각 모델 행: chevron(▶/▼) + 이름 + 메타(수정시각, `공유`/`Legacy` 태그)
  - 펼침 시 reviewers 서브컬렉션 lazy fetch → 평가자 리스트 표시 (자기 자신 placeholder 포함)
- **상단 헤더**: 동기화 상태 표시, 로그인/로그아웃, JSON 불러오기/저장, XLSX/PDF/MD 내보내기
- **본문 상단**: 읽기 전용 모드일 때 노란 배너 ("🔒 Legacy 평가" 또는 "🔒 다른 평가자의 데이터")
- **collapsible 카드**: Cutoff, ROI 목록, Validation 환자, Test 환자 (모두 기본 접힘, `toggleCard(this)` 인라인 핸들러)
- **아코디언 섹션**: 1. Completeness / 2. Usability / 7-8. Variant / 3-6. Specs / A. Summary (PR #4에서 탭→아코디언 전환)

### XLSX 생성 (`buildWorkbook`)

`xlsx-js-style`로 셀 단위 스타일. 시트 간 cross-reference는 **엑셀 수식**. `A. Summary` 시트가 PASS/FAIL의 SoT. GTV 확장 시 indication별 sheet schema 분기 필요.

## 작업 시 주의

- **데이터 출처 우선순위**: 로그인 → Firestore가 SoT. 로그아웃 → localStorage
- **script.js는 비모듈**: `import` 쓰지 말 것. 인라인 핸들러용 함수는 `window` 전역이어야 함 (현재는 함수 선언이 곧 전역)
- **state shape 변경 시 마이그레이션**: `loadState()`의 default backfill + `applyProjectConfigToState`/`applyReviewToState`/`applyLegacyEvaluationToState` 모두 새 필드 default 처리. `SCHEMA_VERSION` 증가 시 server-side migration 필요
- **Sparse object 규칙**: `setCell`/`getCell` 사용. Firestore는 nested map 그대로 받음
- **수식 우선**: 엑셀 cross-sheet 값은 정적 복사 X, 수식 O
- **Firestore 권한 변경 시 배포**: `firebase deploy --only firestore:rules`
- **`firebase-config.js`의 apiKey는 비밀이 아님** (Web SDK 특성). 보안은 `firestore.rules`에서
- **Build/test 없음**: `firebase serve`로 로컬 테스트 (file:// 는 SDK CORS로 안 됨)

## Firebase 초기 설정 (1회, 완료됨)

1. **Firebase Console** → `cqa-input-tool` 프로젝트
2. **Authentication** → Google sign-in 활성화 ✅
3. **Firestore Database** → `asia-northeast3` (서울) ✅
4. **`firebase-config.js`** ✅ apiKey 등 채워짐
5. `firebase use cqa-input-tool` ✅
6. `firebase deploy --only firestore:rules,firestore:indexes,hosting`
7. 로컬 테스트: `firebase serve` → http://localhost:5000

## 알려진 제약 / 결정 필요

- **공유 config edit 권한**: 멤버 누구나 수정 (last-write-wins). 본격 multi-rater 시 owner 전용 제한 고려
- **프로젝트 초대**: 모델 ID 알면 누구나 셀프 join. Cloud Function 기반 정식 초대 흐름 미구현
- **읽기 전용 UX**: 저장만 차단되고 input 자체는 편집 가능. 시각적 disable 필요시 폴리시
- **`databaseURL` (Realtime DB)**: `firebase-config.js`에 포함되어 있지만 사용 안 함. 제거 가능
- **스펙 §결정사항 6개**: Phase 1 착수 전 답 확정 필요 ([CQA_Input_Tool_GTV_Extension_Spec.md](./CQA_Input_Tool_GTV_Extension_Spec.md) 말미 참조)

## 참고 파일

- `script_test.js` — 작업 초반의 옛 사본 (untracked, 4월 22일). 미사용 추정
- 이전 PR 히스토리:
  - #1: Notion용 MD 복사 버튼 (각 탭)
  - #2: 6가지 UX 개선 (전체 MD 복사, 색상 코딩, 진행바 등)
  - #3: 클립보드 안정성
  - #4: 탭 → 아코디언 + PDF 내보내기
  - #5: 아코디언/PDF 버그 fix + 전반 디자인 개선
