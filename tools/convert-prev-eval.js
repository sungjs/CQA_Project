/**
 * prev_eval/*.json → prev_eval_converted/*.json
 * 새 도구의 "📂 JSON 불러오기" 버튼으로 바로 import 가능한 형식으로 변환.
 *
 * 변환 내용:
 * - indicationCategory='OAR' / gtvSubtype=null 명시 (원본은 구 OAR 도구 export)
 * - 새 schema 필드 (truthAbsent, predPresent, patientMeta, testMeta,
 *   reviewerComment, reviewConfidence) default 추가
 * - 파일명을 깔끔하게 (공백/특수문자 → underscore)
 *
 * 사용법: node tools/convert-prev-eval.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'prev_eval');
const DST = path.join(__dirname, '..', 'prev_eval_converted');

if (!fs.existsSync(DST)) fs.mkdirSync(DST, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.json')).sort();
console.log(`📂 ${SRC} → ${DST}`);
console.log(`   ${files.length}개 파일 변환\n`);

for (const fname of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, fname), 'utf8'));

  const converted = {
    projectName:        raw.projectName || fname.replace(/\.json$/i, ''),
    notionLink:         raw.notionLink || '',
    indicationCategory: 'OAR',                  // 명시
    gtvSubtype:         null,
    cutoffDefs:         raw.cutoffDefs || {
      A: { avg: 4, rScore: 3, ratio: 10 },
      B: { avg: 3.5, rScore: 2, ratio: 20 },
      C: { avg: 3, rScore: 2, ratio: 10 }
    },
    rois:               raw.rois || [],
    roiCutoffs:         raw.roiCutoffs || (raw.rois || []).map(() => 'A'),
    validations:        raw.validations || [],
    tests:              raw.tests || [],
    completeness:        raw.completeness        || {},
    completenessComment: raw.completenessComment || {},
    usability:           raw.usability           || {},
    usabilityComment:    raw.usabilityComment    || {},
    variant:             raw.variant             || {},
    variantComment:      raw.variantComment      || {},
    specs:               raw.specs               || {},
    specsComment:        raw.specsComment        || {},
    // 새 schema 추가 필드 default
    patientMeta:    {},
    testMeta:       {},
    truthAbsent:    {},
    predPresent:    {},
    reviewerComment: '',
    reviewConfidence: ''
  };

  // 깔끔한 출력 파일명
  const outName = (raw.projectName || fname)
    .replace(/\.json$/i, '')
    .replace(/[\s,]+/g, '_')
    .replace(/[\(\)]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const outPath = path.join(DST, `${outName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(converted, null, 2), 'utf8');

  const v = converted.validations.length;
  const r = converted.rois.length;
  const usCells = Object.values(converted.usability).reduce((s, row) => s + Object.keys(row || {}).length, 0);
  console.log(`✓ ${fname}`);
  console.log(`  → ${outName}.json`);
  console.log(`    모델: "${converted.projectName}" · 환자 ${v}명 × ROI ${r}개 · usability ${usCells}셀\n`);
}

console.log(`✅ 변환 완료. ${DST} 폴더 확인.`);
