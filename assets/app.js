(() => {
  // file:// 仍能使用普通页面和计算器，不尝试注册 PWA。
  if (!('serviceWorker' in navigator) || !window.isSecureContext
    || !['http:', 'https:'].includes(location.protocol)) return;

  const serviceWorkerUrl = new URL('../sw.js', document.currentScript.src);
  const CHECK_INTERVAL = 60_000;
  let registration = null;
  let lastCheck = 0;
  let checking = false;
  let updatingWorker = null;
  let reloading = false;
  let updateTimeout = null;
  let notice = null;
  let message = null;
  let button = null;

  function hideNotice() {
    if (notice) notice.hidden = true;
    document.body.classList.remove('has-pwa-update');
  }

  function showNotice(text = '发现新版本，点击更新。') {
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'pwa-update';
      notice.id = 'pwa-update';
      message = document.createElement('p');
      message.setAttribute('role', 'status');
      button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', applyUpdate);
      notice.append(message, button);
      document.body.append(notice);
      const reserveSpace = () => {
        document.documentElement.style.setProperty('--pwa-update-height', `${notice.offsetHeight}px`);
      };
      if ('ResizeObserver' in window) new ResizeObserver(reserveSpace).observe(notice);
    }
    message.textContent = text;
    button.textContent = updatingWorker ? '正在更新…' : '立即更新';
    button.disabled = Boolean(updatingWorker);
    notice.hidden = false;
    document.body.classList.add('has-pwa-update');
    document.documentElement.style.setProperty('--pwa-update-height', `${notice.offsetHeight}px`);
  }

  function syncWaiting() {
    if (updatingWorker) return;
    // 首次安装只有 installing/active，不把它当作新版本提示。
    if (registration?.waiting && registration.active) showNotice();
    else hideNotice();
  }

  function showVersion() {
    const label = document.querySelector('[data-app-version]');
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!label || !worker) return;
    const channel = new MessageChannel();
    const timeout = setTimeout(() => channel.port1.close(), 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (typeof event.data?.version === 'string') {
        label.textContent = `要你命3000 · ${event.data.version}`;
      }
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  }

  function reloadIfUpdated() {
    if (!updatingWorker || navigator.serviceWorker.controller !== updatingWorker || reloading) return false;
    reloading = true;
    clearTimeout(updateTimeout);
    location.reload();
    return true;
  }

  function updateFailed() {
    if (reloadIfUpdated()) return;
    clearTimeout(updateTimeout);
    updatingWorker = null;
    if (registration?.waiting) showNotice('更新未完成，请点击重试。');
    else hideNotice();
  }

  function applyUpdate() {
    if (updatingWorker || reloading) return;
    const waiting = registration?.waiting;
    if (!waiting || waiting.state !== 'installed') {
      syncWaiting();
      return;
    }
    updatingWorker = waiting;
    showNotice('正在应用新版本…');
    updateTimeout = setTimeout(updateFailed, 20_000);
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      updateFailed();
    }
  }

  async function checkForUpdate() {
    if (!registration || checking || updatingWorker || !navigator.onLine
      || document.visibilityState !== 'visible') return;
    syncWaiting();
    if (Date.now() - lastCheck < CHECK_INTERVAL) return;
    lastCheck = Date.now();
    checking = true;
    try {
      await registration.update();
      syncWaiting();
    } catch {
      // 网络或更新失败不会影响现有页面和旧版离线缓存。
    } finally {
      checking = false;
    }
  }

  function watchInstalling() {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') syncWaiting();
      if (worker.state === 'activated') showVersion();
      if (worker.state === 'redundant' && worker === updatingWorker) updateFailed();
    });
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 仅本页面的按钮请求能够触发刷新；首次安装、其他标签页接管不会强制刷新。
    if (!reloadIfUpdated()) {
      showVersion();
      syncWaiting();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('pageshow', checkForUpdate);
  window.addEventListener('online', checkForUpdate);
  window.addEventListener('focus', checkForUpdate);

  async function register() {
    try {
      registration = await navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' });
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      syncWaiting();
      showVersion();
      checkForUpdate();
    } catch {
      // 安装能力异常不影响工具使用。
    }
  }
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
})();
