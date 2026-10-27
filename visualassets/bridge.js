// NullBot's visual bridge. Loaded first in every page a visual shows, it
// records what the person does and passes it to the NullBot window. The page
// runs in a sandbox: it can't reach NullBot itself, only post messages that
// the window checks.
(function () {
  'use strict';
  if (window.nullbot && window.nullbot.__bridge) return;
  // Pages arrive as srcdoc, so their path comes from the base address.
  function pageName() {
    var meta = document.querySelector('meta[name="nullbot-page"]');
    if (meta && meta.content) return meta.content;
    var match = /\/__vis\/[0-9a-f]{32}\/(.*)$/.exec(document.baseURI || '');
    return match ? decodeURIComponent(match[1]) || '/' : location.pathname;
  }
  var queue = [];
  var timer = 0;
  var dropped = 0;
  var MAX_QUEUE = 2000;
  var consoleCount = 0;

  function post(message) {
    message.__nullbot = 1;
    try {
      window.parent.postMessage(message, '*');
    } catch (e) {
      // The page is not in a NullBot window.
    }
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (!queue.length && !dropped) return;
    var batch = queue.splice(0, 300);
    if (dropped) {
      batch.push({type: 'dropped', t: Date.now(), count: dropped});
      dropped = 0;
    }
    post({type: 'events', events: batch});
    if (queue.length) schedule();
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, 250);
  }

  function clip(text, max) {
    text = String(text == null ? '' : text);
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  // safe turns data into plain JSON of bounded size.
  function safe(data) {
    if (data === undefined) return null;
    try {
      var json = JSON.stringify(data, function (key, value) {
        if (typeof value === 'function') return undefined;
        if (value instanceof Element) return describe(value);
        return value;
      });
      if (json === undefined) return null;
      if (json.length > 100000) return {truncated: true, text: json.slice(0, 2000)};
      return JSON.parse(json);
    } catch (e) {
      return clip(data, 2000);
    }
  }

  function record(type, fields) {
    var event = {type: type, t: Date.now(), page: pageName()};
    if (fields) for (var key in fields) if (Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined) event[key] = fields[key];
    if (queue.length >= MAX_QUEUE) {
      dropped++;
      return;
    }
    queue.push(event);
    schedule();
  }

  function text(el) {
    var value = '';
    try {
      value = (el.innerText !== undefined ? el.innerText : el.textContent) || '';
    } catch (e) {
      value = el.textContent || '';
    }
    return clip(value.replace(/\s+/g, ' ').trim(), 80);
  }

  // Elements whose text is everything inside them: named by id or class only.
  var containers = {input: 1, textarea: 1, select: 1, form: 1, fieldset: 1, body: 1, html: 1, main: 1, section: 1, article: 1, div: 1, table: 1, tbody: 1, ul: 1, ol: 1, nav: 1, header: 1, footer: 1, aside: 1, svg: 1, canvas: 1, iframe: 1};

  // describe names an element the way a person would point at it.
  function describe(el) {
    if (!el || el.nodeType !== 1) return '';
    var tag = el.tagName.toLowerCase();
    var out = tag;
    if (el.id) out += '#' + el.id;
    var cls = typeof el.className === 'string' ? el.className : el.className && el.className.baseVal;
    if (cls) {
      var parts = String(cls).trim().split(/\s+/).filter(function (c) { return c && c !== 'selected' && c.indexOf('nb-') !== 0; }).slice(0, 2);
      if (parts.length) out += '.' + parts.join('.');
    }
    var name = el.getAttribute('name');
    if (name) out += '[name=' + clip(name, 40) + ']';
    var type = tag === 'input' ? el.getAttribute('type') : '';
    if (type) out += '[type=' + type + ']';
    var label = el.getAttribute('aria-label') || el.getAttribute('data-label') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder');
    if (!label && el.labels && el.labels.length) label = text(el.labels[0]);
    if (!label && !containers[tag]) label = text(el);
    if (label) out += ' "' + clip(label, 80) + '"';
    return out;
  }

  function dataAttributes(el) {
    if (!el || !el.attributes) return undefined;
    var out = null;
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (attr.name.indexOf('data-') === 0 && attr.name !== 'data-label') {
        out = out || {};
        out[attr.name.slice(5)] = clip(attr.value, 120);
        if (Object.keys(out).length >= 6) break;
      }
    }
    return out || undefined;
  }

  var interactive = 'a,button,input,select,textarea,label,summary,option,[role],[onclick],[data-cell-id],[data-id],[data-value],[data-label],[data-nullbot],[tabindex]';

  function editable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  document.addEventListener('click', function (event) {
    var raw = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    if (!raw || (raw.closest && raw.closest('[data-nullbot-ignore]'))) return;
    var el = (raw.closest && raw.closest(interactive)) || raw;
    var fields = {target: describe(el), x: Math.round(event.clientX), y: Math.round(event.clientY), data: dataAttributes(el)};
    if (el !== raw) fields.on = describe(raw);
    if (el.tagName && el.tagName.toLowerCase() === 'a' && el.getAttribute('href')) fields.href = clip(el.getAttribute('href'), 300);
    if (raw.tagName && raw.tagName.toLowerCase() === 'canvas') {
      var rect = raw.getBoundingClientRect();
      fields.canvas = {x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top)};
    }
    record('click', fields);
  }, true);

  function valueOf(el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return '(hidden)';
    if (type === 'checkbox' || type === 'radio') return el.checked;
    if (type === 'file') return Array.prototype.map.call(el.files || [], function (f) { return f.name; }).join(', ');
    if (tag === 'select') {
      return Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return clip(o.text || o.value, 80); }).join(', ');
    }
    if (el.isContentEditable) return clip(el.innerText, 2000);
    return clip(el.value, 2000);
  }

  document.addEventListener('change', function (event) {
    var el = event.target;
    if (!el || el.nodeType !== 1) return;
    record('change', {target: describe(el), value: valueOf(el), data: dataAttributes(el)});
  }, true);

  // Forms have nowhere to go: their fields are recorded instead.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var fields = {};
    try {
      Array.prototype.forEach.call(form.elements || [], function (el) {
        var key = el.name || el.id;
        if (!key || el.disabled) return;
        var type = (el.getAttribute('type') || '').toLowerCase();
        if ((type === 'checkbox' || type === 'radio') && !el.checked) return;
        if (type === 'submit' || type === 'button') return;
        fields[key] = valueOf(el);
      });
    } catch (e) {
      // Fields that can't be read are left out.
    }
    record('form_submit', {target: describe(form), value: fields});
    if (!event.defaultPrevented) event.preventDefault();
  }, true);

  // Pages are handed to the frame by the app, so a link to another page of
  // the visual asks the app for it. Links to the web don't open here.
  var siteRoot = (/^(.*\/__vis\/[0-9a-f]{32}\/)/.exec(document.baseURI) || [])[1] || '';
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target && event.target.closest && event.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    var raw = a.getAttribute('href') || '';
    if (raw.charAt(0) === '#') {
      event.preventDefault();
      var id = decodeURIComponent(raw.slice(1));
      var el = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.body;
      if (el && el.scrollIntoView) el.scrollIntoView();
      record('navigate', {url: clip(raw, 300)});
      return;
    }
    if (/^(javascript|mailto|tel):/i.test(raw)) return;
    var url;
    try {
      url = new URL(a.href, document.baseURI);
    } catch (e) {
      return;
    }
    event.preventDefault();
    if (!siteRoot || url.href.indexOf(siteRoot) !== 0) {
      record('link_blocked', {url: clip(url.href, 300)});
      post({type: 'external', url: clip(url.href, 300)});
      return;
    }
    var page = decodeURIComponent(url.pathname.slice(new URL(siteRoot).pathname.length));
    post({type: 'navigate', page: page, hash: url.hash});
  });

  var lastKey = '';
  var lastKeyAt = 0;
  document.addEventListener('keydown', function (event) {
    if (editable(event.target) || event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
    if (event.repeat) return;
    var now = Date.now();
    if (event.key === lastKey && now - lastKeyAt < 80) return;
    lastKey = event.key;
    lastKeyAt = now;
    var key = (event.ctrlKey ? 'Ctrl+' : '') + (event.altKey ? 'Alt+' : '') + (event.metaKey ? 'Meta+' : '') + event.key;
    record('key', {key: key, target: event.target && event.target !== document.body ? describe(event.target) : undefined});
  }, true);

  window.addEventListener('error', function (event) {
    if (event.target && event.target !== window && event.target.tagName) {
      var el = event.target;
      record('resource_error', {target: describe(el), url: clip(el.currentSrc || el.src || el.href || '', 300)});
      return;
    }
    var source = event.filename ? clip(String(event.filename).split('/').pop(), 120) : '';
    record('error', {message: clip(event.message || (event.error && event.error.message) || 'Script error', 500), source: source ? source + ':' + (event.lineno || 0) + ':' + (event.colno || 0) : undefined});
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    record('rejection', {message: clip(reason && reason.message ? reason.message : reason, 500)});
  });

  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      if (consoleCount < 300) {
        consoleCount++;
        record('console', {level: level, text: clip(Array.prototype.map.call(arguments, function (a) {
          try {
            return typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a);
          } catch (e) {
            return String(a);
          }
        }).join(' '), 500)});
      }
      return original.apply(console, arguments);
    };
  });

  ['alert', 'confirm', 'prompt'].forEach(function (kind) {
    var original = window[kind];
    if (typeof original !== 'function') return;
    window[kind] = function (message) {
      var result = original.apply(window, arguments);
      record('dialog', {name: kind, message: clip(message, 500), result: kind === 'alert' ? undefined : result});
      return result;
    };
  });

  window.addEventListener('hashchange', function () { record('navigate', {url: clip(location.hash, 300)}); });
  window.addEventListener('popstate', function () { record('navigate', {url: clip(location.hash, 300)}); });
  // The app follows this page to another only when it says it is leaving
  // (a frame inside the page asking for a page is not this page leaving).
  function leaving() {
    flush();
    post({type: 'leaving'});
  }
  window.addEventListener('beforeunload', leaving);
  window.addEventListener('pagehide', leaving);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  var context = {};
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.__nullbot !== 1) return;
    if (data.type === 'context' && data.context && typeof data.context === 'object') {
      for (var key in data.context) context[key] = data.context[key];
      if (context.theme) document.documentElement.setAttribute('data-nullbot-theme', context.theme);
      try {
        window.dispatchEvent(new CustomEvent('nullbot:context', {detail: context}));
      } catch (e) {
        // Old engines without CustomEvent.
      }
    } else if (data.type === 'flush') {
      flush();
      post({type: 'flushed', id: data.id});
    }
  });

  window.nullbot = {
    __bridge: true,
    /** What the window was opened with: title, prompt, theme. */
    context: context,
    /** Log something worth knowing: a score, a step finished, a choice. */
    record: function (name, data) { record('custom', {name: clip(name, 120), data: safe(data)}); },
    /** Set what is sent when the person presses Send. */
    setResponse: function (data) { post({type: 'response', data: safe(data)}); },
    /** Set the response and ask the person to send it. */
    submit: function (data) {
      flush();
      post({type: 'submit', data: safe(data)});
    },
  };

  function loaded() {
    record('load', {title: clip(document.title, 200)});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loaded);
  else loaded();
  post({type: 'ready'});
})();
