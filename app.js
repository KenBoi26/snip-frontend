/* ============================================
   Snip — Application Logic
   ============================================ */

(function () {
  'use strict';

  // ─── State ───────────────────────────────
  const history = [];
  let qrInstance = null;

  // ─── DOM refs ────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const tabBar      = $('.tab-bar');
  const tabs        = $$('.tab');
  const indicator   = $('.tab-indicator');
  const panels      = $$('.panel');

  const shortenInput  = $('#shorten-input');
  const shortenBtn    = $('#shorten-btn');
  const shortenResult = $('#shorten-result');
  const shortUrlOut   = $('#short-url-output');
  const copyBtn       = $('#copy-btn');

  const historySection = $('#history-section');
  const historyList    = $('#history-list');

  const qrInput      = $('#qr-input');
  const qrBtn        = $('#qr-btn');
  const qrResult     = $('#qr-result');
  const qrCanvas     = $('#qr-canvas');
  const qrSourceText = $('#qr-source-text');
  const qrDownload   = $('#qr-download-btn');


  // ─── Tab Switching ───────────────────────
  function positionIndicator(activeTab) {
    const barRect = tabBar.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const offsetX = tabRect.left - barRect.left - 4; // account for padding

    indicator.style.width = `${tabRect.width}px`;
    indicator.style.transform = `translateX(${offsetX}px)`;
  }

  function switchTab(tabId) {
    tabs.forEach((t) => {
      const isActive = t.dataset.tab === tabId;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive);
    });

    panels.forEach((p) => {
      const id = p.id.replace('panel-', '');
      const isActive = id === tabId;
      p.classList.toggle('active', isActive);
      p.hidden = !isActive;
    });

    const activeTab = $(`[data-tab="${tabId}"]`);
    positionIndicator(activeTab);
  }

  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  // Keyboard navigation
  tabBar.addEventListener('keydown', (e) => {
    const tabList = [...tabs];
    const current = tabList.findIndex((t) => t === document.activeElement);
    let next;

    if (e.key === 'ArrowRight') next = (current + 1) % tabList.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabList.length) % tabList.length;
    else return;

    e.preventDefault();
    tabList[next].focus();
    switchTab(tabList[next].dataset.tab);
  });

  // Init indicator
  requestAnimationFrame(() => {
    positionIndicator($('.tab.active'));
  });

  window.addEventListener('resize', () => {
    positionIndicator($('.tab.active'));
  });


  // ─── API Configuration ───────────────────
  // Point this to your backend. Falls back to mock if unreachable.
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://api.kennyy.me';

  async function mockShortenAPI(url) {
    // Fallback: simulate response when backend is offline
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    return {
      short_code: code,
      short_url: `https://snip.to/${code}`,
    };
  }

  async function shortenURL(url) {
    try {
      const res = await fetch(`${API_BASE}/api/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) throw new Error(`API returned ${res.status}`);
      return res.json();
    } catch (err) {
      console.warn('Backend unavailable, using mock:', err.message);
      return mockShortenAPI(url);
    }
  }


  // ─── URL Validation ──────────────────────
  function isValidURL(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }


  // ─── Shorten Handler ────────────────────
  shortenBtn.addEventListener('click', handleShorten);
  shortenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleShorten();
  });

  async function handleShorten() {
    const url = shortenInput.value.trim();

    // Validate
    if (!url) {
      shakeInput(shortenInput);
      return;
    }

    if (!isValidURL(url)) {
      shortenInput.classList.add('error');
      shakeInput(shortenInput);
      setTimeout(() => shortenInput.classList.remove('error'), 1500);
      return;
    }

    // Loading state
    shortenBtn.classList.add('loading');
    shortenBtn.disabled = true;

    try {
      const data = await shortenURL(url);

      // Show result
      shortUrlOut.textContent = data.short_url;
      shortenResult.hidden = false;

      // Force re-animation
      shortenResult.style.animation = 'none';
      shortenResult.offsetHeight; // trigger reflow
      shortenResult.style.animation = '';

      // Add to history
      addToHistory(url, data.short_url);

      // Clear input
      shortenInput.value = '';
    } catch (err) {
      console.error('Shorten failed:', err);
    } finally {
      shortenBtn.classList.remove('loading');
      shortenBtn.disabled = false;
    }
  }


  // ─── Copy to Clipboard ──────────────────
  copyBtn.addEventListener('click', () => {
    copyToClipboard(shortUrlOut.textContent, copyBtn);
  });

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      const textEl = btn.querySelector('.copy-text');
      if (textEl) textEl.textContent = 'Copied';

      setTimeout(() => {
        btn.classList.remove('copied');
        if (textEl) textEl.textContent = 'Copy';
      }, 2000);
    });
  }


  // ─── History ─────────────────────────────
  function addToHistory(originalUrl, shortUrl) {
    const parts = shortUrl.split('/');
    const code = parts[parts.length - 1];
    history.unshift({ originalUrl, shortUrl, code, clicks: 0 });
    renderHistory();
    updateStatsForCode(code);
  }

  async function updateStatsForCode(code) {
    // If it is a mock short URL code (doesn't exist on actual backend) we skip or let it fail gracefully
    try {
      const res = await fetch(`${API_BASE}/api/stats/${code}`);
      if (!res.ok) return;
      const data = await res.json();
      
      // Update local state
      const item = history.find(i => i.code === code);
      if (item) {
        item.clicks = data.clicks;
      }
      
      // Update DOM element directly if it exists to avoid full re-render
      const badge = $(`.history-clicks[data-code="${code}"]`);
      if (badge) {
        badge.textContent = `${data.clicks} click${data.clicks === 1 ? '' : 's'}`;
        badge.classList.add('updated');
        setTimeout(() => badge.classList.remove('updated'), 600);
      }
    } catch (err) {
      console.warn('Failed to fetch stats for:', code, err.message);
    }
  }

  function renderHistory() {
    if (history.length === 0) {
      historySection.hidden = true;
      return;
    }

    historySection.hidden = false;
    historyList.innerHTML = '';

    history.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.style.setProperty('--i', idx);
      li.innerHTML = `
        <span class="history-original" title="${escapeHTML(item.originalUrl)}">${escapeHTML(item.originalUrl)}</span>
        <span class="history-clicks" data-code="${escapeHTML(item.code)}">${item.clicks} clicks</span>
        <a href="${escapeHTML(item.shortUrl)}" class="history-short" target="_blank" rel="noopener">${escapeHTML(item.shortUrl)}</a>
        <button class="history-copy-btn" aria-label="Copy ${escapeHTML(item.shortUrl)}" data-url="${escapeHTML(item.shortUrl)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      `;
      historyList.appendChild(li);
    });

    // Bind copy buttons
    historyList.querySelectorAll('.history-copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        navigator.clipboard.writeText(url).then(() => {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1500);
        });
      });
    });
  }


  // ─── QR Code ─────────────────────────────
  qrBtn.addEventListener('click', handleQR);
  qrInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleQR();
  });

  function handleQR() {
    const text = qrInput.value.trim();

    if (!text) {
      shakeInput(qrInput);
      return;
    }

    // Clear previous
    qrCanvas.innerHTML = '';
    qrInstance = null;

    // Generate QR code
    qrInstance = new QRCode(qrCanvas, {
      text: text,
      width: 220,
      height: 220,
      colorDark: '#2a1f14',
      colorLight: '#faf7f2',
      correctLevel: QRCode.CorrectLevel.H,
    });

    // Show result
    qrResult.hidden = false;
    qrResult.style.animation = 'none';
    qrResult.offsetHeight;
    qrResult.style.animation = '';

    // Source text
    const display = text.length > 50 ? text.substring(0, 47) + '…' : text;
    qrSourceText.textContent = display;

    // Clear input
    qrInput.value = '';
  }


  // ─── QR Download ─────────────────────────
  qrDownload.addEventListener('click', () => {
    // qrcode.js generates both a canvas and an img element
    const canvas = qrCanvas.querySelector('canvas');
    const img = qrCanvas.querySelector('img');

    let dataURL;
    if (canvas) {
      dataURL = canvas.toDataURL('image/png');
    } else if (img) {
      // Fallback: draw img to temp canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.naturalWidth || img.width;
      tempCanvas.height = img.naturalHeight || img.height;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      dataURL = tempCanvas.toDataURL('image/png');
    }

    if (dataURL) {
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = 'snip-qrcode.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });


  // ─── Utilities ───────────────────────────
  function shakeInput(el) {
    el.style.animation = 'shake 400ms var(--ease-out-quart)';
    el.addEventListener('animationend', () => {
      el.style.animation = '';
    }, { once: true });
    el.focus();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Add shake keyframes dynamically
  const shakeCSS = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(5px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(3px); }
    }
  `;
  const style = document.createElement('style');
  style.textContent = shakeCSS;
  document.head.appendChild(style);

})();
