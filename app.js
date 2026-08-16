// app.js
(function () {
  var state = { category: 'all' };

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

  function getVisibleTitles() {
    return titlesForCategory(state.category);
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
  refresh();

  window.BacklogApp = { getVisibleTitles: getVisibleTitles, renderGrid: renderGrid, refresh: refresh, state: state };
}());
