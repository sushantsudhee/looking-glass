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

  document.querySelectorAll('.tag-type-selector .toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tag-type-selector .toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tagType = btn.dataset.type;
      snippetLabel.textContent         = TYPE_META[tagType].label;
      snippetInput.placeholder         = TYPE_META[tagType].placeholder;
      playableControls.style.display   = tagType === 'playable' ? '' : 'none';
    });
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
    const mtid        = 'test-mtid-' + Math.random().toString(36).substr(2, 8);

    return Object.assign({}, PLAYABLE_MACRO_MAP, {
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
    });
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

  // Playable + JS mode: inject the tag into an instrumented iframe document
  function buildJsPreviewHtml(userHtml, macroMap) {
    const withMacros = applyMacros(userHtml || '', macroMap);
    let sanitized = withMacros
      .replace(/<script[^>]*src\s*=\s*["']([^"']*mraid\.js[^"']*)["'][^>]*>\s*<\/script>/ig, '')
      .replace(/%\{IMP_BEACON\}/g, '');

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
          'var mediaEl=doc.querySelector("MediaFile");' +
          'var videoUrl=mediaEl?mediaEl.textContent.trim():null;' +
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
          'status.remove();' +
          'var v=document.createElement("video");' +
          'v.src=videoUrl;v.controls=true;v.autoplay=true;v.muted=true;' +
          'v.style.cssText="max-width:100%;max-height:90%;";' +
          'document.body.appendChild(v);' +
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

  function addLog(type, message, extraClass) {
    logs.push({ type, time: Date.now(), message, extraClass });
    renderLogs();
  }

  function renderLogs() {
    const frag     = document.createDocumentFragment();
    const filtered = logs.filter(l => activeTab === 'all' || l.type === activeTab);
    for (const l of filtered) {
      const div = document.createElement('div');
      div.className = 'log-entry ' + l.type;
      if (l.extraClass) div.classList.add(l.extraClass);

      const msgStr = typeof l.message === 'string' ? l.message : safeStringify(l.message);
      if (l.type === 'event' && msgStr.startsWith('unescaped')) div.classList.add('unescaped');
      if (l.type === 'event' && msgStr.startsWith('empty-url')) div.classList.add('empty-url');

      const timeEl = document.createElement('span');
      timeEl.className   = 'time';
      timeEl.textContent = '[' + new Date(l.time).toLocaleTimeString() + ']';

      const content = document.createElement('span');
      content.textContent = l.type.toUpperCase() + ' ' + msgStr;

      div.appendChild(timeEl);
      div.appendChild(content);
      frag.appendChild(div);
    }
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

    if (tagType === 'playable') {
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

    // Warn about any macros with no test value
    if (tagType !== 'vast') {
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

  // ─── Init ──────────────────────────────────────────────────────────────────
  setOrientation('portrait');
  requestAnimationFrame(fitPreviewToContainer);
  window.addEventListener('resize', fitPreviewToContainer);

})();
