// app.js
(function () {
  var state = { category: 'all', status: 'all', genre: 'all', returning: false, hideDone: false, search: '', sort: 'status' };
  var STATUS_LABELS = { queue: 'В очереди', in_progress: 'В процессе', done: 'Пройдено' };

  // Three silhouettes that stay legible at 15px and never need a label to be
  // told apart: ruled lines (a list of things not started), a half-turned dial
  // (something under way), a tick (finished). Drawn in the same stroke language
  // as the toolbar's search and chevron icons.
  var STATUS_ACTIONS = [
    {
      key: 'queue',
      label: 'В очереди',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>'
    },
    {
      key: 'in_progress',
      label: 'В процессе',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.4"/><path d="M8 2.6a5.4 5.4 0 0 1 0 10.8z" fill="currentColor" stroke="none"/></svg>'
    },
    {
      key: 'done',
      // "Готово" here and in the modal; Task 23 renames the badge to match.
      label: 'Готово',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.2 8.4 6.4 11.6 12.8 4.8"/></svg>'
    }
  ];

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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cardStatusHtml(title) {
    var buttons = STATUS_ACTIONS.map(function (action) {
      var isActive = title.status === action.key;
      // The label doubles as the native tooltip and the accessible name, so the
      // icon never has to carry meaning on its own.
      var name = escapeHtml(action.label);
      return '<button type="button" class="card-status__btn' + (isActive ? ' is-active' : '') +
        '" data-status="' + action.key + '" aria-pressed="' + isActive +
        '" title="' + name + '" aria-label="' + name + '">' + action.icon + '</button>';
    }).join('');
    return '<div class="card-status" role="group" aria-label="Статус">' + buttons + '</div>';
  }

  function cardHtml(title) {
    var returningBadge = BacklogQuery.isReturning(title)
      ? '<span class="badge badge--returning">Ждёт продолжения</span>'
      : '';
    var draftBadge = title.draft ? '<span class="badge badge--draft">Черновик</span>' : '';
    var safeTitle = escapeHtml(title.title);
    var safeCover = escapeHtml(title.cover);
    return (
      '<div class="card__poster">' +
      '<img class="card__cover" src="' + safeCover + '" alt="' + safeTitle + '">' +
      cardStatusHtml(title) +
      '</div>' +
      '<div class="card__body">' +
      '<div class="card__title">' + safeTitle + '</div>' +
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
      if (state.hideDone && t.status === 'done') return false;
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
  document.getElementById('hide-done-filter').addEventListener('change', function (e) {
    state.hideDone = e.target.checked;
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

  // ── Modal controls: status segments and the star strip ─────────────────

  var statusGroup = document.getElementById('modal-status');
  var starStrip = document.getElementById('modal-rating');
  var ratingReadout = document.getElementById('modal-rating-readout');
  var stars = Array.prototype.slice.call(starStrip.querySelectorAll('.star-rating__star'));
  var previewValue = null;

  function renderStatusButtons(status) {
    statusGroup.querySelectorAll('.status-buttons__btn').forEach(function (btn) {
      var isActive = btn.dataset.status === status;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function currentRating() {
    return parseInt(starStrip.dataset.rating || '0', 10);
  }

  function drawReadout() {
    var rating = currentRating();
    // Hovering the star you already gave is the way to un-rate a title, so the
    // readout says what the click will do instead of leaving it to be guessed.
    if (previewValue !== null && previewValue === rating) {
      ratingReadout.className = 'rating__readout rating__readout--clear';
      ratingReadout.textContent = 'Убрать';
      return;
    }
    var shown = previewValue !== null ? previewValue : rating;
    ratingReadout.className = 'rating__readout';
    ratingReadout.innerHTML = '<span class="rating__value">' + (shown || '—') + '</span>/10';
  }

  function renderRating(rating) {
    var value = rating || 0;
    starStrip.dataset.rating = String(value);
    starStrip.setAttribute('aria-label', value ? 'Оценка ' + value + ' из 10' : 'Оценка от 1 до 10');
    stars.forEach(function (star) {
      var starValue = parseInt(star.dataset.value, 10);
      star.classList.toggle('is-filled', starValue <= value);
      star.setAttribute('aria-pressed', String(starValue === value));
      // Roving tabindex: ten stars should cost one tab stop, not ten. Arrow
      // keys walk the row from whichever star currently holds the rating.
      star.tabIndex = starValue === (value || 1) ? 0 : -1;
    });
    drawReadout();
  }

  function setPreview(value) {
    previewValue = value;
    starStrip.classList.add('is-previewing');
    stars.forEach(function (star) {
      star.classList.toggle('is-preview', parseInt(star.dataset.value, 10) <= value);
    });
    drawReadout();
  }

  function clearPreview() {
    previewValue = null;
    starStrip.classList.remove('is-previewing');
    stars.forEach(function (star) { star.classList.remove('is-preview'); });
    drawReadout();
  }

  starStrip.addEventListener('pointerover', function (event) {
    // A touch tap fires pointerover with no matching leave, which would strand
    // the preview lit over the real rating. Only a real pointer previews.
    if (event.pointerType !== 'mouse') return;
    var star = event.target.closest('.star-rating__star');
    if (star) setPreview(parseInt(star.dataset.value, 10));
  });

  starStrip.addEventListener('pointerleave', clearPreview);

  // The keyboard gets the same preview as the pointer: arrowing along the row
  // lights the strip to the focused star before anything is committed.
  starStrip.addEventListener('focusin', function (event) {
    var star = event.target.closest('.star-rating__star');
    if (star) setPreview(parseInt(star.dataset.value, 10));
  });

  starStrip.addEventListener('focusout', function (event) {
    if (!starStrip.contains(event.relatedTarget)) clearPreview();
  });

  starStrip.addEventListener('keydown', function (event) {
    var star = event.target.closest('.star-rating__star');
    if (!star) return;
    var index = stars.indexOf(star);
    var next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stars.length - 1;
    else return;
    event.preventDefault();
    next = Math.max(0, Math.min(stars.length - 1, next));
    stars.forEach(function (s) { s.tabIndex = -1; });
    stars[next].tabIndex = 0;
    stars[next].focus();
  });

  starStrip.addEventListener('click', function (event) {
    var star = event.target.closest('.star-rating__star');
    if (!star) return;
    var id = document.getElementById('title-modal').dataset.id;
    if (!id) return;
    var value = parseInt(star.dataset.value, 10);
    var next = value === currentRating() ? null : value;
    BacklogStorage.setOverride(window.localStorage, id, { rating: next });
    renderRating(next);
    // The pointer has not moved, so re-run the preview against the new rating —
    // otherwise the readout would still be offering to clear what just went.
    if (previewValue !== null) setPreview(value);
    refresh();
  });

  statusGroup.addEventListener('click', function (event) {
    var btn = event.target.closest('.status-buttons__btn');
    if (!btn) return;
    var id = document.getElementById('title-modal').dataset.id;
    if (!id) return;
    BacklogStorage.setOverride(window.localStorage, id, { status: btn.dataset.status });
    renderStatusButtons(btn.dataset.status);
    refresh();
  });

  function openTitleModal(id) {
    var title = findTitleById(id);
    if (!title) return;
    document.getElementById('modal-cover').src = title.cover;
    document.getElementById('modal-cover').alt = title.title;
    document.getElementById('modal-title').textContent = title.title;
    var meta = [title.year, title.genres.join(', ')].filter(Boolean).join(' · ');
    if (title.airingStatus) meta += ' · ' + (title.airingStatus === 'ongoing' ? 'выходит' : 'завершено');
    document.getElementById('modal-meta').textContent = meta;
    var seasonsEl = document.getElementById('modal-seasons');
    seasonsEl.textContent = title.seasonInfo ? 'Сезоны: ' + title.seasonInfo : '';
    seasonsEl.hidden = !title.seasonInfo;
    document.getElementById('modal-synopsis').textContent = title.draft
      ? 'Черновик — жанры, год, постер и описание ещё не заполнены. Просто попросите Claude дополнить «' + title.title + '».'
      : title.synopsis;
    renderStatusButtons(title.status);
    clearPreview();
    renderRating(title.rating);
    var modal = document.getElementById('title-modal');
    modal.dataset.id = id;
    modal.hidden = false;
  }

  function closeTitleModal() {
    document.getElementById('title-modal').hidden = true;
  }

  var grid = document.getElementById('grid');

  function applyCardStatus(btn) {
    var card = btn.closest('.card');
    if (!card) return;
    var id = card.dataset.id;
    var status = btn.dataset.status;
    var keepFocus = document.activeElement === btn;
    BacklogStorage.setOverride(window.localStorage, id, { status: status });
    refresh();
    // refresh() rebuilds the grid, so a keyboard user's focus would drop to
    // <body>. Put it back on the same control of the same card — unless the
    // card has just been filtered out by the change that was made.
    if (keepFocus) {
      var again = Array.prototype.slice.call(grid.querySelectorAll('.card'))
        .filter(function (c) { return c.dataset.id === id; })[0];
      var target = again && again.querySelector('.card-status__btn[data-status="' + status + '"]');
      if (target) target.focus();
    }
    // If this title's modal happens to be open behind the change, keep the two
    // views telling the same story.
    var modal = document.getElementById('title-modal');
    if (!modal.hidden && modal.dataset.id === id) renderStatusButtons(status);
  }

  grid.addEventListener('click', function (event) {
    var quick = event.target.closest('.card-status__btn');
    if (quick) {
      // Both branches live in one listener on #grid, so the early return is
      // what actually keeps the card from opening — stopPropagation could not,
      // since sibling listeners on the same node still run. It is kept so
      // nothing bound above #grid is surprised either.
      event.stopPropagation();
      applyCardStatus(quick);
      return;
    }
    var card = event.target.closest('.card');
    if (card) openTitleModal(card.dataset.id);
  });

  grid.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    // A quick-action button turns Enter/Space into its own click; without this
    // the modal would open on top of the status change.
    if (event.target.closest('.card-status__btn')) return;
    var card = event.target.closest('.card');
    if (!card) return;
    if (event.key === ' ' || event.key === 'Spacebar') event.preventDefault();
    openTitleModal(card.dataset.id);
  });
  document.getElementById('modal-close').addEventListener('click', closeTitleModal);
  document.querySelector('.modal__backdrop').addEventListener('click', closeTitleModal);

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
