// A draw.io diagram. Clicking a shape or connector selects it (again to
// deselect); the selection is the response, so a person can point at parts.
(function () {
  'use strict';
  var pages = Array.prototype.slice.call(document.querySelectorAll('.nb-page'));
  var bar = document.querySelector('.nb-bar');
  var selected = [];
  function respond() {
    window.nullbot.setResponse({selected: selected.map(function (el) {
      return {id: el.getAttribute('data-cell-id'), label: el.getAttribute('data-label') || '', page: el.closest('.nb-page').getAttribute('data-page')};
    })});
  }
  function show(name) {
    pages.forEach(function (page) { page.hidden = page.getAttribute('data-page') !== name; });
    if (bar) Array.prototype.forEach.call(bar.querySelectorAll('.nb-chip'), function (chip) { chip.setAttribute('aria-pressed', chip.textContent === name ? 'true' : 'false'); });
  }
  if (bar) {
    pages.forEach(function (page) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nb-chip';
      chip.textContent = page.getAttribute('data-page');
      chip.addEventListener('click', function () {
        show(chip.textContent);
        window.nullbot.record('page', {name: chip.textContent});
      });
      bar.appendChild(chip);
    });
  }
  if (pages.length) show(pages[0].getAttribute('data-page'));
  document.addEventListener('click', function (event) {
    var cell = event.target.closest && event.target.closest('.drawio .cell');
    if (!cell) return;
    var at = selected.indexOf(cell);
    if (at >= 0) {
      selected.splice(at, 1);
      cell.classList.remove('selected');
    } else {
      selected.push(cell);
      cell.classList.add('selected');
    }
    respond();
  });
})();
