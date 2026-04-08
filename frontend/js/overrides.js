/* Non-invasive UI polish hooks.
   Important: no routing/swipe overrides here. Core navigation stays in app.js. */

(function () {
  'use strict';

  function getTrack() {
    return document.querySelector('.bank-cards-track');
  }

  function isDesktopWheelContext() {
    return window.matchMedia('(min-width: 960px)').matches;
  }

  function initCarouselDepth() {
    var track = getTrack();
    if (!track || track._depthInit) return;
    track._depthInit = true;

    var raf = 0;
    function updateCardScale() {
      raf = 0;
      if (track.offsetParent === null) return;

      var cards = track.querySelectorAll('.bank-card');
      if (!cards.length) return;

      var trackCenter = track.scrollLeft + track.clientWidth / 2;
      cards.forEach(function (card) {
        var cardCenter = card.offsetLeft + card.offsetWidth / 2;
        var dist = Math.abs(trackCenter - cardCenter);
        var maxDist = Math.max(track.clientWidth * 0.9, 1);
        var ratio = Math.max(0, 1 - dist / maxDist);
        var scale = 0.9 + 0.1 * ratio;
        var opacity = 0.6 + 0.4 * ratio;
        card.style.transform = 'scale(' + scale.toFixed(3) + ')';
        card.style.opacity = opacity.toFixed(3);
        card.style.transition = 'transform .18s ease, opacity .18s ease';
      });
    }

    function queueUpdate() {
      if (raf) return;
      raf = requestAnimationFrame(updateCardScale);
    }

    track.addEventListener('scroll', queueUpdate, { passive: true });
    window.addEventListener('resize', queueUpdate, { passive: true });

    if (!track._depthObserver && typeof MutationObserver !== 'undefined') {
      track._depthObserver = new MutationObserver(queueUpdate);
      track._depthObserver.observe(track, { childList: true, subtree: false });
    }

    queueUpdate();
  }

  function initCarouselWheelSnap() {
    var track = getTrack();
    if (!track || track._wheelInit) return;
    track._wheelInit = true;

    var snapTimer = null;
    track.addEventListener('wheel', function (e) {
      if (!isDesktopWheelContext()) return;
      if (track.offsetParent === null) return;

      e.preventDefault();
      var baseCard = track.querySelector('.bank-card');
      var cardW = (baseCard ? baseCard.offsetWidth : track.clientWidth) + 14;
      var dir = e.deltaX !== 0 ? Math.sign(e.deltaX) : Math.sign(e.deltaY);
      if (!dir) return;
      var cur = Math.round(track.scrollLeft / cardW);
      var next = Math.max(0, cur + dir);
      clearTimeout(snapTimer);
      snapTimer = setTimeout(function () {
        track.scrollTo({ left: next * cardW, behavior: 'smooth' });
      }, 50);
    }, { passive: false });
  }

  function init() {
    initCarouselDepth();
    initCarouselWheelSnap();

    setTimeout(function () {
      initCarouselDepth();
      initCarouselWheelSnap();
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
  window.addEventListener('pageshow', init, { passive: true });
})();
