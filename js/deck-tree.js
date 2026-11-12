const formatCount = new Intl.NumberFormat('ko-KR');

function folderNode(name = '', path = '') {
  return { name, path, folders: new Map(), files: [], decks: [], wordCount: 0 };
}

function buildTree(catalog, folderRoots) {
  const root = folderNode();
  for (const deck of catalog) {
    const segments = deck.path.slice('./data/'.length).split('/');
    const filename = segments.pop();
    const alias = folderRoots[segments[0]];
    const folders = alias ? [...alias, ...segments.slice(1)] : segments;
    let parent = root;

    for (const name of folders) {
      if (!parent.folders.has(name)) {
        const path = parent.path ? parent.path + '/' + name : name;
        parent.folders.set(name, folderNode(name, path));
      }
      parent = parent.folders.get(name);
      parent.decks.push(deck);
      parent.wordCount += deck.count;
    }
    parent.files.push({ deck, name: filename.replace(/\.json$/i, '') });
  }
  return root;
}

function icon(symbol) {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = symbol;
  return span;
}

function countLabel(wordCount) {
  const span = document.createElement('span');
  span.className = 'deck-node-count';
  span.textContent = ' (' + formatCount.format(wordCount) + '단어)';
  return span;
}

export function createDeckTree(container, catalog, status, folderRoots) {
  const selected = new Set();
  const folderInputs = [];
  const fileInputs = new Map();
  let opened = false;

  function selection() {
    return catalog.filter(deck => selected.has(deck.id));
  }

  function updateChecks() {
    for (const [id, input] of fileInputs) input.checked = selected.has(id);
    for (const { node, input } of folderInputs) {
      const checkedCount = node.decks.filter(deck => selected.has(deck.id)).length;
      input.checked = checkedCount === node.decks.length;
      input.indeterminate = checkedCount > 0 && !input.checked;
    }
    const chosen = selection();
    const words = chosen.reduce((sum, deck) => sum + deck.count, 0);
    status.textContent = chosen.length + '개 단어장 · ' + formatCount.format(words) + '단어';
  }

  function setChecked(id, checked) {
    if (checked) selected.add(id);
    else selected.delete(id);
  }

  function renderFile({ deck, name }) {
    const label = document.createElement('label');
    label.className = 'deck-file';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = deck.id;
    input.setAttribute('aria-label', deck.name + ' (' + deck.count + '단어)');
    input.addEventListener('change', () => {
      setChecked(deck.id, input.checked);
      updateChecks();
    });
    label.append(input, icon('📄'), document.createTextNode(name), countLabel(deck.count));
    fileInputs.set(deck.id, input);
    return label;
  }

  function renderFolder(node) {
    const wrapper = document.createElement('div');
    wrapper.className = 'deck-folder';
    wrapper.dataset.folder = node.path;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'deck-folder-check';
    input.setAttribute('aria-label', node.path.replaceAll('/', ' / ') + ' 전체 선택');
    input.addEventListener('change', () => {
      for (const deck of node.decks) setChecked(deck.id, input.checked);
      updateChecks();
    });

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.append(icon('📁'), document.createTextNode(' ' + node.name), countLabel(node.wordCount));
    const children = document.createElement('div');
    children.className = 'deck-children';
    renderChildren(node, children);
    details.append(summary, children);
    wrapper.append(input, details);
    folderInputs.push({ node, input, details });
    return wrapper;
  }

  function renderChildren(node, parent) {
    for (const file of node.files) parent.append(renderFile(file));
    for (const folder of node.folders.values()) parent.append(renderFolder(folder));
  }

  renderChildren(buildTree(catalog, folderRoots), container);

  function setSelection(ids) {
    selected.clear();
    for (const id of ids) {
      if (fileInputs.has(id)) selected.add(id);
    }
    updateChecks();
  }

  return {
    open(ids) {
      setSelection(ids);
      if (opened) return;
      for (const { node, details } of folderInputs) {
        details.open = node.path === '학교' || node.path === '학교/2026' ||
          node.decks.some(deck => selected.has(deck.id));
      }
      opened = true;
    },
    clear() { setSelection([]); },
    selectedIds() { return selection().map(deck => deck.id); }
  };
}
