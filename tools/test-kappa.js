/**
 * Smoke test for Fleiss kappa correctness.
 * 실행: node tools/test-kappa.js
 *
 * Reference values:
 *   Wikipedia Fleiss kappa example (10 subjects, 4 raters, 5 categories) → κ ≈ 0.21
 *   완전 일치 (n raters all give same category) → κ = 1
 *   완전 불일치 (raters split evenly) → κ ≈ 0
 *   Single rater 또는 0 subjects → null
 */

// fleissKappa 구현 복사 (script.js의 것과 동일 — 환경 의존성 X)
function fleissKappa(counts, n, k) {
  const N = counts.length;
  if (N === 0 || n < 2) return null;
  const p_j = new Array(k).fill(0);
  counts.forEach(row => row.forEach((c, j) => p_j[j] += c));
  for (let j = 0; j < k; j++) p_j[j] /= (N * n);
  const P_i = counts.map(row => {
    const sumSq = row.reduce((s, c) => s + c * c, 0);
    return (sumSq - n) / (n * (n - 1));
  });
  const P_bar = P_i.reduce((s, p) => s + p, 0) / N;
  const Pe = p_j.reduce((s, p) => s + p * p, 0);
  if (Pe === 1) return 1;
  return (P_bar - Pe) / (1 - Pe);
}

function assert(name, actual, expected, tolerance) {
  tolerance = tolerance || 0.001;
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  console.log(`${ok ? '✅' : '❌'} ${name}: actual=${actual?.toFixed?.(4) ?? actual}, expected≈${expected}, diff=${diff?.toFixed?.(4) ?? '-'}`);
  if (!ok) process.exitCode = 1;
}

console.log('=== Fleiss κ smoke tests ===\n');

// 1) 완전 일치 (모든 rater가 같은 category 선택)
const perfect = [
  [4, 0, 0],   // 4명 모두 category 0
  [0, 4, 0],   // 4명 모두 category 1
  [0, 0, 4],
];
assert('Perfect agreement', fleissKappa(perfect, 4, 3), 1, 0.001);

// 2) 균등 분포 (rater들이 categories에 균등) → κ = -1/(n-1)
// Fleiss κ 정의상 이는 우연보다 못한 일치 (anti-agreement). n=4면 -1/3.
const random = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
];
assert('Uniform distribution → κ = -1/(n-1)', fleissKappa(random, 4, 4), -1/3, 0.001);

// 3) Wikipedia 예제 (10 subjects, 14 raters, 5 categories) → κ ≈ 0.21
// https://en.wikipedia.org/wiki/Fleiss%27_kappa
const wiki = [
  [0, 0, 0, 0, 14],
  [0, 2, 6, 4, 2],
  [0, 0, 3, 5, 6],
  [0, 3, 9, 2, 0],
  [2, 2, 8, 1, 1],
  [7, 7, 0, 0, 0],
  [3, 2, 6, 3, 0],
  [2, 5, 3, 2, 2],
  [6, 5, 2, 1, 0],
  [0, 2, 2, 3, 7],
];
assert('Wikipedia 10x14x5 example', fleissKappa(wiki, 14, 5), 0.2099, 0.005);

// 4) Single rater (n=1) → null
assert('Single rater → null', fleissKappa([[1, 0]], 1, 2) === null ? 0 : -1, 0);

// 5) Zero subjects → null
assert('Zero subjects → null', fleissKappa([], 4, 5) === null ? 0 : -1, 0);

// 6) Binary case (specs ci agreement) — 2 categories
const binary = [
  [4, 0],   // ROI 0: 4명 모두 not checked
  [0, 4],   // ROI 1: 4명 모두 checked
  [2, 2],   // ROI 2: 2 vs 2 split
];
const kBinary = fleissKappa(binary, 4, 2);
console.log(`ℹ Binary 3 ROI test: κ = ${kBinary?.toFixed(4)} (mixed agreement — sanity check only)`);

console.log('\n=== Done ===');
if (process.exitCode === 1) {
  console.log('❌ Some tests failed.');
} else {
  console.log('✅ All assertions passed.');
}
