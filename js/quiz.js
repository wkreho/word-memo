const $ = id => document.getElementById(id);
const answerInput = $('answer-input');
let quizState = 'idle';
let direction = 'en-ko';
let allWords = [];
let roundWords = [];
let questionIndex = 0;
let roundCorrectCount = 0;
let roundNumber = 0;
const latestResults = new Map();
let isComposing = false;
let pendingImeSubmit = false;
let imeSubmitTimer = null;
let enterHeld = false;

let onQuizExit = null;

export function startQuiz(words, quizDirection, onExit) {
  allWords = words;
  direction = quizDirection;
  onQuizExit = onExit;
  roundNumber = 0;
  latestResults.clear();
  $('direction-label').textContent = direction === 'en-ko' ? '영어 → 한국어' : '한국어 → 영어';
  startRound(allWords);
}

function finishQuiz(results) {
  const onExit = onQuizExit;
  onQuizExit = null;
  quizState = 'idle';
  resetCompositionSubmit();
  enterHeld = false;
  allWords = [];
  roundWords = [];
  latestResults.clear();
  answerInput.value = '';
  onExit(results);
}

function cancelQuiz() {
  if (quizState !== 'idle') finishQuiz(null);
}

function fitLayout() {
  if (quizState === 'idle') return;
  document.body.classList.remove('allow-scroll');
  requestAnimationFrame(() => {
    if (quizState === 'idle') return;
    const shell = $('quiz-view');
    if (shell.scrollHeight > shell.clientHeight + 2) document.body.classList.add('allow-scroll');
  });
}

function shuffleWords(words) {
  const shuffled = words.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function normalizeAnswer(value) {
  // 띄어쓰기만 제거합니다. 철자와 하이픈/아포스트로피 등은 그대로 비교합니다.
  return value.normalize('NFC').replace(/\s+/gu, '').toLowerCase();
}

function koreanAnswers(value) {
  // 괄호 안의 쉼표/슬래시는 구분자로 쓰지 않아 뜻을 지나치게 잘게 나누지 않습니다.
  const matching = { '(': ')', '[': ']', '{': '}', '（': '）' };
  const stack = [];
  const parts = [];
  let part = '';
  for (const char of value) {
    if (matching[char]) stack.push(matching[char]);
    else if (stack.length && char === stack[stack.length - 1]) stack.pop();
    if (!stack.length && /[,;/\r\n]/.test(char)) {
      if (part.trim()) parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  if (part.trim()) parts.push(part);
  // 원문은 표시용으로 그대로 두고, 각 뜻에 괄호 규칙을 따로 적용합니다.
  return [...new Set([value, ...parts].filter(part => part.trim()))];
}

function parseAnswerBrackets(value) {
  const pairs = { '(': ')', '[': ']', '{': '}', '（': '）' };
  const nodes = [];
  const stack = [{ children: nodes }];
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const parent = stack[stack.length - 1];
    if (pairs[char]) {
      // 과도한 중첩이나 잘못 닫힌 괄호는 원문 비교만 허용합니다.
      if (stack.length > 64) return null;
      const group = { open: char, close: pairs[char], start: i, children: [] };
      parent.children.push(group);
      stack.push(group);
    } else if (Object.values(pairs).includes(char)) {
      if (stack.length === 1 || parent.close !== char) return null;
      parent.end = i + 1;
      parent.inner = value.slice(parent.start + 1, i);
      stack.pop();
    } else {
      const last = parent.children.length - 1;
      if (typeof parent.children[last] === 'string') parent.children[last] += char;
      else parent.children.push(char);
    }
  }
  return stack.length === 1 ? nodes : null;
}

function matchesOptionalBrackets(nodes, answer) {
  // 후보 조합이나 사용자 정규식을 만들지 않고, 입력에서 도달 가능한 위치만 추적합니다.
  const cache = new Map();
  function consume(text, positions) {
    const literal = normalizeAnswer(text);
    return new Set([...positions].filter(pos => answer.startsWith(literal, pos))
      .map(pos => pos + literal.length));
  }
  function walk(parts, positions) {
    if (!positions.size) return positions;
    for (const part of parts) {
      if (typeof part === 'string') positions = consume(part, positions);
      else {
        if (!cache.has(part)) cache.set(part, new Map());
        const results = cache.get(part);
        const next = new Set();
        for (const pos of positions) {
          if (!results.has(pos)) {
            const start = new Set([pos]);
            const kept = consume(part.close, walk(part.children, consume(part.open, start)));
            const unwrapped = walk(part.children, start);
            results.set(pos, new Set([pos, ...kept, ...unwrapped]));
          }
          results.get(pos).forEach(end => next.add(end));
        }
        positions = next;
      }
      if (!positions.size) break;
    }
    return positions;
  }
  return walk(nodes, new Set([0])).has(answer.length);
}

function isIndependentAlternative(value) {
  const text = value.trim();
  // 문법 표시, 목적어 자리, 용례 설명은 독립적인 동의어가 아닙니다.
  if (!/^[\p{L}\s'-]+$/u.test(text) || (text.match(/\p{L}/gu) || []).length < 2 ||
      text.length > 80) return false;
  if (/^(?:a |an |the |of |for |used |when |usually |especially |in the )/i.test(text) ||
      /^(?:to|up|out|in|on|at|off|down|with|by|from|into|over|under)$/i.test(text) ||
      /^(?:something|someone|somebody|anything|anyone|sb|sth|noun|verb|adjective|adverb|plural|singular|past|tense|formal|informal|literal|figurative|optional|object|subject|especially|usually|명사|동사|형용사|부사|복수|단수|과거|현재|목적어|주어|설명|예시|문법|비유|특히|주로|보통|사람|사물)$/i.test(text)) return false;
  if (/[가-힣]/.test(text) && /\s/.test(text) &&
      !/(?:다|한|하는|된|은|는|적인|하게|히|로)$/.test(text)) return false;
  return !/^(?:특히|주로|보통|예를|문법|비유|복수|단수|과거|현재|설명|참고)/.test(text) &&
    !/(?:따른|대한|대해|경우|의미|뜻|설명|나타냄|가리킴|등|등의|용법)$/.test(text);
}

function bracketAlternatives(value, nodes) {
  const alternatives = [];
  for (const group of nodes) {
    if (typeof group === 'string') continue;
    const prefix = value.slice(0, group.start);
    const suffix = value.slice(group.end);
    const base = nodes.filter(node => typeof node === 'string').join('').trim();
    if (!base || /[,;/\r\n]/.test(base)) continue;
    for (const candidate of koreanAnswers(group.inner)) {
      if (!isIndependentAlternative(candidate)) continue;
      if (!suffix.trim() && prefix.trim()) {
        // 서신 [편지], 망설이다 [주저하다]처럼 뜻 뒤에 놓인 완결된 대체 표현.
        alternatives.push(candidate);
      } else if (/^[가-힣]{2,}$/.test(prefix.trim()) &&
          /^(?:하다|하는|한|되다|된|시키다|적인|적이다)$/.test(suffix.trim()) &&
          /^[가-힣]{2,}$/.test(candidate.trim())) {
        // 비하[모멸]하다, 반항[저항/거역]하다: 공통 어미를 보존합니다.
        alternatives.push(candidate.trim() + suffix.trim());
      }
    }
  }
  return alternatives;
}

function matchesAnswer(value, answer) {
  if (normalizeAnswer(value) === answer) return true;
  const nodes = parseAnswerBrackets(value);
  if (!nodes) return false;
  return matchesOptionalBrackets(nodes, answer) ||
    bracketAlternatives(value, nodes).some(candidate => normalizeAnswer(candidate) === answer);
}

function isCorrectAnswer(word, answer) {
  const normalized = normalizeAnswer(answer);
  if (!normalized) return false;
  const candidates = direction === 'ko-en' ? [word.word] : koreanAnswers(word.korean);
  return candidates.some(candidate => matchesAnswer(candidate, normalized));
}

function startRound(words) {
  roundWords = shuffleWords(words);
  questionIndex = 0;
  roundCorrectCount = 0;
  roundNumber += 1;
  $('result-panel').hidden = true;
  $('question-panel').hidden = false;
  $('keyboard-help').hidden = false;
  showQuestion();
}

function showQuestion() {
  const word = roundWords[questionIndex];
  quizState = 'answering';
  resetCompositionSubmit();
  answerInput.readOnly = false;
  answerInput.value = '';
  $('answer-message').textContent = '';
  $('feedback').hidden = true;
  $('feedback-title').textContent = '';
  $('correct-word').textContent = '';
  $('correct-korean').textContent = '';
  $('submitted-answer').textContent = '';
  $('example-sentence').textContent = '';
  $('example-sentence').hidden = true;
  $('hint-box').hidden = true;
  $('hint-text').textContent = '';
  $('show-hint').setAttribute('aria-expanded', 'false');
  $('submit-answer').hidden = false;
  $('next-question').hidden = true;
  $('progress').textContent = (questionIndex + 1) + ' / ' + roundWords.length;
  $('question').className = direction === 'ko-en' ? 'korean-question' : '';
  $('question').textContent = direction === 'en-ko' ? word.word :
    (word.korean || '(등록된 한국어 뜻이 없습니다.)');
  $('answer-label').textContent = direction === 'en-ko' ? '한국어 뜻 입력' : '영어 단어 입력';
  answerInput.lang = direction === 'en-ko' ? 'ko' : 'en';
  answerInput.focus({ preventScroll: true });
  fitLayout();
}

function submitAnswer() {
  if (quizState !== 'answering' || isComposing) return;
  if (!answerInput.value.trim()) {
    $('answer-message').textContent = '답을 입력하세요.';
    answerInput.focus();
    return;
  }
  const word = roundWords[questionIndex];
  const correct = isCorrectAnswer(word, answerInput.value);
  latestResults.set(word.id, correct);
  if (correct) roundCorrectCount += 1;
  quizState = 'feedback';
  answerInput.readOnly = true;
  $('answer-message').textContent = '';
  $('feedback-title').textContent = correct ? '✅ 정답' : '❌ 오답';
  $('feedback-title').className = correct ? 'correct' : 'incorrect';
  $('correct-word').textContent = word.word;
  $('correct-korean').textContent = word.korean || '(등록된 한국어 뜻이 없습니다.)';
  $('submitted-answer').textContent = correct ? '' : '입력한 답: ' + answerInput.value;
  $('example-sentence').textContent = word.example;
  $('example-sentence').hidden = !word.example;
  $('feedback').hidden = false;
  $('submit-answer').hidden = true;
  $('next-question').textContent = questionIndex + 1 === roundWords.length ? '결과 보기' : '다음 문제';
  $('next-question').hidden = false;
  $('next-question').focus({ preventScroll: true });
  fitLayout();
}

function nextQuestion() {
  if (quizState !== 'feedback') return;
  questionIndex += 1;
  if (questionIndex < roundWords.length) showQuestion();
  else showResults();
}

function getWrongWords() {
  return allWords.filter(word => latestResults.get(word.id) === false);
}

function showResults() {
  quizState = 'results';
  $('question-panel').hidden = true;
  $('result-panel').hidden = false;
  $('keyboard-help').hidden = true;
  const total = roundWords.length;
  const wrong = getWrongWords();
  $('result-title').textContent = roundNumber === 1 ? '퀴즈 완료' : '오답 재시험 완료';
  $('result-total').textContent = total;
  $('result-correct').textContent = roundCorrectCount;
  $('result-wrong').textContent = total - roundCorrectCount;
  $('result-rate').textContent = (roundCorrectCount / total * 100).toFixed(1) + '%';
  $('cumulative-result').textContent = '전체 ' + allWords.length + '단어 중 ' +
    (allWords.length - wrong.length) + '개 정답 상태 · 남은 오답 ' + wrong.length + '개';
  $('retry-wrong').textContent = '오답 ' + wrong.length + '개 다시 시험';
  $('retry-wrong').hidden = wrong.length === 0;
  $('return-to-study').disabled = false;
  (wrong.length ? $('retry-wrong') : $('return-to-study')).focus({ preventScroll: true });
  fitLayout();
}

$('submit-answer').addEventListener('click', submitAnswer);
$('next-question').addEventListener('click', nextQuestion);
$('show-hint').addEventListener('click', () => {
  if (quizState !== 'answering' && quizState !== 'feedback') return;
  $('hint-text').textContent = roundWords[questionIndex].synonyms || '사용 가능한 힌트가 없습니다.';
  $('hint-box').hidden = false;
  $('show-hint').setAttribute('aria-expanded', 'true');
  if (quizState === 'answering') answerInput.focus({ preventScroll: true });
  fitLayout();
});
$('retry-wrong').addEventListener('click', () => {
  if (quizState !== 'results') return;
  const wrong = getWrongWords();
  if (wrong.length) startRound(wrong);
});
$('return-to-study').addEventListener('click', () => {
  if (quizState === 'results') finishQuiz(new Map(latestResults));
});
$('cancel-quiz').addEventListener('click', cancelQuiz);

function resetCompositionSubmit() {
  clearTimeout(imeSubmitTimer);
  imeSubmitTimer = null;
  pendingImeSubmit = false;
  isComposing = false;
  // 다음 문제를 표시해도 같은 Enter를 떼기 전까지 enterHeld는 유지합니다.
}

function queueImeSubmit() {
  if (!pendingImeSubmit || quizState !== 'answering') return;
  const questionId = roundWords[questionIndex].id;
  clearTimeout(imeSubmitTimer);
  // compositionend 뒤의 최종 input 반영까지 기다린 뒤, 예약한 제출을 한 번만 소비합니다.
  imeSubmitTimer = setTimeout(() => {
    imeSubmitTimer = null;
    if (!pendingImeSubmit) return;
    pendingImeSubmit = false;
    if (quizState === 'answering' && !isComposing &&
        roundWords[questionIndex].id === questionId) submitAnswer();
  }, 0);
}

answerInput.addEventListener('compositionstart', () => {
  resetCompositionSubmit();
  isComposing = true;
});
answerInput.addEventListener('compositionend', () => {
  isComposing = false;
  queueImeSubmit();
});

function isEnterKey(event) {
  return event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter';
}

document.addEventListener('keydown', event => {
  if (quizState === 'idle' || !isEnterKey(event)) return;
  // 제출로 포커스가 다음/결과 버튼으로 옮겨져도 같은 키의 기본 클릭까지 차단합니다.
  if ((enterHeld || pendingImeSubmit) &&
      (quizState !== 'answering' || !(event.isComposing || isComposing))) {
    event.preventDefault();
    return;
  }
  if (quizState !== 'answering' && quizState !== 'feedback') return;
  // 힌트/취소 버튼에 Tab으로 이동한 경우 Enter로 해당 버튼을 사용할 수 있습니다.
  const button = event.target.closest('button');
  if (button && button.id !== 'submit-answer' && button.id !== 'next-question') return;
  if (event.isComposing || isComposing || event.keyCode === 229) {
    if (quizState === 'answering' && event.target === answerInput &&
        !event.repeat && !enterHeld && !pendingImeSubmit) {
      pendingImeSubmit = true;
      enterHeld = true;
      // 일부 브라우저는 compositionend 이후에도 keyCode 229를 보냅니다.
      if (!isComposing && !event.isComposing) queueImeSubmit();
    }
    // preventDefault를 호출하지 않아 이 Enter가 한글 조합을 정상 확정하게 합니다.
    return;
  }
  event.preventDefault();
  if (event.repeat || enterHeld || pendingImeSubmit) return;
  enterHeld = true;
  if (quizState === 'answering') submitAnswer();
  else nextQuestion();
});
document.addEventListener('keyup', event => {
  if (!isEnterKey(event)) return;
  if (enterHeld || pendingImeSubmit) event.preventDefault();
  enterHeld = false;
  // 키를 먼저 떼어도 compositionend에서 처리할 pendingImeSubmit은 유지합니다.
});
window.addEventListener('blur', () => { enterHeld = false; });

window.addEventListener('resize', fitLayout);
