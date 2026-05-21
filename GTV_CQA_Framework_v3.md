# GTV CQA Framework v3

**상태**: 2026-05-21  
**범위**: 모든 GTV indication에 통용되는 단일 CQA 평가 framework  
**관련 문서**: 
- `CQA_Input_Tool_GTV_Extension_Spec_v2.md` (Tool 구현 spec)
- `CQA_Tool_Feedback.md` (현재 tool 피드백)

---

## 0. Design Principle

**GTV CQA는 indication-agnostic universal framework이다.**

도구도 framework도 indication별로 분기하지 않는다. 모든 GTV에 통용되는 단일 rubric을 사용하고, indication-specific 차이는 reviewer의 임상 지식에서 처리한다. Single-target vs multi-target도 분기하지 않는다 (이것 역시 implicit indication categorization이라).

### Universal이 가능한 근거

6-item rubric의 모든 metric은 개념적으로 universal:

| Metric | Universal 정의 | Reviewer가 case-by-case 판단하는 부분 |
|--------|-------------|--------------------------------|
| Detection | Tumor 있었나 + AI가 놓치거나 추가로 그렸나 | What counts as "lesion" |
| Overall quality | 임상 사용 가능성 | 어느 정도가 acceptable인가 |
| Target coverage | Visible tumor를 모두 포함했나 | 어디까지가 tumor |
| Non-target exclusion | 비-tumor 구조를 포함했나 | 무엇이 비-tumor |
| Boundary accuracy | Boundary가 visible 경계를 따라가나 | Reference imaging이 뭔가 |
| Smoothness | Artifact 없는 깨끗한 contour | 동일 (universal) |

**Metric은 도구가 표현하고, clinical interpretation은 reviewer가 한다.** 이 분리가 indication-agnostic design의 핵심.

### 이 접근의 이점

1. **확장성**: 새 indication 추가 시 코드/UI 변경 zero
2. **단순성**: One mental model for all GTV
3. **Cross-indication 비교**: 같은 metric → trivial comparison
4. **유지보수**: Indication-specific branch zero
5. **Reviewer training**: 한 번 학습 → 모든 indication 적용
6. **PROJECT_STATUS.md §5.C 결정과 일관**: subtype 제거 결정의 자연스러운 연장

### Trade-off

- Reviewer는 각 case의 임상 맥락(modality, anatomy, target 정의)을 스스로 알고 있어야 함
- 도구가 indication-specific guide 제공 안 함
- RT MD 대상 도구라 합리적 가정

---

## 1. Scope (참고)

도구가 indication을 구분하지 않지만, 평가 대상 indication 정리:

- AAPM 2026 priority 1: GBM, Liver CRC mets, Cervix
- AAPM 2026 priority 2: Pancreas, Liver (Decathlon), Lung NSCLC, Adrenal ACC
- AAPM 2026 priority 3: Esophagus, Brain mets
- 향후 모든 GTV indication 추가 가능 (framework/도구 변경 없이)

각 indication은 도구 내에서 **project** 단위로 등록 (e.g., "GBM_v1"). Project = 평가 대상 모델 단위. Indication-specific branching 의미 아님.

### Modality

CT / MR / PET-CT / multimodal 모두 지원. Modality는 **project metadata** 또는 **case-level metadata**로 기록되지만 branching logic으로 작용하지 않음. Reviewer가 modality 맥락 알고 평가.

### Evaluation Stage

단계적 학습 전략 지원. Pre-deployment / training cycle milestones / pre-release / post-deployment monitoring. 각 stage = 별도 project (또는 project 내 evaluation_stage 필드)로 등록. Cross-stage 시계열 비교 가능.

---

## 2. Universal 6-item Rubric

### 1. Detection — Unified

Single-target과 multi-target 통합 처리. 모든 case에 동일하게 3-input 평가:

1. **Tumor present in reference?** — Y / N
   - Default: Y
   - Reference contour에 lesion이 있어야 했나
2. **Missed clinically significant lesion(s)** — None / 1-2 / 3-5 / >5
   - Default: None
   - #1 = Y일 때만 의미 있음
3. **Spurious contour / hallucination** — None / 1-2 / 3-5 / >5
   - Default: None
   - 모든 case에 적용

**4-state mapping (자동 derive)**:

| Tumor | Missed | Hallucinated | State |
|-------|--------|--------------|-------|
| Y | None | None | TP |
| Y | 1-2+ | * | FN |
| N | N/A | None | TN |
| N | N/A | 1-2+ | FP |

**Multi-target 자연스럽게 fit**:
- 20개 중 18 잡고 2 hallucinated: Tumor=Y, Missed=1-2 (=2개), Hallucinated=1-2 (=2개)
- 절반 놓침: Tumor=Y, Missed=>5
- 모두 잡음: Tumor=Y, Missed=None, Hallucinated=None

### 2. 전반적 퀄리티

5-tier (universal):

- **5**: Approve as-is, no edit needed
- **4**: Minor edit (<5% volume change, cosmetic)
- **3**: Moderate edit, boundary 조정 필요
- **2**: Major edit (≥5% volume change 또는 clinically significant)
- **1**: Unusable, scratch부터 재contour

Reviewer가 case 맥락 반영해서 gestalt 판단.

### 3. Target Coverage (under-contour assessment)

**Universal 정의**: AI contour가 visible tumor를 모두 포함했는가

3-tier:
- **Complete**: Visible tumor 완전 포함
- **Minor miss**: 일부 누락, 임상적 의미 작음
- **Significant miss**: Clinically meaningful 영역 누락

What counts as "visible tumor"는 reviewer가 case context로 판단. 도구는 prompt하지 않음.

### 4. Non-target Exclusion (over-contour assessment)

**Universal 정의**: Contour가 비-tumor 구조를 부적절하게 포함했는가

3-tier:
- **Clean**: 비-tumor 포함 없음
- **Minor inclusion**: 작은 영역 부적절 포함, 임상 영향 적음
- **Major inclusion**: 의미 있는 비-tumor 영역 포함

자유서술 field로 "무엇이 포함됐는지" 기록 → failure mode catalog 자동 누적.

### 5. Boundary Accuracy

**Universal 정의**: 그어진 contour의 boundary가 visible tumor 경계를 따라가는가

3-tier:
- **Accurate**: Boundary가 visible 경계 정확히 따라감
- **Minor deviation**: 부분적 deviation, 임상 영향 작음
- **Significant deviation**: 명백한 boundary error

Item 3(coverage)와 구분: Coverage는 영역, Boundary는 그어진 영역의 edge 정확도.

### 6. Smoothness / Technical Quality

**Universal 정의**: AI 처리 artifact 없는 깨끗한 contour인가

3-tier:
- **Clean**: Inter-slice consistency OK, disconnected component 없음, boundary noise 없음 (있다면 biological 합리적)
- **Minor artifact**: 작은 jitter나 minor noise, 임상 사용 지장 없음
- **Significant artifact**: Disconnected fragments, 불연속, pixelated boundary로 clean-up 필요

Item 5(boundary accuracy)와 구분: Accuracy는 영역의 정확성, Smoothness는 그 영역의 기하학적 품질.

---

## 3. Evaluation Methodology (3-Pillar)

Indication 관계없이 동일.

### Pillar 1: Real Model Outputs + Clinical Review

- 테스트 케이스(N=100-150 per project)에 모델 추론
- RT MD가 6-item rubric으로 평가
- 결과 = 4-state confusion matrix + per-sub-metric scores

Metrics: Sensitivity / Specificity / PPV / NPV, ROC AUC + PR AUC, Per-sub-metric distribution, NNR (Number Needed to Review).

### Pillar 2: Synthetic Perturbation

- Reference contour에 알려진 perturbation 주입
- Under-contour / over-contour / regional miss / spurious addition / boundary fluctuation
- Magnitude: 2mm / 5mm / 10mm

Metrics: Detection sensitivity vs perturbation magnitude curve, per-perturbation-type detection rate, minimum detectable error size.

### Pillar 3: Negative Case Evaluation

"없는 병변" 평가. Meeting action 1 영역.

**Negative case 정의** (universal):
- 해당 project의 target tumor가 없는 환자
- Project owner가 negative case set 별도 구성

**측정**:
- Negative case set에 모델 추론
- FP(spurious contour) 발생 빈도
- Per-modality breakdown (CT vs MR에서 FP rate 다를 수 있음)

Metrics: Specificity, FP rate per case, anatomical distribution of FP.

**Clean case calibration** (Pillar 3 일부):
- Reference에 잘 매칭하는 cases (Dice > 0.95)에서 CQA "no error" 판정 confidence
- Calibration: reliability diagram, Brier score, ECE

### 3-Pillar 통합 reporting

Single number 요약 금지. Report 항목:
- ROC + PR curve (Pillar 1)
- Sensitivity vs perturbation magnitude curve (Pillar 2)
- Specificity + FP rate per case (Pillar 3)
- Calibration plot (Pillar 3)
- NNR at fixed sensitivity
- Failure mode catalog coverage

---

## 4. Project-Level Configuration

Indication-agnostic 도구에서 prokect별로 다음을 owner가 설정:

| 설정 항목 | 용도 |
|---------|----|
| Project name | E.g., "GBM_v1" |
| Modality | CT / MR / PET-CT / multimodal (참고용) |
| Evaluation stage | baseline / training_N / pre_release / post_deployment |
| Model version | Specific checkpoint identifier |
| ROI list | 평가 대상 ROI |
| Cutoff thresholds per Type | Sensitivity / FP rate / Boundary score 등 |
| Significant miss threshold | E.g., ">5mm" 또는 protocol-specific |
| Negative case set | Pillar 3용 환자 list (별도 project로 등록도 가능) |

이 설정은 indication-aware하지 않음. Owner가 자기 project 맥락에서 정의.

---

## 5. Acceptance Criteria via User Study (Meeting Action 2)

"사용자 기대 vs 모델 성능 gap"을 정량화해서 cutoff threshold 도출:

1. 사내 RT MD 3-4명 모집
2. Pre-evaluated case set(N=50-100, indication mix) 준비
3. 각 RT MD가 contour 보고 "임상 사용 가능 여부" rating (binary 또는 5-tier)
4. Rating vs metric (Dice, Sensitivity, FP rate 등) 상관 분석
5. 어떤 metric이 acceptance와 가장 align하는지 식별 → threshold 도출

도출 결과 = "Sensitivity > X, FP rate < Y, Boundary score > Z" 같은 acceptance criteria.

### Asymmetric Weighting 명시

GTV에서 marginal miss (FN) > over-contour (FP) 임상적 비중. Cutoff system이 반영:
- Sensitivity threshold: 엄격 (90%+)
- FP rate threshold: 상대적으로 완화 가능
- Weighted score: `Score = α * Sensitivity - β * FP_rate` with `α > β`

α, β는 user study에서 도출.

---

## 6. Classification Pipeline 통합 (Meeting Action 3, 6)

CQA dataset의 일부가 indication unlabeled 상태. 분류 work가 upstream.

### Upstream: Classification work (별도 도구)

1. 암종 우선순위 결정 → Notion doc에서 이미 완료
2. 암종별 분류 로직 (action 6): 시각적 특징 catalog
3. 분류 도구 제작 (action 4): 체크리스트 형태
4. 데이터 분류 작업 (action 3)

### CQA framework가 받는 input

- Project metadata로 `indication: <enum>` + `classification_confidence: <high/medium/low>`
- Low-confidence는 secondary review 대상
- Re-classification 가능성 → schema에 classification history

### 분류 도구는 별도

**별도 도구 권장**:
- 분류 = 일회성 작업, 평가 = ongoing → user flow 다름
- CQA Input Tool에 mode 추가하면 UX 복잡도 증가
- 분류 도구는 단순 체크리스트 web app으로 충분

---

## 7. Stage-by-Stage Evaluation

각 evaluation record에 schema 확장:
- `evaluation_stage: 'baseline' | 'training_cycle_N' | 'pre_release' | 'post_deployment'`
- `model_version: string`
- `training_data_snapshot: string`

Cross-stage 비교:
- 같은 test set, 같은 rubric으로 stage별 평가 후 metric 시계열 plot
- Stage 간 metric 차이로 학습 효과 측정
- Regression detection

---

## 8. Tool Implementation Reference

자세한 spec은 `CQA_Input_Tool_GTV_Extension_Spec_v2.md` 참조. 주요 변경:

| Framework 요소 | Tool 영향 |
|---------------|--------|
| Unified detection (3-input) | 기존 2-col checkbox 교체 |
| Universal sub-metric | 변경 없음 (이미 universal한 정의) |
| Single/multi 분기 제거 | ROI-level multiIsland flag 불필요 |
| Modality metadata | Project metadata로 추가 |
| Stage metadata | Project metadata로 추가 |
| Negative case evaluation | Project 단위로 별도 등록 가능 (또는 ROI category) |
| Acceptance criteria | Cutoff threshold 시스템 활용 |

---

## 9. Open Decisions

다음은 framework 확정 전 결정 필요:

1. **Negative case set 구성 source**: 사내 데이터 vs public dataset
2. **분류 도구 owner**: Group 결정 — 사내 dev팀? 외부?
3. **User study 일정**: Acceptance criteria 정의를 위한 user study 시점 (model maturity와 align)
4. **CQA Input Tool 우선순위**: Unified detection migration이 Phase 1.5 (test/모듈화)와 어떻게 align할지
5. **Stage metadata 운영 방식**: 별도 project로 분리 vs 같은 project 내 stage field
6. **Classification 결과의 CQA로 반영 timing**: 분류 완료 후 일괄 vs incremental

---

## 10. Next Actions (Jisoo 기준)

### Near-term (1-2주)

1. **Framework v3 group 공유 + 합의** (이 문서)
   - Open decisions 항목 협의 → 확정
2. **Tool Extension Spec v2 finalize** (`CQA_Input_Tool_GTV_Extension_Spec_v2.md`)
   - Unified detection migration plan
   - Cursor Claude 작업 input으로 사용

### Mid-term (3-6주)

3. **분류 도구 spec** (action 4) — group 협업 시작
4. **분류 로직 작성** (action 6) — 우선순위 1 indication부터
5. **Negative case evaluation 방법 구체화** (action 1)
6. **User study design** (action 2)

### Long-term (2-3개월)

7. **데이터 분류 작업** (action 3)
8. **CQA Input Tool unified detection 구현**
9. **첫 GBM CQA 본격 실행**
