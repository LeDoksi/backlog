// app.js
(function () {
  var state = { category: 'all', status: 'all', genre: [], returning: false, hideDone: false, draftsOnly: false, search: '', sort: 'status' };
  // Task 44: "unreleased" is a real 4th status (movie/series/anime that
  // hasn't premiered yet), but it is deliberately not one of the three
  // quick-click STATUS_ACTIONS below — see cardHtml and the edit form.
  var STATUS_LABELS = { queue: 'В бэклоге', in_progress: 'В процессе', done: 'Завершено', unreleased: 'Ещё не вышло' };

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

  // Sync is the one layer of this app that is allowed to be absent.
  //
  // lib/storage.js, lib/query.js and data.js are what the page *is* — without
  // them there is nothing to render and a hard failure is the honest outcome.
  // lib/sync.js is an addition on top of an app that worked for months without
  // it, and it is also the one script served from a CDN-adjacent shape (see the
  // deferred tag in index.html), so "it did not load" is a real state: a blocked
  // request, a corporate proxy, a stale service worker, a syntax error on an
  // older browser.
  //
  // A bare `BacklogSync.pushOverride(...)` in that state throws a ReferenceError
  // rather than doing nothing, and the throw lands in the worst possible place.
  // applyStatusChange writes to localStorage first and repaints the card second,
  // so the exception fires *between* them: the edit is saved, the card silently
  // keeps showing the old status, and the owner clicks again on what looks like
  // a dead button. Same shape in applyRatingChange, the delete handler and the
  // quick-add form.
  //
  // So the module is resolved once, here, and a stand-in takes its place if it
  // is not there. Every call site then reads exactly as it did before, and each
  // no-op returns what the real function returns for "no sync today" — the same
  // value a null client already produces on a page where the SDK never loaded,
  // which is a path the rest of this file has always handled.
  // Task 40: same absent-module discipline as Sync above, for lib/enrich.js —
  // a Find click must degrade to "не удалось найти" rather than a
  // ReferenceError if the script failed to load.
  var Enrich = (typeof BacklogEnrich !== 'undefined' && BacklogEnrich) ? BacklogEnrich : {
    searchTmdb: function () { return Promise.resolve([]); },
    fetchTmdbDetails: function () { return Promise.resolve(null); },
    searchRawg: function () { return Promise.resolve([]); },
    fetchRawgDetails: function () { return Promise.resolve(null); },
    searchShikimori: function () { return Promise.resolve([]); },
    fetchShikimoriDetails: function () { return Promise.resolve(null); },
    searchSteam: function () { return Promise.resolve([]); },
    fetchSteamDetails: function () { return Promise.resolve(null); }
  };

  var Sync = (typeof BacklogSync !== 'undefined' && BacklogSync) ? BacklogSync : {
    TABLES: [],
    createClient: function () { return null; },
    pullState: function () {
      return Promise.resolve({ ok: false, state: {}, tables: [], errors: [] });
    },
    applyState: function () { return []; },
    pushOverride: function () { return Promise.resolve(false); },
    pushDelete: function () { return Promise.resolve(false); },
    pushDraft: function () { return Promise.resolve(false); },
    pushRemoveDraft: function () { return Promise.resolve(false); },
    pushParts: function () { return Promise.resolve(false); },
    seedLocal: function () { return Promise.resolve([]); },
    useOutbox: function () {},
    flushOutbox: function () { return Promise.resolve(0); },
    subscribe: function () { return null; }
  };

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
    // Task 44: same reasoning for "unreleased" — clicking "В процессе" or
    // "Завершено" on something that has not come out yet makes no sense, so
    // the strip is suppressed for it too. The badge alone still shows it.
    var quickActions = (hasPartsChecklist(title) || title.status === 'unreleased') ? '' : cardStatusHtml(title);
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
      if (state.draftsOnly && !t.draft) return false;
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
  document.getElementById('drafts-only-filter').addEventListener('change', function (e) {
    state.draftsOnly = e.target.checked;
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
  // Task 44: unreleased is excluded too — you cannot "randomly watch"
  // something that hasn't come out, any more than you can a game.
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
    var pool = titlesForCategory(state.category).filter(function (t) { return t.status !== 'done' && t.status !== 'unreleased' && t.category !== 'game'; });
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

  // ── Итоги: the trophy case ───────────────────────────────────────────
  //
  // One question, asked three ways: how much of the shelf has actually been
  // got through. The whole catalog at the top, then the four categories, then
  // the genres the finished titles belong to.
  //
  // Every number here comes off `baseTitles()` — the same source, and for the
  // per-category done/total the same `BacklogQuery.countProgress` call, that
  // `renderCounters` writes into the tab chips. That is deliberate: the panel
  // and the tabs must be incapable of disagreeing, and the cheapest way to
  // guarantee that is for both to be the same computation rather than two that
  // happen to agree today. It also means the derived status of a parts-bearing
  // series (see BacklogStorage.effectiveStatus) is respected here exactly as it
  // is on the card — a show you are caught up on but still waiting for counts
  // as "в процессе" in these totals, not as finished.
  //
  // Recomputed from scratch on every open. Nothing is cached: statuses change
  // constantly from the grid and the modal, and a trophy case showing last
  // week's numbers is worse than no trophy case.

  // Same four categories, in the same order, as the tab row in index.html.
  var STATS_CATEGORIES = [
    { key: 'game', label: 'Игры' },
    { key: 'series', label: 'Сериалы' },
    { key: 'movie', label: 'Кино' },
    { key: 'anime', label: 'Аниме' }
  ];

  function tally(titles) {
    // done/total come from the exact call the tab counters make; the other two
    // are counted off the same array, so the four figures always sum.
    //
    // Task 44: "unreleased" gets no bucket of its own here — it falls into
    // `queue` below by construction (it is neither done nor in_progress),
    // folded into "в бэклоге" the same way the plan's Step 5 allows. Splitting
    // it out would need a 5th number on a trophy case that is already reading
    // four per row, for a status that — unlike the other three — says nothing
    // about how much of the catalog has actually been got through; lumping it
    // with "not started yet" is the accurate story and costs no code.
    var progress = BacklogQuery.countProgress(titles);
    var inProgress = titles.filter(function (t) { return t.status === 'in_progress'; }).length;
    return {
      done: progress.done,
      in_progress: inProgress,
      queue: progress.total - progress.done - inProgress,
      total: progress.total
    };
  }

  function computeStats() {
    var all = baseTitles();

    // Genres are counted catalog-wide rather than per category. Per-category
    // would split 55 finished titles across four lists, three of which are too
    // thin to say anything (one finished anime contributes two genres, and the
    // bar chart of a single title is not a chart). Catalog-wide there is one
    // ranked list with real shape to it — and the category axis is already
    // fully covered by the block directly above it.
    //
    // A finished title with no genres (a quick-added draft) contributes to the
    // totals and to nothing here, which is correct: it has no genre to credit.
    var genreCounts = {};
    all.forEach(function (t) {
      if (t.status !== 'done') return;
      (t.genres || []).forEach(function (genre) {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      });
    });
    var genres = Object.keys(genreCounts)
      .sort(function (a, b) { return genreCounts[b] - genreCounts[a] || a.localeCompare(b); })
      .map(function (name) { return { name: name, done: genreCounts[name] }; });

    return {
      overall: tally(titlesForCategory('all')),
      categories: STATS_CATEGORIES.map(function (cat) {
        var t = tally(titlesForCategory(cat.key));
        t.key = cat.key;
        t.label = cat.label;
        return t;
      }),
      genres: genres,
      // What the genre bars are scaled against: the leader fills the track and
      // everything else is read against it. Length means volume of finished
      // titles, not completion ratio — in a trophy case the tall bar should be
      // the genre you have actually got through most of, not a two-title genre
      // that happens to be exhausted.
      genreMax: genres.length ? genres[0].done : 0
    };
  }

  function pct(part, whole) {
    return whole > 0 ? (part / whole) * 100 : 0;
  }

  // One span per title, in status order: everything finished, then everything
  // under way, then the dark remainder. A meter would give the proportion; a
  // row of spines gives the proportion *and* keeps the collection countable —
  // 168 discrete objects rather than a percentage. The spans flex, so the row
  // is exactly the panel's width at every size and simply gets finer as the
  // catalog grows.
  function combHtml(overall) {
    var runs = [
      { n: overall.done, cls: ' stats__tick--done' },
      { n: overall.in_progress, cls: ' stats__tick--wip' },
      { n: overall.queue, cls: '' }
    ];
    var out = '';
    runs.forEach(function (run) {
      for (var i = 0; i < run.n; i++) out += '<span class="stats__tick' + run.cls + '"></span>';
    });
    return out;
  }

  // A zero-length segment is not rendered at all rather than rendered at 0% —
  // the segments carry a min-width so a single title is still visible, and that
  // min-width would otherwise draw a phantom sliver for a count of nothing.
  function segmentHtml(kind, value, total, delay) {
    if (!value) return '';
    return '<span class="stats-meter__seg stats-meter__seg--' + kind +
      '" style="width:' + pct(value, total).toFixed(3) + '%;--d:' + delay + 'ms"></span>';
  }

  function categoryRowHtml(cat, index) {
    var delay = 120 + index * 70;
    var breakdown = 'завершено ' + cat.done + ', в процессе ' + cat.in_progress +
      ', в бэклоге ' + cat.queue + ', всего ' + cat.total;
    // The cyan token only exists when there is something under way. Hovering
    // the row spells the whole breakdown out, the way the card's rating mark
    // and quick-actions do.
    var wip = cat.in_progress
      ? '<span class="stats__wip" title="В процессе: ' + cat.in_progress + '" aria-hidden="true">+' + cat.in_progress + '</span>'
      : '';
    return '<li class="stats__cat" title="' + escapeHtml(cat.label + ' — ' + breakdown) + '">' +
      '<span class="stats__cat-name">' + escapeHtml(cat.label) + '</span>' +
      '<span class="stats-meter" aria-hidden="true">' +
        segmentHtml('done', cat.done, cat.total, delay) +
        segmentHtml('wip', cat.in_progress, cat.total, delay) +
      '</span>' +
      '<span class="stats__figures">' + wip +
        '<span class="stats__count" aria-hidden="true">' + cat.done + '/' + cat.total + '</span>' +
      '</span>' +
      '<span class="sr-only">' + escapeHtml(breakdown) + '</span>' +
      '</li>';
  }

  function genreRowHtml(genre, max, index) {
    var delay = 340 + index * 34;
    return '<li class="stats__genre">' +
      '<span class="stats__genre-name">' + escapeHtml(genre.name) + '</span>' +
      '<span class="stats-bar" aria-hidden="true">' +
        '<span class="stats-bar__fill" style="width:' + pct(genre.done, max).toFixed(3) + '%;--d:' + delay + 'ms"></span>' +
      '</span>' +
      '<span class="stats__count" aria-hidden="true">' + genre.done + '</span>' +
      '<span class="sr-only">завершено ' + genre.done + '</span>' +
      '</li>';
  }

  function statsHtml(stats) {
    var o = stats.overall;
    var genreList = stats.genres.length
      ? '<ul class="stats__genres" role="list">' +
          stats.genres.map(function (g, i) { return genreRowHtml(g, stats.genreMax, i); }).join('') +
        '</ul>'
      : '<p class="stats__empty">Пока ничего не завершено. Отметьте первый тайтл — он появится здесь.</p>';

    return (
      '<section class="stats__hero">' +
        '<span class="stats__eyebrow">Завершено</span>' +
        '<p class="stats__score" aria-hidden="true">' +
          '<span class="stats__score-done">' + o.done + '</span>' +
          '<span class="stats__score-rest">/' + o.total + '</span>' +
        '</p>' +
        '<span class="sr-only">Завершено ' + o.done + ' из ' + o.total + '</span>' +
        '<div class="stats__comb" aria-hidden="true">' + combHtml(o) + '</div>' +
      '</section>' +
      '<section class="stats__section">' +
        '<h3 class="stats__section-title">По категориям</h3>' +
        '<ul class="stats__cats" role="list">' +
          stats.categories.map(categoryRowHtml).join('') +
        '</ul>' +
      '</section>' +
      '<section class="stats__section">' +
        '<h3 class="stats__section-title">Жанры завершённого</h3>' +
        genreList +
      '</section>'
    );
  }

  var statsModal = document.getElementById('stats-modal');
  var statsBody = document.getElementById('stats-body');
  var statsClose = document.getElementById('stats-close');
  // Its own opener-memory, separate from the title panel's `lastFocused`: the
  // two panels are opened from different places and neither may hand focus back
  // to the other's origin.
  var statsLastFocused = null;

  // Where Escape/× should hand focus back to. Anything inside either panel is
  // refused: this panel can be opened while the title panel is still up (the
  // handoff below hides it), and remembering an element in the panel that is on
  // its way out would store something that is about to be display:none. Focusing
  // such an element is a silent no-op — it is still `document.contains`-true, so
  // the usual guard waves it through — and the keyboard user is dropped on the
  // body instead of anywhere they can navigate from.
  function statsFocusTarget(el) {
    if (!el || el === document.body) return null;
    if (statsModal.contains(el)) return null;
    if (document.getElementById('title-modal').contains(el)) return null;
    return el;
  }

  function openStatsModal() {
    if (!statsModal.hidden) return;
    hideTitleModalForStats();
    statsBody.innerHTML = statsHtml(computeStats());
    statsLastFocused = statsFocusTarget(document.activeElement);
    statsModal.hidden = false;
    statsClose.focus();
  }

  function closeStatsModal() {
    if (statsModal.hidden) return;
    statsModal.hidden = true;
    var target = statsLastFocused;
    statsLastFocused = null;
    // Unlike the title panel — whose card can genuinely be gone by now, deleted
    // or filtered away, leaving nothing to return to — this panel always has a
    // home to go back to: the button that opens it is a fixture of the toolbar.
    // So the fallback is that button rather than the body.
    if (!(target && document.contains(target) && typeof target.focus === 'function')) {
      target = document.getElementById('stats-open');
    }
    target.focus();
    // The grid is about to be looked at again — same handoff the title panel makes.
    flushGrid();
  }

  // ── Keeping the two panels mutually exclusive ─────────────────────────
  //
  // Neither panel traps focus (the title panel never has), so a keyboard user
  // can Tab out of an open panel and reach the grid or the toolbar behind the
  // backdrop — and from there open the other panel on top of this one. Two
  // stacked dialogs, both aria-modal, is a state neither was built for. So
  // whichever is opened last simply takes the screen: the outgoing panel is
  // hidden without restoring its opener's focus, because focus is on its way
  // into the incoming panel and pulling it backwards would fight that.
  function hideStatsForTitleModal() {
    if (statsModal.hidden) return;
    statsModal.hidden = true;
    statsLastFocused = null;
  }

  function hideTitleModalForStats() {
    var modal = document.getElementById('title-modal');
    if (modal.hidden) return;
    modal.hidden = true;
    lastFocused = null;
  }

  document.getElementById('stats-open').addEventListener('click', openStatsModal);
  statsClose.addEventListener('click', closeStatsModal);
  statsModal.querySelector('.modal__backdrop').addEventListener('click', closeStatsModal);

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
    // The checklist is the input and the status is the output, so both travel:
    // the indices here, and the derived status through applyStatusChange below.
    // Sending only the status would leave the other device deriving `queue`
    // from its own empty checklist and shadowing the value it had just been
    // sent — see the note on effectiveStatus in lib/storage.js.
    Sync.pushParts(syncClient, id, checked);
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
    // Whatever the edit form was doing for a previous card — or an earlier
    // open of this same card — it must not survive into this one; a stale
    // snapshot compared against a different title's inputs is how a save
    // would write the wrong diff.
    exitEditMode();
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
    document.getElementById('modal-synopsis').textContent = title.synopsis
      ? title.synopsis
      : 'Описание пока не заполнено. Попросите Claude дополнить «' + title.title + '».';
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
    // The stats panel is a peer, never a floor to stack on — see
    // hideStatsForTitleModal. Done before `lastFocused` is captured so the
    // element remembered here is the card, not something inside a panel that
    // is on its way out.
    hideStatsForTitleModal();
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

  // ── Task 39: full in-UI card editing ──────────────────────────────────
  //
  // Everything below turns "Редактировать" into a form pre-filled with the
  // title's *current effective* values (data.js merged with any existing
  // override — the same object the rest of the modal is already rendering
  // from, never a raw re-read of data.js). Saving diffs the parsed form
  // against a snapshot taken the moment the form opened and writes only the
  // fields that actually changed, through the exact same
  // BacklogStorage.setOverride / Sync.pushOverride pair every other edit in
  // this file already goes through — no new write path, no new guard.
  var modalEditBtn = document.getElementById('modal-edit');
  var editForm = document.getElementById('modal-edit-form');
  var editTitleInput = document.getElementById('edit-title');
  var editOriginalTitleInput = document.getElementById('edit-original-title');
  var editCategorySelect = document.getElementById('edit-category');
  var editYearInput = document.getElementById('edit-year');
  var editGenresInput = document.getElementById('edit-genres');
  var editCoverInput = document.getElementById('edit-cover');
  var editCoverPreview = document.getElementById('edit-cover-preview');
  var editCoverFileInput = document.getElementById('edit-cover-file');
  var editCoverError = document.getElementById('edit-cover-error');
  var editPlatformsField = document.getElementById('edit-platforms-field');
  var editPlatformsInput = document.getElementById('edit-platforms');
  var editSeasonInfoField = document.getElementById('edit-season-info-field');
  var editSeasonInfoInput = document.getElementById('edit-season-info');
  var editSynopsisInput = document.getElementById('edit-synopsis');
  var editPartsField = document.getElementById('edit-parts-field');
  var editPartsList = document.getElementById('edit-parts-list');
  var editUnreleasedField = document.getElementById('edit-unreleased-field');
  var editUnreleasedInput = document.getElementById('edit-unreleased');
  var editDraftInput = document.getElementById('edit-draft');
  var editError = document.getElementById('edit-error');

  // The fields this form can produce a diff for, in no particular order.
  // `rating` stays off this list — it is still set from the star strip a few
  // lines of markup above this form. `status` itself is also normally set
  // from the plain status buttons next to it (also outside this form, and
  // still live while the form is open — see updateEditFieldVisibility below).
  // `unreleased` is the one exception: it is a virtual, form-only field (there
  // is no `title.unreleased`) that diffs like anything else here but, on
  // save, is translated into a `status` patch instead of copied verbatim —
  // see the special case in the save handler. Left untouched, it produces no
  // diff and so never overwrites whatever the live status buttons did during
  // the same edit; only an explicit check/uncheck ever touches `status`.
  var EDIT_FIELDS = ['title', 'originalTitle', 'category', 'year', 'genres', 'cover', 'platforms', 'seasonInfo', 'synopsis', 'parts', 'draft', 'unreleased'];

  // Only the fields that make sense for the (possibly just-picked) category
  // are shown — `platforms` for games, `seasonInfo`/`parts` for series/anime.
  // A hidden field's input is simply never touched by the owner, so it stays
  // equal to its snapshot and produces no diff on save; no extra gating is
  // needed anywhere else for that.
  //
  // Task 44: `unreleased` additionally needs `hasParts` — a fact about the
  // title being edited, not the category dropdown — because a parts-bearing
  // series/anime already expresses "hasn't come out yet" per-part and must
  // never offer this checkbox at all. `hasParts` is snapshotted once when the
  // form opens (see enterEditMode) rather than recomputed from the live
  // edit-parts rows, matching how `platforms`/`seasonInfo`/`parts` visibility
  // here has always only tracked the category, not other live-edited fields.
  function updateEditFieldVisibility(category, hasParts) {
    editPlatformsField.hidden = category !== 'game';
    var isSeasonal = category === 'series' || category === 'anime';
    editSeasonInfoField.hidden = !isSeasonal;
    editPartsField.hidden = !isSeasonal;
    var canBeUnreleased = (category === 'movie' || isSeasonal) && !hasParts;
    editUnreleasedField.hidden = !canBeUnreleased;
  }

  editCategorySelect.addEventListener('change', function () {
    updateEditFieldVisibility(editCategorySelect.value, editHasPartsChecklist);
  });

  // ── Task 41: upload a cover image from device ─────────────────────────
  //
  // No new storage field: a picked/downscaled file just overwrites
  // #edit-cover's value, exactly as if the owner had typed a URL — Сохранить
  // above already reads `editCoverInput.value.trim()` as `cover` and diffs it
  // against the snapshot, so this rides that path unchanged. Last-touched
  // wins between the two inputs, kept deliberately simple per the plan.
  function updateEditCoverPreview() {
    var src = editCoverInput.value.trim();
    editCoverPreview.hidden = !src;
    editCoverPreview.src = src;
  }

  editCoverInput.addEventListener('input', updateEditCoverPreview);

  function readFileAsDataUri(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('file read failed')); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image decode failed')); };
      img.src = src;
    });
  }

  var COVER_MAX_DIM = 900;
  var COVER_JPEG_QUALITY = 0.82;

  // Downscale never upscales — a source already smaller than 900px on its
  // longest edge passes through at its own size (scale caps at 1).
  function downscaleCoverFile(file) {
    return readFileAsDataUri(file).then(loadImage).then(function (img) {
      var scale = Math.min(1, COVER_MAX_DIM / Math.max(img.width, img.height));
      var w = Math.round(img.width * scale);
      var h = Math.round(img.height * scale);
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY);
    });
  }

  editCoverFileInput.addEventListener('change', function () {
    var file = editCoverFileInput.files[0];
    editCoverFileInput.value = ''; // lets the same file be picked again later
    if (!file) return;
    editCoverError.hidden = true;
    if (file.type.indexOf('image/') !== 0) {
      editCoverError.textContent = 'Выберите файл изображения';
      editCoverError.hidden = false;
      return;
    }
    downscaleCoverFile(file).then(function (dataUri) {
      editCoverInput.value = dataUri;
      updateEditCoverPreview();
    }).catch(function () {
      editCoverError.textContent = 'Не удалось загрузить изображение';
      editCoverError.hidden = false;
    });
  });

  function parseList(value) {
    return value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function editPartRowHtml(part) {
    var name = escapeHtml(part && part.name || '');
    var year = part && part.year != null ? escapeHtml(part.year) : '';
    var released = !part || part.released !== false;
    return '<li class="edit-parts__row">' +
      '<input type="text" class="edit-parts__name" placeholder="Название части" value="' + name + '">' +
      '<input type="number" class="edit-parts__year" placeholder="Год" value="' + year + '">' +
      '<label class="edit-parts__released"><input type="checkbox" class="edit-parts__released-box"' + (released ? ' checked' : '') + '> вышло</label>' +
      '<button type="button" class="edit-parts__remove" aria-label="Удалить часть">×</button>' +
      '</li>';
  }

  editPartsList.addEventListener('click', function (event) {
    var btn = event.target.closest('.edit-parts__remove');
    if (!btn) return;
    var row = btn.closest('.edit-parts__row');
    if (row) row.remove();
  });

  document.getElementById('edit-parts-add').addEventListener('click', function () {
    editPartsList.insertAdjacentHTML('beforeend', editPartRowHtml(null));
  });

  // A row nobody typed anything into (added by "+ Добавить часть" and left
  // alone) is dropped rather than saved as a blank part.
  function readEditParts() {
    return Array.prototype.slice.call(editPartsList.querySelectorAll('.edit-parts__row')).map(function (row) {
      var name = row.querySelector('.edit-parts__name').value.trim();
      var yearRaw = row.querySelector('.edit-parts__year').value.trim();
      return {
        name: name,
        year: yearRaw ? parseInt(yearRaw, 10) : null,
        released: row.querySelector('.edit-parts__released-box').checked
      };
    }).filter(function (p) { return p.name || p.year; });
  }

  // The pre-fill snapshot the diff on save is compared against. Normalized to
  // the exact shape the parsed form will produce, so "nothing changed"
  // compares equal even when the source title left a field undefined
  // (data.js titles have no `originalTitle` at all, for instance).
  var editSnapshot = null;

  // Task 44: whether the title being edited carries a parts checklist, frozen
  // at the moment the form opened — see the comment on updateEditFieldVisibility.
  var editHasPartsChecklist = false;

  function enterEditMode(title) {
    editHasPartsChecklist = hasPartsChecklist(title);
    editSnapshot = {
      title: title.title || '',
      originalTitle: title.originalTitle || '',
      category: title.category,
      year: title.year != null ? title.year : null,
      genres: (title.genres || []).slice(),
      cover: title.cover || '',
      platforms: (title.platforms || []).slice(),
      seasonInfo: title.seasonInfo || '',
      synopsis: title.synopsis || '',
      parts: (title.parts || []).map(function (p) {
        return { name: p.name || '', year: p.year != null ? p.year : null, released: p.released !== false };
      }),
      // Task 43: missing/falsy `draft` (every ordinary catalog entry) reads
      // as unchecked, exactly like every other optional field's `|| ''`
      // fallback above.
      draft: !!title.draft,
      // Task 44: `title.status` here is already the *current effective*
      // status (findTitleById reads through applyOverlay/withDerivedStatus),
      // so a parts-bearing title — which can never derive to 'unreleased' —
      // always reads false here too, on top of the checkbox being hidden.
      unreleased: title.status === 'unreleased'
    };
    editTitleInput.value = editSnapshot.title;
    editOriginalTitleInput.value = editSnapshot.originalTitle;
    editCategorySelect.value = editSnapshot.category;
    editYearInput.value = editSnapshot.year != null ? editSnapshot.year : '';
    editGenresInput.value = editSnapshot.genres.join(', ');
    editCoverInput.value = editSnapshot.cover;
    editCoverFileInput.value = '';
    editCoverError.hidden = true;
    updateEditCoverPreview();
    editPlatformsInput.value = editSnapshot.platforms.join(', ');
    editSeasonInfoInput.value = editSnapshot.seasonInfo;
    editSynopsisInput.value = editSnapshot.synopsis;
    editPartsList.innerHTML = editSnapshot.parts.map(editPartRowHtml).join('');
    editUnreleasedInput.checked = editSnapshot.unreleased;
    editDraftInput.checked = editSnapshot.draft;
    updateEditFieldVisibility(editSnapshot.category, editHasPartsChecklist);
    editError.hidden = true;
    editError.textContent = '';
    modalEditBtn.hidden = true;
    editForm.hidden = false;
  }

  function exitEditMode() {
    editSnapshot = null;
    editForm.hidden = true;
    modalEditBtn.hidden = false;
  }

  modalEditBtn.addEventListener('click', function () {
    var id = document.getElementById('title-modal').dataset.id;
    var title = findTitleById(id);
    if (title) enterEditMode(title);
  });

  document.getElementById('edit-cancel').addEventListener('click', exitEditMode);

  document.getElementById('edit-save').addEventListener('click', function () {
    var id = document.getElementById('title-modal').dataset.id;
    var title = findTitleById(id);
    if (!id || !title || !editSnapshot) return;

    var next = {
      title: editTitleInput.value.trim(),
      originalTitle: editOriginalTitleInput.value.trim(),
      category: editCategorySelect.value,
      year: editYearInput.value.trim() ? parseInt(editYearInput.value, 10) : null,
      genres: parseList(editGenresInput.value),
      cover: editCoverInput.value.trim(),
      platforms: parseList(editPlatformsInput.value),
      seasonInfo: editSeasonInfoInput.value.trim(),
      synopsis: editSynopsisInput.value,
      parts: readEditParts(),
      draft: editDraftInput.checked,
      unreleased: editUnreleasedInput.checked
    };

    var changedFields = EDIT_FIELDS.filter(function (field) {
      return JSON.stringify(next[field]) !== JSON.stringify(editSnapshot[field]);
    });

    if (!changedFields.length) { exitEditMode(); return; }

    // Shape-checked against the same rules a catalog entry has to pass —
    // airingStatus is untouched by this form and is carried through from the
    // current title as-is, so only errors that actually mention a field the
    // owner just edited can block the save. That keeps a pre-existing,
    // unrelated shape issue (or a category change this form does not attempt
    // to reconcile airingStatus for — see README) from silently blocking an
    // edit to a different field. `status` itself needs no such check here:
    // the checkbox below can only ever produce 'unreleased' or 'queue', both
    // always valid regardless of category (see lib/validate.js).
    var candidate = Object.assign({}, title, {
      title: next.title,
      category: next.category,
      year: next.year,
      genres: next.genres,
      cover: next.cover,
      synopsis: next.synopsis
    });
    var errors = BacklogValidate.validateTitle(candidate).filter(function (e) {
      return changedFields.some(function (f) { return e.indexOf(f) !== -1; });
    });
    if (errors.length) {
      editError.textContent = errors.join('; ');
      editError.hidden = false;
      return;
    }

    var patch = {};
    changedFields.forEach(function (field) {
      // Task 44: `unreleased` is not a real title field — it is translated
      // into the actual `status` write here. Checking it asks for
      // 'unreleased'; unchecking it (only reachable when it was checked, since
      // an unchanged checkbox never appears in changedFields at all) reverts
      // to 'queue' — the same safe default a brand-new title gets, there being
      // no reliable "previous status" to restore instead.
      if (field === 'unreleased') { patch.status = next.unreleased ? 'unreleased' : 'queue'; return; }
      patch[field] = next[field];
    });

    BacklogStorage.setOverride(window.localStorage, id, patch);
    Sync.pushOverride(syncClient, id, patch);

    exitEditMode();
    // Full rebuild rather than the in-place patch the quick status/rating
    // actions use: an edit can touch the title's category, genres, sort keys
    // and cover all at once, and it is a deliberate, discrete action from
    // inside an already-open modal rather than a rapid click in the grid, so
    // there is no hover/focus state in the wall worth preserving through it.
    refresh();
    openTitleModal(id);
  });

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
    // Write-through: localStorage first (so the UI below is already correct and
    // stays correct offline), then the same change to Supabase. The push is
    // fire-and-forget by design — it can only ever fail into a console warning,
    // never into a broken click. See lib/sync.js.
    Sync.pushOverride(syncClient, id, { rating: rating });
    var card = cardById(id);
    var title = findTitleById(id);
    if (card && title) patchCardRating(card, title);
  }

  // The one path every status write goes through, from a card or from the
  // modal: persist, repaint what is on screen in place, and note that the
  // grid's order is now out of date.
  function applyStatusChange(id, status) {
    BacklogStorage.setOverride(window.localStorage, id, { status: status });
    Sync.pushOverride(syncClient, id, { status: status });
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
  // Scoped to this panel by id. There is more than one .modal__backdrop in the
  // document now, and a bare document.querySelector would silently bind
  // whichever happened to come first in the markup.
  document.querySelector('#title-modal .modal__backdrop').addEventListener('click', closeTitleModal);

  // Escape is the only dismissal a keyboard-only user can reach without hunting
  // for the × — the backdrop is unclickable to them. Both panels answer to it;
  // opening one closes the other, so at most one branch can ever fire.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (!statsModal.hidden) {
      event.preventDefault();
      closeStatsModal();
      return;
    }
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
    // Asked before the delete, because deleteTitle is what makes the answer
    // stop being true: a draft is removed from `backlog-added` outright, so
    // afterwards there is no way left to tell it apart from a catalog title.
    // The remote has to make the same choice — drop the row vs. tombstone it —
    // and getting it backwards would plant a permanent shared tombstone on a
    // slug the quick-add form can mint again.
    var wasDraft = BacklogStorage.getAdded(window.localStorage).some(function (t) { return t.id === id; });
    BacklogStorage.deleteTitle(window.localStorage, id);
    Sync.pushDelete(syncClient, id, wasDraft);
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
    var draft = {
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
    };
    BacklogStorage.addTitle(window.localStorage, draft);
    Sync.pushDraft(syncClient, draft);
    titleInput.value = '';
    categorySelect.value = '';
    refresh();
  });

  // ── Task 40/42: auto-fill from TMDb/RAWG/Shikimori ────────────────────
  //
  // Quick-add only, by design: a title's data is expected to be curated and
  // then stable, so re-fetching from an API is never offered from Task 39's
  // edit form for an already-existing card (risk of silently overwriting a
  // correct/curated value with a fresh API guess). Wired exactly once, onto
  // #quick-add-picker, live as the owner types (see wireEnrichPicker).
  //
  // category → provider is fixed by this catalog's own rules: movies/series
  // go to TMDb, anime to Shikimori (a Russian anime-tracking site — unlike
  // the old Jikan source, its titles/synopses are already Russian, so an
  // anime pick is exactly as complete as a TMDb/RAWG one), games try Steam
  // first and fall back to RAWG (Task 45 — see searchByCategory's `rawg`
  // branch and lib/enrich.js's Steam header comment for why: Steam has real
  // Russian genres/descriptions for titles with a Russian store page, RAWG
  // covers everything else and supplies console `platforms` either way).
  function providerFor(category) {
    if (category === 'movie') return 'tmdb-movie';
    if (category === 'series') return 'tmdb-series';
    if (category === 'game') return 'rawg';
    if (category === 'anime') return 'shikimori';
    return null;
  }

  // Every fetchXDetails/searchX call in lib/enrich.js already resolves rather
  // than rejects for a bad key, an offline tab or a non-200 response (see its
  // header comment) — the one thing it cannot protect against is `fetch`
  // itself not existing (very old browsers), so that is guarded here, once,
  // rather than in every call site below.
  function nativeFetch() {
    return (typeof window !== 'undefined' && typeof window.fetch === 'function')
      ? window.fetch.bind(window)
      : null;
  }

  // Resolves to `{ ok, candidates }` or `{ ok: false, reason }` — never
  // rejects, never throws. `reason` is what turns into the inline message.
  function searchByCategory(category, query) {
    var fetchFn = nativeFetch();
    if (!fetchFn) return Promise.resolve({ ok: false, reason: 'no-fetch' });
    var provider = providerFor(category);
    if (provider === 'tmdb-movie' || provider === 'tmdb-series') {
      if (!TMDB_KEY) return Promise.resolve({ ok: false, reason: 'no-key' });
      return Enrich.searchTmdb(fetchFn, TMDB_KEY, provider === 'tmdb-series' ? 'series' : 'movie', query)
        .then(function (list) { return { ok: true, provider: provider, candidates: list }; });
    }
    if (provider === 'rawg') {
      // Task 45: Steam first (real Russian genres/descriptions, for any game
      // that has a Russian-localized Steam store page), RAWG as the
      // fallback — an empty Steam result, a proxy failure and a network
      // error all collapse to the same "[]" from searchSteam (see its
      // header comment in lib/enrich.js), so there is nothing special to
      // branch on here beyond "did Steam find anything at all".
      return Enrich.searchSteam(fetchFn, CORS_PROXY, query).then(function (steamList) {
        if (steamList && steamList.length) {
          return { ok: true, provider: 'steam', candidates: steamList };
        }
        if (!RAWG_KEY) return { ok: false, reason: 'no-key' };
        return Enrich.searchRawg(fetchFn, RAWG_KEY, query)
          .then(function (list) { return { ok: true, provider: 'rawg', candidates: list }; });
      });
    }
    if (provider === 'shikimori') {
      return Enrich.searchShikimori(fetchFn, query)
        .then(function (list) { return { ok: true, provider: provider, candidates: list }; });
    }
    return Promise.resolve({ ok: false, reason: 'no-category' });
  }

  function detailsByProvider(provider, id) {
    var fetchFn = nativeFetch();
    if (!fetchFn) return Promise.resolve(null);
    if (provider === 'tmdb-movie') return Enrich.fetchTmdbDetails(fetchFn, TMDB_KEY, 'movie', id);
    if (provider === 'tmdb-series') return Enrich.fetchTmdbDetails(fetchFn, TMDB_KEY, 'series', id);
    if (provider === 'rawg') return Enrich.fetchRawgDetails(fetchFn, RAWG_KEY, id);
    if (provider === 'shikimori') return Enrich.fetchShikimoriDetails(fetchFn, id);
    if (provider === 'steam') return steamDetailsWithPlatformSupplement(fetchFn, id);
    return Promise.resolve(null);
  }

  // Task 45 Step 3: Steam's own appdetails only reports Windows/Mac/Linux
  // booleans, not console platforms, so a Steam-sourced pick makes one
  // extra, best-effort RAWG search by the resolved Steam title purely to
  // pull a richer `platforms` list (RAWG's top hit for that title, if any).
  // This supplement can never fail or block the pick: a missing RAWG_KEY, no
  // match, a network error or a thrown exception anywhere in the RAWG leg
  // all fall back to just returning Steam's own details unchanged — only a
  // real, non-empty RAWG `platforms` list ever overwrites Steam's.
  function steamDetailsWithPlatformSupplement(fetchFn, appid) {
    return Enrich.fetchSteamDetails(fetchFn, CORS_PROXY, appid).then(function (details) {
      if (!details) return null;
      if (!RAWG_KEY) return details;
      return Enrich.searchRawg(fetchFn, RAWG_KEY, details.title)
        .then(function (matches) {
          var topMatch = matches && matches.length ? matches[0] : null;
          return topMatch ? Enrich.fetchRawgDetails(fetchFn, RAWG_KEY, topMatch.id) : null;
        })
        .then(function (rawgDetails) {
          if (rawgDetails && rawgDetails.platforms && rawgDetails.platforms.length) {
            details.platforms = rawgDetails.platforms;
          }
          return details;
        })
        .catch(function () { return details; });
    });
  }

  function candidateHtml(c) {
    var name = escapeHtml(c.title || 'Без названия');
    var year = c.year ? String(c.year) : '—';
    var poster = c.poster ? '<img class="enrich-picker__poster" src="' + escapeHtml(c.poster) + '" alt="">'
      : '<span class="enrich-picker__poster enrich-picker__poster--empty"></span>';
    return '<li class="enrich-picker__item" data-id="' + escapeHtml(String(c.id)) + '" tabindex="0">' +
      poster +
      '<span class="enrich-picker__info"><span class="enrich-picker__name">' + name +
      '</span><span class="enrich-picker__year">' + year + '</span></span>' +
      '</li>';
  }

  // Task 42: search is instant, not click-triggered — a debounced `input`
  // listener on the title field plus an immediate re-search on the category
  // `<select>`'s `change` (changing category changes which provider/results
  // apply, so that shouldn't wait for the debounce either). `onPick(details)`
  // is handed the normalized fetchXDetails result for whichever candidate
  // was clicked.
  //
  // Race-condition guard: a fast typer can have an older, slower request
  // resolve after a newer one has already started or landed. Every call to
  // runSearch (and every close(), including the implicit one when the query
  // drops below 2 characters) bumps `searchToken`; a search's `.then` only
  // renders its result if its own token still matches the latest one issued,
  // so a stale response can never overwrite or flicker over fresher results.
  function wireEnrichPicker(titleInput, categorySelect, container, onPick) {
    var list = container.querySelector('.enrich-picker__list');
    var msg = container.querySelector('.enrich-picker__message');
    var debounceTimer = null;
    var searchToken = 0;

    function showMessage(text) {
      list.innerHTML = '';
      msg.textContent = text;
      msg.hidden = false;
      container.hidden = false;
    }

    function close() {
      searchToken += 1; // invalidate any search still in flight
      container.hidden = true;
      list.innerHTML = '';
      msg.hidden = true;
    }

    function runSearch() {
      var category = categorySelect.value;
      var query = titleInput.value.trim();
      searchToken += 1;
      var token = searchToken;
      // Below 2 characters or no category picked isn't a failure state, just
      // "not enough to search yet" — hide the panel rather than message it.
      if (query.length < 2 || !category) {
        close();
        return;
      }
      showMessage('Ищу…');
      searchByCategory(category, query).then(function (result) {
        if (token !== searchToken) return; // superseded by a newer search
        if (!result.ok) {
          showMessage(result.reason === 'no-key'
            ? 'Добавь ключ TMDB_KEY/RAWG_KEY в app.js'
            : 'Не удалось найти');
          return;
        }
        if (!result.candidates.length) {
          showMessage('Ничего не нашлось');
          return;
        }
        msg.hidden = true;
        container.dataset.provider = result.provider;
        list.innerHTML = result.candidates.map(candidateHtml).join('');
        container.hidden = false;
      });
      // searchByCategory never rejects (see lib/enrich.js), so there is
      // deliberately no .catch() chained above — the form's own state is
      // never at risk from this call either way.
    }

    titleInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 350);
    });

    categorySelect.addEventListener('change', function () {
      clearTimeout(debounceTimer);
      runSearch();
    });

    list.addEventListener('click', function (event) {
      var item = event.target.closest('.enrich-picker__item');
      if (!item) return;
      var provider = container.dataset.provider;
      showMessage('Загружаю…');
      detailsByProvider(provider, item.dataset.id).then(function (details) {
        if (!details) { showMessage('Не удалось загрузить'); return; }
        onPick(details);
        close();
      });
    });

    container.querySelector('.enrich-picker__close').addEventListener('click', function () {
      clearTimeout(debounceTimer);
      close();
    });
  }

  // Quick-add has no year/genre/synopsis fields to stage a pick in, so a
  // candidate is applied straight into a fresh draft via BacklogStorage.addTitle
  // — the exact same object shape (and the same Sync.pushDraft call) the plain
  // submit handler above builds, just with the fetched fields folded in instead
  // of left blank.
  function applyQuickAddPick(details) {
    var titleInput = document.getElementById('quick-add-title');
    var categorySelect = document.getElementById('quick-add-category');
    var typed = titleInput.value.trim();
    var category = categorySelect.value;
    if (!typed || !category) return;
    var name = (details.title && 'title' in details) ? details.title : typed;
    var existingIds = baseTitles().map(function (t) { return t.id; });
    var id = BacklogSlug.uniqueId(name, existingIds);
    var draft = {
      id: id,
      title: name,
      category: category,
      status: 'queue',
      airingStatus: (category === 'series' || category === 'anime') ? 'ongoing' : null,
      year: details.year != null ? details.year : null,
      genres: details.genres || [],
      rating: null,
      synopsis: ('synopsis' in details) ? details.synopsis : '',
      cover: details.cover || 'images/covers/_placeholder.svg',
      // Always a draft, same as a plain quick-add: `draft` is the review
      // signal ("owner/Claude should still sanity-check this"), not a
      // completeness flag — an API pick can be factually wrong (wrong
      // edition, wrong franchise entry) even with every field filled in.
      // The modal's placeholder-synopsis message is gated on actual content
      // (see openTitleModal), not on this flag, so a fetched synopsis still
      // displays correctly for a draft.
      draft: true
    };
    if (category === 'game' && details.platforms && details.platforms.length) draft.platforms = details.platforms;
    BacklogStorage.addTitle(window.localStorage, draft);
    Sync.pushDraft(syncClient, draft);
    titleInput.value = '';
    categorySelect.value = '';
    refresh();
  }

  wireEnrichPicker(
    document.getElementById('quick-add-title'),
    document.getElementById('quick-add-category'),
    document.getElementById('quick-add-picker'),
    applyQuickAddPick
  );

  // ── Cross-device sync ────────────────────────────────────────────────
  //
  // The grid is painted from localStorage first and Supabase catches up
  // afterwards. That order is the whole offline story: the first screen never
  // waits on a network round trip, an unreachable Supabase costs nothing but a
  // console warning, and the PWA's cached shell keeps working exactly as it did
  // before this file learned the word "sync".
  //
  // These two strings are meant to be in the source. The anon key is a public
  // identifier, not a secret — it is what every browser must present to reach
  // the project at all, and what actually guards the data is the row-level
  // security policy on the three tables plus the fact that nobody else knows
  // the project URL. See README, "Синхронизация".
  var SUPABASE_URL = 'https://rjdnpwamcxvhryiigbvt.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto';
  var SEEDED_KEY = 'backlog-sync-seeded';

  // Task 40: TMDb and RAWG v3-style client keys — the same "checked-in public
  // key" treatment as SUPABASE_KEY above (see README, "Синхронизация"). Both
  // are client-facing keys these APIs expect to be called with directly from
  // the browser, not server secrets.
  var TMDB_KEY = '9affbfce7554a8309e8ea9933431b1ff';
  var RAWG_KEY = 'bde5b0fbbc9242d0b0aeec940d845ac3';

  // Task 45: store.steampowered.com sends no CORS headers on either endpoint
  // lib/enrich.js's Steam functions call, so those requests are relayed
  // through this public proxy instead (confirmed live, no API key needed —
  // see lib/enrich.js's header comment). This is the one place that base URL
  // lives, so swapping providers if proxy.cors.sh ever stops working is a
  // one-line change here, not a search-and-replace.
  var CORS_PROXY = 'https://proxy.cors.sh/';

  // Null until the SDK has loaded and a client has been built, and null forever
  // if that never happens. Every BacklogSync function takes null as "local-only
  // today" and resolves false, which is why the push calls above need no guard
  // of their own.
  var syncClient = null;

  // A draft that the catalog has since absorbed is dropped from `backlog-added`
  // by pruneAdded, silently, as a side effect of reading. The remote row would
  // otherwise outlive it and be handed back on every pull — harmless on screen,
  // since every device prunes on read too, but it accumulates forever. Reaped
  // here instead, once per pull.
  function reapSupersededDrafts() {
    var before = BacklogStorage.getAdded(window.localStorage);
    if (!before.length) return;
    var keptIds = BacklogStorage.pruneAdded(window.localStorage, TITLES.map(function (t) { return t.id; }))
      .map(function (t) { return t.id; });
    if (keptIds.length === before.length) return;
    before.forEach(function (t) {
      if (keptIds.indexOf(t.id) === -1) Sync.pushRemoveDraft(syncClient, t.id);
    });
  }

  // The list of tables this browser has already reconciled with the remote.
  // A malformed or missing value reads as "none", which costs one extra seed
  // rather than skipping one that was needed.
  function readSeeded() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(SEEDED_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeSeeded(tables) {
    try {
      window.localStorage.setItem(SEEDED_KEY, JSON.stringify(tables));
    } catch (e) {
      console.warn('[sync] could not record seed state', e && e.message);
    }
  }

  function pullIntoMirror() {
    return Sync.pullState(syncClient).then(function (result) {
      // `result.state` holds only the tables that actually answered, so a
      // failed or missing table leaves its localStorage key untouched rather
      // than blanking it. Nothing at all is written when the whole pull failed.
      //
      // `readSeeded()` is the second guard, and it closes a gap the first one
      // cannot see. A table's *read* can succeed while its *write* fails — an
      // RLS policy granting select but not insert, a column mismatch on the
      // batched upsert, a transient 429 on the one request that matters most —
      // and then the pull comes back with real, well-formed rows that have
      // simply never heard of this browser's months of local history. Applying
      // them would destroy exactly what the seed step exists to protect. So a
      // key is only ever written once its table is *confirmed* seeded; an
      // unseeded table keeps its local data untouched and is retried on the
      // next load, because a failed seed leaves it unmarked in
      // `backlog-sync-seeded`. This is the same list startSync writes, so it
      // stays right for every later pull too, not just the one at startup.
      if (result.ok) {
        Sync.applyState(window.localStorage, result.state, { tables: readSeeded() });
        reapSupersededDrafts();
      }
      return result;
    });
  }

  // Is the user in the middle of something a repaint would wreck?
  //
  // A remote change is never urgent — it is somebody else's click on another
  // device — so it always loses to work in progress here. An open panel would
  // be redrawn or closed under the reader; a rebuilt grid moves cards out from
  // under a pointer or the keyboard focus, which is the exact hazard the
  // deferred-reorder machinery above already exists to prevent. So a busy tab
  // takes the data (localStorage is updated either way) and defers the paint
  // through that same machinery: `gridStale` is set, and the existing
  // flushGrid hooks catch up the moment the user leaves the grid or closes the
  // panel.
  //
  // The search box is deliberately not on this list: typing already re-renders
  // the grid on every keystroke and the input itself is never rebuilt.
  function userIsBusy() {
    if (!document.getElementById('title-modal').hidden) return true;
    if (!statsModal.hidden) return true;
    if (!genrePanel.hidden) return true;
    if (genreWrap.contains(document.activeElement)) return true;
    if (grid.contains(document.activeElement)) return true;
    // A pointer resting on the wall means a click is probably on its way.
    if (grid.matches && grid.matches(':hover')) return true;
    return false;
  }

  function onRemoteChange() {
    pullIntoMirror().then(function (result) {
      if (!result.ok) return;
      if (userIsBusy()) {
        gridStale = true;
        // Cheap and safe: the counters are their own nodes and nothing is
        // focused inside them, so the tab chips can stay honest even while the
        // wall itself waits.
        renderCounters();
        return;
      }
      // A remote delete or quick-add changes which genres exist on this tab, so
      // the list is rebuilt, not just the grid.
      populateGenreFilter();
      refresh();
    });
  }

  function startSync() {
    // Registered before the client exists, so an edit made on a page that never
    // managed to reach Supabase at all is still remembered for next time.
    Sync.useOutbox(window.localStorage);
    syncClient = Sync.createClient(SUPABASE_URL, SUPABASE_KEY);
    if (!syncClient) return;

    // First run on a browser that has been keeping its edits to itself: push
    // what is here before pulling anything down, or the empty remote would
    // answer "you have nothing" and applyState would faithfully write that over
    // months of statuses, ratings and ticked seasons. Upserts, so this merges
    // with whatever the other device has already put there rather than
    // replacing it.
    //
    // Tracked per table, and it must stay that way. Seeding a table a second
    // time is not a harmless repeat: it pushes this browser's local rows up
    // *ahead of the pull*, so anything the other device changed or deleted in
    // the meantime is resurrected from a stale mirror. The flag is what makes
    // "seed" a one-time reconciliation rather than a recurring upload.
    var seeded = readSeeded();
    var todo = Sync.TABLES.filter(function (t) { return seeded.indexOf(t) === -1; });
    var ready = todo.length
      ? Sync.seedLocal(syncClient, window.localStorage, { tables: todo })
      : Promise.resolve([]);

    ready
      .then(function (done) {
        // A table that failed stays unmarked and is retried next load — which
        // is exactly what should happen for `parts` on a project where that
        // table has not been created yet.
        //
        // This has to land *before* the pull below, and not merely as
        // bookkeeping for the next load: `pullIntoMirror` reads this same list
        // back to decide which keys it is allowed to overwrite. An unmarked
        // table means "the remote has not been told about this browser's local
        // rows yet", and applying a pull to it would erase them. Writing the
        // list here is what makes that list true by the time the pull reads it.
        if (done.length) writeSeeded(seeded.concat(done));
        // Before the pull, never after. Edits made offline live only in
        // localStorage and in the outbox; if the remote became the authority
        // first, applyState would overwrite them with a state that has never
        // heard of them and the work would be gone. Flushing first is what
        // makes "the app works offline" survive coming back online.
        return Sync.flushOutbox(syncClient);
      })
      .then(function () {
        return pullIntoMirror();
      })
      .then(function (result) {
        if (!result.ok) return;
        populateGenreFilter();
        refresh();
        // Subscribed only to the tables that answered the pull: asking realtime
        // for a table that does not exist takes the whole channel down with it,
        // and `parts` is the one an older project may not have yet.
        Sync.subscribe(syncClient, onRemoteChange, { tables: result.tables });
      })
      .then(function () {
        // Coming back online without a reload — the common shape of it on a
        // phone. Same order as startup: send what was queued, then catch up on
        // whatever the other device did in the meantime.
        window.addEventListener('online', function () {
          Sync.flushOutbox(syncClient).then(onRemoteChange);
        });
      })
      .catch(function (e) {
        // Belt and braces. Nothing above is supposed to be able to reject —
        // lib/sync.js swallows its own failures — but a bug here must not take
        // the page down with it, because the page works fine without any of it.
        console.warn('[sync] startup failed — running local-only', e && e.message);
      });
  }

  populateGenreFilter();
  updateRandomAvailability();
  refresh();

  // Deferred to DOMContentLoaded because the Supabase tag in index.html is
  // `defer`red: this file runs during parsing, the SDK executes after it, and
  // this event is the first moment `window.supabase` is guaranteed to exist.
  // It also keeps the whole of sync strictly behind the first paint.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSync);
  } else {
    startSync();
  }

  window.BacklogApp = {
    getVisibleTitles: getVisibleTitles,
    renderGrid: renderGrid,
    refresh: refresh,
    openTitleModal: openTitleModal,
    closeTitleModal: closeTitleModal,
    computeStats: computeStats,
    openStatsModal: openStatsModal,
    closeStatsModal: closeStatsModal,
    state: state,
    // Exposed for the console: `BacklogApp.syncClient()` returning null is the
    // one-line answer to "is this tab syncing at all?".
    syncClient: function () { return syncClient; },
    pullIntoMirror: pullIntoMirror
  };
}());
