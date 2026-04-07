/* ╔══════════════════════════════════════════════════════════════╗
   ║  overrides.js — анімації переходів + карусель карток         ║
   ║  Завантажується після app.js, патчить switchScreen           ║
   ╚══════════════════════════════════════════════════════════════╝ */

(function () {
  'use strict';

  /* ── 1. SCREEN TRANSITION PATCH ─────────────────────────────
     Перехоплюємо switchScreen: додаємо напрям + клас animate     */

  var NAV_ORDER = ['dashboard', 'transactions', 'cards', 'profile'];
  var _prevScreen = 'dashboard';
  var _originalSwitchScreen = null;

  function patchSwitchScreen() {
    if (typeof window.switchScreen !== 'function') return;
    if (window.__overridesSwitchPatched) return;
    window.__overridesSwitchPatched = true;

    _originalSwitchScreen = window.switchScreen;

    window.switchScreen = function (screenId) {
      var nextIndex = NAV_ORDER.indexOf(screenId);
      var prevIndex = NAV_ORDER.indexOf(_prevScreen);
      var direction = (nextIndex >= prevIndex) ? 'ltr' : 'rtl'; // left→right = forward

      // Mark outgoing screen for exit animation
      var outgoing = document.querySelector('.screen.active-screen');
      if (outgoing && outgoing.id !== screenId) {
        outgoing.classList.add('screen-exit');
        outgoing.classList.add('screen-exit-' + direction);
        // Remove after animation
        var _out = outgoing;
        setTimeout(function () {
          _out.classList.remove('screen-exit', 'screen-exit-ltr', 'screen-exit-rtl');
        }, 220);
      }

      // Call original
      _originalSwitchScreen(screenId);

      // Add enter animation class to incoming screen
      var incoming = document.getElementById(screenId);
      if (incoming) {
        incoming.classList.remove('screen-enter', 'screen-enter-ltr', 'screen-enter-rtl');
        void incoming.offsetWidth; // force reflow
        incoming.classList.add('screen-enter');
        incoming.classList.add('screen-enter-' + direction);
        setTimeout(function () {
          incoming.classList.remove('screen-enter', 'screen-enter-ltr', 'screen-enter-rtl');
        }, 320);
      }

      _prevScreen = screenId;
    };
  }

  /* ── 2. CARD CAROUSEL SCROLL DEPTH EFFECT ──────────────────
     При скролі карусель масштабує сусідні картки (parallax)       */

  function initCarouselDepth() {
    var track = document.querySelector('.bank-cards-track');
    if (!track || track._depthInit) return;
    track._depthInit = true;

    function updateCardScale() {
      var cards = track.querySelectorAll('.bank-card');
      if (!cards.length) return;
      var trackCenter = track.scrollLeft + track.clientWidth / 2;

      cards.forEach(function (card) {
        var cardCenter = card.offsetLeft + card.offsetWidth / 2;
        var dist = Math.abs(trackCenter - cardCenter);
        var maxDist = track.clientWidth * 0.9;
        var ratio = Math.max(0, 1 - dist / maxDist);
        var scale = 0.88 + 0.12 * ratio;
        var opacity = 0.55 + 0.45 * ratio;
        card.style.transform = 'scale(' + scale.toFixed(3) + ')';
        card.style.opacity = opacity.toFixed(3);
        card.style.transition = 'transform .18s ease, opacity .18s ease';
      });
    }

    track.addEventListener('scroll', updateCardScale, { passive: true });
    updateCardScale();

    // Re-init after cards loaded
    var observer = new MutationObserver(function () {
      track._depthInit = false;
      initCarouselDepth();
    });
    observer.observe(track, { childList: true });
  }

  /* ── 3. SWIPE GESTURE FOR SCREEN NAVIGATION ─────────────────
     Горизонтальний свайп по app-content → переключення екрану     */

  function initScreenSwipe() {
    var content = document.getElementById('appScreen');
    if (!content || content._swipeInit) return;
    content._swipeInit = true;

    var startX = 0, startY = 0, startTime = 0;
    var THRESHOLD = 60, MAX_Y = 80, MAX_TIME = 380;

    content.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
    }, { passive: true });

    content.addEventListener('touchend', function (e) {
      if (!e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var dt = Date.now() - startTime;

      // Ignore vertical scrolls
      if (Math.abs(dy) > MAX_Y) return;
      if (Math.abs(dx) < THRESHOLD) return;
      if (dt > MAX_TIME) return;

      // Only swipe in main tab bar screens
      var currentId = document.querySelector('.screen.active-screen')?.id;
      if (!NAV_ORDER.includes(currentId)) return;

      var curIdx = NAV_ORDER.indexOf(currentId);
      var nextIdx;
      if (dx < 0) {
        // swipe left → go to next tab
        nextIdx = Math.min(NAV_ORDER.length - 1, curIdx + 1);
      } else {
        // swipe right → go to prev tab
        nextIdx = Math.max(0, curIdx - 1);
      }

      if (nextIdx !== curIdx && typeof window.switchScreen === 'function') {
        var nextScreen = NAV_ORDER[nextIdx];
        window.history.pushState(null, '', (window.getBasePath ? window.getBasePath() : '') + '/' + nextScreen);
        window.switchScreen(nextScreen);
      }
    }, { passive: true });
  }

  /* ── 4. CAROUSEL SNAP MOMENTUM (keyboard/mouse) ─────────────
     Забезпечуємо щоб колесо миші теж снепало по одній карті      */

  function initCarouselWheelSnap() {
    var track = document.querySelector('.bank-cards-track');
    if (!track || track._wheelInit) return;
    track._wheelInit = true;

    var _snapTimer = null;
    track.addEventListener('wheel', function (e) {
      e.preventDefault();
      var cardW = (track.querySelector('.bank-card')?.offsetWidth || track.clientWidth) + 14;
      var dir = e.deltaX !== 0 ? Math.sign(e.deltaX) : Math.sign(e.deltaY);
      var cur = Math.round(track.scrollLeft / cardW);
      var next = Math.max(0, cur + dir);
      clearTimeout(_snapTimer);
      _snapTimer = setTimeout(function () {
        track.scrollTo({ left: next * cardW, behavior: 'smooth' });
      }, 50);
    }, { passive: false });
  }

  /* ── 5. INIT ─────────────────────────────────────────────── */

  function init() {
    patchSwitchScreen();
    initCarouselDepth();
    initScreenSwipe();
    initCarouselWheelSnap();

    // Re-try carousel init after data loads (cards are async)
    setTimeout(function () {
      initCarouselDepth();
      initCarouselWheelSnap();
    }, 1500);

    setTimeout(function () {
      initCarouselDepth();
      initCarouselWheelSnap();
    }, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Already loaded — wait one tick so app.js finishes
    setTimeout(init, 0);
  }

})();
