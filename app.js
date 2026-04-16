// Looking Glass — Ad Preview Tool
// Built on top of playable-preview by hyungseokchoi-moloco

(function () {

  // ─── Tag type state ────────────────────────────────────────────────────────
  let tagType = 'playable'; // 'playable' | 'js' | 'vast'

  const snippetLabel     = document.getElementById('snippetLabel');
  const playableControls = document.getElementById('playableControls');

  const TYPE_META = {
    playable: { label: 'Playable snippet', placeholder: 'Paste your playable JS snippet here...' },
    js:       { label: 'JS ad tag',        placeholder: 'Paste your JS ad tag here...' },
    vast:     { label: 'VAST tag',         placeholder: 'Paste a VAST XML string, or a VAST URL starting with https://...' },
  };

  function setTagType(type) {
    tagType = type;
    document.querySelectorAll('.tag-type-selector .toggle').forEach(b =>
      b.classList.toggle('active', b.dataset.type === type)
    );
    snippetLabel.textContent       = TYPE_META[type].label;
    snippetInput.placeholder       = TYPE_META[type].placeholder;
    playableControls.style.display = type === 'playable' ? '' : 'none';
  }

  document.querySelectorAll('.tag-type-selector .toggle').forEach(btn => {
    btn.addEventListener('click', () => setTagType(btn.dataset.type));
  });

  // ─── Macro maps ────────────────────────────────────────────────────────────

  // Playable-specific macros (resolved to test tracker URLs)
  const EVENT_BASE_URL = 'https://test.url/';
  function eventUrl(name) { return encodeURIComponent(EVENT_BASE_URL + name); }

  const PLAYABLE_MACRO_MAP = {
    '#IMP_TRACE_MRAID_VIEWABLE_ESC#':  eventUrl('MRAID_VIEWABLE'),
    '#IMP_TRACE_GAME_VIEWABLE_ESC#':   eventUrl('GAME_VIEWABLE'),
    '#PLAYABLE_TAPS_FOR_ENGAGEMENT#':  '1',
    '#PLAYABLE_ENGAGEMENT_ESC#':       eventUrl('ENGAGEMENT'),
    '#PLAYABLE_TAPS_FOR_REDIRECTION#': '0',
    '#PLAYABLE_REDIRECTION_ESC#':      eventUrl('REDIRECTION'),
    '#IMP_TRACE_COMPLETE_ESC#':        eventUrl('COMPLETE'),
    '#CLICK_TEMPLATE_ESC#':            eventUrl('CLICK'),
    '#FINAL_LANDING_URL_ESC#':         eventUrl('FINAL_LANDING'),
    '#START_MUTED#':                   'true',
    '#DRAW_CUSTOM_CLOSE_BUTTON#':      'false',
    '#CACHEBUSTER#':                   '',
    '#IMP_TRACE_EVENT_PREFIX#':        EVENT_BASE_URL,
  };

  // Build the full macro map at preview time, reading override inputs
  function buildMacroMap() {
    const bundle   = document.getElementById('ovBundle').value   || 'com.example.testapp';
    const appname  = document.getElementById('ovAppname').value  || 'Test App';
    const deviceid = document.getElementById('ovDeviceid').value || '00000000-0000-0000-0000-000000000000';
    const clickUrl = document.getElementById('ovClickUrl').value || 'https://example.com';
    const width    = document.getElementById('ovWidth').value    || '320';
    const height   = document.getElementById('ovHeight').value   || '480';

    // These change every render, like in production
    const cachebuster = String(Math.floor(Math.random() * 1e9));
    const mtid        = 'test-mtid-' + Math.random().toString(36).slice(2, 10);

    return {
      ...PLAYABLE_MACRO_MAP,
      // ── {{curly}} format — used in VAST and many JS tags ──
      '{{mtid}}':             mtid,
      '{{bundle}}':           bundle,
      '{{appname}}':          appname,
      '{{deviceid}}':         deviceid,
      '{{cachebuster}}':      cachebuster,
      '{{width}}':            width,
      '{{height}}':           height,
      // partner macros (Celtra, Flashtalking, etc.)
      '{{device.idfa}}':      deviceid,
      '{{device.gaid}}':      deviceid,
      '{{campaign.id}}':      'test-campaign-id',
      '{{creative.id}}':      'test-creative-id',
      '{{creative.type}}':    'playable',
      '{{publisher.name}}':   appname,
      '{{publisher.bundle}}': bundle,
      // ── #HASH# format — JS tag macros ──
      '#CLICK_URL_ESC#':  encodeURIComponent(clickUrl),
      '#IMPRESSION_URL#': EVENT_BASE_URL + 'impression',
      '#CACHEBUSTER#':    cachebuster,
    };
  }

  // Replace all #MACRO# and {{macro}} tokens in a string
  function applyMacros(input, macroMap) {
    if (!input) return '';
    let result = input.replace(/#[A-Z0-9_]+#/g, token =>
      Object.prototype.hasOwnProperty.call(macroMap, token) ? macroMap[token] : token
    );
    result = result.replace(/\{\{[^}]+\}\}/g, token =>
      Object.prototype.hasOwnProperty.call(macroMap, token) ? macroMap[token] : token
    );
    return result;
  }

  // After substitution, find tokens that still look like macros (no test value for them)
  function findUnresolvedMacros(text) {
    const found = new Set();
    (text.match(/#[A-Z0-9_]+#/g)  || []).forEach(t => found.add(t));
    (text.match(/\{\{[^}]+\}\}/g) || []).forEach(t => found.add(t));
    return Array.from(found);
  }

  // ─── Playable-specific validation ─────────────────────────────────────────
  function runPlayableValidations(rawText) {
    const results = [];

    const missing = Object.keys(PLAYABLE_MACRO_MAP).filter(k => !rawText.includes(k));
    results.push(missing.length > 0
      ? { ok: false, msg: 'Missing macros: ' + missing.join(', ') }
      : { ok: true,  msg: 'All required playable macros present' }
    );

    if (/<script[^>]*src\s*=\s*["']\s*payload\.js(?:[?#][^"']*)?["'][^>]*>/i.test(rawText)) {
      results.push({ ok: false, msg: 'Relative payload.js detected — use a fully hosted URL.' });
    } else {
      results.push({ ok: true, msg: 'No relative payload.js' });
    }

    results.push(rawText.includes('%{IMP_BEACON}')
      ? { ok: true,  msg: 'IMP_BEACON present' }
      : { ok: false, msg: 'IMP_BEACON missing' }
    );

    results.push(/<script[^>]*src\s*=\s*["'][^"']*mraid\.js[^"']*["'][^>]*>\s*<\/script>/i.test(rawText)
      ? { ok: true,  msg: 'mraid.js present' }
      : { ok: false, msg: 'mraid.js missing' }
    );

    return results;
  }

  // ─── HTML builders ─────────────────────────────────────────────────────────

  // Playable + JS mode: inject the tag into an instrumented iframe document.
  // If the content is already a full HTML document (BRG ADM), inject scripts
  // directly rather than wrapping with document.write (which breaks WebGL).
  function buildJsPreviewHtml(userHtml, macroMap) {
    const withMacros = applyMacros(userHtml || '', macroMap);
    let sanitized = withMacros
      .replace(/<script[^>]*src\s*=\s*["']([^"']*mraid\.js[^"']*)["'][^>]*>\s*<\/script>/ig, '')
      .replace(/%\{IMP_BEACON\}/g, '');

    const isFullDoc = /^\s*<!doctype\s/i.test(sanitized) || /^\s*<html[\s>]/i.test(sanitized);

    if (isFullDoc) {
      // Inject instrumentation + mraid stub into the <head> of the existing document
      const injection =
        '<script src="../injected/instrumentation.js"></script>' +
        '<script src="../injected/mraid-stub.js"></script>';
      // Prefer injecting right after <head>, fall back to before </head>
      if (/<head>/i.test(sanitized)) {
        return sanitized.replace(/<head>/i, '<head>' + injection);
      } else if (/<\/head>/i.test(sanitized)) {
        return sanitized.replace(/<\/head>/i, injection + '</head>');
      }
      return sanitized;
    }

    const b64 = btoa(unescape(encodeURIComponent(sanitized)));

    return '<!doctype html><html><head>' +
      '<meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<meta name="referrer" content="no-referrer" />' +
      '<title>Preview</title>' +
      '<style>html,body{margin:0;padding:0;height:100%}:root,html,body{width:100%;height:100%;overflow:hidden}*,*::before,*::after{box-sizing:border-box}</style>' +
      '</head><body>' +
      '<script src="injected/instrumentation.js"></script>' +
      '<script src="injected/mraid-stub.js"></script>' +
      '<script>(function(){var d=decodeURIComponent(escape(atob("' + b64 + '")));document.write(d);})();</script>' +
      '</body></html>';
  }

  // VAST mode: parse VAST XML and show a video player with tracker logging
  function buildVastPreviewHtml(vastInput) {
    const isUrl   = /^https?:\/\//i.test(vastInput.trim());
    const encoded = JSON.stringify(vastInput.trim());

    return '<!doctype html><html><head>' +
      '<meta charset="utf-8">' +
      '<style>' +
        'html,body{margin:0;padding:0;width:100%;height:100%;background:#000;' +
          'display:flex;align-items:center;justify-content:center;flex-direction:column}' +
        'video{max-width:100%;max-height:90%}' +
        '#status{color:#aaa;font-family:monospace;font-size:11px;text-align:center;' +
          'padding:12px;white-space:pre-wrap;word-break:break-all}' +
      '</style></head><body>' +
      '<script src="injected/instrumentation.js"></script>' +
      '<div id="status">Parsing VAST...</div>' +
      '<script>(async function(){' +
        'var input=' + encoded + ';' +
        'var isUrl=' + isUrl + ';' +
        'var status=document.getElementById("status");' +
        'try{' +
          'var xml;' +
          'if(isUrl){var res=await fetch(input);xml=await res.text();}' +
          'else{xml=input;}' +
          'var doc=(new DOMParser()).parseFromString(xml,"text/xml");' +
          // Prefer H.264 (avc) over H.265 (hvc/hevc/h265) — Chrome doesn\'t support H.265.
          'var allMediaFiles=Array.from(doc.querySelectorAll("MediaFile"));' +
          'var h264=allMediaFiles.filter(function(m){var u=(m.textContent||"").toLowerCase();return !u.includes("h265")&&!u.includes("hevc")&&!u.includes("hvc");});' +
          'var mediaEl=(h264.length?h264:allMediaFiles)[0]||null;' +
          'var videoUrl=mediaEl?mediaEl.textContent.trim():null;' +
          'if(videoUrl&&videoUrl.startsWith("<![CDATA[")){videoUrl=videoUrl.replace(/^<!\\[CDATA\\[/,"").replace(/\\]\\]>$/,"").trim();}' +
          'if(!videoUrl){status.textContent="No MediaFile found in VAST.";return;}' +
          'var impressions=Array.from(doc.querySelectorAll("Impression"))' +
            '.map(function(el){return el.textContent.trim();}).filter(Boolean);' +
          'var trackings={};' +
          'doc.querySelectorAll("Tracking").forEach(function(el){' +
            'var ev=el.getAttribute("event"),url=el.textContent.trim();' +
            'if(!trackings[ev])trackings[ev]=[];if(url)trackings[ev].push(url);' +
          '});' +
          'parent.postMessage({__preview__:true,type:"info",' +
            'message:"VAST parsed — MediaFile: "+videoUrl},\'*\');' +
          'parent.postMessage({__preview__:true,type:"info",' +
            'message:"Trackers: impressions="+impressions.length+", events="+JSON.stringify(Object.keys(trackings))},\'*\');' +
          'status.style.display="none";' +
          'var v=document.createElement("video");' +
          'v.src=videoUrl;v.controls=true;v.autoplay=true;v.muted=true;' +
          'v.style.cssText="max-width:100%;max-height:90%;";' +
          'document.body.appendChild(v);' +
          'v.addEventListener("error",function(){' +
            'var msg="Video failed to load";' +
            'if(videoUrl.toLowerCase().includes("h265")||videoUrl.toLowerCase().includes("hevc")){msg="H.265/HEVC codec not supported in this browser — BRG returned an H.265 file. Try a different exchange or use Safari.";}' +
            'status.style.cssText="display:block;color:#ff9f0a;font-family:monospace;font-size:11px;padding:12px;text-align:center";' +
            'status.textContent=msg;' +
            'parent.postMessage({__preview__:true,type:"error",message:msg},"*");' +
          '});' +
          'v.addEventListener("play",async function(){' +
            'for(var u of impressions){try{await fetch(u,{mode:"no-cors"});}catch(e){}}' +
            'for(var u of(trackings.start||[])){try{await fetch(u,{mode:"no-cors"});}catch(e){}}' +
          '},{once:true});' +
          'v.addEventListener("ended",async function(){' +
            'for(var u of(trackings.complete||[])){try{await fetch(u,{mode:"no-cors"});}catch(e){}}' +
          '});' +
        '}catch(e){' +
          'status.textContent="VAST error: "+e.message;' +
          'parent.postMessage({__preview__:true,type:"error",message:"VAST error: "+e.message},\'*\');' +
        '}' +
      '})();</script>' +
      '</body></html>';
  }

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const snippetInput        = document.getElementById('snippetInput');
  const engagementTapsInput = document.getElementById('engagementTapsInput');
  const redirectionTapsInput = document.getElementById('redirectionTapsInput');
  const previewBtn          = document.getElementById('previewBtn');
  const clearAllBtn         = document.getElementById('clearAllBtn');
  const btnPortrait         = document.getElementById('btnPortrait');
  const btnLandscape        = document.getElementById('btnLandscape');
  const deviceWrap          = document.getElementById('deviceWrap');
  const previewFrame        = document.getElementById('previewFrame');
  const deviceBezel         = deviceWrap ? deviceWrap.querySelector('.device-bezel') : null;
  const logList             = document.getElementById('logList');
  const deviceSizeLabel     = document.getElementById('deviceSize');
  const exportLogBtn        = document.getElementById('exportLogBtn');

  // ─── Log ───────────────────────────────────────────────────────────────────
  const logs = [];
  let activeTab = 'all';

  const MAX_MSG_CHARS = 500;

  function makeLogEntry(l) {
    const div = document.createElement('div');
    div.className = 'log-entry ' + l.type;
    if (l.extraClass) div.classList.add(l.extraClass);

    let msgStr = typeof l.message === 'string' ? l.message : safeStringify(l.message);
    if (l.type === 'event' && msgStr.startsWith('unescaped')) div.classList.add('unescaped');
    if (l.type === 'event' && msgStr.startsWith('empty-url')) div.classList.add('empty-url');

    // Truncate giant strings (e.g. base64 asset bundles logged by playable SDKs)
    if (msgStr.length > MAX_MSG_CHARS) {
      const kb = (msgStr.length / 1024).toFixed(1);
      msgStr = msgStr.slice(0, MAX_MSG_CHARS) + ` … [truncated ${kb} kB]`;
    }

    const timeEl = document.createElement('span');
    timeEl.className   = 'time';
    timeEl.textContent = '[' + new Date(l.time).toLocaleTimeString() + ']';

    const content = document.createElement('span');
    content.textContent = l.type.toUpperCase() + ' ' + msgStr;

    div.appendChild(timeEl);
    div.appendChild(content);
    return div;
  }

  function addLog(type, message, extraClass) {
    const entry = { type, time: Date.now(), message, extraClass };
    logs.push(entry);
    // Append incrementally — only rebuild if the tab filter would hide this entry
    if (activeTab === 'all' || type === activeTab) {
      logList.appendChild(makeLogEntry(entry));
      logList.scrollTop = logList.scrollHeight;
    }
  }

  function renderLogs() {
    const frag = document.createDocumentFragment();
    const filtered = logs.filter(l => activeTab === 'all' || l.type === activeTab);
    for (const l of filtered) frag.appendChild(makeLogEntry(l));
    logList.innerHTML = '';
    logList.appendChild(frag);
    logList.scrollTop = logList.scrollHeight;
  }

  function safeStringify(value) {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value, (k, v) => {
        if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
        return v;
      });
    } catch (e) { return String(value); }
  }

  document.querySelectorAll('.tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab || 'all';
      renderLogs();
    });
  });

  // ─── Export log ────────────────────────────────────────────────────────────
  exportLogBtn?.addEventListener('click', () => {
    if (logs.length === 0) { alert('No log entries to export.'); return; }
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'looking-glass-log-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ─── Preview ───────────────────────────────────────────────────────────────
  // Set to true before programmatic clicks from the BRG fetch flow so that
  // macro-presence validation is skipped (BRG already resolved all macros).
  let _skipValidation = false;

  previewBtn?.addEventListener('click', () => {
    logs.length = 0;
    renderLogs();

    const userInput = snippetInput.value || '';
    if (!userInput.trim()) {
      addLog('error', 'Nothing to preview — paste an ad tag first.');
      return;
    }

    const macroMap = buildMacroMap();

    // Apply playable tap counts from inputs
    macroMap['#PLAYABLE_TAPS_FOR_ENGAGEMENT#']  = String(Math.max(0, Math.min(9,
      parseInt(engagementTapsInput?.value  || '1', 10) || 0)));
    macroMap['#PLAYABLE_TAPS_FOR_REDIRECTION#'] = String(Math.max(0, Math.min(9,
      parseInt(redirectionTapsInput?.value || '0', 10) || 0)));

    if (tagType === 'playable' && !_skipValidation) {
      const validations = runPlayableValidations(userInput);
      let allOk = true;
      for (const v of validations) {
        addLog('info', v.msg, v.ok ? 'success' : 'error');
        if (!v.ok) allOk = false;
      }
      if (!allOk) {
        try { previewFrame.srcdoc = '<!doctype html><title>Validation failed</title>'; } catch (e) {}
        requestAnimationFrame(fitPreviewToContainer);
        return;
      }
    }

    // Warn about any macros with no test value (skip for BRG-resolved tags)
    if (tagType !== 'vast' && !_skipValidation) {
      const resolved   = applyMacros(userInput, macroMap);
      const unresolved = findUnresolvedMacros(resolved);
      if (unresolved.length > 0) {
        addLog('info', 'Unresolved macros (no test value): ' + unresolved.join(', '), 'error');
      }
    }

    const html = tagType === 'vast'
      ? buildVastPreviewHtml(userInput)
      : buildJsPreviewHtml(userInput, macroMap);

    try {
      previewFrame.srcdoc = html;
    } catch (e) {
      previewFrame.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    }
    requestAnimationFrame(fitPreviewToContainer);
  });

  // ─── Clear ─────────────────────────────────────────────────────────────────
  clearAllBtn?.addEventListener('click', () => {
    snippetInput.value = '';
    if (engagementTapsInput)  engagementTapsInput.value  = '1';
    if (redirectionTapsInput) redirectionTapsInput.value = '0';
    logs.length = 0;
    renderLogs();
    try { previewFrame.srcdoc = '<!doctype html><title>Cleared</title>'; } catch (e) { previewFrame.src = 'about:blank'; }
    requestAnimationFrame(fitPreviewToContainer);
  });

  // ─── Orientation ───────────────────────────────────────────────────────────
  function setOrientation(mode) {
    deviceWrap.classList.toggle('portrait',  mode === 'portrait');
    deviceWrap.classList.toggle('landscape', mode === 'landscape');
    btnPortrait.classList.toggle('active',   mode === 'portrait');
    btnLandscape.classList.toggle('active',  mode === 'landscape');
    fitPreviewToContainer();
  }
  btnPortrait?.addEventListener('click',  () => setOrientation('portrait'));
  btnLandscape?.addEventListener('click', () => setOrientation('landscape'));

  // ─── Fit preview to container ──────────────────────────────────────────────
  function measureBezelNaturalSize() {
    if (!deviceBezel) return { w: 360, h: 640 };
    const prev = deviceBezel.style.transform;
    deviceBezel.style.transform = 'scale(1)';
    const w = deviceBezel.offsetWidth;
    const h = deviceBezel.offsetHeight;
    deviceBezel.style.transform = prev;
    return { w, h };
  }

  function fitPreviewToContainer() {
    if (!deviceWrap || !deviceBezel) return;
    const { w, h } = measureBezelNaturalSize();
    const availW   = deviceWrap.clientWidth;
    const availH   = deviceWrap.clientHeight;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / w, availH / h, 1);
    deviceBezel.style.transformOrigin = 'center center';
    deviceBezel.style.transform       = `scale(${scale})`;
    updateDeviceSizeLabel();
  }

  function updateDeviceSizeLabel() {
    try {
      if (deviceSizeLabel) deviceSizeLabel.textContent =
        `${previewFrame.offsetWidth} x ${previewFrame.offsetHeight}`;
    } catch (_) {}
  }

  // ─── Messages from iframe ──────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || !d.__preview__) return;
    addLog(d.type || 'info', d.message);
  });

  // ─── CID Lookup DOM refs ───────────────────────────────────────────────────
  const apiKeyInput      = document.getElementById('apiKeyInput');
  const platformIdInput  = document.getElementById('platformIdInput');
  const cidInput         = document.getElementById('cidInput');
  const brgToggle        = document.getElementById('brgToggle');
  const brgSelects       = document.getElementById('brgSelects');
  const brgExchange      = document.getElementById('brgExchange');
  const brgDeviceOs      = document.getElementById('brgDeviceOs');
  const fetchPreviewBtn  = document.getElementById('fetchPreviewBtn');

  // Restore saved API key
  const savedKey = localStorage.getItem('lg_api_key');
  if (savedKey && apiKeyInput) apiKeyInput.value = savedKey;

  // Show/hide BRG selects based on toggle
  brgToggle?.addEventListener('change', () => {
    if (brgSelects) brgSelects.style.display = brgToggle.checked ? '' : 'none';
  });

  // ─── Base URLs (proxy-aware for local dev) ────────────────────────────────
  const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const API_BASE = IS_LOCAL ? '/api' : 'https://api.moloco.cloud';
  const BRG_URL  = IS_LOCAL
    ? '/brg/appbase.bidresponse.v1.BidResponse/GenerateBidResponse'
    : 'https://cfe-gateway-rp76syjtkq-uc.a.run.app/appbase.bidresponse.v1.BidResponse/GenerateBidResponse';

  // ─── Auth token (cached per session) ──────────────────────────────────────
  let _cachedToken = null;

  async function getAuthToken(apiKey) {
    if (_cachedToken) return _cachedToken;
    const res = await fetch(`${API_BASE}/cm/v1/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Auth failed (${res.status}): ${txt}`);
    }
    const data = await res.json();
    _cachedToken = data.token;
    return _cachedToken;
  }

  // ─── Creative lookup ───────────────────────────────────────────────────────
  async function fetchCreative(token, creativeId) {
    const res = await fetch(`${API_BASE}/cm/v1/creatives/${encodeURIComponent(creativeId)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Creative lookup failed (${res.status}): ${txt}`);
    }
    return res.json();
  }

  // ─── Proto / grpc-web helpers ──────────────────────────────────────────────

  function encodeVarint(n) {
    const bytes = [];
    while (n > 0x7F) {
      bytes.push((n & 0x7F) | 0x80);
      n >>>= 7;
    }
    bytes.push(n & 0x7F);
    return new Uint8Array(bytes);
  }

  // Returns [varint(bytes.length), ...bytes]
  function lenDelim(bytes) {
    const lv = encodeVarint(bytes.length);
    const out = new Uint8Array(lv.length + bytes.length);
    out.set(lv); out.set(bytes, lv.length);
    return out;
  }

  // Returns the varint-encoded proto field tag
  function protoTag(fieldNum, wireType) {
    return encodeVarint((fieldNum << 3) | wireType);
  }

  function concatUint8Arrays(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }

  // Encode GenerateBidResponseRequest and wrap in grpc-web frame
  function encodeGrpcWebRequest(exchangeType, deviceOsType, creativeFormat, platformId, creativeId) {
    const enc = new TextEncoder();
    const parts = [];

    if (exchangeType) { parts.push(protoTag(1, 0)); parts.push(encodeVarint(exchangeType)); }
    if (deviceOsType) { parts.push(protoTag(2, 0)); parts.push(encodeVarint(deviceOsType)); }
    if (creativeFormat){ parts.push(protoTag(3, 0)); parts.push(encodeVarint(creativeFormat)); }
    if (platformId)   { const b = enc.encode(platformId);  parts.push(protoTag(4, 2)); parts.push(lenDelim(b)); }
    if (creativeId)   { const b = enc.encode(creativeId);  parts.push(protoTag(5, 2)); parts.push(lenDelim(b)); }

    const msg   = concatUint8Arrays(parts);
    const frame = new Uint8Array(5 + msg.length);
    frame[0]    = 0; // no compression
    new DataView(frame.buffer).setUint32(1, msg.length, false); // big-endian length
    frame.set(msg, 5);
    return frame;
  }

  // Decode GenerateBidResponseResponse (field 1 = json_str)
  function decodeProtoJsonStr(bytes) {
    let pos = 0;
    while (pos < bytes.length) {
      let tag = 0, shift = 0;
      while (pos < bytes.length) {
        const b = bytes[pos++];
        tag |= (b & 0x7F) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x7;
      if (wireType === 2) {
        let len = 0; shift = 0;
        while (pos < bytes.length) {
          const b = bytes[pos++];
          len |= (b & 0x7F) << shift;
          if (!(b & 0x80)) break;
          shift += 7;
        }
        const fieldBytes = bytes.slice(pos, pos + len);
        pos += len;
        if (fieldNum === 1) return new TextDecoder().decode(fieldBytes);
      } else if (wireType === 0) {
        while (pos < bytes.length && (bytes[pos++] & 0x80));
      } else if (wireType === 5) { pos += 4; }
        else if (wireType === 1) { pos += 8; }
        else break;
    }
    return null;
  }

  // ─── BRG call ──────────────────────────────────────────────────────────────

  async function callBRG(token, exchangeType, deviceOsType, creativeFormat, platformId, creativeId) {
    const body = encodeGrpcWebRequest(exchangeType, deviceOsType, creativeFormat, platformId, creativeId);
    const res = await fetch(BRG_URL, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/grpc-web+proto',
        'Authorization':    `Bearer ${token}`,
        'Moloco-Bff-Auth':  'morse',
        'Moloco-Bff-Name':  'prod_appbase_go',
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`BRG call failed (${res.status}): ${txt}`);
    }
    const buf  = await res.arrayBuffer();
    const view = new DataView(buf);
    let pos    = 0;
    while (pos + 5 <= buf.byteLength) {
      const flag = view.getUint8(pos);
      const len  = view.getUint32(pos + 1, false);
      pos += 5;
      if (flag & 0x80) { pos += len; continue; } // trailer
      const jsonStr = decodeProtoJsonStr(new Uint8Array(buf, pos, len));
      pos += len;
      if (jsonStr) return jsonStr;
    }
    throw new Error('No data frame in BRG response');
  }

  // Synthesise a minimal VAST wrapper around a direct MP4 URL.
  // Used when the creative has no VAST XML, or when BRG returns H.265-only.
  function synthesizeVast(videoUrl) {
    return `<VAST version="2.0"><Ad><InLine><AdSystem>LookingGlass</AdSystem>` +
      `<AdTitle>Direct Preview</AdTitle><Creatives><Creative><Linear>` +
      `<Duration>00:01:00</Duration><MediaFiles>` +
      `<MediaFile type="video/mp4" delivery="progressive"><![CDATA[${videoUrl}]]></MediaFile>` +
      `</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  }

  // ─── Fetch & Preview handler ───────────────────────────────────────────────
  fetchPreviewBtn?.addEventListener('click', async () => {
    const apiKey     = apiKeyInput?.value.trim()    || '';
    const platformId = platformIdInput?.value.trim() || '';
    const cid        = cidInput?.value.trim()        || '';

    if (!apiKey) { addLog('error', 'Enter your Moloco API key.'); return; }
    if (!cid)    { addLog('error', 'Enter a Creative ID.');       return; }

    fetchPreviewBtn.disabled    = true;
    fetchPreviewBtn.textContent = 'Fetching...';
    logs.length = 0; renderLogs();

    try {
      // Persist API key
      localStorage.setItem('lg_api_key', apiKey);
      _cachedToken = null; // force re-auth in case key changed

      // 1. Auth
      addLog('info', 'Authenticating...');
      const token = await getAuthToken(apiKey);
      addLog('info', 'Auth token obtained.', 'success');

      // 2. Creative lookup
      addLog('info', `Fetching creative: ${cid}`);
      const envelope = await fetchCreative(token, cid);
      const creative = envelope.creative || envelope;
      const cType    = creative.type || 'UNKNOWN';
      addLog('info', `Creative type: ${cType}`, 'success');

      // Resolve platform ID: manual override > extracted from creative response (uppercased for BRG)
      const rawPlatformId = creative.ad_account_id || creative.platform_id || creative.account_id || '';
      const resolvedPlatformId = platformId || rawPlatformId.toUpperCase();
      if (!platformId && resolvedPlatformId) {
        addLog('info', `Platform ID auto-detected: ${resolvedPlatformId}`, 'success');
        if (platformIdInput) platformIdInput.value = resolvedPlatformId;
      }

      // 3. Map creative type → tag mode
      let rawTag    = '';
      let detectedType = 'js';
      let brgFormat = null; // 1=VIDEO, 2=PLAYABLE

      if (cType === 'RICH_CUSTOM_HTML') {
        detectedType = 'playable';
        brgFormat    = 2;
        rawTag       = creative.rich_custom_html?.entry_html || '';
      } else if (cType === 'VIDEO') {
        detectedType = 'vast';
        brgFormat    = 1;
        rawTag       = creative.video?.vast_url || creative.video?.vast_xml || '';
        // Fallback: if no VAST is stored in the creative, synthesise a minimal one from
        // the direct video_url (H.264 original) so the VAST player has something to show.
        if (!rawTag && creative.video?.video_url) {
          rawTag = synthesizeVast(creative.video.video_url);
          addLog('info', 'No VAST on creative — synthesised from video_url for preview.');
        }
      } else {
        addLog('info', `Type ${cType} — BRG not supported. Showing raw creative JSON.`);
        rawTag = JSON.stringify(creative, null, 2);
      }

      // Switch tag-type UI
      setTagType(detectedType);

      // 4. BRG resolution
      const useBrg = brgToggle?.checked && brgFormat !== null && resolvedPlatformId;
      // For VIDEO creatives the VAST has no #MACRO# tokens — they live in the playable endcard.
      // Scan the endcard HTML too so the macro report is meaningful.
      const endcardHtml = cType === 'VIDEO' ? (creative.video?.playable_endcard?.entry_html || '') : '';
      const originalMacros = [...new Set([
        ...findUnresolvedMacros(rawTag),
        ...findUnresolvedMacros(endcardHtml)
      ])];
      let brgResolved = false;

      if (useBrg) {
        const exchVal = parseInt(brgExchange?.value || '1', 10);
        const osVal   = parseInt(brgDeviceOs?.value || '1', 10);
        addLog('info', `Calling BRG (exchange=${exchVal}, os=${osVal}, format=${brgFormat})...`);
        try {
          const brgJsonStr = await callBRG(token, exchVal, osVal, brgFormat, resolvedPlatformId, cid);
          const brgJson    = JSON.parse(brgJsonStr);
          const adm        = brgJson?.seatbid?.[0]?.bid?.[0]?.adm;
          if (adm) {
            rawTag = adm;
            brgResolved = true;
            // For VIDEO: warn if BRG only returned H.265 (unsupported in Chrome)
            if (cType === 'VIDEO' && /h265|hevc|hvc/i.test(adm) && !/h264|avc/i.test(adm)) {
              const fallbackUrl = creative.video?.video_url;
              if (fallbackUrl) {
                addLog('info', 'BRG VAST contains only H.265 (unsupported in Chrome) — falling back to direct video_url.', 'error');
                rawTag = synthesizeVast(fallbackUrl);
              } else {
                addLog('info', 'BRG VAST contains only H.265 — may not play in Chrome.', 'error');
              }
            }
            addLog('info', 'BRG ADM extracted — macros resolved by production ADM system.', 'success');
          } else {
            addLog('info', 'BRG response contained no ADM — using raw creative tag.', 'error');
          }
        } catch (brgErr) {
          const isCors = brgErr.message.includes('Failed to fetch') || brgErr.message.includes('NetworkError');
          addLog('info',
            isCors
              ? `BRG blocked by CORS (only works from portal.moloco.cloud) — using raw creative tag.`
              : `BRG error: ${brgErr.message} — using raw creative tag.`,
            'error');
        }
      } else if (brgFormat !== null && !resolvedPlatformId) {
        addLog('info', 'Platform ID not found — skipping BRG. Add it manually if needed.');
      }

      // 5. Fill & preview
      snippetInput.value = rawTag;
      _skipValidation = true;
      previewBtn?.click();
      _skipValidation = false;

      // 6. Macro resolution report
      // In BRG mode: check what BRG left unresolved in the ADM.
      // In test-value mode: simulate applyMacros first, then check what has no test value.
      const trulyUnresolved = brgResolved
        ? findUnresolvedMacros(rawTag)
        : findUnresolvedMacros(applyMacros(rawTag, buildMacroMap()));

      addLog('info', '─────────────────────────────');
      if (trulyUnresolved.length === 0) {
        const how = brgResolved ? 'resolved by BRG' : 'resolved with test values';
        addLog('info', `✓ Creative OK — ${originalMacros.length} macro(s) ${how}`, 'success');
        originalMacros.forEach(m => addLog('info', `  · ${m}`));
      } else {
        addLog('info', `⚠ ${trulyUnresolved.length} macro(s) have no value — creative may misbehave`, 'error');
        trulyUnresolved.forEach(m => addLog('info', `  · ${m}`, 'error'));
        const resolved = originalMacros.filter(m => !trulyUnresolved.includes(m));
        if (resolved.length > 0) {
          addLog('info', `${resolved.length} resolved:`);
          resolved.forEach(m => addLog('info', `  · ${m}`));
        }
      }

    } catch (err) {
      addLog('error', 'Lookup failed: ' + err.message);
    } finally {
      fetchPreviewBtn.disabled    = false;
      fetchPreviewBtn.textContent = 'Fetch & Preview';
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────────
  setOrientation('portrait');
  requestAnimationFrame(fitPreviewToContainer);
  window.addEventListener('resize', fitPreviewToContainer);

})();
