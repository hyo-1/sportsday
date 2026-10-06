// firebase-config.js
// Firebase 콘솔에서 복사한 설정값을 아래 firebaseConfig 안에 붙여 넣는 파일입니다.
// (설정값은 비밀번호가 아니라 "내 Firebase 프로젝트의 주소"라서 GitHub에 올려도 괜찮습니다.
//  실제 보안은 Firestore 보안 규칙과 교사 로그인이 지켜줍니다.)
//
// 값을 넣기 전에는 "연습(데모) 모드"로 동작합니다.
// 연습 모드에서는 데이터가 그 기기의 브라우저에만 저장되고, 교사 번호는 123456 입니다.

export const firebaseConfig = {
  apiKey: 'AIzaSyASAQzqbFW46_qRtEeqmPnrZAPJKjgQZac',
  authDomain: 'maseok-sportsday.firebaseapp.com',
  projectId: 'maseok-sportsday',
  storageBucket: 'maseok-sportsday.firebasestorage.app',
  messagingSenderId: '235993027427',
  appId: '1:235993027427:web:f8a89bdb0fcdcf91b03956',
};

// 교사 로그인에 쓰는 이메일 (Firebase 콘솔의 Authentication에서 "같은 이메일"로 사용자를 만듭니다.)
// 실제로 메일을 보내지 않으니 존재하는 주소가 아니어도 됩니다.
// 비밀번호 = 교사 입력용 숫자 6자리 (Firebase는 최소 6자리를 요구합니다).
export const TEACHER_EMAIL = 'teacher@sportsday.app';

/* Firestore 보안 규칙 (Firebase 콘솔 → Firestore Database → 규칙 탭에 붙여 넣기)

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sportsday/state {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.token.email == 'teacher@sportsday.app';
    }
  }
}
*/
