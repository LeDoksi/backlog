// app.js
(function () {
  var state = { category: 'all', status: 'all', genre: 'all', returning: false, search: '', sort: 'added' };

  function baseTitles() {
    return BacklogStorage.applyOverlay(TITLES, window.localStorage);
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
    return (
      '<img class="card__cover" src="' + title.cover + '" alt="' + title.title + '">' +
      '<div class="card__body">' +
      '<div class="card__title">' + title.title + '</div>' +
      '<span class="badge">' + title.status + '</span>' + returningBadge +
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
    document.getElementById('modal-synopsis').textContent = title.synopsis;
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
  document.getElementById('modal-close').addEventListener('click', closeTitleModal);
  document.querySelector('.modal__backdrop').addEventListener('click', closeTitleModal);

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
