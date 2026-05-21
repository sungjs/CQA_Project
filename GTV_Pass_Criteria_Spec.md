# GTV Pass Criteria (Cutoff Threshold) 설계

**상태**: 2026-05-21 draft proposal  
**관련**: `GTV_CQA_Framework_v3.md`, `PROJECT_STATUS.md` §6.7  
**Action item 매핑**: 2026-05-19 미팅 Action 2 ("사용자 기대 vs 모델 성능 gap 평가 기준") deliverable

---

## 0. 문제 진술

CQA Input Tool은 GTV CQA Framework v3로 indication-agnostic universal scheme 구현 완료. 그러나 **pass/fail 판정 로직(Cutoff 시스템)이 OAR 시절 그대로 머물러 있음**.

현재 cutoff (OAR-flavored):
```
Type A: avg ≥ 4.5, rScore ≤ 2, ratio ≤ 5%
Type B: avg ≥ 4.0, rScore ≤ 2, ratio ≤ 10%
Type C: avg ≥ 3.5, rScore ≤ 2, ratio ≤ 20%
```

이건 **Clinical Usability 평균**에만 기반. OAR에서는 적절한데, GTV에서는 critical failure mode 누락:

- **Missed tumor (FN)**: Tumor 자체를 못 찾은 case는 usability score가 매겨지지 않거나 의미가 약함. 80% sensitivity 모델이 잡힌 contour만 좋으면 usability avg는 pass 나옴 → **false sense of passing**
- **Hallucination (FP)**: AI가 없는 tumor 그린 케이스도 usability에 반영 안 됨
- **Sub-metric severity**: "Significant miss" in Target Coverage 같은 critical fail이 binary check로만 잡혀서 cutoff에 반영 안 됨

PROJECT_STATUS.md §6.7에 이미 limitation으로 인지되어 있음:
> "Sensitivity / FP rate 구조적 cutoff threshold 미구현 — 현재는 usability 평균 기반 cutoff. GTV의 sensitivity/specificity-aware threshold는 미래 추가."

본 문서는 이를 구체화한다.

---

## 1. 설계 원칙

1. **Indication-agnostic 유지**: GTV 전체에 통용. GBM/Cervix/Liver mets 등 indication별 분기 없음.
2. **OAR cutoff와 공존**: `indicationCategory === 'OAR'` 일 때는 현재 로직 그대로. `'GTV'` 일 때 multi-dimension cutoff 활성.
3. **3-dimension AND logic**: GTV pass는 Detection + Quality + Sub-metric 세 차원 모두 통과해야 함. 어느 하나라도 fail이면 fail.
4. **Asymmetric clinical risk 반영**: Marginal miss (FN) > over-contour (FP) → sensitivity threshold가 FP threshold보다 엄격.
5. **Heuristic default + user study refinement**: 초기 default는 literature 기반 heuristic. 첫 평가 진행하면서 user study (Framework v3 §5)로 refinement.
6. **Dimension별 fail 표시**: Pass/Fail binary 말고 "어느 차원에서 fail했는지" 명시.

---

## 2. 3-Dimension Cutoff 구조 (GTV mode)

### Dimension 1: Detection (가장 critical)

검출 자체의 성공률. Tumor 못 찾으면 다른 metric이 의미 없음.

| Field | 의미 | 계산 |
|-------|-----|------|
| `sensitivityMin` | 최소 sensitivity | `TP / (TP + FN)` ≥ threshold |
| `fpRateMax` | 최대 FP rate per case | `FP_cases / total_cases` ≤ threshold |
| `severeMissAllowed` | 'many'(>5) missed 허용 case 수 | count of cases with `missed: 'many'` ≤ threshold |

### Dimension 2: Quality (기존 usability 기반)

OAR cutoff와 동일 metric. GTV에서도 유지.

| Field | 의미 | 계산 |
|-------|-----|------|
| `avg` (기존) | Usability 평균 | mean of usability scores ≥ threshold |
| `rScore` (기존) | Low-score threshold | 점수 ≤ rScore 인 case 수 |
| `ratio` (기존) | Low-score 비율 | `low_score_cases / total` ≤ threshold |

GTV에서 usability는 보조 metric. 잡힌 contour의 quality만 측정 (FN은 반영 안 됨).

### Dimension 3: Sub-metric

3-6번 sub-metric에서 critical fail (Significant miss / Major inclusion / Significant artifact) 비율 제한.

| Field | 의미 | 적용 sub-metric |
|-------|-----|---------------|
| `significantMissRateMax` | 'Significant miss' 비율 cap | Sub-metric 3 (Target coverage) |
| `majorInclusionRateMax` | 'Major inclusion' 비율 cap | Sub-metric 4 (Non-target exclusion) |
| `significantArtifactRateMax` | 'Significant artifact' 비율 cap | Sub-metric 6 (Smoothness) |
| `significantBoundaryDeviationRateMax` (optional) | 'Significant deviation' 비율 cap | Sub-metric 5 (Boundary accuracy) |

**Note**: 현재 도구는 sub-metric을 binary checkbox로 처리. 3-tier rating (Clean/Minor/Significant)로 확장하려면 별도 data model 변경 필요. 본 문서는 미래 3-tier 확장 가정해서 cutoff 구조 정의하되, **초기 구현은 binary 기반** (체크된 비율 cap)으로 시작 가능.

---

## 3. Heuristic Default 값 (User study 전 starting point)

Literature + 일반 clinical AI evaluation 관행 기반. **User study 완료 후 refinement**.

### Type A — 엄격 (pre-release / production)

```
Detection:
  sensitivityMin: 0.95           # 95%+ tumor 검출
  fpRateMax: 0.05                # 5% 미만 FP rate
  severeMissAllowed: 0           # 'many' missed case 0개 허용

Quality:
  avgMin: 4.5
  rScoreThreshold: 2
  ratioMax: 0.05                 # rScore ≤ 2 case가 5% 이하

Sub-metric:
  significantMissRateMax: 0.05   # 5% 이하
  majorInclusionRateMax: 0.05    # 5% 이하  
  significantArtifactRateMax: 0.10
```

### Type B — 중간 (validation / iteration)

```
Detection:
  sensitivityMin: 0.90
  fpRateMax: 0.15
  severeMissAllowed: 1

Quality:
  avgMin: 4.0
  rScoreThreshold: 2
  ratioMax: 0.10

Sub-metric:
  significantMissRateMax: 0.10
  majorInclusionRateMax: 0.10
  significantArtifactRateMax: 0.20
```

### Type C — 완화 (early training / research)

```
Detection:
  sensitivityMin: 0.85
  fpRateMax: 0.30
  severeMissAllowed: 2

Quality:
  avgMin: 3.5
  rScoreThreshold: 2
  ratioMax: 0.20

Sub-metric:
  significantMissRateMax: 0.20
  majorInclusionRateMax: 0.20
  significantArtifactRateMax: 0.30
```

---

## 4. Pass/Fail 판정 Logic

```
function isGtvPassed(stats, cutoff) {
  const detection = checkDetection(stats, cutoff);
  const quality = checkQuality(stats, cutoff);
  const subMetric = checkSubMetric(stats, cutoff);
  
  return {
    overall: detection.pass && quality.pass && subMetric.pass,
    detection,    // { pass: bool, fails: [field names] }
    quality,
    subMetric
  };
}
```

UI 표시:
- **Overall PASS/FAIL** badge
- **Dimension별 PASS/FAIL** + fail dimension의 어떤 field가 fail했는지 reason 표시
- 예시: "FAIL — Detection: sensitivity 0.87 < 0.90; Sub-metric: significantMissRate 0.15 > 0.10"

이러면 reviewer/owner가 어디서 fail했는지 즉시 파악, 모델 개선 방향이 명확.

---

## 5. UI/UX 변경

### Cutoff 설정 카드 (owner-only edit)

Indication mode에 따라 dynamic 표시:

**OAR mode**: 현재 그대로 (avg / rScore / ratio 3 columns)

**GTV mode**: 위 3-dimension expandable layout
- Dimension 1 (Detection): sensitivityMin / fpRateMax / severeMissAllowed
- Dimension 2 (Quality): avgMin / rScoreThreshold / ratioMax — 기존 column 재사용
- Dimension 3 (Sub-metric): 3개 sub-rate threshold

Compact 표시 방안:
- Type A/B/C 각각을 expandable card로
- Default heuristic 값으로 pre-fill, owner가 필요 시 조정
- Reset to default 버튼

### Summary 카드

기존 GTV 통계(TP/FN/FP/TN, Miss rate, FP rate) 그대로 표시 + dimension별 pass/fail breakdown 추가:

```
┌────────────────────────────────────────┐
│ A. Summary                              │
├────────────────────────────────────────┤
│ Overall: FAIL                           │
│                                          │
│ Detection:    ✗ FAIL                    │
│   Sensitivity: 0.87  (need ≥ 0.90)      │
│   FP rate:     0.12  ✓                  │
│                                          │
│ Quality:      ✓ PASS                    │
│   Avg:         4.2                      │
│                                          │
│ Sub-metric:   ✗ FAIL                    │
│   Sig miss:    15%   (max 10%)          │
│   Major incl:  8%    ✓                  │
└────────────────────────────────────────┘
```

### XLSX Export

A. Summary 시트에 dimension별 PASS/FAIL 행 추가. Excel 수식으로 자동 재계산.

---

## 6. Data Model 변경

```js
projects/{id} {
  cutoffDefs: {
    A: {
      // OAR + GTV 공용 (기존):
      avg: 4.5,
      rScore: 2,
      ratio: 0.05,
      
      // GTV mode-specific (신규, optional):
      gtv: {
        sensitivityMin: 0.95,
        fpRateMax: 0.05,
        severeMissAllowed: 0,
        significantMissRateMax: 0.05,
        majorInclusionRateMax: 0.05,
        significantArtifactRateMax: 0.10
      }
    },
    B: {...},
    C: {...}
  }
}
```

**Migration**:
- 기존 cutoffDefs에 `gtv` field 없는 project → 자동으로 default value 채우기
- `schemaVersion` v4로 bump 또는 lazy migration (read 시점에 채우기)

**Backward compatibility**:
- OAR mode에서는 `gtv` field 무시
- GTV mode에서 `gtv` field 없으면 default heuristic 사용

---

## 7. 구현 계획 (Sprint 추가)

Improvement Plan에서 Sprint 6으로 추가:

### Sprint 6: GTV Pass Criteria

1. Data model 확장 (`cutoffDefs.{A,B,C}.gtv` sub-object)
2. Default value migration code
3. Cutoff 설정 UI에 GTV dimension expand 추가 (mode에 따라 dynamic)
4. `isGtvPassed()` function 작성 (3-dimension AND logic)
5. Summary card에 dimension별 PASS/FAIL breakdown 추가
6. XLSX export 업데이트
7. Pure function smoke test 추가 (3-dimension cutoff edge case들)

Estimate: 1주

---

## 8. User Study Refinement Path

Heuristic default 값은 starting point. 다음 단계로 refinement:

### Phase 1: Heuristic 운용 (현재 ~ 1차 평가)

- 첫 GBM CQA 평가에 Type B 적용 (validation 단계)
- Reviewer 피드백 수집 — "이 cutoff가 임상적 acceptance와 맞는지"

### Phase 2: User Study (1차 평가 종료 후)

Framework v3 §5 방법론:
1. 사내 RT MD 3-4명에게 N=50-100 case rating
2. Rating vs metric (sensitivity, FP rate, sub-metric scores) 상관 분석
3. 어떤 metric이 acceptance와 가장 align하는지 식별
4. Threshold value refinement

### Phase 3: Refined Cutoff 적용 (2차 평가~)

- User-study-derived threshold로 Type A/B/C 값 update
- 기존 heuristic은 fallback default로 유지

---

## 9. 미팅에서 결정 / 협의 사항

### Critical decisions

1. **3-dimension AND logic 동의 여부**: Detection + Quality + Sub-metric 모두 통과 필요한지, 아니면 weighted score로 융합할지
2. **Heuristic default 값**: 위 §3 숫자가 reasonable한지 임상 의견
3. **첫 GBM 평가에 적용할 Type**: Type B (validation) 권장 — 첫 평가는 baseline 측정이므로

### Practical decisions

4. **Sub-metric 3-tier 확장 여부**: 현재 binary checkbox → 향후 3-tier (Clean/Minor/Significant)로 확장할지. 확장 시 별도 Sprint 필요.
5. **User study 일정**: 1차 평가 완료 후 즉시 진행 권장

### Owner 결정

6. **Sprint 6 owner**: Jisoo가 spec → Claude Code 구현
7. **User study owner**: Jisoo + RT MD 섭외 협력

---

## 10. Open Questions

1. **Cutoff 정의의 "ratio" 의미 명확화**: 현재 OAR에서 ratio가 "rScore 이하 점수 case 비율"로 사용되는데, GTV에서도 같은 의미로 가져갈지 명시
2. **Negative case 비율**: 같은 모델에 positive/negative case 섞여있을 때, sensitivity 계산이 negative case 제외해야 함 (`TP / (TP + FN)`, denominator는 tumor present case만). 도구가 이거 정확히 계산하는지 검증 필요
3. **Per-ROI vs aggregate cutoff**: Cutoff Type을 ROI별로 지정 가능한데, GTV multi-dimension threshold도 ROI별로 다르게 가져갈 수 있어야 하는지
4. **Sub-metric rate calculation**: Sub-metric 3-6 check가 "체크된 ROI 비율"인지 "체크된 patient 비율"인지 명확화

---

## 11. 작업 우선순위 권장

```
즉시 (이번 미팅 후):
  - 3-dimension 구조에 대한 그룹 합의
  - Heuristic default 값에 대한 임상 의견

1-2주 내:
  - Sprint 6 spec 확정 → Claude Code 작업 시작
  - 첫 GBM 평가 dataset 준비 병행

평가 진행 중:
  - Reviewer 피드백 수집 (heuristic이 너무 strict/loose한지)

1차 평가 완료 후:
  - User study design & 진행
  - Refined cutoff 적용

```

---

## 12. PROJECT_STATUS.md 업데이트 항목

작업 진행 시 PROJECT_STATUS.md에 반영:

- §6 "남은 항목"에서 §6.7 (Sensitivity / FP rate cutoff 미구현)를 §7 "완료된 작업"으로 이동
- §3 "현재 기능 - 설정" 카드에 GTV mode cutoff 3-dimension 설명 추가
- §4 "데이터 모델" `cutoffDefs.{A,B,C}.gtv` sub-object 추가
- §5 "핵심 UI/UX" 에 "GTV cutoff dimension expansion" 결정 추가
