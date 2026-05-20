// Firebase 프로젝트 설정. 비모듈 스크립트로 로드되어 전역에 노출됨.
// Firebase Console → 프로젝트 설정 → "내 앱" → 웹 앱 SDK 설정에서 복사해 채우세요.
// apiKey는 비밀이 아닙니다 (Web SDK 특성). 진짜 보안은 firestore.rules에서 처리.
window.CQA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyC00EAJVQ95B-s4tuGWYNo3PKA_DmSsEmk",
  authDomain: "cqa-input-tool.firebaseapp.com",
  databaseURL: "https://cqa-input-tool-default-rtdb.firebaseio.com",
  projectId: "cqa-input-tool",
  storageBucket: "cqa-input-tool.firebasestorage.app",
  messagingSenderId: "274418586771",
  appId: "1:274418586771:web:fb3808c7de20d727f12966"
};

// Google Sign-In 후 허용할 이메일 도메인. firestore.rules에서도 동일하게 검증.
window.CQA_ALLOWED_EMAIL_DOMAIN = "oncosoft.io";
