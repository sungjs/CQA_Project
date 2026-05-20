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




