/**
 * 기존 평가지 (prev_eval/*.json) → Firestore projects/{id} + reviews/{uid}
 *
 * 사용법:
 * 1. Firebase Console → 프로젝트 설정(⚙) → 서비스 계정 탭 → "새 비공개 키 생성"
 *    → 다운로드한 JSON을 tools/service-account-key.json 으로 저장 (gitignored)
 * 2. node tools/import-prev-eval.js
 *
 * 데이터 변환 방침:
 * - 원본 파일은 OAR 도구로 작성된 형식 (completeness boolean)
 * - 의미 손실 없이 indicationCategory='OAR'로 import
 * - 사용자가 사이드바에서 본 후 필요시 GTV 모드로 수동 전환 가능
 *   (전환 시 데이터는 보존됨; mode 변경은 UI 해석 차이만 발생)
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const KEY_PATH = path.join(__dirname, 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error(`\n❌ Service account key 없음: ${KEY_PATH}`);
  console.error(`\n   Firebase Console → 프로젝트 설정 → 서비스 계정 탭 → "새 비공개 키 생성"`);
  console.error(`   다운로드한 파일을 위 경로에 저장 후 다시 실행하세요.\n`);
  process.exit(1);
}

const serviceAccount = require('./service-account-key.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db   = admin.firestore();
const auth = admin.auth();

// 평가지 import 대상 — 사용자
const TARGET_EMAIL = 'sungjs@oncosoft.io';
const PREV_DIR     = path.join(__dirname, '..', 'prev_eval');

function slugify(name) {
  return String(name || 'project').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'project';
}

async function main() {
  console.log(`🔑 Firebase Admin 초기화 완료`);

  const user = await auth.getUserByEmail(TARGET_EMAIL);
  const uid  = user.uid;
  console.log(`👤 Import target: ${TARGET_EMAIL} (uid=${uid.slice(0, 12)}…)`);

  const files = fs.readdirSync(PREV_DIR).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error(`❌ prev_eval/ 에 JSON 파일이 없습니다.`);
    process.exit(1);
  }
  console.log(`📂 발견된 평가지: ${files.length}개\n`);

  const summary = [];

  for (const fname of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(PREV_DIR, fname), 'utf8'));
    const projectName = raw.projectName || fname.replace(/\.json$/i, '');

    const modelId = `${slugify(projectName)}_imp_${Date.now().toString(36)}`;

    const projectDoc = {
      name: projectName,
      notionLink: raw.notionLink || '',
      indicationCategory: 'OAR',
      gtvSubtype: null,
      cutoffDefs: raw.cutoffDefs || {
        A: { avg: 4, rScore: 3, ratio: 10 },
        B: { avg: 3.5, rScore: 2, ratio: 20 },
        C: { avg: 3, rScore: 2, ratio: 10 }
      },
      rois: raw.rois || [],
      roiCutoffs: raw.roiCutoffs || (raw.rois || []).map(() => 'A'),
      validations: raw.validations || [],
      tests: raw.tests || [],
      owner: uid,
      members: [uid],
      schemaVersion: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const reviewDoc = {
      completeness:        raw.completeness        || {},
      completenessComment: raw.completenessComment || {},
      usability:           raw.usability           || {},
      usabilityComment:    raw.usabilityComment    || {},
      variant:             raw.variant             || {},
      variantComment:      raw.variantComment      || {},
      specs:               raw.specs               || {},
      specsComment:        raw.specsComment        || {},
      patientMeta: {}, testMeta: {},
      truthAbsent: {}, predPresent: {},
      reviewerComment: '',
      reviewConfidence: '',
      reviewerEmail: TARGET_EMAIL,
      schemaVersion: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const vCount = projectDoc.validations.length;
    const rCount = projectDoc.rois.length;
    const usCells = Object.values(reviewDoc.usability).reduce((s, row) => s + Object.keys(row || {}).length, 0);
    const compCells = Object.values(reviewDoc.completeness).reduce((s, row) => s + Object.keys(row || {}).length, 0);

    console.log(`📥 ${projectName}`);
    console.log(`   modelId: ${modelId}`);
    console.log(`   환자 ${vCount}명 · ROI ${rCount}개 · usability ${usCells}셀 · completeness ${compCells}셀`);

    const projectRef = db.collection('projects').doc(modelId);
    const reviewRef  = projectRef.collection('reviews').doc(uid);

    await projectRef.set(projectDoc);
    await reviewRef.set(reviewDoc);
    console.log(`   ✅ Done\n`);

    summary.push({ projectName, modelId, vCount, rCount, usCells, compCells });

    // 다음 모델의 createdAt 타임스탬프 분리 (사이드바 정렬 순서 보장)
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('━'.repeat(50));
  console.log('📊 Import 요약');
  console.log('━'.repeat(50));
  summary.forEach(s => {
    console.log(`  • ${s.projectName}`);
    console.log(`      → ${s.modelId}`);
    console.log(`      ${s.vCount}명 × ${s.rCount}ROI / usability ${s.usCells}, completeness ${s.compCells}`);
  });
  console.log(`\n✅ 전체 ${summary.length}개 평가지 import 완료`);
  console.log(`   사이드바에서 새로고침하면 보입니다.`);
}

main().catch(e => {
  console.error('\n❌ Error:', e.message || e);
  if (e.code) console.error('   Code:', e.code);
  process.exit(1);
});
