// A Chart.js chart from a config. Clicking a bar, point or slice records it
// and toggles it in the response, so a person can point at data.
(function () {
  'use strict';
  var stage = document.querySelector('.nb-stage');
  function fail(message) {
    stage.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'nb-error';
    p.textContent = message;
    stage.appendChild(p);
    console.error(message);
  }
  if (typeof window.Chart !== 'function') return fail('Chart.js didn’t load.');
  var config;
  try {
    config = JSON.parse(document.getElementById('nb-visual').textContent || '{}');
  } catch (e) {
    return fail('The chart config isn’t valid JSON: ' + e.message);
  }
  // A simpler shape: {type, labels, series: [{name, values}]}.
  if (!config.data && (config.series || config.labels)) {
    config = {
      type: config.type || 'bar',
      data: {
        labels: config.labels || [],
        datasets: (config.series || []).map(function (s) { return {label: s.name || s.label, data: s.values || s.data || []}; }),
      },
      options: config.options || {},
    };
  }
  var dark = document.documentElement.getAttribute('data-nullbot-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-nullbot-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  function applyTheme(isDark) {
    Chart.defaults.color = isDark ? '#a3aab2' : '#4c535c';
    Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    Chart.defaults.font.family = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
  }
  applyTheme(dark);
  // Datasets without colors get NullBot's palette (Chart.js's own palette
  // switches off once its defaults change).
  var palette = ['#3a6ea5', '#d08a1e', '#2c7a57', '#a8493b', '#7a4ea0', '#56658a', '#a8641c', '#12807a'];
  function alpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var perPoint = {pie: 1, doughnut: 1, polarArea: 1};
  ((config.data && config.data.datasets) || []).forEach(function (dataset, i) {
    var type = dataset.type || config.type;
    if (perPoint[type]) {
      if (!dataset.backgroundColor) dataset.backgroundColor = (dataset.data || []).map(function (_, j) { return palette[j % palette.length]; });
      if (!dataset.borderColor) dataset.borderColor = dark ? '#1d2025' : '#ffffff';
      return;
    }
    var color = palette[i % palette.length];
    if (!dataset.borderColor) dataset.borderColor = color;
    if (!dataset.backgroundColor) dataset.backgroundColor = type === 'line' || type === 'radar' ? alpha(color, 0.15) : alpha(color, 0.85);
    if (type === 'line' && dataset.borderWidth == null) dataset.borderWidth = 2;
  });
  config.options = config.options || {};
  config.options.responsive = true;
  config.options.maintainAspectRatio = false;
  var selected = [];
  function key(item) { return item.datasetIndex + ':' + item.index; }
  config.options.onClick = function (event, elements, chart) {
    if (!elements || !elements.length) return;
    var el = elements[0];
    var dataset = chart.data.datasets[el.datasetIndex] || {};
    var raw = (dataset.data || [])[el.index];
    var label = (chart.data.labels || [])[el.index];
    var item = {datasetIndex: el.datasetIndex, index: el.index, dataset: dataset.label, label: label, value: raw};
    var at = selected.findIndex(function (s) { return key(s) === key(item); });
    if (at >= 0) selected.splice(at, 1);
    else selected.push(item);
    window.nullbot.record('chart_click', {label: label == null ? undefined : String(label), name: dataset.label, value: raw, data: {dataset: el.datasetIndex, index: el.index, selected: at < 0}});
    window.nullbot.setResponse({selected: selected.map(function (s) { return {dataset: s.dataset, label: s.label, value: s.value}; })});
  };
  config.options.plugins = config.options.plugins || {};
  config.options.plugins.legend = config.options.plugins.legend || {};
  var defaultLegend = Chart.defaults.plugins.legend.onClick;
  config.options.plugins.legend.onClick = function (event, item, legend) {
    defaultLegend.call(this, event, item, legend);
    window.nullbot.record('legend', {name: item.text, value: !legend.chart.isDatasetVisible(item.datasetIndex) ? 'hidden' : 'shown'});
  };
  var box = document.createElement('div');
  box.className = 'nb-chart';
  var canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', document.title);
  box.appendChild(canvas);
  stage.appendChild(box);
  var chart;
  try {
    chart = new Chart(canvas, config);
  } catch (e) {
    return fail('This chart couldn’t be drawn: ' + e.message);
  }
  window.addEventListener('nullbot:context', function (event) {
    if (!event.detail || !event.detail.theme) return;
    applyTheme(event.detail.theme === 'dark');
    chart.options.scales && Object.keys(chart.options.scales).forEach(function (axis) {
      var scale = chart.options.scales[axis];
      if (scale && scale.ticks) scale.ticks.color = Chart.defaults.color;
    });
    chart.update();
  });
})();
