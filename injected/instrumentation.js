// Preview instrumentation: console, error, fetch, XHR
(function () {
  function post(type, message) {
    try {
      parent.postMessage({ __preview__: true, type, message }, '*');
    } catch (e) { /* ignore */ }
  }

  function normalizeUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input && input.url) return input.url;
      return String(input);
    } catch (e) {
      return String(input);
    }
  }

  function isLocalUrl(url) {
    try {
      const s = String(url);
      return s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('about:') || s.startsWith('chrome-extension:');
    } catch (e) {
      return false;
    }
  }

  // Event URL detection
  const EVENT_BASE = 'https://test.url/';
  const EVENT_BASE_ENC = encodeURIComponent(EVENT_BASE); // https%3A%2F%2Ftest.url%2F

  function postDetectedEvent(evt) {
    post('event', evt.kind === 'encoded' ? `unescaped ${evt.name} fired` : `${evt.name} fired`);
  }

  function detectEventUrl(u) {
    try {
      const s = String(u);
      if (s.includes(EVENT_BASE)) {
        const rest = s.slice(EVENT_BASE.length);
        const name = rest.split(/[?#]/)[0];
        return { kind: 'plain', name };
      }
      if (s.includes(EVENT_BASE_ENC)) {
        const decoded = decodeURIComponent(s);
        const rest = decoded.slice(EVENT_BASE.length);
        const name = rest.split(/[?#]/)[0];
        return { kind: 'encoded', name };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Console proxy
  ['log', 'warn', 'error', 'info', 'debug'].forEach((method) => {
    const original = console[method];
    console[method] = function () {
      try { post('console', Array.from(arguments)); } catch (e) { /* ignore */ }
      return original.apply(console, arguments);
    };
  });

  // Error handlers
  window.addEventListener('error', (ev) => {
    post('error', {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    post('error', { message: (r && r.message) ? r.message : String(r) });
  });

  // Fetch
  const originalFetch = window.fetch;
  window.fetch = function () {
    const url = normalizeUrl(arguments[0]);
    const evt = detectEventUrl(url);
    if (evt) {
      postDetectedEvent(evt);
    }
    return originalFetch.apply(window, arguments)
      .then((res) => {
        if (!isLocalUrl(url) && !evt) post('network', { url: String(url), status: res.status });
        return res;
      })
      .catch((err) => {
        if (!isLocalUrl(url) && !evt) post('network', { url: String(url), error: String(err) });
        throw err;
      });
  };

  // XHR
  const OrigXHR = XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OrigXHR();
    let _url = '';
    const open = xhr.open;
    xhr.open = function (method, url) { _url = url; return open.apply(xhr, arguments); };
    xhr.addEventListener('loadend', function () {
      if (isLocalUrl(_url)) return;
      const evt = detectEventUrl(_url);
      if (evt) {
        postDetectedEvent(evt);
        return;
      }
      post('network', { url: _url, status: xhr.status });
    });
    xhr.addEventListener('error', function () {
      if (isLocalUrl(_url)) return;
      const evt = detectEventUrl(_url);
      if (evt) {
        postDetectedEvent(evt);
        return;
      }
      post('network', { url: _url, error: 'xhr' });
    });
    return xhr;
  };

  // Image src tracking (dynamic img.src and setAttribute('src', ...))
  try {
    const loggedImgs = new WeakSet();
    function postImgResult(img, url, ok) {
      try {
        if (loggedImgs.has(img)) return;
        loggedImgs.add(img);
        const evt = detectEventUrl(url);
        if (evt) {
          postDetectedEvent(evt);
          return;
        }
        post('network', ok ? { url, status: 200 } : { url, error: 'image' });
      } catch (e) { /* ignore */ }
    }
    const proto = HTMLImageElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'src');
    if (desc && desc.set && desc.get) {
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { return desc.get.call(this); },
        set: function (url) {
          try {
            const u = String(url);
            if (!isLocalUrl(u)) {
              this.addEventListener('load', () => postImgResult(this, u, true), { once: true });
              this.addEventListener('error', () => postImgResult(this, u, false), { once: true });
            }
          } catch (e) { /* ignore */ }
          return desc.set.call(this, url);
        }
      });
    }
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name && String(name).toLowerCase() === 'src' && this instanceof HTMLImageElement) {
        try {
          const u = String(value);
          if (!isLocalUrl(u)) {
            this.addEventListener('load', () => postImgResult(this, u, true), { once: true });
            this.addEventListener('error', () => postImgResult(this, u, false), { once: true });
          }
        } catch (e) { /* ignore */ }
      }
      return origSetAttribute.call(this, name, value);
    };

    // Fallback: capture image load/error at document level (for cases where setter patch fails)
    document.addEventListener('load', function (ev) {
      const t = ev.target;
      if (t && t.tagName === 'IMG') {
        const url = t.currentSrc || t.src || '';
        if (!isLocalUrl(url)) postImgResult(t, url, true);
      }
    }, true);
    document.addEventListener('error', function (ev) {
      const t = ev.target;
      if (t && t.tagName === 'IMG') {
        const url = t.currentSrc || t.src || '';
        if (!isLocalUrl(url)) postImgResult(t, url, false);
      }
    }, true);
  } catch (e) { /* ignore */ }
})();
