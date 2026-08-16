// app.js
(function () {
  var state = { category: 'all', status: 'all', genre: 'all', returning: false, search: '', sort: 'added' };
  var STATUS_LABELS = { queue: 'В очереди', in_progress: 'В процессе', done: 'Пройдено' };

  function baseTitles() {
    var combined = BacklogStorage.combineWithAdded(TITLES, window.localStorage);
    return BacklogStorage.applyOverlay(combined, window.localStorage);
  }

  function titlesForCategory(category) {
    var all = baseTitles();
    if (category === 'all') return all;
    return all.filter(function (t) { return t.category === category; });
  }

  function renderCounters() {
    document.querySelectorAll('.tabs__count').forEach(function (el) {
      var category = el.getAttribute('data-count');
      var progress = BacklogQuery.countProgress(titlesForCategory(category));
      el.textContent = progress.done + '/' + progress.total;
    });
  }

  function cardHtml(title) {
    var returningBadge = BacklogQuery.isReturning(title)
      ? '<span class="badge badge--returning">Ждёт продолжения</span>'
      : '';
    var draftBadge = title.draft ? '<span class="badge badge--draft">Черновик</span>' : '';
    return (
      '<img class="card__cover" src="' + title.cover + '" alt="' + title.title + '">' +
      '<div class="card__body">' +
      '<div class="card__title">' + title.title + '</div>' +
      '<span class="badge">' + (STATUS_LABELS[title.status] || title.status) + '</span>' + returningBadge + draftBadge +
      '</div>'
    );
  }

  function renderGrid(titles) {
    var grid = document.getElementById('grid');
    grid.innerHTML = '';
    titles.forEach(function (title) {
      var card = document.createElement('article');
      card.className = 'card';
      card.dataset.id = title.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', title.title);
      card.innerHTML = cardHtml(title);
      grid.appendChild(card);
    });
  }

  function populateGenreFilter() {
    var select = document.getElementById('genre-filter');
    var genres = {};
    baseTitles().forEach(function (t) { t.genres.forEach(function (g) { genres[g] = true; }); });
    Object.keys(genres).sort().forEach(function (g) {
      var option = document.createElement('option');
      option.value = g;
      option.textContent = g;
      select.appendChild(option);
    });
  }

  function getVisibleTitles() {
    var titles = titlesForCategory(state.category).filter(function (t) {
      return BacklogQuery.matchesFilters(t, { status: state.status, genre: state.genre, returning: state.returning })
        && BacklogQuery.matchesSearch(t, state.search);
    });
    return BacklogQuery.sortTitles(titles, state.sort);
  }

  function refresh() {
    renderGrid(getVisibleTitles());
    renderCounters();
  }

  function onTabClick(event) {
    var button = event.target.closest('.tabs__item');
    if (!button) return;
    state.category = button.getAttribute('data-category');
    document.querySelectorAll('.tabs__item').forEach(function (b) { b.classList.remove('is-active'); });
    button.classList.add('is-active');
    refresh();
  }

  document.getElementById('tabs').addEventListener('click', onTabClick);

  document.getElementById('status-filter').addEventListener('change', function (e) {
    state.status = e.target.value;
    refresh();
  });
  document.getElementById('genre-filter').addEventListener('change', function (e) {
    state.genre = e.target.value;
    refresh();
  });
  document.getElementById('returning-filter').addEventListener('change', function (e) {
    state.returning = e.target.checked;
    refresh();
  });
  document.getElementById('sort-select').addEventListener('change', function (e) {
    state.sort = e.target.value;
    refresh();
  });
  document.getElementById('search-input').addEventListener('input', function (e) {
    state.search = e.target.value;
    refresh();
  });

  function findTitleById(id) {
    return baseTitles().filter(function (t) { return t.id === id; })[0];
  }

  function openTitleModal(id) {
    var title = findTitleById(id);
    if (!title) return;
    document.getElementById('modal-cover').src = title.cover;
    document.getElementById('modal-cover').alt = title.title;
    document.getElementById('modal-title').textContent = title.title;
    var meta = [title.year, title.genres.join(', ')].filter(Boolean).join(' · ');
    if (title.airingStatus) meta += ' · ' + (title.airingStatus === 'ongoing' ? 'выходит' : 'завершено');
    document.getElementById('modal-meta').textContent = meta;
    document.getElementById('modal-synopsis').textContent = title.draft
      ? 'Черновик — жанры, год, постер и описание ещё не заполнены. Просто попросите Claude дополнить «' + title.title + '».'
      : title.synopsis;
    document.getElementById('modal-status').value = title.status;
    document.getElementById('modal-rating').value = title.rating || '';
    var modal = document.getElementById('title-modal');
    modal.dataset.id = id;
    modal.hidden = false;
  }

  function closeTitleModal() {
    document.getElementById('title-modal').hidden = true;
  }

  document.getElementById('grid').addEventListener('click', function (event) {
    var card = event.target.closest('.card');
    if (card) openTitleModal(card.dataset.id);
  });
  document.getElementById('grid').addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    var card = event.target.closest('.card');
    if (!card) return;
    if (event.key === ' ' || event.key === 'Spacebar') event.preventDefault();
    openTitleModal(card.dataset.id);
  });
  document.getElementById('modal-close').addEventListener('click', closeTitleModal);
  document.querySelector('.modal__backdrop').addEventListener('click', closeTitleModal);

  document.getElementById('modal-status').addEventListener('change', function (e) {
    var id = document.getElementById('title-modal').dataset.id;
    BacklogStorage.setOverride(window.localStorage, id, { status: e.target.value });
    refresh();
  });

  document.getElementById('modal-rating').addEventListener('change', function (e) {
    var id = document.getElementById('title-modal').dataset.id;
    var value = e.target.value ? parseInt(e.target.value, 10) : null;
    BacklogStorage.setOverride(window.localStorage, id, { rating: value });
    refresh();
  });

  document.getElementById('modal-delete').addEventListener('click', function () {
    var id = document.getElementById('title-modal').dataset.id;
    var title = findTitleById(id);
    if (!title) return;
    var confirmed = window.confirm('Удалить «' + title.title + '» из бэклога? Это действие нельзя отменить.');
    if (!confirmed) return;
    BacklogStorage.deleteTitle(window.localStorage, id);
    closeTitleModal();
    refresh();
  });

  document.getElementById('quick-add-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var titleInput = document.getElementById('quick-add-title');
    var categorySelect = document.getElementById('quick-add-category');
    var name = titleInput.value.trim();
    var category = categorySelect.value;
    if (!name || !category) return;
    var existingIds = baseTitles().map(function (t) { return t.id; });
    var id = BacklogSlug.uniqueId(name, existingIds);
    BacklogStorage.addTitle(window.localStorage, {
      id: id,
      title: name,
      category: category,
      status: 'queue',
      airingStatus: (category === 'series' || category === 'anime') ? 'ongoing' : null,
      year: null,
      genres: [],
      rating: null,
      synopsis: '',
      cover: 'images/covers/_placeholder.svg',
      draft: true
    });
    titleInput.value = '';
    categorySelect.value = '';
    refresh();
  });

  populateGenreFilter();
  refresh();

  window.BacklogApp = {
    getVisibleTitles: getVisibleTitles,
    renderGrid: renderGrid,
    refresh: refresh,
    openTitleModal: openTitleModal,
    closeTitleModal: closeTitleModal,
    state: state
  };
}());
