"use strict";
window.PUBLIC_DEMO = Object.freeze({
  allowBrowserStorageDemo() {
    const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
    const released = location.protocol === 'https:' && location.hostname === 'altakori.github.io'
      && location.pathname.startsWith('/lesionlens/');
    return document.body.dataset.demoMode === 'public-static' && (local || released);
  }
});
