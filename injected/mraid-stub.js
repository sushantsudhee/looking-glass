// Minimal MRAID stub for preview
(function () {
  function currentWidth() {
    return window.innerWidth || document.documentElement.clientWidth || 0;
  }
  function currentHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 0;
  }
  function currentSize() {
    return { width: currentWidth(), height: currentHeight() };
  }

  class Mraid {
    constructor() { }
    getState() { return 'default'; }
    getCurrentPosition() { const s = currentSize(); return { x: 0, y: 0, width: s.width, height: s.height }; }
    getMaxSize() { return currentSize(); }
    getScreenSize() { return currentSize(); }
    addEventListener() { }
    removeEventListener() { }
    isViewable() { return true; }
    setOrientationProperties() { return {}; }
    open(url) {
      try {
        const u = url || '';
        let msg;
        if (!u) {
          msg = 'empty-url mraid.open() called with empty/missing URL';
        } else {
          let isEncoded = false;
          try { isEncoded = decodeURIComponent(u) !== u; } catch (_) {}
          msg = (isEncoded ? 'unescaped ' : '') + 'CTA button clicked: ' + u;
        }
        parent.postMessage({ __preview__: true, type: 'event', message: msg }, '*');
      } catch (e) {
        console.error('Mraid.open error', e);
      }
      return true;
    }
    close() { }
    expand() { }
    useCustomClose(v) { }
    getPlacementType() { return 'inline'; }
    getVersion() { return '2.0'; }
  }
  window.mraid = new Mraid();
})();
