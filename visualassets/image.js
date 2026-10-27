// A picture to look at or label. Clicking places a numbered pin, tagged with
// the chosen label when there are labels; clicking a pin removes it. The
// pins are the response.
(function () {
  'use strict';
  var config = JSON.parse(document.getElementById('nb-visual').textContent || '{}');
  var labels = Array.isArray(config.labels) ? config.labels : [];
  var palette = ['#d08a1e', '#3a6ea5', '#2c7a57', '#a8493b', '#7a4ea0', '#56658a', '#a8641c', '#12807a'];
  var pins = [];
  var current = labels.length ? labels[0] : '';
  var stage = document.querySelector('.nb-stage');
  var wrap = document.createElement('div');
  wrap.className = 'nb-image-wrap';
  var img = document.createElement('img');
  img.alt = config.title || 'Picture';
  img.draggable = false;
  img.src = config.src;
  wrap.appendChild(img);
  stage.appendChild(wrap);

  var labeling = labels.length > 0 || config.pins === true;
  var bar = document.createElement('div');
  bar.className = 'nb-bar';
  bar.setAttribute('data-nullbot-ignore', '');
  var hint = document.createElement('span');
  hint.className = 'nb-hint';
  bar.appendChild(hint);
  var chips = [];
  labels.forEach(function (label, i) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'nb-chip';
    var swatch = document.createElement('span');
    swatch.className = 'nb-swatch';
    swatch.style.background = palette[i % palette.length];
    chip.appendChild(swatch);
    chip.appendChild(document.createTextNode(label));
    chip.addEventListener('click', function () {
      current = label;
      update();
    });
    chips.push(chip);
    bar.appendChild(chip);
  });
  var undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'nb-chip';
  undo.textContent = 'Undo';
  undo.addEventListener('click', function () {
    var pin = pins.pop();
    if (pin) {
      window.nullbot.record('unpin', {n: pin.n, label: pin.label || undefined});
      changed();
    }
  });
  var clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'nb-chip';
  clear.textContent = 'Clear';
  clear.addEventListener('click', function () {
    if (!pins.length) return;
    pins = [];
    window.nullbot.record('clear_pins', {});
    changed();
  });
  bar.appendChild(undo);
  bar.appendChild(clear);
  if (labeling) document.body.insertBefore(bar, stage);
  else document.body.classList.add('nb-plain');

  function colorFor(label) {
    var i = labels.indexOf(label);
    return i < 0 ? '' : palette[i % palette.length];
  }

  function update() {
    chips.forEach(function (chip, i) { chip.setAttribute('aria-pressed', labels[i] === current ? 'true' : 'false'); });
    undo.disabled = clear.disabled = !pins.length;
    hint.textContent = pins.length
      ? pins.length + ' point' + (pins.length === 1 ? '' : 's') + ' marked. Click a pin to remove it.'
      : labels.length ? 'Pick a label, then click the picture to mark a point.' : 'Click the picture to mark a point.';
  }

  function render() {
    Array.prototype.slice.call(wrap.querySelectorAll('.nb-pin')).forEach(function (el) { el.remove(); });
    pins.forEach(function (pin) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'nb-pin';
      el.setAttribute('data-nullbot-ignore', '');
      el.style.left = (pin.fx * 100) + '%';
      el.style.top = (pin.fy * 100) + '%';
      var color = colorFor(pin.label);
      if (color) el.style.setProperty('--pin', color);
      el.textContent = String(pin.n) + (pin.label ? ' ' + pin.label : '');
      el.title = 'Remove point ' + pin.n;
      el.addEventListener('click', function (event) {
        event.stopPropagation();
        pins = pins.filter(function (p) { return p !== pin; });
        window.nullbot.record('unpin', {n: pin.n, label: pin.label || undefined});
        changed();
      });
      wrap.appendChild(el);
    });
  }

  function changed() {
    render();
    update();
    window.nullbot.setResponse({
      image: {width: img.naturalWidth, height: img.naturalHeight},
      points: pins.map(function (pin) {
        var point = {n: pin.n, x: pin.x, y: pin.y};
        if (pin.label) point.label = pin.label;
        return point;
      }),
    });
  }

  var next = 1;
  img.addEventListener('click', function (event) {
    var rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var fx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    var fy = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    if (!labeling) {
      // Where on the picture, in its own pixels.
      window.nullbot.record('image_click', {x: Math.round(fx * img.naturalWidth), y: Math.round(fy * img.naturalHeight)});
      return;
    }
    var pin = {n: next++, fx: fx, fy: fy, x: Math.round(fx * img.naturalWidth), y: Math.round(fy * img.naturalHeight), label: current};
    pins.push(pin);
    window.nullbot.record('pin', {n: pin.n, label: pin.label || undefined, x: pin.x, y: pin.y});
    changed();
  });
  img.addEventListener('error', function () {
    stage.innerHTML = '<p class="nb-error">This picture couldn’t be loaded.</p>';
  });
  update();
})();
