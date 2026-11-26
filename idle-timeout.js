/*
 * 8mellow — automatic sign-out after inactivity
 * Load this at the bottom of any logged-in page, AFTER the page's own
 * script (it needs the page's `supabaseClient`):
 *     <script src="idle-timeout.js"></script>
 */
(function () {
  // Logged-in pages live inside the side-menu shell (app.html).
  // If one is opened on its own, move it into the shell.
  try {
    const here = location.pathname.split('/').pop();
    const SHELL_PAGES = ['dashboard.html','inbox.html','write.html','my-messages.html','chat.html','profile.html','settings.html'];
    if (window.top === window.self && SHELL_PAGES.indexOf(here) !== -1) {
      // An email sign-in link carries a one-time code. Let the page finish
      // signing in first, then move into the shell (otherwise the code is lost).
      const hasAuth = /(access_token|refresh_token|error_description|token_hash)=/.test(location.hash) ||
                      /[?&](code|token_hash|error_description)=/.test(location.search);
      if (!hasAuth) {
        location.replace('app.html#' + here + location.search + location.hash);
        return;
      }
      let tries = 0;
      const wait = setInterval(async function () {
        tries++;
        try {
          const r = await supabaseClient.auth.getSession();
          if (r.data && r.data.session) { clearInterval(wait); location.replace('app.html#' + here); return; }
        } catch (e) {}
        if (tries > 40) clearInterval(wait);   // give up after ~10 seconds
      }, 250);
    }
  } catch (e) {}

  const IDLE_LIMIT  = 30 * 60 * 1000;  // sign out after 30 minutes with no activity
  const WARN_BEFORE = 60 * 1000;       // show a warning for the last minute
  const KEY = '8mellow_last_activity'; // shared between tabs
  // After signing back in, return to the page they were on
  const LOGIN_URL = 'auth.html?mode=login&timeout=1&next=' +
    encodeURIComponent(location.pathname.split('/').pop() + location.search);

  if (typeof supabaseClient === 'undefined') return;

  let memLast = null;        // fallback if localStorage is unavailable
  let lastWrite = 0;
  let warningEl = null;
  let countdownEl = null;
  let signingOut = false;

  function readLast() {
    try {
      const v = parseInt(localStorage.getItem(KEY), 10);
      if (!isNaN(v)) return v;
    } catch (e) {}
    return memLast;
  }

  function writeLast(t) {
    memLast = t;
    lastWrite = t;
    try { localStorage.setItem(KEY, String(t)); } catch (e) {}
  }

  async function doSignOut() {
    if (signingOut) return;
    signingOut = true;
    try { await supabaseClient.auth.signOut(); } catch (e) {}
    try { localStorage.removeItem(KEY); localStorage.removeItem('8mellow_draft'); } catch (e) {}
    window.location.replace(LOGIN_URL);
  }

  // ---------- warning pop-up ----------
  function showWarning(secondsLeft) {
    if (!warningEl) {
      warningEl = document.createElement('div');
      warningEl.setAttribute('role', 'alertdialog');
      warningEl.setAttribute('aria-modal', 'true');
      warningEl.style.cssText =
        'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
        'padding:20px;background:rgba(26,26,26,.45);font-family:Inter,sans-serif;';

      const card = document.createElement('div');
      card.style.cssText =
        'background:#fff;border-radius:20px;padding:32px;max-width:380px;width:100%;text-align:center;' +
        'box-shadow:0 20px 60px rgba(91,50,165,.25);border-top:6px solid #5B32A5;';

      const title = document.createElement('h2');
      title.textContent = 'Still there?';
      title.style.cssText = "font-family:Outfit,sans-serif;font-size:24px;color:#5B32A5;margin-bottom:8px;";

      const text = document.createElement('p');
      text.style.cssText = 'font-size:15px;color:#666;margin-bottom:24px;line-height:1.5;';
      text.append('For your privacy, you will be signed out in ');
      countdownEl = document.createElement('strong');
      countdownEl.style.color = '#1A1A1A';
      text.append(countdownEl);
      text.append(' seconds.');

      const stay = document.createElement('button');
      stay.type = 'button';
      stay.textContent = 'Stay signed in';
      stay.style.cssText =
        "width:100%;padding:14px;border:none;border-radius:12px;background:#5B32A5;color:#fff;" +
        "font-family:Outfit,sans-serif;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:10px;";
      stay.onclick = function () { writeLast(Date.now()); hideWarning(); };

      const out = document.createElement('button');
      out.type = 'button';
      out.textContent = 'Sign out now';
      out.style.cssText =
        "width:100%;padding:12px;border:none;background:none;color:#666;font-size:14px;" +
        "font-weight:600;cursor:pointer;text-decoration:underline;";
      out.onclick = doSignOut;

      card.append(title, text, stay, out);
      warningEl.append(card);
      document.body.append(warningEl);
      stay.focus();
    }
    countdownEl.textContent = Math.max(0, secondsLeft);
  }

  function hideWarning() {
    if (warningEl) { warningEl.remove(); warningEl = null; countdownEl = null; }
  }

  // ---------- the check ----------
  function tick() {
    if (signingOut) return;
    const last = readLast();
    if (last === null) { writeLast(Date.now()); return; }

    const idle = Date.now() - last;
    if (idle >= IDLE_LIMIT) {
      doSignOut();
    } else if (idle >= IDLE_LIMIT - WARN_BEFORE) {
      showWarning(Math.ceil((IDLE_LIMIT - idle) / 1000));
    } else {
      hideWarning(); // activity happened in another tab
    }
  }

  function onActivity() {
    if (warningEl || signingOut) return;          // only the button dismisses the warning
    const now = Date.now();
    if (now - lastWrite > 3000) writeLast(now);   // save at most every 3 seconds
  }

  // ---------- start (only when someone is logged in) ----------
  supabaseClient.auth.getSession().then(function (res) {
    if (!res.data || !res.data.session) return;

    // Away longer than the limit (closed laptop, old tab)? Sign out right away.
    const last = readLast();
    if (last !== null && Date.now() - last >= IDLE_LIMIT) { doSignOut(); return; }
    writeLast(Date.now());

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', 'input']
      .forEach(function (evt) {
        window.addEventListener(evt, onActivity, { passive: true, capture: true });
      });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });

    setInterval(tick, 1000);
  });
})();
