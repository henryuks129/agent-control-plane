/* Agent Control Plane landing page. No dependencies.
   The page is complete without this file: every state it animates towards is
   the state the markup already shows. The script only adds classes that let the
   stylesheet start from an earlier state and play forward. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  // ---- Copy the quick start ----
  // Works with or without motion, so it is set up before anything else can return.

  function initCopy(button) {
    var source = doc.getElementById(button.getAttribute('data-copy'));
    var status = doc.getElementById(button.getAttribute('data-copy-status'));
    var label = button.querySelector('[data-copy-label]');
    var reset = null;
    if (!source) return;

    function say(message) { if (status) status.textContent = message; }

    // The clipboard API is missing on plain http and can be refused by the
    // browser. Selecting the commands leaves the visitor one keypress away.
    function selectInstead() {
      try {
        var range = doc.createRange();
        range.selectNodeContents(source);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        say('Copying is blocked here. The commands are selected: press Ctrl+C, or Cmd+C on a Mac.');
      } catch (error) {
        say('Copying is blocked here. Select the commands and copy them by hand.');
      }
    }

    function copied() {
      if (label) label.textContent = 'Copied';
      button.classList.add('is-copied');
      say('Commands copied. Paste them into your terminal.');
      window.clearTimeout(reset);
      reset = window.setTimeout(function () {
        if (label) label.textContent = 'Copy';
        button.classList.remove('is-copied');
      }, 2600);
    }

    button.addEventListener('click', function () {
      var text = source.textContent.split('\n').map(function (line) { return line.trim(); }).filter(Boolean).join('\n');
      var clipboard = typeof navigator !== 'undefined' && navigator.clipboard;
      if (!clipboard || !clipboard.writeText) { selectInstead(); return Promise.resolve(); }
      try {
        return clipboard.writeText(text).then(copied, selectInstead);
      } catch (error) {
        selectInstead();
        return Promise.resolve();
      }
    });
  }

  each(doc.querySelectorAll('[data-copy]'), initCopy);

  // ---- The example patch can be approved with motion on or off ----

  var demo = doc.querySelector('[data-demo]');
  var approve = demo && demo.querySelector('[data-demo-approve]');
  var patchLine = demo && demo.querySelector('[data-says="patch"]');
  var waitingText = patchLine ? patchLine.textContent : '';
  var onApproved = null;

  function setApproved(on) {
    if (!demo || !approve) return;
    demo.classList.toggle('is-approved', on);
    approve.textContent = on ? 'Approved' : 'Approve';
    approve.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (patchLine) patchLine.textContent = on ? 'Approved by you. Applied as one change.' : waitingText;
  }

  if (approve) {
    approve.addEventListener('click', function () {
      var on = !demo.classList.contains('is-approved');
      setApproved(on);
      if (on && onApproved) onApproved();
    });
  }

  // ---- Everything below is motion ----

  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm || !('IntersectionObserver' in window)) return;
  root.classList.add('motion');

  // Loops run only while their element is on screen and the tab is visible.
  function watch(element, threshold, onChange) {
    var onScreen = false;
    var report = function () { onChange(onScreen && !doc.hidden); };
    new window.IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      report();
    }, { threshold: threshold }).observe(element);
    doc.addEventListener('visibilitychange', report);
  }

  // ---- Scroll reveals ----
  // Only elements that start below the fold are held back, and only once this
  // script is running, so a failed script or a deep link never hides content.

  var revealer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.remove('pre');
      revealer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });

  each(doc.querySelectorAll('[data-reveal]'), function (element) {
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    element.classList.add('pre');
    revealer.observe(element);
  });

  // ---- The thread: split, work, hand off, wait for approval ----

  function initDemo(stage) {
    var LAST = 8;
    // How long each phase holds before the next. Phase 8 is the wait for approval:
    // it is the longest on purpose, because nothing moves until the visitor does.
    var HOLD = [500, 1000, 900, 2100, 1300, 900, 2300, 1500, 6000];
    var toggle = stage.querySelector('[data-demo-toggle]');
    var lines = {};
    each(stage.querySelectorAll('[data-says]'), function (element) {
      lines[element.getAttribute('data-says')] = { element: element, final: element.textContent };
    });
    // What each status line reads from a given phase on. null is the text in the markup.
    var SAYS = {
      claude: [[3, 'Working in its own worktree.'], [6, null]],
      codex: [[3, 'Working in its own worktree.'], [4, null]],
      opencode: [[3, 'Working in its own worktree.'], [4, 'Copy is done.'], [5, 'Reading the checkpoint.'], [6, null]],
      patch: [[0, 'Waiting for the tasks to finish.'], [7, 'Checks are running. Nothing has been merged.'], [8, null]]
    };
    var phase = 0;
    var timer = null;
    var watching = false;
    var paused = false;

    // The whole picture is a function of the phase number, so any phase can be
    // drawn directly and a restart cannot leave a stale class behind.
    function draw(n) {
      phase = n;
      for (var i = 1; i <= LAST; i += 1) stage.classList.toggle('s' + i, i <= n);
      // There is nothing to approve until the checks have run.
      if (approve) approve.disabled = n < LAST;
      Object.keys(SAYS).forEach(function (name) {
        if (!lines[name]) return;
        var text = '';
        SAYS[name].forEach(function (step) { if (n >= step[0]) text = step[1] === null ? lines[name].final : step[1]; });
        lines[name].element.textContent = text || ' ';
      });
    }

    function cut(n) {
      stage.classList.add('is-cut');
      setApproved(false);
      draw(n);
      void stage.offsetWidth; // apply the rewind before transitions come back
      stage.classList.remove('is-cut');
    }

    function restart() {
      stage.classList.add('is-fading');
      timer = window.setTimeout(function () {
        cut(0);
        stage.classList.remove('is-fading');
        timer = null;
        plan();
      }, 520);
    }

    function step() {
      timer = null;
      if (phase >= LAST) { restart(); return; }
      draw(phase + 1);
      plan();
    }

    function plan() {
      if (timer || paused || !watching) return;
      timer = window.setTimeout(step, HOLD[phase]);
    }

    function halt() { window.clearTimeout(timer); timer = null; }

    onApproved = function () {
      halt();
      if (paused || !watching) return;
      timer = window.setTimeout(function () { timer = null; restart(); }, 2600);
    };

    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', function () {
        paused = !paused;
        toggle.textContent = paused ? 'Play' : 'Pause';
        toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
        if (paused) halt(); else plan();
      });
    }

    stage.classList.add('is-live');
    cut(0);
    watch(stage, 0.2, function (on) {
      watching = on;
      if (on) plan(); else halt();
    });
  }

  if (demo) initDemo(demo);

  // ---- The terminal: real commands, real output, typed once ----

  function initTerminal(term) {
    var button = term.querySelector('[data-term-toggle]');
    var points = doc.querySelectorAll('[data-point]');
    var rows = [];
    each(term.querySelectorAll('.ln'), function (line) {
      var row = { line: line, command: null };
      var text = line.querySelector('.tx');
      if (text) {
        // Two spans share the command: the typed part and the part still to come.
        // The untyped part keeps its room, so the terminal never changes height.
        row.command = text.textContent;
        row.typed = doc.createElement('span');
        row.rest = doc.createElement('span');
        row.typed.className = 'typed';
        row.rest.className = 'rest';
        row.typed.textContent = row.command;
        text.textContent = '';
        text.appendChild(row.typed);
        text.appendChild(row.rest);
      }
      rows.push(row);
    });
    var index = 0;
    var chars = 0;
    var timer = null;
    var watching = false;
    var started = false;
    var done = false;

    function point(n) {
      each(points, function (element) { element.classList.toggle('is-now', element.getAttribute('data-point') === String(n)); });
    }

    function show(row, count) {
      row.line.classList.remove('wait');
      if (row.command === null) return;
      row.typed.textContent = row.command.slice(0, count);
      row.rest.textContent = row.command.slice(count);
    }

    function rewind() {
      index = 0; chars = 0; done = false;
      rows.forEach(function (row) {
        row.line.classList.add('wait');
        row.line.classList.remove('now');
        if (row.command !== null) { row.typed.textContent = ''; row.rest.textContent = row.command; }
      });
      term.classList.add('is-typing');
      if (button) button.textContent = 'Show all';
    }

    function finish() {
      window.clearTimeout(timer); timer = null;
      rows.forEach(function (row) { show(row, row.command === null ? 0 : row.command.length); row.line.classList.remove('now'); });
      term.classList.remove('is-typing');
      point(-1);
      done = true;
      if (button) button.textContent = 'Replay';
    }

    function tick() {
      timer = null;
      var row = rows[index];
      if (!row) { finish(); return; }
      var next = rows[index + 1];
      if (row.command === null) {
        show(row, 0);
        index += 1;
        // Output arrives quickly; the pause comes before the next command is typed.
        plan(next && next.command !== null ? 1100 : 70);
        return;
      }
      if (chars === 0) {
        row.line.classList.add('now');
        point(row.line.getAttribute('data-cmd'));
      }
      chars += 1;
      show(row, chars);
      if (chars < row.command.length) { plan(14 + Math.random() * 30); return; }
      row.line.classList.remove('now');
      chars = 0;
      index += 1;
      plan(420);
    }

    function plan(delay) {
      if (timer || done || !watching) return;
      timer = window.setTimeout(tick, delay);
    }

    if (button) {
      button.hidden = false;
      button.addEventListener('click', function () {
        if (!done) { finish(); return; }
        rewind();
        plan(300);
      });
    }

    rewind();
    watch(term, 0.35, function (on) {
      watching = on;
      if (!on) { window.clearTimeout(timer); timer = null; return; }
      plan(started ? 200 : 600);
      started = true;
    });
  }

  var terminal = doc.querySelector('[data-terminal]');
  if (terminal) initTerminal(terminal);
})();
