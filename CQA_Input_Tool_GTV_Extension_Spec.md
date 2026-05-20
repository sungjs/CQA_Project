# CQA Input Tool: GTV 지원을 위한 변경사항 정리

## 배경

현재 CQA Input Tool (https://cqa-input-tool.web.app/)은 OAR autosegmentation 평가용으로 설계되어 있음. GBM을 시작으로 GTV CQA가 본격화되면서 같은 도구를 indication-extensible 형태로 확장할 필요가 생김. 본 문서는 form 변경 착수 전 사양 확정용 변경사항 정리.

## 현재 폼 구조 (OAR 기준)

상위 구성:
- 모델/프로젝트 이름, 총평/Notion 링크
- Cutoff 기준 정의 (Type별 threshold)
- ROI 목록 (cutoff type 선택)
- Validation 환자 / Test 환자 리스트

평가 섹션 (rubric 항목 = section 번호 매핑):
- **1. ROI Completeness**: ROI 누락 여부 (binary checkbox)
- **2. Clinical Usability**: ROI × 환자 grid, 1-5 점수
- **3-6. Specifications**: 각 ROI별 개선 필요 항목 체크
- **7-8. Variant cases**: Variant Test 환자 점수 입력
- **A. Summary**: 실시간 미리보기

Export: MD / PDF / XLSX / JSON

## GTV 평가의 본질적 차이

OAR와 GTV는 다음 다섯 가지 측면에서 본질적으로 다르며, form 구조 변경의 근거가 됨:

1. **존재 자체가 가변**: Tumor가 있을 수도, 없을 수도 있음 (OAR는 항상 존재)
2. **Multi-target 가능성**: Multifocal GBM, Liver mets는 한 환자에 다수 lesion
3. **Failure mode 비대칭**: Marginal miss(under-contour)가 over-contour보다 임상적으로 훨씬 critical
4. **Indication-specific 평가 기준**: GBM/Cervix/Liver mets는 sub-metric 정의가 모두 다름
5. **Imaging modality dependency**: 평가 reference imaging이 indication별로 다름

## 변경 필요사항

### 1. Indication Type 도입 (최상위 metadata)

새 최상위 field 추가:

- **Indication Category**: OAR / GTV (radio button)
- **GTV Subtype** (Indication=GTV일 때만 활성화):
  - GBM (Brain primary)
  - Cervix
  - Liver mets
  - (추후 확장 가능한 dropdown 구조)

이 선택값에 따라 sub-metric set, multi-target 처리, modality 입력 항목이 분기됨.

### 2. ROI → Target 개념 확장

현재 "ROI"는 사전 정의 organ list를 가정. GTV는 환자별 가변:

| Mode | Data structure |
|------|---------------|
| OAR | Patient × ROI grid (fixed ROI list) |
| GTV - single-target (GBM, Cervix) | Patient × {target metadata, scores} |
| GTV - multi-target (Liver mets) | Patient × Lesion[] × {scores} |

OAR mode의 "ROI 목록" UI는 그대로 두고, GTV mode에서는 해당 영역이 자동으로 단순화 (single-target) 또는 lesion array 관리 UI (multi-target)로 전환.

### 3. Completeness 항목 4-state 확장

현재 OAR Completeness는 binary (체크=누락, 빈칸=존재). GTV는 4-state 필요:

| State | 정의 | 임상적 의미 |
|-------|------|-------------|
| TP (True Positive) | Tumor 존재 & AI 추론 함 | 정상 |
| FN (False Negative) | Tumor 존재 & AI 추론 안 함 | **Critical failure** |
| FP (False Positive) | Tumor 부재 & AI 추론 함 | Hallucination |
| TN (True Negative) | Tumor 부재 & AI 추론 안 함 | 정상 |

UI 제안: Completeness 셀이 OAR mode에서는 checkbox, GTV mode에서는 4-state selector (TP/FN/FP/TN dropdown 또는 4-button toggle).

Multi-target indication(Liver mets)은 lesion 단위 TP/FN/FP/TN + patient-level "missed lesion count" 별도 집계.

### 4. Clinical Usability scale 유지, 정의 보강

1-5 scale은 reviewer training cost 절감을 위해 유지. 단 GTV-specific anchor를 추가 명문화:

- **5**: Approve as-is, no edit needed
- **4**: Minor edit (<5% volume change, cosmetic)
- **3**: Moderate edit, boundary 조정 필요
- **2**: Major edit (≥5% volume change 또는 clinically significant change)
- **1**: Unusable, scratch부터 재contour

OAR과 동일 scale 사용하므로 form 구조 변경 없음. Help tooltip에 indication별 anchor 정의를 동적으로 표시.

### 5. Specifications (3-6) 항목 indication별 분기

현재 3-6번이 OAR organ-specific으로 정의된 항목 list 기반. GTV는 indication별로 다른 sub-item set 필요:

**GBM** (rubric Option A 채택):
- 3. Target coverage (enhancing tumor + cavity if post-op)
- 4. Non-target exclusion (edema, hemorrhage, post-surgical artifact)
- 5. Boundary accuracy
- 6. Smoothness / technical quality (inter-slice consistency, artifact-free)

**Cervix**:
- 3. Primary tumor coverage (T2 hyperintense lesion)
- 4. Parametrial / vaginal extension handling
- 5. Non-target exclusion (cervical canal, normal cervix, bladder/rectum unless invasion)
- 6. Boundary accuracy + smoothness

**Liver mets**:
- 3. Per-lesion coverage
- 4. Lesion count completeness (missed lesion)
- 5. Non-target exclusion (hepatic vessel, bile duct, cyst, normal parenchyma)
- 6. Boundary accuracy + smoothness

각 sub-item은 3-tier rating (Clean / Minor issue / Major issue) + 자유서술 필드. Form은 indication subtype 선택에 따라 적절한 sub-item set을 동적으로 로드.

### 6. Multi-target 지원 (Liver mets specific)

Liver mets의 multi-lesion nature를 위한 data model 확장:

- Patient 하위에 Lesion array
- 각 Lesion 필드: ID, location (liver segment), size (max diameter), individual scores per sub-metric
- Patient-level aggregate:
  - Total expected lesion count (reviewer 사전 입력)
  - Detected lesion count (AI output)
  - Per-lesion score median / range
  - Missed lesion count = expected - detected

UI: Patient row 클릭 시 expand → lesion list. Lesion add/remove UI. Lesion ID는 자동 부여 + reviewer가 location label 입력.

### 7. Patient-level Metadata 확장

각 환자에 indication-specific metadata 입력 필드 추가:

**GBM**:
- Pre-op / Post-op (cavity 있음/없음) — required
- Newly diagnosed / Recurrence — required
- Available imaging sequences (T1c, FLAIR, T2, DWI, post-contrast subtraction) — checkbox

**Cervix**:
- T-stage (T1-T4) — required
- EBRT only / EBRT + brachytherapy — required
- Imaging: T2 MR (primary), DWI optional

**Liver mets**:
- Primary cancer origin (CRC, breast, melanoma, lung, etc.) — required
- Number of lesions expected (reviewer 사전 라벨링) — required
- Imaging phase (arterial / portal venous / delayed / multi-phase)

이 metadata는 stratified secondary analysis에 활용. Patient row에 expandable detail panel로 입력.

### 8. Reviewer Metadata 추가

각 평가에 reviewer-level metadata 도입 (현재 form에서 implicit하게 단일 reviewer 가정한 것으로 보임):

- **Reviewer ID**: Multi-rater agreement 분석용
- **Review confidence (1-5)**: 케이스 평가의 어려움 — ambiguous case identification에 활용
- **Review duration**: 자동 측정(셀 입력 시작-완료 시간) 또는 수동 입력. 평가 cost 분석용
- **Comments / failure mode notes**: 자유서술. Major edit 라벨 시 사유 기록 → failure mode catalog 자동 누적

### 9. Cutoff 기준 정의 확장

현재 Type별 threshold 시스템을 indication별로 확장:

- Indication × Type 조합으로 cutoff 정의
- Multi-target indication은 patient-level cutoff와 lesion-level cutoff 분리
- 추가 metric:
  - Missed lesion rate (Liver mets)
  - False positive rate (모든 GTV indication)
  - Per-modality breakdown (optional)

UI: Cutoff 정의 표가 indication 선택에 따라 적절한 metric set으로 전환.

### 10. Export 확장

기존 export(MD/PDF/XLSX/JSON) 유지 + GTV-specific 보강:

- **XLSX**: Multi-target indication을 위한 nested 구조 (Patient sheet + Lesion sheet, foreign key 관계). xlsx 스킬 참고하여 구조화.
- **MD**: Indication-specific report template으로 자동 분기. Sub-metric 정의가 indication별로 다르니 template도 indication별 유지.
- **JSON**: Programmatic analysis용 raw data. 외부 분석 pipeline 연동 위해 schema versioning 필요.
- **Stratified analysis report (신규)**: Pre-op/post-op, T-stage, primary origin 등 covariate별 자동 break-down.

### 11. Backward Compatibility

기존 OAR 평가 record 보존 + GTV opt-in 방식:

- 신규 record: Indication Category 선택 강제 (default = OAR, GBM 평가 시 명시적 전환)
- 기존 record: Indication=OAR로 자동 migration
- Schema versioning: 데이터 record에 schema_version 필드 추가하여 future migration 대응

## 구현 우선순위 (제안)

### Phase 1 — GBM Single-target 지원 (Minimum Viable)

목표: 첫 GBM CQA 평가가 도구에서 가능하게.

1. Indication Category / Subtype 선택 UI
2. Completeness 4-state 확장 (GTV mode)
3. GBM-specific sub-metric (3-6) loadable 구조
4. Patient metadata: Pre-op/Post-op flag, newly diagnosed/recurrence
5. 기존 OAR 모드 호환성 유지 (regression test 필수)
6. MD/XLSX export에서 GBM section 분기

### Phase 2 — Multi-target 지원 (Liver mets)

목표: Liver mets CQA가 가능한 data model + UI.

1. Patient → Lesion nested data model
2. Lesion 추가/삭제 UI + lesion-level scoring grid
3. Multi-target cutoff 정의
4. Lesion-level export (XLSX nested sheets)
5. Missed lesion rate / FP rate metric 계산

### Phase 3 — Cervix 및 Polish

목표: 세 indication 모두 지원 + 평가 품질 보강 기능.

1. Cervix sub-metric (3-6) 활성화
2. Reviewer metadata (confidence, duration, comments)
3. Imaging modality 정보 입력 필드
4. Stratified analysis export
5. Inter-rater agreement 자동 계산 (multi-rater 입력 지원 시)

## 결정 필요 사항 (구현 착수 전 확인)

다음 항목은 form 변경 작업 시작 전 confirm 필요:

1. **기존 OAR 3-6번 sub-metric 구조의 정확한 구성**: 현재 form 내부 정의가 GTV로 일반화 가능한지 확인. 필요 시 OAR도 동일 framework으로 약간 재정렬.
2. **1-5 scale anchor 정의 일치 여부**: GTV-specific anchor가 OAR과 완전히 동일한지 차별화할지. 동일이면 tooltip 분기만, 차별이면 mode별 별도 정의.
3. **Liver mets lesion ID 부여 규칙**: 자동 sequential ID + reviewer location label vs 완전 수동.
4. **Multi-rater 동시 입력 지원 여부**: 현재 single user 입력 가정. 향후 inter-rater 평가 지원하려면 collaborative editing 또는 reviewer-별 record 분리 구조 필요.
5. **Imaging viewer 통합 여부**: 현재 contour 정보만 입력 (image 직접 보지 않음). GTV는 image evidence가 중요하므로 thumbnail 표시나 외부 viewer 링크 통합 고려할지.
6. **Cutoff threshold 마이그레이션**: 기존 OAR cutoff 정의를 그대로 둘지, indication-aware structure로 schema migration할지.

## 참고: rubric 매핑 (변경 전후 비교)

| Section | OAR (현재) | GTV (변경 후 - GBM 예시) |
|---------|----------|-------------------------|
| 1. Completeness | ROI 누락 binary check | TP/FN/FP/TN 4-state |
| 2. Clinical Usability | 1-5 score | 1-5 score (anchor 보강) |
| 3. Specification | OAR organ-specific | Target coverage |
| 4. Specification | OAR organ-specific | Non-target exclusion |
| 5. Specification | OAR organ-specific | Boundary accuracy |
| 6. Specification | OAR organ-specific | Smoothness / technical quality |
| 7-8. Variant | Test 환자 점수 | Test 환자 점수 (변경 없음, indication 따라 sub-metric 다름) |
| A. Summary | 실시간 preview | 실시간 preview (indication별 layout) |
