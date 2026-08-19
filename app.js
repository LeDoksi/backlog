// app.js
(function () {
  var state = { category: 'all', status: 'all', genre: [], returning: false, hideDone: false, search: '', sort: 'status' };
  var STATUS_LABELS = { queue: 'В бэклоге', in_progress: 'В процессе', done: 'Завершено' };

  // Three silhouettes that stay legible at 15px and never need a label to be
  // told apart: ruled lines (a list of things not started), a half-turned dial
  // (something under way), a tick (finished). Drawn in the same stroke language
  // as the toolbar's search and chevron icons.
  var STATUS_ACTIONS = [
    {
      key: 'queue',
      label: 'В бэклоге',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>'
    },
    {
      key: 'in_progress',
      label: 'В процессе',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.4"/><path d="M8 2.6a5.4 5.4 0 0 1 0 10.8z" fill="currentColor" stroke="none"/></svg>'
    },
    {
      key: 'done',
      // Kept in step with STATUS_LABELS, the modal's segments and the status
      // filter — one status, one word, everywhere it is spelled out.
      label: 'Завершено',
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

  // Genre names and ids both go into attribute selectors; neither is anything
  // but letters today, but the escape costs nothing and the fallback keeps the
  // lookup working on browsers without CSS.escape.
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value;
  }

  function cardStatusHtml(title) {
    var buttons = STATUS_ACTIONS.map(function (action) {
      var isActive = title.status === action.key;
      // The label doubles as the native tooltip and the accessible name, so the
      // icon never has to carry meaning on its own.
      var name = escapeHtml(action.label);
      // tabindex -1 on all three: the card is already a tab stop, and 129 cards
      // × 3 buttons would add 387 more. The group is entered with Left/Right
      // from the card and walked with Left/Right/Home/End — the same roving
      // scheme the modal's ten stars use to cost one tab stop instead of ten.
      return '<button type="button" tabindex="-1" class="card-status__btn' + (isActive ? ' is-active' : '') +
        '" data-status="' + action.key + '" aria-pressed="' + isActive +
        '" title="' + name + '" aria-label="' + name + '">' + action.icon + '</button>';
    }).join('');
    return '<div class="card-status" role="group" aria-label="Статус">' + buttons + '</div>';
  }

  // ── The rating mark ───────────────────────────────────────────────────
  //
  // One star from the modal's strip, plus the modal's readout value: that is
  // the whole composition. It is the same statement the modal makes, compressed
  // to the two glyphs that survive at 168px — the gold star says "this is a
  // rating", the numeral says which. Rated and unrated differ in material, not
  // only in colour: a rated title's plate is mounted with a solid hairline and
  // its star lights under the shelf light; an unrated one keeps the dashed rim
  // this app already uses for "not filled in yet" (the draft badge, an unaired
  // season's box) and shows the readout's own «—». So a scan of the wall reads
  // as which shelves have been graded, and that read survives greyscale.
  //
  // Purely a display mark — aria-hidden, with the same fact folded into the
  // card's own aria-label, since the rating is set on the modal's star strip
  // and a second, half-sized control on the poster would be one too many.
  function cardRatingHtml(title) {
    var rated = typeof title.rating === 'number';
    var tip = rated ? 'Моя оценка: ' + title.rating + ' из 10' : 'Оценка ещё не выставлена';
    return '<span class="card-rating' + (rated ? ' is-rated' : '') +
      '" title="' + escapeHtml(tip) + '" aria-hidden="true">' +
      '<span class="card-rating__star"></span>' +
      '<span class="card-rating__value">' + (rated ? title.rating : '—') + '</span>' +
      '</span>';
  }

  function ratingLabel(title) {
    return typeof title.rating === 'number' ? 'оценка ' + title.rating + ' из 10' : 'без оценки';
  }

  // The card's accessible name carries what the poster shows: the title, and
  // whether it has been graded. Kept in one place because renderGrid writes it
  // once and patchCardRating rewrites it on every change.
  function cardLabel(title) {
    return title.title + ' — ' + ratingLabel(title);
  }

  function cardHtml(title) {
    var airingBadge = BacklogQuery.isStillAiring(title)
      ? '<span class="badge badge--returning">Всё ещё выходит</span>'
      : '';
    var draftBadge = title.draft ? '<span class="badge badge--draft">Черновик</span>' : '';
    var safeTitle = escapeHtml(title.title);
    var safeCover = escapeHtml(title.cover);
    // A parts-bearing title's status is derived from its checklist, not set by
    // hand — see hasPartsChecklist in lib/storage.js. The quick-action strip
    // writes a status override, which the derivation would immediately shadow
    // on the next read, so for these titles the strip is not rendered at all
    // rather than left to click and silently do nothing useful. The badge
    // above it still shows the derived status; only the three buttons go.
    var quickActions = hasPartsChecklist(title) ? '' : cardStatusHtml(title);
    return (
      '<div class="card__poster">' +
      '<img class="card__cover" src="' + safeCover + '" alt="' + safeTitle + '">' +
      cardRatingHtml(title) +
      quickActions +
      '</div>' +
      '<div class="card__body">' +
      '<div class="card__title">' + safeTitle + '</div>' +
      // data-status is what styles.css resolves the chip's hue from, so the
      // badge is coloured by the same attribute the quick-action buttons and the
      // modal's segments use — one map, three surfaces.
      '<span class="badge card__status-badge" data-status="' + title.status + '">' +
      (STATUS_LABELS[title.status] || title.status) + '</span>' + airingBadge + draftBadge +
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
      card.setAttribute('aria-label', cardLabel(title));
      card.innerHTML = cardHtml(title);
      grid.appendChild(card);
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

  // ── Deferred grid reorder ─────────────────────────────────────────────
  //
  // The grid's default sort is status-based, so changing a card's status can
  // move that card — and every card after it — to a different slot. Doing that
  // under a stationary pointer is how a second click lands on a title the user
  // never aimed at: with a mouse the reveal strip's `pointer-events` has not
  // recomputed (no intervening mousemove) so the click falls through to the
  // card body and opens the wrong modal; on touch the strip is always live and
  // the second tap silently writes the wrong status. Rapid triage down a row
  // is the whole point of these buttons, so the row must hold still while it
  // is being triaged.
  //
  // So a quick-action patches only its own card, and the reorder is held until
  // the user is demonstrably done working inside the grid: the mouse leaves it,
  // focus leaves it, or a pointer goes down anywhere outside it.
  var gridStale = false;

  function refresh() {
    gridStale = false;
    renderGrid(getVisibleTitles());
    renderCounters();
  }

  function flushGrid() {
    if (!gridStale) return;
    gridStale = false;
    renderGrid(getVisibleTitles());
  }

  function onTabClick(event) {
    var button = event.target.closest('.tabs__item');
    if (!button) return;
    state.category = button.getAttribute('data-category');
    // Task 23: the genre list is scoped to the active category, so a genre
    // picked on one tab may not even exist on the next — the selection is
    // dropped and the list rebuilt rather than carried across.
    state.genre = [];
    populateGenreFilter();
    document.querySelectorAll('.tabs__item').forEach(function (b) { b.classList.remove('is-active'); });
    button.classList.add('is-active');
    updateRandomAvailability();
    refresh();
  }

  document.getElementById('tabs').addEventListener('click', onTabClick);

  document.getElementById('status-filter').addEventListener('change', function (e) {
    state.status = e.target.value;
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

  // ── Genre filter: a multi-select popover ─────────────────────────────
  //
  // Thirty-one genres on «Всё» will not sit open in a toolbar whose whole job
  // is to recede behind the poster wall, so they fold behind one trigger cut
  // to the same 36px silhouette as the selects beside it.
  //
  // Every row carries the number of titles that genre holds on the active tab,
  // and the list is ordered by that number. The distribution is nowhere near
  // flat — боевик 77 against военный 1 — so weight-first ordering puts the
  // genres that actually cut the wall at the top and sinks the one-title tail,
  // and the count beside each name is what makes that order self-evident
  // instead of arbitrary. Equal counts fall back to alphabetical so the order
  // is stable between renders.
  //
  // Ticking a genre never re-sorts the list: it has to hold still while it is
  // being worked, the same rule the grid follows for its quick-actions.
  var genreWrap = document.getElementById('genre-filter');
  var genreTrigger = document.getElementById('genre-trigger');
  var genrePanel = document.getElementById('genre-panel');
  var genreOptions = document.getElementById('genre-options');
  var genreFooter = document.getElementById('genre-footer');
  var genreCount = document.getElementById('genre-count');
  var genreChips = document.getElementById('genre-chips');
  var genreReset = document.getElementById('genre-reset');

  function openGenrePanel() {
    if (!genrePanel.hidden) return;
    genrePanel.hidden = false;
    genreTrigger.setAttribute('aria-expanded', 'true');
  }

  function closeGenrePanel(returnFocus) {
    if (genrePanel.hidden) return;
    genrePanel.hidden = true;
    genreTrigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) genreTrigger.focus();
  }

  // Everything that shows the current selection, redrawn from state.genre:
  // the trigger's count, the reset action, and the chip row under the toolbar.
  function renderGenreSummary() {
    var n = state.genre.length;
    genreCount.textContent = n ? String(n) : '';
    genreCount.hidden = !n;
    genreWrap.classList.toggle('is-filtering', n > 0);
    // On screen the trigger reads "Жанры" next to a bare number, which spoken
    // aloud would be "Жанры 3" — say what the number counts.
    genreTrigger.setAttribute('aria-label', n ? 'Жанры, выбрано: ' + n : 'Жанры');
    genreFooter.hidden = !n;

    genreChips.innerHTML = state.genre.map(function (genre) {
      var safe = escapeHtml(genre);
      return '<span class="genre-chip">' + safe +
        '<button type="button" class="genre-chip__remove" data-genre="' + safe +
        '" aria-label="Убрать жанр «' + safe + '»">' +
        '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M3.4 3.4 8.6 8.6M8.6 3.4 3.4 8.6"/></svg>' +
        '</button></span>';
    }).join('');
    genreChips.hidden = !n;
  }

  function populateGenreFilter() {
    // A rebuild means the available genres just changed under the panel — it
    // must never stay open over a list that is no longer the one being read.
    closeGenrePanel(false);

    var counts = {};
    titlesForCategory(state.category).forEach(function (t) {
      t.genres.forEach(function (genre) { counts[genre] = (counts[genre] || 0) + 1; });
    });
    var names = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });

    if (!names.length) {
      // Reachable on a tab holding nothing but drafts, which carry no genres.
      genreOptions.innerHTML = '<p class="genre-filter__empty">Здесь пока нет жанров</p>';
    } else {
      genreOptions.innerHTML = names.map(function (genre) {
        var safe = escapeHtml(genre);
        var checked = state.genre.indexOf(genre) !== -1 ? ' checked' : '';
        return '<label class="genre-option">' +
          '<input type="checkbox" value="' + safe + '"' + checked + '>' +
          '<span class="genre-option__name">' + safe + '</span>' +
          '<span class="genre-option__count">' + counts[genre] + '</span>' +
          '</label>';
      }).join('');
    }
    renderGenreSummary();
  }

  function clearGenres() {
    state.genre = [];
    genreOptions.querySelectorAll('input:checked').forEach(function (input) { input.checked = false; });
    renderGenreSummary();
    refresh();
  }

  genreTrigger.addEventListener('click', function () {
    if (genrePanel.hidden) openGenrePanel(); else closeGenrePanel(false);
  });

  // Down from the trigger steps into the list, the way a menu behaves. The
  // options are real checkboxes, so Tab walks them and Space toggles them for
  // free — no roving tabindex here, unlike the card grid and the star strip,
  // because a popover is entered on purpose and left with Escape rather than
  // being tabbed through on the way to something else.
  genreTrigger.addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    openGenrePanel();
    var first = genreOptions.querySelector('input');
    if (first) first.focus();
  });

  genreOptions.addEventListener('change', function (event) {
    var input = event.target;
    if (!input.matches || !input.matches('input[type="checkbox"]')) return;
    var at = state.genre.indexOf(input.value);
    if (input.checked && at === -1) state.genre.push(input.value);
    else if (!input.checked && at !== -1) state.genre.splice(at, 1);
    renderGenreSummary();
    refresh();
  });

  genreReset.addEventListener('click', function () {
    // The reset lives in a footer that is about to be hidden, so focus has to
    // be handed back before it goes — otherwise it drops to the body and the
    // still-open panel becomes unreachable from the keyboard.
    genreTrigger.focus();
    clearGenres();
  });

  genreChips.addEventListener('click', function (event) {
    var btn = event.target.closest('.genre-chip__remove');
    if (!btn) return;
    var at = state.genre.indexOf(btn.dataset.genre);
    if (at === -1) return;
    var hadFocus = btn === document.activeElement;
    state.genre.splice(at, 1);
    var input = genreOptions.querySelector('input[value="' + cssEscape(btn.dataset.genre) + '"]');
    if (input) input.checked = false;
    renderGenreSummary();
    refresh();
    // The chip holding focus was just replaced along with the rest of the row;
    // send focus to the next chip, or back to the trigger if that was the last.
    if (hadFocus) (genreChips.querySelector('.genre-chip__remove') || genreTrigger).focus();
  });

  genreWrap.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (genrePanel.hidden) return;
    // Keep the page-level Escape handler from reading this as "close the modal".
    event.stopPropagation();
    event.preventDefault();
    closeGenrePanel(true);
  });

  // Tabbing out of the panel closes it; so does a pointer landing anywhere
  // else on the page. Capture phase so it still fires when the press is
  // swallowed by another handler.
  genreWrap.addEventListener('focusout', function (event) {
    // A null relatedTarget means focus left the document altogether — the
    // window was blurred, not the panel abandoned. Alt-tabbing away and back
    // must not throw away a half-made selection, so only a move to a real
    // element somewhere else on the page counts as leaving.
    if (!event.relatedTarget) return;
    if (!genreWrap.contains(event.relatedTarget)) closeGenrePanel(false);
  });

  document.addEventListener('pointerdown', function (event) {
    if (!genreWrap.contains(event.target)) closeGenrePanel(false);
  }, true);

  // ── Random pick ──────────────────────────────────────────────────────
  //
  // "What should I watch?" ignores every filter but the category tab — a
  // search term or a stray genre filter left on from an earlier session
  // should never be the reason the pool comes up empty. Done titles are
  // excluded; queue and in_progress both count as "worth watching next".
  //
  // Games are excluded unconditionally, regardless of which tab is active:
  // you don't "watch" a game, so a game can never be a correct answer to
  // this button. On "Всё" that just narrows the pool; on "Игры" it makes
  // the pool permanently empty, which is handled as its own state below
  // rather than the generic "nothing left to watch" message — the button is
  // never a candidate-producer on that tab, not merely temporarily out of
  // candidates.
  var randomBtn = document.getElementById('random-pick');
  var randomLabel = randomBtn.querySelector('.toolbar__random-label');
  var RANDOM_DEFAULT_LABEL = randomLabel.textContent;
  var RANDOM_UNAVAILABLE_LABEL = 'В игры играют';
  var RANDOM_UNAVAILABLE_TITLE = 'Кнопка недоступна на вкладке «Игры»: игра — не то, что смотрят.';
  var randomEmptyTimer = null;

  // Called once at startup and again on every tab switch. Keeps the button's
  // "this can never work here" state in sync with the active category *before*
  // the user even clicks — discovering that on click, via the same message
  // used for "everything here is done", would read as a bug rather than a
  // deliberate rule.
  function updateRandomAvailability() {
    // Any tab switch — not just entering "Игры" — must fully reconcile the
    // button's transient state before deciding what the new tab shows.
    // Without this, a leftover "nothing left to pick" cooldown from the
    // previously active tab survives the switch: the label/aria-disabled
    // reset below make the button *look* live again, but the click handler
    // still bails out on `toolbar__random--empty`, silently swallowing a
    // valid click on a tab that has plenty of candidates.
    if (randomEmptyTimer) { clearTimeout(randomEmptyTimer); randomEmptyTimer = null; }
    randomBtn.classList.remove('toolbar__random--empty');

    var unavailable = state.category === 'game';
    randomBtn.classList.toggle('toolbar__random--unavailable', unavailable);
    if (unavailable) {
      randomBtn.setAttribute('aria-disabled', 'true');
      randomBtn.title = RANDOM_UNAVAILABLE_TITLE;
      randomLabel.textContent = RANDOM_UNAVAILABLE_LABEL;
    } else {
      randomBtn.removeAttribute('aria-disabled');
      randomBtn.removeAttribute('title');
      randomLabel.textContent = RANDOM_DEFAULT_LABEL;
    }
  }

  randomBtn.addEventListener('click', function () {
    // A click during the "nothing to pick" cooldown, or while the button is
    // sitting on the games-only tab, is a no-op rather than a second message
    // — the button stays focusable and in the tab order the whole time (no
    // native `disabled`), it just ignores the extra click.
    if (randomBtn.classList.contains('toolbar__random--empty')) return;
    if (randomBtn.classList.contains('toolbar__random--unavailable')) return;
    var pool = titlesForCategory(state.category).filter(function (t) { return t.status !== 'done' && t.category !== 'game'; });
    var picked = BacklogQuery.pickRandom(pool);
    if (picked) {
      openTitleModal(picked.id);
      return;
    }
    if (randomEmptyTimer) clearTimeout(randomEmptyTimer);
    randomBtn.classList.add('toolbar__random--empty');
    randomBtn.setAttribute('aria-disabled', 'true');
    randomLabel.textContent = 'Тут всё завершено';
    randomEmptyTimer = setTimeout(function () {
      randomBtn.classList.remove('toolbar__random--empty');
      randomBtn.removeAttribute('aria-disabled');
      randomLabel.textContent = RANDOM_DEFAULT_LABEL;
      randomEmptyTimer = null;
    }, 1800);
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

  // ── Season/part checklist ─────────────────────────────────────────────
  //
  // For a series or anime that carries a `parts` list, the three-seat control
  // is not the truth any more: the truth is which seasons/films/OVAs have been
  // watched, and the status falls out of that. So the checklist takes the
  // control's place in the same field, and the status is shown as a read-only
  // badge above it.
  //
  // The point of the exercise is the unreleased row. A show whose every aired
  // season is ticked but whose next season is still pending must read "в
  // процессе", not "завершено" — otherwise the one thing the owner wanted to
  // keep ("I am caught up, I am waiting") is spelled the same way as "this is
  // over". BacklogStorage.deriveStatus is where that rule lives; everything
  // here just renders it.
  var statusLabel = document.getElementById('modal-status-label');
  var partsWrap = document.getElementById('modal-parts');
  var partsList = document.getElementById('modal-parts-list');
  var partsBadge = document.getElementById('modal-parts-status');
  var partsProgress = document.getElementById('modal-parts-progress');

  // One rule, defined next to the derivation that depends on it. `baseTitles`
  // already hands back the derived status for exactly these titles, so the
  // checklist branch below and the card behind it cannot disagree.
  var hasPartsChecklist = BacklogStorage.hasPartsChecklist;

  function isReleased(part) {
    return !part || part.released !== false;
  }

  function partsHtml(parts, checked) {
    return parts.map(function (part, index) {
      var pending = !isReleased(part);
      var name = escapeHtml(part.name || ('Часть ' + (index + 1)));
      var year = part.year ? '<span class="part__year">' + escapeHtml(part.year) + '</span>' : '';
      // Says why the box will not take a tick. A `disabled` input alone reads
      // as "broken" — this one is not broken, it is simply not out yet.
      var note = pending ? '<span class="part__pending">ещё не вышло</span>' : '';
      // A tick on a part that has since been marked unreleased is dropped on
      // the way in, exactly as deriveStatus drops it — the checkbox must not
      // show a state the status is refusing to count.
      var isOn = !pending && checked.indexOf(index) !== -1;
      return '<li class="part' + (pending ? ' part--pending' : '') + '">' +
        '<label class="part__row">' +
        '<input type="checkbox" class="part__box" data-index="' + index + '"' +
        (isOn ? ' checked' : '') + (pending ? ' disabled' : '') + '>' +
        '<span class="part__name">' + name + '</span>' + year + note +
        '</label></li>';
    }).join('');
  }

  // Repaints only the badge and the counter, never the list — a change comes
  // from a checkbox that currently holds focus, and rebuilding the rows under
  // it would throw that focus to the body mid-run.
  function renderPartsSummary(title, checked) {
    // Counter and badge come from the same walk of `parts`, so an index that is
    // out of range or sitting on an unreleased part can no longer inflate
    // «Просмотрено N из M» next to a badge that has (correctly) not moved.
    var progress = BacklogStorage.partsProgress(title.parts, checked);
    var derived = BacklogStorage.deriveStatus(title.parts, checked);
    partsBadge.dataset.status = derived || '';
    partsBadge.textContent = STATUS_LABELS[derived] || '';
    var text = progress.released
      ? 'Просмотрено ' + progress.watched + ' из ' + progress.released
      : 'Пока ничего не вышло';
    if (progress.pending) text += ' · впереди ещё ' + progress.pending;
    partsProgress.textContent = text;
    return derived;
  }

  function renderPartsChecklist(title) {
    var checked = BacklogStorage.getCheckedParts(window.localStorage, title.id);
    partsList.innerHTML = partsHtml(title.parts, checked);
    return renderPartsSummary(title, checked);
  }

  partsList.addEventListener('change', function (event) {
    var box = event.target;
    if (!box.classList || !box.classList.contains('part__box')) return;
    var id = document.getElementById('title-modal').dataset.id;
    if (!id) return;
    var title = findTitleById(id);
    if (!title || !hasPartsChecklist(title)) return;
    var checked = BacklogStorage.setPartChecked(window.localStorage, id, parseInt(box.dataset.index, 10), box.checked);
    var derived = renderPartsSummary(title, checked);
    // Straight down the existing status path: one setOverride, the card behind
    // the modal patched in place, counters redrawn, reorder deferred. Nothing
    // in the grid, the filters or the sort had to learn what a part is.
    if (derived) applyStatusChange(id, derived);
  });

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
    // Persists, and repaints the mark on the card behind the modal in place.
    applyRatingChange(id, next);
    renderRating(next);
    // The pointer has not moved, so re-run the preview against the new rating —
    // otherwise the readout would still be offering to clear what just went.
    if (previewValue !== null) setPreview(value);
    // Rating only changes the grid when it is the sort key, and the grid is
    // behind a modal right now — defer it with everything else.
    gridStale = true;
  });

  statusGroup.addEventListener('click', function (event) {
    var btn = event.target.closest('.status-buttons__btn');
    if (!btn) return;
    var id = document.getElementById('title-modal').dataset.id;
    if (!id) return;
    // Same in-place path as the card strip, so the grid behind the modal is
    // never rebuilt mid-interaction either. It repaints these segments too.
    applyStatusChange(id, btn.dataset.status);
  });

  // The element the modal was opened from, so it can be given focus back.
  var lastFocused = null;

  function openTitleModal(id) {
    var title = findTitleById(id);
    if (!title) return;
    document.getElementById('modal-cover').src = title.cover;
    document.getElementById('modal-cover').alt = title.title;
    document.getElementById('modal-title').textContent = title.title;
    // The source-language name, under the Russian one. Absent for games (their
    // `title` already is the original) and for anything released here under its
    // own name — and suppressed outright when the two strings match, so the
    // panel never prints the same words twice.
    var originalEl = document.getElementById('modal-original');
    var hasOriginal = typeof title.originalTitle === 'string'
      && title.originalTitle.trim() !== ''
      && title.originalTitle !== title.title;
    originalEl.textContent = hasOriginal ? title.originalTitle : '';
    originalEl.hidden = !hasOriginal;
    var meta = [title.year, title.genres.join(', ')].filter(Boolean).join(' · ');
    if (title.airingStatus) meta += ' · ' + (title.airingStatus === 'ongoing' ? 'ещё выходит' : 'закончен');
    document.getElementById('modal-meta').textContent = meta;
    var seasonsEl = document.getElementById('modal-seasons');
    seasonsEl.textContent = title.seasonInfo || '';
    seasonsEl.hidden = !title.seasonInfo;
    var platformsEl = document.getElementById('modal-platforms');
    var hasPlatforms = title.category === 'game' && Array.isArray(title.platforms) && title.platforms.length > 0;
    platformsEl.textContent = hasPlatforms ? 'Платформы: ' + title.platforms.join(', ') : '';
    platformsEl.hidden = !hasPlatforms;
    document.getElementById('modal-synopsis').textContent = title.draft
      ? 'Черновик — жанры, год, постер и описание ещё не заполнены. Просто попросите Claude дополнить «' + title.title + '».'
      : title.synopsis;
    if (hasPartsChecklist(title)) {
      statusLabel.textContent = 'Сезоны и части';
      statusGroup.hidden = true;
      partsWrap.hidden = false;
      // Renders the derived badge and nothing else. Opening a modal is a pure
      // view action and must never persist anything: `title.status` is already
      // the derived value (applyOverlay computes it on read), so the card
      // behind the modal is showing the same thing without a write. The only
      // thing that writes is the checkbox handler above — that is the actual
      // user-initiated event.
      renderPartsChecklist(title);
    } else {
      statusLabel.textContent = 'Статус';
      partsWrap.hidden = true;
      statusGroup.hidden = false;
      renderStatusButtons(title.status);
    }
    clearPreview();
    renderRating(title.rating);
    var modal = document.getElementById('title-modal');
    modal.dataset.id = id;
    // Remember where the modal was opened from so Escape/× can hand focus back
    // to that exact card instead of dumping the keyboard user at the top of the
    // page. Nothing is stored if focus was already inside the modal.
    if (!modal.contains(document.activeElement)) lastFocused = document.activeElement;
    modal.hidden = false;
    // Focus has to cross into the dialog, otherwise a card opened with Enter
    // keeps focus behind the overlay and the next Tab walks the hidden grid.
    document.getElementById('modal-close').focus();
  }

  function closeTitleModal() {
    document.getElementById('title-modal').hidden = true;
    var target = lastFocused;
    lastFocused = null;
    // The card may have been dropped by a grid refresh (delete, filter change)
    // while the modal was open — then there is nothing to return to and focus
    // falls back to the body on its own.
    if (target && document.contains(target) && typeof target.focus === 'function') target.focus();
    // The grid is about to be looked at again — let it catch up now.
    flushGrid();
  }

  var grid = document.getElementById('grid');

  function cardById(id) {
    return grid.querySelector('.card[data-id="' + cssEscape(id) + '"]');
  }

  // Rewrite one card to match a new status without touching a single other
  // node in the grid: no innerHTML on #grid, no reordering, no re-created
  // <img>, and the focused button survives because it is never replaced.
  function patchCardStatus(card, title) {
    card.querySelectorAll('.card-status__btn').forEach(function (btn) {
      var isActive = btn.dataset.status === title.status;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    var badge = card.querySelector('.card__status-badge');
    if (badge) {
      badge.textContent = STATUS_LABELS[title.status] || title.status;
      // The hue is resolved from the attribute, so the chip would keep the old
      // status's colour under the new status's word without this line.
      badge.dataset.status = title.status;
    }
    // The "Всё ещё выходит" badge used to have to be added or removed here,
    // because it depended on the status being changed. It no longer does — it is
    // now a plain fact about the title (airingStatus === 'ongoing'), which a
    // status write cannot touch. So there is nothing left to sync.
  }

  // Same discipline as patchCardStatus, for the poster's rating mark: rewrite
  // the two glyphs and the card's accessible name, touch nothing else. A rating
  // is only ever set from the modal, so the card being patched is the one
  // behind the open panel — a full renderGrid would rebuild every <img> in the
  // grid under it, and re-sort the wall out from under the card the user is
  // about to be handed focus back to.
  function patchCardRating(card, title) {
    var mark = card.querySelector('.card-rating');
    if (!mark) return;
    var rated = typeof title.rating === 'number';
    mark.classList.toggle('is-rated', rated);
    mark.title = rated ? 'Моя оценка: ' + title.rating + ' из 10' : 'Оценка ещё не выставлена';
    var value = mark.querySelector('.card-rating__value');
    if (value) value.textContent = rated ? String(title.rating) : '—';
    card.setAttribute('aria-label', cardLabel(title));
  }

  function applyRatingChange(id, rating) {
    BacklogStorage.setOverride(window.localStorage, id, { rating: rating });
    var card = cardById(id);
    var title = findTitleById(id);
    if (card && title) patchCardRating(card, title);
  }

  // The one path every status write goes through, from a card or from the
  // modal: persist, repaint what is on screen in place, and note that the
  // grid's order is now out of date.
  function applyStatusChange(id, status) {
    BacklogStorage.setOverride(window.localStorage, id, { status: status });
    var title = findTitleById(id);
    var card = cardById(id);
    if (card && title) patchCardStatus(card, title);
    gridStale = true;
    renderCounters();
    // If this title's modal happens to be open behind the change, keep the two
    // views telling the same story.
    var modal = document.getElementById('title-modal');
    if (!modal.hidden && modal.dataset.id === id) renderStatusButtons(status);
  }

  function applyCardStatus(btn) {
    var card = btn.closest('.card');
    if (!card) return;
    applyStatusChange(card.dataset.id, btn.dataset.status);
  }

  // The grid catches up the moment the user stops working inside it.
  grid.addEventListener('pointerleave', function (event) {
    // Touch fires pointerleave the instant the finger lifts, which would put
    // the reorder right back under the next tap. Only a real pointer that has
    // travelled out of the grid proves nothing is aimed at a card any more.
    if (event.pointerType && event.pointerType !== 'mouse') return;
    flushGrid();
  });
  grid.addEventListener('focusout', function (event) {
    if (!grid.contains(event.relatedTarget)) flushGrid();
  });
  // Covers touch, where there is no leave to wait for: a tap on the toolbar,
  // the tabs or the modal means the triage run is over.
  document.addEventListener('pointerdown', function (event) {
    if (!grid.contains(event.target)) flushGrid();
  }, true);

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

  function cardButtons(card) {
    return Array.prototype.slice.call(card.querySelectorAll('.card-status__btn'));
  }

  grid.addEventListener('keydown', function (event) {
    var card = event.target.closest('.card');
    if (!card) return;
    var key = event.key;
    var btn = event.target.closest('.card-status__btn');

    if (btn) {
      // Inside the group: walk it, or step back out. Enter/Space fall through
      // to the button's own click, which is why they are not listed here —
      // without that the modal would open on top of the status change.
      var group = cardButtons(card);
      var index = group.indexOf(btn);
      var next;
      if (key === 'ArrowRight') next = index + 1;
      else if (key === 'ArrowLeft') next = index - 1;
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = group.length - 1;
      else if (key === 'Escape') { event.preventDefault(); card.focus(); return; }
      else return;
      event.preventDefault();
      group[Math.max(0, Math.min(group.length - 1, next))].focus();
      return;
    }

    // On the card itself: Left/Right step into the status group. Only the
    // horizontal pair is claimed — Up/Down stay with the page, since this grid
    // has no row-to-row keyboard model to justify taking them.
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      var buttons = cardButtons(card);
      if (!buttons.length) return;
      event.preventDefault();
      // Enter where the answer already is: the current status.
      var active = buttons.filter(function (b) { return b.classList.contains('is-active'); })[0];
      var entry = active || (key === 'ArrowRight' ? buttons[0] : buttons[buttons.length - 1]);
      entry.focus();
      return;
    }

    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
    if (key === ' ' || key === 'Spacebar') event.preventDefault();
    openTitleModal(card.dataset.id);
  });
  document.getElementById('modal-close').addEventListener('click', closeTitleModal);
  document.querySelector('.modal__backdrop').addEventListener('click', closeTitleModal);

  // Escape is the only dismissal a keyboard-only user can reach without hunting
  // for the × — the backdrop is unclickable to them.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (document.getElementById('title-modal').hidden) return;
    event.preventDefault();
    closeTitleModal();
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
    // A bare slug with no year — the form has no year field. data.js entries are
    // `slug-year`, and BacklogStorage.isSupersededBy is what bridges the two so
    // this draft disappears once the real entry lands. See README, "Как устроены id".
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
  updateRandomAvailability();
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
