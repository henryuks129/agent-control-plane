// Agent Control Plane: app prototypes. One small script for every page.
// It only moves between states that are already in the page: nothing is
// fetched, saved to a server or sent anywhere.
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');

  // Storage can be blocked (private windows), so the theme must work without it.
  function stored() { try { return localStorage.getItem('acp-prototype-theme'); } catch (error) { return null; } }
  function store(value) { try { value ? localStorage.setItem('acp-prototype-theme', value) : localStorage.removeItem('acp-prototype-theme'); } catch (error) { /* stays for this page only */ } }
  function applyTheme(value) {
    if (value === 'dark' || value === 'light') root.setAttribute('data-theme', value); else root.removeAttribute('data-theme');
    each('[data-theme-set]', function (button) { button.setAttribute('aria-pressed', String(button.getAttribute('data-theme-set') === (value || 'system'))); });
  }
  function currentTheme() {
    return root.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  // Set before the page paints so a light-theme reader never sees a dark flash.
  var saved = stored();
  if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);

  function each(selector, run, scope) { Array.prototype.forEach.call((scope || document).querySelectorAll(selector), run); }
  function byId(id) { return id ? document.getElementById(id) : null; }
  function ids(value) { return (value || '').split(/\s+/).filter(Boolean); }

  function selectTab(tab, focus) {
    var list = tab.closest('[role="tablist"]');
    if (!list) return;
    each('[role="tab"]', function (other) {
      var on = other === tab;
      other.setAttribute('aria-selected', String(on));
      other.tabIndex = on ? 0 : -1;
      var panel = byId(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    }, list);
    // Parts outside the panels that belong to some states only, such as the
    // stop button beside Send, name those states in data-when.
    var group = list.getAttribute('data-state-group');
    if (group) each('[data-when][data-group="' + group + '"]', function (part) {
      part.hidden = ids(part.getAttribute('data-when')).indexOf(tab.getAttribute('data-state')) === -1;
    });
    if (focus) tab.focus();
  }

  function tabFor(element) {
    var panel = element && element.closest('[role="tabpanel"]');
    return panel ? document.querySelector('[role="tab"][aria-controls="' + panel.id + '"]') : null;
  }

  // A link such as review.html#state-failed opens that state.
  function openHash() {
    var target = byId(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    var chain = [];
    for (var tab = tabFor(target); tab; tab = tabFor(tab)) chain.unshift(tab);
    chain.forEach(function (item) { selectTab(item, false); });
    if (target.getAttribute('role') !== 'tabpanel') target.scrollIntoView();
  }

  function closeNav() {
    document.body.classList.remove('nav-open');
    each('[data-nav-toggle]', function (button) { button.setAttribute('aria-expanded', 'false'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(stored());
    each('[role="tablist"]', function (list) {
      var selected = list.querySelector('[role="tab"][aria-selected="true"]') || list.querySelector('[role="tab"]');
      if (selected) selectTab(selected, false);
    });
    openHash();

    // Settings: mark the section being read in the section nav.
    var links = document.querySelectorAll('.section-nav a');
    if (links.length && 'IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          Array.prototype.forEach.call(links, function (link) {
            if (link.getAttribute('href') === '#' + entry.target.id) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '0px 0px -70% 0px' });
      each('.settings-section', function (section) { observer.observe(section); });
    }
  });
  window.addEventListener('hashchange', openHash);

  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var hit = function (selector) { return target.closest(selector); };
    var element;

    if ((element = hit('[role="tab"]'))) selectTab(element, false);

    if ((element = hit('[data-goto-tab]'))) {
      var tab = byId(element.getAttribute('data-goto-tab'));
      if (tab) { selectTab(tab, false); window.scrollTo(0, 0); }
    }

    if ((element = hit('[data-toggle]'))) {
      var region = byId(element.getAttribute('data-toggle'));
      if (region) { region.hidden = !region.hidden; element.setAttribute('aria-expanded', String(!region.hidden)); }
    }

    if ((element = hit('[data-show], [data-hide]'))) {
      ids(element.getAttribute('data-hide')).forEach(function (id) { var part = byId(id); if (part) part.hidden = true; });
      var shown = ids(element.getAttribute('data-show')).map(byId).filter(Boolean);
      shown.forEach(function (part) { part.hidden = false; });
      // Keep keyboard focus on something visible when the control it was on goes away.
      if (shown.length && element.closest('[hidden]')) { shown[0].tabIndex = -1; shown[0].focus(); }
    }

    if ((element = hit('[data-open-dialog]'))) {
      var dialog = byId(element.getAttribute('data-open-dialog'));
      if (dialog && dialog.showModal) dialog.showModal();
    }
    if ((element = hit('[data-close-dialog]'))) { var open = element.closest('dialog'); if (open) open.close(); }

    if ((element = hit('[data-copy]'))) {
      var code = element.parentElement && element.parentElement.querySelector('code');
      var button = element;
      var done = function (label) { button.textContent = label; setTimeout(function () { button.textContent = 'Copy'; }, 1600); };
      if (code && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code.textContent || '').then(function () { done('Copied'); }, function () { done('Select and copy'); });
      else done('Select and copy');
    }

    if ((element = hit('[data-theme-set]'))) { var choice = element.getAttribute('data-theme-set'); store(choice === 'system' ? '' : choice); applyTheme(choice === 'system' ? null : choice); }
    if (hit('[data-theme-toggle]')) { var next = currentTheme() === 'dark' ? 'light' : 'dark'; store(next); applyTheme(next); }

    if ((element = hit('[data-nav-toggle]'))) {
      var opened = document.body.classList.toggle('nav-open');
      element.setAttribute('aria-expanded', String(opened));
      if (opened) { var first = document.querySelector('.side a, .side button'); if (first) first.focus(); }
    }
    if (hit('[data-nav-close]')) closeNav();

    // One pressed button in a group, such as a severity choice.
    if ((element = hit('[data-single] > button'))) each('button', function (other) { other.setAttribute('aria-pressed', String(other === element)); }, element.parentElement);

    // Orchestrators: at most two stars. A third is refused with a reason.
    if ((element = hit('[data-star]'))) {
      var pressed = element.getAttribute('aria-pressed') === 'true';
      var count = document.querySelectorAll('[data-star][aria-pressed="true"]').length;
      var limit = byId('star-limit');
      if (!pressed && count >= 2) { if (limit) limit.hidden = false; }
      else {
        element.setAttribute('aria-pressed', String(!pressed));
        var text = element.querySelector('[data-star-text]');
        if (text) text.textContent = pressed ? 'Make orchestrator' : 'Orchestrator';
        if (limit) limit.hidden = true;
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeNav();
    var tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (!tab || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End')) return;
    var tabs = Array.prototype.slice.call(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
    var index = tabs.indexOf(tab);
    var to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    selectTab(tabs[to], true);
  });

  // Nothing in a prototype is submitted.
  document.addEventListener('submit', function (event) { event.preventDefault(); });
})();
