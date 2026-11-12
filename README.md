# word-memo
only for my self, site for word memorizing

## 사용 방법

[English Word Memo](https://wkreho.github.io/word-memo/)에서 **단어장 선택**을 누르고 파일이나 폴더를 골라 적용합니다. 폴더 이름을 누르면 펼쳐지고, 옆의 체크박스를 누르면 하위 단어장이 모두 선택됩니다. 기본 단어장은 Collection 12입니다. 영어 정의와 동의어 보기를 전환할 수 있습니다. 퀴즈에는 보이는 미체크 행만 포함되며, 완료 후 **단어 암기로 돌아가기**를 눌러 결과를 반영합니다.

체크 상태, 선택한 단어장과 보기 설정은 이 브라우저에 저장됩니다. **학습 기록 초기화**는 모든 단어장의 체크 기록을 지웁니다.

## 단어장 추가

1. `data/` 아래에 단어 배열을 JSON 파일로 저장합니다. 각 항목에 `word`, `korean`, `english`, `synonyms`를 사용하고, 예문은 선택적으로 `example`에 넣습니다.
2. `data/catalog.js`에 고유 `id`, 표시 이름 `name`, `index.html` 기준 상대 경로 `path`, 항목 수 `count`를 추가합니다. 체크 기록은 단어장 ID와 파일 내 위치를 사용하므로 기존 목록에 단어를 추가할 때는 끝에 붙입니다. 파일을 이동할 때도 기존 ID를 유지합니다.

탐색기는 `path`의 하위 디렉터리를 따라 폴더를 표시합니다. `folderRoots`는 기존 Collection, Wordly Wise, SAT 데이터 폴더의 표시 이름을 지정합니다. 중간·기말의 세 학기 폴더는 `data/학교/2026/중간·기말/`에 있습니다.

Collection 12의 분할 목록은 `data/collection/12.json`에 합쳐져 있습니다. `index.html`은 HTTP(S)로 열어야 합니다. GitHub Pages는 저장소의 **Settings → Pages**에서 **Deploy from a branch → main → /(root)**를 선택합니다. 별도 빌드 과정은 없습니다.
