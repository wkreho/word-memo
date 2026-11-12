import { catalog } from '../data/catalog.js';
import { startQuiz } from './quiz.js';
import { createDeckTree } from './deck-tree.js';

const $ = id => document.getElementById(id);
const table = $('vocab-table');
const tableBody = $('vocab-body');
const shuffleBtn = $('shuffle-btn');
const hideCheckedBtn = $('hide-checked-btn');
const showAllBtn = $('show-all-btn');
const rangeStart = $('range-start');
const rangeEnd = $('range-end');
const visibleCount = $('visible-count');
const selectionStatus = $('selection-status');
const loadStatus = $('load-status');
const quizSetup = $('quiz-setup');
const quizTargetCount = $('quiz-target-count');
const quizSetupMessage = $('quiz-setup-message');
const quizStartButton = $('start-quiz-btn');
const quizButton = $('quiz-btn');
const quizRowData = new WeakMap();
const deckDialog = $('deck-dialog');
const deckButton = $('deck-btn');
const decksById = new Map(catalog.map(deck => [deck.id, deck]));
const storageKey = 'word-memo.progress.v1';

function readProgress() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch {
    return {};
  }
}

function validWordId(id) {
  if (typeof id !== 'string') return false;
  const match = /^(.+):(0|[1-9]\d*)$/.exec(id);
  return Boolean(match && Number(match[2]) < (decksById.get(match[1])?.count ?? 0));
}

const saved = readProgress();
const checkedIds = new Set(Array.isArray(saved.checked) ? saved.checked.filter(validWordId) : []);
let selectedIds = [];
let column = saved.column === 'synonyms' ? 'synonyms' : 'english';
let hoveredColumn = null;

function saveProgress() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      selected: selectedIds,
      checked: [...checkedIds],
      column
    }));
    $('storage-status').hidden = true;
  } catch {
    $('storage-status').hidden = false;
  }
}

function setColumn(next) {
  column = next;
  $('detail-heading').textContent = column === 'english' ? '영어 정의' : '동의어';
  document.querySelectorAll('[data-column]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.column === column));
  });
  getDataRows().forEach(row => {
    row.cells[2].textContent = quizRowData.get(row)[column];
  });
}

document.querySelectorAll('[data-column]').forEach(button => {
  button.addEventListener('click', () => {
    setColumn(button.dataset.column);
    saveProgress();
  });
});

const deckTree = createDeckTree($('deck-tree'), catalog, $('deck-draft-count'));
deckButton.addEventListener('click', () => {
  deckTree.open(selectedIds);
  deckDialog.showModal();
});
$('deck-clear').addEventListener('click', () => deckTree.clear());
$('deck-cancel').addEventListener('click', () => deckDialog.close());
$('deck-apply').addEventListener('click', () => {
  const ids = deckTree.selectedIds();
  deckDialog.close();
  if (ids.join('|') !== selectedIds.join('|')) loadDecks(ids);
});

async function fetchDeck(deck) {
  const response = await fetch(deck.path);
  if (!response.ok) throw new Error(deck.name + ' (' + response.status + ')');
  const entries = await response.json();
  if (!Array.isArray(entries) || entries.length !== deck.count ||
      entries.some(item => !item || typeof item.word !== 'string' || !item.word.trim() ||
        ['korean', 'english', 'synonyms', 'example'].some(key =>
          item[key] != null && typeof item[key] !== 'string'))) {
    throw new Error(deck.name + ' 데이터 형식을 확인해 주세요.');
  }
  return entries.map((item, index) => ({
    id: deck.id + ':' + index,
    word: item.word,
    korean: item.korean ?? '',
    english: item.english ?? '',
    synonyms: item.synonyms ?? '',
    example: item.example ?? ''
  }));
}

async function loadDecks(ids) {
  const decks = ids.map(id => decksById.get(id));
  table.setAttribute('aria-busy', 'true');
  deckButton.disabled = quizButton.disabled = true;
  loadStatus.textContent = '단어장을 불러오는 중…';
  try {
    const words = (await Promise.all(decks.map(fetchDeck))).flat();
    renderWords(words);
    selectedIds = ids;
    $('selected-decks').textContent = decks.length
      ? decks.map(deck => deck.name + ' (' + deck.count + '개)').join(' · ')
      : '단어장을 선택해 주세요.';
    loadStatus.textContent = '총 ' + words.length + '단어 · ' + decks.length + '개 단어장';
    saveProgress();
  } catch (error) {
    loadStatus.textContent = '단어장을 불러오지 못했습니다. ' + error.message;
  } finally {
    table.setAttribute('aria-busy', 'false');
    deckButton.disabled = false;
    quizButton.disabled = !tableBody.rows.length;
  }
}

function rememberCheck(row, checked) {
  const id = row.dataset.quizId;
  if (checked) checkedIds.add(id);
  else checkedIds.delete(id);
}

tableBody.addEventListener('change', event => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  rememberCheck(event.target.closest('tr'), event.target.checked);
  saveProgress();
});

$('reset-progress').addEventListener('click', () => {
  if (!window.confirm('모든 단어장의 체크 기록을 지울까요?')) return;
  checkedIds.clear();
  setRowsChecked(getDataRows(), false);
  showAllBtn.click();
  selectionStatus.textContent = '모든 단어장의 학습 기록을 초기화했습니다.';
});

function getQuizRows() {
  return getVisibleRows().filter(row => {
    const style = getComputedStyle(row);
    return row.getClientRects().length > 0 &&
      style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
      style.opacity !== '0' &&
      !row.querySelector('input[type="checkbox"]').checked && quizRowData.has(row);
  });
}

quizButton.addEventListener('click', () => {
  const count = getQuizRows().length;
  quizTargetCount.textContent = '퀴즈 대상: ' + count + '단어';
  quizSetupMessage.textContent = count ? '' : '시험할 수 있는 미체크 단어가 없습니다.';
  quizStartButton.disabled = count === 0;
  quizSetup.showModal();
});

$('cancel-quiz-setup').addEventListener('click', () => quizSetup.close());
quizStartButton.addEventListener('click', () => {
  const rows = getQuizRows();
  if (!rows.length) {
    quizTargetCount.textContent = '퀴즈 대상: 0단어';
    quizSetupMessage.textContent = '시험할 수 있는 미체크 단어가 없습니다.';
    quizStartButton.disabled = true;
    return;
  }

  const direction = quizSetup.querySelector('input[name="quiz-direction"]:checked').value;
  const rowsById = new Map(rows.map(row => [row.dataset.quizId, row]));
  const studyScroll = window.scrollY;
  quizSetup.close();
  $('study-view').hidden = true;
  $('quiz-view').hidden = false;
  document.body.classList.add('quiz-active');
  window.scrollTo(0, 0);

  startQuiz(rows.map(row => quizRowData.get(row)), direction, results => {
    $('quiz-view').hidden = true;
    $('study-view').hidden = false;
    document.body.classList.remove('quiz-active', 'allow-scroll');
    if (results) {
      let correct = 0;
      for (const [id, checked] of results) {
        const row = rowsById.get(id);
        row.querySelector('input[type="checkbox"]').checked = checked;
        rememberCheck(row, checked);
        if (checked) correct += 1;
      }
      saveProgress();
      selectionStatus.textContent = '퀴즈 결과 반영: 정답 ' + correct + '개 · 오답 ' +
        (results.size - correct) + '개. 기존 숨김 상태는 유지했습니다.';
    } else {
      selectionStatus.textContent = '퀴즈를 취소했습니다. 기존 체크 상태를 유지했습니다.';
    }
    quizButton.focus({ preventScroll: true });
    window.scrollTo(0, studyScroll);
  });
});

function getDataRows() {
  return Array.from(tableBody.rows);
}

// 선택과 구간 번호는 원본 데이터가 아닌, 현재 보이는 DOM 행 순서를 기준으로 합니다.
function getVisibleRows() {
  return getDataRows().filter(row => getComputedStyle(row).display !== 'none');
}

// 기존 갱신 시점마다 줄무늬와 번호를 함께 갱신합니다. 숨긴 행에는 번호를 남기지 않습니다.
function updateRowColors() {
  let visibleIndex = 0;
  getDataRows().forEach(row => {
    row.classList.remove('row-a', 'row-b');
    const number = row.querySelector('.row-number');
    number.textContent = '';
    if (getComputedStyle(row).display === 'none') return;
    row.classList.add(visibleIndex % 2 === 0 ? 'row-b' : 'row-a');
    visibleIndex += 1;
    number.textContent = visibleIndex;
  });
  visibleCount.textContent = `현재 보이는 순서 기준 · ${visibleIndex}개`;
  selectionStatus.textContent = '';
}

function setRowsChecked(rows, checked) {
  rows.forEach(row => {
    row.querySelector('input[type="checkbox"]').checked = checked;
    rememberCheck(row, checked);
  });
  saveProgress();
}

document.getElementById('select-all-btn').addEventListener('click', () => {
  const rows = getVisibleRows();
  setRowsChecked(rows, true);
  selectionStatus.textContent = `보이는 ${rows.length}개 항목을 선택했습니다.`;
});

document.getElementById('clear-all-btn').addEventListener('click', () => {
  setRowsChecked(getDataRows(), false);
  selectionStatus.textContent = '숨겨진 항목을 포함해 모든 체크를 해제했습니다.';
});

function setRangeChecked(checked) {
  const rows = getVisibleRows();
  if (!rows.length) {
    selectionStatus.textContent = '현재 보이는 단어가 없습니다.';
    return;
  }

  const startValue = rangeStart.value.trim();
  const endValue = rangeEnd.value.trim();
  let start = Number(startValue);
  let end = Number(endValue);
  if (!startValue || !endValue || !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) || start < 1 || end < 1) {
    selectionStatus.textContent = '시작과 끝 번호에 1 이상의 정수를 입력하세요.';
    return;
  }

  // 역순 입력은 교환하고, 보이는 범위와 겹치는 부분만 선택/해제합니다.
  if (start > end) [start, end] = [end, start];
  if (start > rows.length) {
    selectionStatus.textContent = `현재 번호는 1~${rows.length}입니다. 입력한 구간에 해당하는 행이 없습니다.`;
    return;
  }
  end = Math.min(end, rows.length);
  rangeStart.value = start;
  rangeEnd.value = end;
  setRowsChecked(rows.slice(start - 1, end), checked);
  selectionStatus.textContent = `${start}~${end}번 항목 ${end - start + 1}개를 ${checked ? '선택' : '해제'}했습니다.`;
}

document.getElementById('select-range-btn').addEventListener('click', () => setRangeChecked(true));
document.getElementById('clear-range-btn').addEventListener('click', () => setRangeChecked(false));

// 데이터 파일에는 단어만 두고, 셀과 체크박스 생성은 본체에서 처리합니다.
function renderWords(words) {
  const fragment = document.createDocumentFragment();
  words.forEach(word => {
    const row = document.createElement('tr');
    row.dataset.quizId = word.id;
    quizRowData.set(row, word);
    [word.word, word.korean, word[column]].forEach(text => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checkedIds.has(word.id);
    checkbox.setAttribute('aria-label', `${word.word} 암기 완료`);
    const checkboxCell = document.createElement('td');
    checkboxCell.className = 'selection-cell';
    const number = document.createElement('span');
    number.className = 'row-number';
    checkboxCell.append(number, checkbox);
    row.appendChild(checkboxCell);
    fragment.appendChild(row);
  });
  tableBody.replaceChildren(fragment);
  updateRowColors();
}

// Fisher–Yates 방식으로 섞습니다. 기존 체크 상태와 숨김 상태는 행에 유지됩니다.
function shuffleTable() {
  const dataRows = getDataRows();
  for (let i = dataRows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [dataRows[i], dataRows[j]] = [dataRows[j], dataRows[i]];
  }
  const fragment = document.createDocumentFragment();
  dataRows.forEach(row => fragment.appendChild(row));
  tableBody.appendChild(fragment);
  updateRowColors();
}
shuffleBtn.addEventListener('click', shuffleTable);

// 체크된 항목 숨기기
hideCheckedBtn.addEventListener('click', () => {
  getDataRows().forEach(row => {
    if (row.querySelector('input[type="checkbox"]').checked) {
      row.style.display = 'none';
    }
  });
  updateRowColors();
});

// 모두 다시 보이기: 체크 상태는 기존처럼 유지합니다.
showAllBtn.addEventListener('click', () => {
  getDataRows().forEach(row => {
    row.style.display = '';
  });
  updateRowColors();
});

const hiddenColumn = $('hidden-column');
function updateHiddenColumn() {
  const index = hiddenColumn.value === '' ? hoveredColumn : Number(hiddenColumn.value);
  for (let i = 0; i < 3; i += 1) table.classList.toggle('hide-col-' + i, index === i);
}

hiddenColumn.addEventListener('change', updateHiddenColumn);
table.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse') return;
  const index = event.target.closest('td, th')?.cellIndex;
  const next = index === 1 || index === 2 ? index : null;
  if (hoveredColumn === next) return;
  hoveredColumn = next;
  updateHiddenColumn();
});
table.addEventListener('pointerleave', () => {
  hoveredColumn = null;
  updateHiddenColumn();
});

setColumn(column);
updateRowColors();
const savedIds = Array.isArray(saved.selected) ? saved.selected : ['collection/12'];
loadDecks(catalog.filter(deck => savedIds.includes(deck.id)).map(deck => deck.id));
