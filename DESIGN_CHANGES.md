# Design Refresh — 2026-05-20 자율 작업 기록

## 목표
- **군더더기 제거**: gradient, 과도한 shadow, hover translateY 등 dated 트렌드 정리
- **차분한 톤**: 임상 데이터 입력 도구에 맞는 절제된 색감 + 일관된 spacing/typography
- **데이터 가독성**: 그리드 셀, 통계 셀, summary table의 정보 밀도 + 명확한 hierarchy
- **2026 디자인 트렌드 반영**: design token (CSS variable) 체계, flat over gradient, tabular nums, 더 작은 radius, 부드러운 micro-interaction

각 iteration마다 변경 사항/이유/판단을 누적 기록합니다.

---

## Iteration 1 — Foundation refresh

### Before
- 색상이 코드 곳곳에 hard-code (`#6366f1`, `#1e293b`, `#eef2f7`, ...)
- gradient 빈번 (헤더 그라데이션, btn-primary 그라데이션, summary table 헤더 그라데이션, banner 그라데이션, 사이드바 shadow 등)
- box-shadow가 카드/섹션/버튼/chip에 누적되어 시각적 노이즈
- 버튼 hover에 `transform: translateY(-1px)` — 2020-2022년 트렌드, 지금은 과하다
- radius가 4/6/8/10/12/20/9999 등 들쭉날쭉
- 기본 폰트가 시스템 폰트 (한글은 Apple SD Gothic Neo / Segoe UI fallback)
- Tailwind 기본 `#eef2f7` 차가운 푸른 배경

### Change
1. **디자인 토큰화** — `:root`에 CSS variable 80+개 정의 (surface, text, border, semantic, GTV 4-state, radius, shadow, transition)
2. **Pretendard 폰트 도입** — `Pretendard Variable` CDN, 한글-영문 통일된 modern sans-serif
3. **gradient 전면 제거** — 섹션 헤더, 버튼, summary 헤더, banner 모두 flat color
4. **그림자 정제** — 카드/섹션 `0 1px 2px` 단일 톤, hover에서 들썩이지 않음. sidebar는 그림자 아예 제거 (border-right로만 구분)
5. **radius scale 통일** — `--r-xs 4 · --r-sm 6 · --r-md 8 · --r-lg 12 · --r-pill 999`
6. **`transform: translateY` 제거** — 버튼/카드 hover에서 들썩이지 않고 색상만 변함. 차분한 인터랙션
7. **typography 정제**
   - 본문 14px / 1.5 line-height
   - 헤더 letter-spacing + uppercase로 미세한 정보 위계
   - `font-feature-settings: 'tnum'` — 데이터 테이블에 tabular nums 자동 적용 (숫자 정렬)
8. **focus ring 통일** — `--focus-ring: 0 0 0 3px rgba(99,102,241,0.22)`. 모든 inputs/buttons 동일 외관
9. **sync status에 dot indicator** — `::before`로 6px 원 + pulse 애니메이션 (저장 중)
10. **배경색 살짝 따뜻하게** — `#eef2f7` (차가운 푸름) → `#f6f7f9` (off-white)
11. **read-only 배너** — gradient → flat amber-50 + 명확한 border

### Why
- design token이 있으면 일관성 보장 + 다크 모드 future-proof
- gradient 제거는 2024-2026 modern UI의 기본 (Linear, Vercel, Stripe 모두 flat)
- transform-on-hover 제거는 더 차분한 UX (의료 도구는 산만함 최소화)
- Pretendard는 한글-영문 mix 환경에서 글자 너비/굵기 균형이 좋음
- tabular nums는 데이터 비교 시 시각적 정렬 (5.00 vs 5.55 같은 숫자가 칸 정렬)

---

## Iteration 2 — 평가 후 디테일 다듬기

### 평가 발견점 (배포된 Iteration 1 본 후)
- **헤더 버튼 8개가 한 줄에 가지런히** → 시각적 산만. Primary와 secondary가 같은 비중으로 보임
- **Indication 라디오 버튼** native HTML 그대로 → 어색하고 modern 톤과 안 맞음
- **모델명/Notion 입력**에 placeholder 없음 → 사용자가 어떤 값을 넣어야 하는지 힌트 부족
- **Section 헤더의 3px 인디고 strip** → 모든 섹션에 동일하게 적용되니 강조가 아닌 noise가 됨
- **chip의 cutoff select 배경** `#c7d2fe` (indigo-200) → 다른 부분과 톤 mismatch, 너무 saturated

### Change
1. **Header secondary buttons → `.btn-group`** — `📂 💾 📋 🖨 🗑` 다섯 개를 segment처럼 묶음. 배경 muted bg 위에 hover만 카드처럼 떠오름. Primary XLSX 단독 분리.
2. **Indication selector → segmented control** — 라디오 버튼 hidden, `:has(input:checked)`로 활성 label에 카드 외관. Modern macOS/iOS toggle 패턴.
3. **모델명 placeholder** — "예: GBM_v1_2026Q2", Notion: "노션 페이지 URL 또는 자유 메모"
4. **input label 정제** — `(파일명에 사용)`, `(선택)`을 부가 텍스트로 분리. mb-1 → mb-1.5
5. **subtype dropdown 라벨 정리** — "— Subtype:" → 그냥 "subtype" (양옆 dash 제거)
6. **section-hd border-left 제거** — 좌측 3px indigo 바 제거. bg + bottom border + 굵은 폰트로 위계 표현. 더 차분.
7. **chip select 색상** — `#c7d2fe` → `rgba(99,102,241,0.12)` (token 기반 subtle alpha overlay). hover 시 0.18로 미세 강조.
8. **h1 크기 다운** — `text-2xl` (24px) → `text-xl` (20px) + `tracking-tight`. 헤더 무게감 줄임.
9. **subtitle 톤 다운** — `text-sm` (14px) → `text-xs` (12px). 보조 정보로 명확화.

### Why
- 8 버튼을 다 보여주되 hierarchy 부여 (group + outline의 secondary, filled primary)
- Segmented control은 native radio보다 한 번에 옵션 비교가 쉽고 modern UX 표준
- Placeholder는 사용자의 인지 부담 감소 + 잘못된 입력 방지
- Section 헤더의 좌측 strip이 5개 섹션에 모두 있으면 신호가 noise가 됨. 제거 후 typography로 충분

---

## Iteration 3 — Data grid + Summary table

### 평가 발견점
- **그리드 cell의 missing/FN 상태**가 단순 배경색만으로 표시 → 색약 사용자나 빠른 스캔 시 놓치기 쉬움
- **score-low/score-mid** 빨강/노랑 배경만 있고 다른 신호 없음
- **summary table** 모든 셀에 border가 둘러진 grid 스타일 → 옛날 spreadsheet 느낌
- **헤더 uppercase 강제** → 영문은 OK, 한글은 무의미 (`텍스트-위`는 의미 없음)
- **stat row와 데이터 row 사이 시각 분리 부족** — 어디까지가 환자 데이터고 어디부터가 통계인지 불분명

### Change
1. **Missing / FN cell에 좌측 3px 빨강 strip** — 색상 + 형태 dual signal (색약 접근성)
2. **score-low / score-mid**에도 좌측 색상 strip — 일관성
3. **summary table 격자 → 행 구분만** — 모든 td border 제거, border-bottom 1px만. 마지막 행 border 제거. 마지막 줄에 noise 안 남음
4. **summary header padding 증가** + `text-transform: uppercase` 제거 (letter-spacing은 유지)
5. **stat row 위 1px border-top** — 데이터 vs 통계 명확히 구분
6. **stat row label** font-size 11px + letter-spacing — 통계임을 한눈에 인지
7. **grid header letter-spacing** 0.02em → 0.04em (수치 미세 조정)
8. **grid header border-bottom 1px** — 헤더와 데이터 영역 구분

### Why
- Strip은 데이터 시각화 분야에서 표준 (Datadog/Grafana 등에서 critical row 표시)
- Border가 적은 테이블은 modern (Linear/Notion 테이블 패턴). 정보 자체에 집중
- 색 + 형태 dual signal은 WCAG accessibility 권고

---

## Iteration 4 — Sidebar 정제 + Summary GTV 박스 리디자인

### 평가 발견점
- **GTV 전체 지표 박스** — Tailwind `bg-amber-50 border-amber-200` 라이브 inline 마크업 → 디자인 시스템 밖, 그라데이션 없지만 그냥 박스 하나
- **사이드바 새 모델 / 참여 버튼** — `btn btn-sm w-full`로 generic 버튼 외관 → 사이드바 컨텍스트와 안 어울림 (border가 있음)
- **스크롤바** — OS 기본. Windows에서 두꺼움 / 회색
- **사이드바 actions 영역과 list 영역 간격** — 살짝 답답

### Change
1. **GTV summary 박스를 stat-chip 컴포넌트로** — TP/FN/FP/TN/Miss rate를 각각 chip으로 분리. 각 chip은 해당 4-state 색상 토큰 사용. Miss rate chip은 우측 정렬 + accent-soft 강조.
   - 라벨 + 값을 baseline-aligned (값이 14px 굵게, 라벨 12px). 데이터 우선 시각.
2. **사이드바 actions 버튼 → 투명 ghost** — 기본 transparent border, hover 시 bg-muted. 사이드바 안에서 자연스러움.
3. **커스텀 스크롤바** — `scrollbar-width: thin`, webkit 8px (사이드바) / 10px (그리드). 색상 token 사용. modern apps 표준.
4. **사이드바 actions padding** — 12px → 10px, gap 4px → 2px (더 컴팩트)

### Why
- 정보 위계: 5개 수치를 한 줄로 나열하면 어느 게 중요한지 모름. chip 형식 + Miss rate 우측 강조로 가독성 ↑
- 사이드바는 chrome이지 별도 카드 영역이 아님. 버튼이 카드처럼 떠 보이면 안 됨
- 커스텀 스크롤바는 visual polish의 가장 큰 차이 중 하나 (특히 Windows)

---

## Iteration 5 — 마무리 일관성

### 변경
1. **카드 헤더 h3 일관 처리** — 모든 `.card-hd h3`에 단일 스타일 (13px, weight 600, slate-900, tight letter-spacing, inline-flex로 카운트 span 포함). 인라인 `font-semibold text-sm` 클래스 모두 제거
2. **카운트 표시 자동 톤다운** — `h3 > span:not(.card-hint)`이 자동으로 muted text + light weight. ROI 목록 (5)의 "(5)" 부분이 자동 처리
3. **카드 hint 클래스 통일** — `.card-hint` 한 클래스로 cutoff, reviewer note, patient metadata 모두 동일 스타일 (11px, faint color)
4. **Footer 재디자인** — text-only 한 줄 → `.app-footer` flex layout, 브랜드/dot/설명 분리. 더 정돈된 모습. 32px 상단 여백 + 21px 하단 패딩
5. **`::selection` 색상** — 텍스트 선택 시 accent-soft 색상 (디테일이지만 modern 앱은 보통 신경 씀)
6. **Patient Metadata 카드 hint** "stratified 분석용" 추가 — 카드가 collapsed 상태일 때도 용도가 한눈에

### 결과 (시각적 변경 누적)
- gradient 0개 (이전: 12+ 개)
- shadow가 카드/사이드바에 종속, 버튼은 flat
- radius scale 5단계로 통일
- 색상은 모두 token 기반 (다크모드 추후 도입 시 root 변경만으로 가능)
- 한글 fonts Pretendard로 안정적 weight rendering
- 데이터 표 tabular nums 자동
- 4-state cell에 색상 + 좌측 strip dual signal

---

## Iteration 6 — 마지막 평가 후 미세 폴리시

### 평가 발견점
- **사이드바 active model row** — bg만으로 활성 표시 → 위계가 약함. 다른 항목과 차이가 한눈에 안 들어옴
- **active reviewer item**도 같은 이슈
- **모바일 사이드바** — 펼쳤을 때 본문 위에 떠 있어도 본문이 그대로 보임. 사용자 시선 혼란
- **모션 환경설정** — `prefers-reduced-motion` 미고려 (전정장애 사용자 접근성)

### Change
1. **Active model row 좌측 3px 인디고 bar** — `::before` pseudo, 6px top/bottom inset. bg + indicator dual signal. 5-10개 모델 중에서도 활성 항목 즉시 시각 인지
2. **Active reviewer item 좌측 2px bar** — 동일 패턴, 좀 더 얇게 (계층 위계)
3. **모바일 사이드바 dim overlay** — `body::after`로 viewport 전체에 rgba(15,23,42,0.32). 사이드바 펼침 = 모달 비슷한 컨텍스트 강조
4. **`prefers-reduced-motion` 대응** — 모든 transition/animation 0.01ms로 단축. sync status pulse도 정지

### Why
- Bg + accent strip dual signal은 modern apps의 사이드바 표준 (Linear, Notion, GitHub 모두 비슷)
- WCAG 2.1 Success Criterion 2.3.3 (Animation from interactions) 권고
- 모바일에서 overlay dim은 사이드바를 모달처럼 다루는 UX 컨벤션

---

## 종합 평가

### 5+ iteration 누적 결과

| 영역 | Before | After |
|------|--------|-------|
| 색상 관리 | 50+ hex 하드코드 | `:root` design token + 0 잔여 hex |
| Gradient | 12+ 인스턴스 | 0 |
| Shadow | 카드/섹션/버튼/chip 모두 | 카드 1단계 + sync indicator만 |
| Hover 효과 | translateY + shadow + bg | bg/color 변경만 (차분) |
| Radius | 4/6/8/10/12/16/20/9999 mixed | xs/sm/md/lg/pill 5단계 |
| Font | system stack | Pretendard Variable |
| Tabular nums | 일부 | 데이터 표 자동 |
| Active state 위계 | bg color만 | bg + accent strip dual |
| 색약 접근성 | 색상만 | 색 + 형태 dual (strip) |
| Reduced motion | 미대응 | `prefers-reduced-motion` 처리 |
| 디자인 토큰화 | 없음 | 80+ token + 다크모드 future-proof |

### 다음에 시도할 만한 (시간 부족으로 미적용)
- 다크 모드 (token이 준비됐으니 `[data-theme="dark"]` 정의만 추가)
- 카드 그룹화 (Cutoff + ROI/Val/Test를 하나의 "Setup" 그룹으로)
- Section accordion smooth expand/collapse 애니메이션 (현재 display: none 즉시 토글)
- Toast notification 시스템 (현재 alert 사용 중)
- 키보드 단축키 cheatsheet 모달

---

## Iteration 7 — 화면 활용 + 다크 모드 + 사이드바 모델명 (사용자 피드백)

### 사용자 피드백
1. "왠지모르게 밤티나는데 UI를 좀 더 개선해줘" → 어색한 부분 보완
2. **"테이블 옆 비어있는 공간이 너무 많아"** — 본문 max-width가 모니터보다 작아서 가운데로 몰림
3. **"다크모드도 해줘"**
4. **"사이드바에서 모델명이 길면 잘려보이는데 이것도 개선해줘"**

### Change

**1. 본문 가로 공간 활용**
- `#appMain.max-w-[1600px] mx-auto p-4` Tailwind 제거
- `#appMain` 자체 CSS로 `padding: 16px 24px 24px`, `max-width: none`
- `body:not(.sidebar-collapsed) #appMain { margin-left: 240px }` (사이드바 width 240으로 증가)
- 결과: 와이드 모니터에서 빈 공간 없음

**2. 그리드 셀 stretch (fr 단위)**
- `gridCols()`: ROI cell `${CELL_W}px` → `minmax(${CELL_W}px, 1fr)`
- comment cell: `${COMMENT_W}px` → `minmax(${COMMENT_W}px, 1.5fr)`
- specs grid: 마찬가지로 minmax(110px, 1fr) + comment columns minmax 1.5fr
- Patient Metadata grid도 select/number/text별 fr 분배
- `.g { width: 100%; min-width: max-content }` — 컨테이너에 맞춰 stretch + 컨텐츠 클 때만 가로 스크롤

**3. 다크 모드**
- `:root[data-theme="dark"]` selector로 모든 design token의 dark variant 정의 (50+ 토큰)
- 자동 감지: 인라인 `<script>` (FOUC 방지) — `localStorage` 저장값 또는 `prefers-color-scheme` 기반 초기 설정
- 수동 토글: 헤더에 `☀/☾` 아이콘 버튼 (`.btn-icon`). 클릭 시 light↔dark + localStorage 저장
- 다크 보정: `.chip`, `.btn-primary`, `.btn-dark`, `.read-only-banner`, `body::after` overlay 등 light 전용 색상 따로 처리
- `color-scheme: light/dark` CSS property로 native 스크롤바/form 컨트롤도 자동 매칭
- GitHub Primer 색상 팔레트 참고 (`#0d1117`, `#161b22`, `#cdd2d7` 등)

**4. 사이드바 모델명 multi-line**
- `nowrap + ellipsis` → `display: -webkit-box; -webkit-line-clamp: 2`
- 2줄까지 wrap, 그 이상은 끝에 ellipsis
- `word-break: break-word` — 영문 long string에도 동작
- **hover 시 line-clamp 해제** — full text 보임 (native title tooltip + 인라인 expand 둘 다 작동)
- reviewer list도 동일 처리 (hover 시 wrap)
- 사이드바 너비 220 → **240px** (모델명 여유)

### Why
- Cell stretch는 `minmax(min, 1fr)`이 modern grid 표준 — 작은 ROI 수에선 펼치고 많을 땐 가로 스크롤
- Pretendard + design token 덕분에 다크 모드는 토큰 값만 swap하면 거의 자동
- FOUC (Flash Of Unstyled Content) 방지를 위해 stylesheet 적용 직후 인라인 스크립트로 attribute 설정 (Vercel/Linear 등도 동일 패턴)
- 사이드바 모델명 hover 시 full expand는 native tooltip보다 빠르게 인지 가능 (마우스 정지 없이도 보임)

---

## 2026-05-20 → 21 — UI/UX 획기적 변경 (3-tab architecture)

### 동기
사용자 피드백: *"전반적으로 뭔가 번잡하다는 생각이 들어서, UI/UX를 획기적으로 변경해줘. 나 한시간 뒤에 올게."*

기존 문제:
- 한 화면에 모든 카드(모델 설정, Cutoff, ROI/Val/Test, 메타데이터, sub-metric, reviewer note, 5개 평가 section, summary, interrater)가 stack — 평가자가 어디서 무엇을 해야 하는지 한눈에 보이지 않음
- 모델 설정 / 평가 입력 / 결과 분석이라는 3 phase가 시각적으로 구분되지 않음
- 평가 중에도 cutoff 표가 같이 보여 산만, 결과 분석할 때도 모델 설정 카드가 위에 있음

### Cycle 1 — 3-tab 메인 뷰 (Setup / Evaluate / Results)
- `<nav id="mainTabs">` — 헤더 바로 아래 큰 3-tab bar (icon + label + sub-label)
- 모든 주요 카드/section에 `data-view="setup|evaluate|results"` 속성
- CSS attribute selector + `body[data-active-view]`로 비활성 view 완전 hide (`display: none !important`)
- `switchMainView(view)` JS: 활성 클래스 토글 + localStorage 영속화 + 스크롤 top
- `loadReviewerEvaluation()` 호출 시 Setup view에 있으면 자동으로 Evaluate view로 전환 (사이드바 모델 클릭 → 바로 평가)

**Why**: 3-phase mental model (설정 → 평가 → 분석)을 화면 구조로 직접 반영. Linear/Notion 같은 modern app의 segmented top-tab 패턴. 평가에 집중할 때 무관한 카드가 안 보이는 게 핵심.

### Cycle 2 — Setup tab Hero + 그룹 라벨
- 모델 핵심 정보(모델명, Notion, 평가 유형)를 별도 `.hero-card`로 분리
- Hero input은 underline-only border, 17px / weight 600 (form 같지 않게)
- Setup view 안에 group title — *"모델 환경"* / *"데이터 (ROI · 환자)"* (uppercase 11px 라벨)
- Reviewer Note 카드는 Evaluate view로 이동 (모델 설정 단계가 아님)

**Why**: Setup tab은 정보 hierarchy가 가장 중요한 곳. Hero로 "이 모델은 X" 정체성을 먼저 노출하고, 그 뒤로 환경/데이터 그룹을 stack. 모든 카드가 평등하게 나열되는 기존 구조보다 시각적 위계가 명확.

### Cycle 3 — Evaluate tab context bar + section hover
- `.eval-context-bar` — Evaluate view 상단에 sticky 느낌 컨텍스트 (모델명 / 평가자 이메일 · indication / Completeness 진행 / Usability 진행)
- accent-soft 배경의 좌측 3px accent border — "지금 평가 모드" 시그널
- `updateEvalContextBar()` JS: switchMainView + renderAll 시 자동 호출, 입력 시마다 cell 카운트 갱신
- Section header의 *"📋 MD 복사"* 버튼을 `opacity: 0` + hover/focus 시 노출 — 자주 안 쓰는 보조 액션이라 항상 보일 필요 없음

**Why**: 평가 중 "내가 누구로, 어떤 모델을, 얼마나 평가했는지"를 항상 노출. 진행도가 보이면 동기부여 + 부분 평가 후 돌아왔을 때 컨텍스트 회복이 빠름. MD 복사 같은 부가 버튼은 hover로 격리해서 inline UI 노이즈 감소.

### Cycle 4 — Results hero stats + Sidebar polish
- `.results-hero` — Results view 상단 4-col big number 카드 (ROI PASS% / 평가 완료% / 평가자 N / Fleiss κ 평균)
- ROI PASS%는 80% 이상이면 success-green, 50% 미만이면 danger-red 자동 컬러링
- κ 평균은 `renderInterraterAgreement()` 안에서 유효 ROI 평균으로 계산 후 hero에 push
- Sidebar 모델 항목 active 시 accent-soft 배경 + 모델명 굵게 (단순 색 변경만이 아니라 명확한 selected state)

**Why**: Results는 분석 phase — 큰 숫자 4개로 "PASS 잘 됐나 / 일치도 OK인가" 한눈에 판단. 기존엔 summary 표만 있어서 한참 읽어야 됐음. 사이드바는 모델 N개를 빠르게 switching하는 곳, active state가 명확해야 confusion 줄어듦.

### 통합 효과
- 한 뷰포트에 들어가는 카드 수: 10+개 → 평균 3-5개 (view마다)
- 시각적 정보 위계: hero stat / 컨텍스트 바 / section 카드 / 보조 액션 (hover) 4단계로 분리
- View persistence (localStorage) — 새로고침 후에도 마지막 view 복귀
- data-view attribute selector 방식이라 모든 기존 컴포넌트 코드 그대로 — backwards compat 100%

---

## 2026-05-21 (오후) — 2차 자율 작업 (Cycle 6-10)

### 동기
1차 작업 직후 발견된 이슈와 사용자 피드백:
- 사용자: *"cutoff는 어디로??"* — 카드가 collapsed 상태라 못 찾음 → default expanded로 변경 (hotfix)
- 사용자: *"setup tab이 어디야?"* + *"처음에 보이는 듯 하다가 evaluate만 남아요"* — 탭 버튼들도 `data-view` 속성을 갖고 있어서 view-hide CSS 규칙이 자기 자신을 숨김. `:not(.main-tab)` 추가로 fix (hotfix)
- 사용자: *"놀지말고 더 살펴보고 개선해봐"* — 2차 자율 작업 의뢰

### Cycle 6 — Setup 카드 그룹 재배치
- Setup tab 카드 순서를 의미 그룹별로 재정렬:
  - **모델 환경** 그룹: Hero · Cutoff · Project Metadata · Sub-metric 라벨
  - **데이터** 그룹: ROI / Validation / Test 3-col grid
- Project Metadata와 Sub-metric은 평가 "데이터"가 아니라 모델 "환경" 정보 — 이전엔 데이터 그룹 아래에 있어 의미 위치가 어긋났음
- Group title에 보조 라벨 추가 — "모델 환경 (평가 기준 · 메타데이터)" / "데이터 (ROI · 환자)" — uppercase 11px 메인 + 10px 흐린 보조

**Why**: 같은 모델 설정 작업이라도 *언제* 만지는지가 다름 (cutoff/metadata는 모델 정의 시점, ROI/환자는 평가 데이터 추가 시점). 그룹화로 mental load 감소.

### Cycle 7 — Header overflow menu
- 헤더 우상단 secondary tools 5개 (📂📋🖨💾🗑)를 `⋯` 단일 버튼 + dropdown으로 통합
- `.overflow-menu` — 280px min-width, 항목별 icon + label + 보조 설명 (예: "전체 MD 복사 — Notion 등에 붙여넣기")
- 위험 액션(🗑 초기화)은 `oi-danger` 클래스로 빨간 톤
- 메뉴 외부 클릭 + Esc 키로 자동 닫힘
- 결과: 헤더에 보이는 액션이 8개 → 4개 (XLSX 다운로드 primary + 다크모드 + 로그인 + 더보기 ⋯)

**Why**: 5개의 비슷한 icon 버튼이 일렬로 있으면 *어떤 게 어떤 기능인지* 알기 어려움. 사용 빈도가 매우 낮은 액션(JSON 백업, PDF 인쇄)은 한 단계 더 들어가도 OK. 더보기 메뉴에는 보조 설명을 같이 두어 hover/탐색 부담 해소.

### Cycle 8 — Section header + hint 간소화
- Section body의 verbose hint paragraph (`text-sm text-slate-600 mb-2`)를 통일된 `.section-hint` 스타일로 변경 (12px, 한 줄)
- 본질 정보는 굵게, 보조 정보는 `.hint-aux`로 한 단계 더 흐리게
- 예시: *"각 환자에서 ROI가 누락됐으면 체크하세요. (체크 = 누락, 빈칸 = 존재). xlsx에는 존재 셀이 - 로, 누락 셀이 빈칸으로 저장됩니다."*
  → *"체크 = 누락 · 빈칸 = 존재 · XLSX에는 존재 셀이 `-`로 저장"*
- `code` 인라인 태그도 더 작은 inline pill (background-muted)로 정제

**Why**: Hint는 매번 읽지 않음 — 첫 한 번만 읽고 익숙해지면 시각적 노이즈. 핵심만 한 줄로 압축하고 부가설명은 흐리게. `· 점` 구분자로 시각적으로 짧게 분리.

### Cycle 9 — Empty state onboarding
- Setup tab 상단에 두 가지 onboarding 배너 추가:
  - `#emptyStateBanner` — 로그인 + 모델 미선택 시 노출. "평가를 시작하려면 모델을 만드세요" + "＋ 새 모델 / 🔗 ID로 참여" 버튼 (사이드바 버튼으로 위임)
  - `#signedOutHint` — 로그아웃 + 로컬 데이터 없음 시 노출. "로그인하면 클라우드 동기화 + 멀티 평가자 협업" + "Google 로그인" 버튼
- `updateEmptyStateBanners()` JS — `updateAuthUI` + `switchMainView` 시 자동 호출
- icon 박스 + title + sub-text + action button 구성 (accent-soft 배경 + 좌측 3px accent border)

**Why**: 첫 진입 사용자에게 "다음에 뭘 해야 하는지" 명확하게 안내 — 이전엔 빈 Hero 카드가 나와도 어떻게 시작할지 모름. 사이드바 버튼은 발견하기 어려우니 본문에 큰 CTA를 둠.

### Cycle 10 — Polish
- Empty-state banner의 `linear-gradient(135deg, ...)` 제거 → flat `accent-soft` 배경 (1차 디자인 refresh의 "gradient 전면 제거" 원칙과 일관성 맞춤)
- `.section-hint` + `.hint-aux` 스타일 통일 (이전엔 inline Tailwind 클래스로 산만)
- Dark mode 토큰 점검 — 모든 신규 컴포넌트(overflow-menu, eval-context-bar, results-hero, empty-state-banner, hero-card)가 design token만 사용 → dark mode 자동 적용

### 통합 효과 (Cycle 1-10 종합)
- Setup view 진입 시 첫 view 정보 위계: empty-state CTA (있을 때) → Hero → 모델 환경 그룹 → 데이터 그룹
- Evaluate view 진입 시: 컨텍스트 바 (모델/평가자/진행도) → reviewer note (접힘) → 평가 section (4개)
- Results view 진입 시: 4-col big stats (PASS%·완료%·평가자·κ) → summary 표 → interrater
- 헤더 button density: 8 → 4 visible buttons (overflow 5개 + 항상 4개)
- 신규 사용자 onboarding pathway 명시화 — 빈 화면에서 새 모델 만들기까지 1 클릭

### Cycle 11 — Header / footer trim
- 헤더 subtitle 제거: *"ROI/환자 수를 자유롭게 조정하면서 CQA 결과를 입력하고 한 번에 xlsx로 내보냅니다."* — feature tagline은 첫 진입 후 redundant
- 푸터 inline 정보 제거: *"로그인 시 Firestore 자동 동기화 · 로그아웃 시 브라우저 localStorage 저장"* — 한 번 알고 나면 매번 볼 필요 없음. 브랜드만 남김
- `.app-header-title h1` — 18px font-size로 명시 통일 (이전 Tailwind 클래스에 분산)

**Why**: 모든 페이지 전체에 항상 노출되는 "marketing copy" 톤은 매번 작업하는 사용자에겐 노이즈. 첫 진입 안내는 onboarding 배너로, 평가 컨텍스트는 context bar로 옮겼으므로 header 자체는 깔끔하게.

### Cycle 12 — 진행률 제거 (사용자 피드백)
- 사용자: *"평가 완료 퍼센트 표시는 의미가 없는것같은데 어떻게생각해?"* + Evaluate 컨텍스트 바의 진행 표시에 대해 *"그게 어디있는거죠?"* (= 발견조차 안 됨)
- **Evaluate 컨텍스트 바**: `.ec-right` 진행도 2개 (Completeness / Usability filled/total) 완전 제거. 컨텍스트 바는 모델명 + 평가자 정보만.
- **Results hero**: "평가 완료%" 카드 제거 → 3-col로 축소 (ROI PASS / 평가자 / Fleiss κ)

**Why**: 두 진행률 모두 misleading —
1. **Completeness 진행**: GTV default=TP, OAR default=존재이므로 negative 표시한 셀 수만 카운트됨. 사용자는 "내가 얼마나 평가했는지"로 해석하는데 실제로는 *negative judgement 개수*만 보여 직관과 반대.
2. **Usability 완료%**: 평가는 모든 셀을 한 번씩 보고 결정하는 게 정상이라 100%가 default 도달점. "75% 완료"는 진행이 아니라 *덜 함*. 진행 상태로서 의미 없음.
3. **Results 상단 PASS/FAIL 위계와 충돌**: "평가 완료%"가 ROI PASS%와 같은 카드 위계라 마치 결과 지표인 듯 오해 유발.

사용자가 진행 표시를 "어디 있냐"고 물어본 것 자체가 "발견 안 됨 = 필요 없음"의 증거. 잔여 셀 카운트 형태로도 고려했지만 사용 사례 검증 후 추가 결정.


