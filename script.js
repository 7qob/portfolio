/* Shared behaviour, loaded by every page. Every init below is a no-op when the
   page has none of its elements, so one file serves all of them. ES5 on
   purpose: no build step, and it has to run straight off disk over file://. */
document.addEventListener("DOMContentLoaded", function () {
  var year = document.getElementById("year");
  if (year) {
    year.textContent = new Date().getFullYear();
  }

  renderContributions();
  initThemeToggle();
  initLang();
  initSplitters();
  initFigures();
  initClipToggles();
  initBoxScroll();

  initVaultPanel();
  loadEditor();
  initAuth();
  initVault();
  initLogin();
  initUptime();
});

/* Overflow is measured, never assumed: .has-overflow drives the fade mask and
   an overflowing region gets tabindex so it can be scrolled by keyboard. */
function initBoxScroll() {
  var regions = document.querySelectorAll(".is-home .box__body, .is-home .link-box__note");
  if (!regions.length) return;

  function update(el) {
    var overflows = el.scrollHeight - el.clientHeight > 1;
    var atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

    el.classList.toggle("has-overflow", overflows);
    el.classList.toggle("is-end", overflows && atEnd);

    if (overflows) el.setAttribute("tabindex", "0");
    else el.removeAttribute("tabindex");
  }

  function updateAll() {
    for (var i = 0; i < regions.length; i++) update(regions[i]);
  }

  for (var i = 0; i < regions.length; i++) {
    (function (el) {
      el.addEventListener("scroll", function () { update(el); }, { passive: true });

      if (window.ResizeObserver) {
        new ResizeObserver(function () { update(el); }).observe(el);
      }
    })(regions[i]);
  }

  updateAll();
  if (!window.ResizeObserver) window.addEventListener("resize", updateAll);
}

function initFigures() {
  var imgs = document.querySelectorAll(
    ".figure img, .mediarow img, .mediarow video, .rig__row img");
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var hide = (function (image) {
      return function () {
        var fig = image.closest(".figure, .mediarow, .rig__row");
        if (fig) fig.hidden = true;

        var band = image.closest(".reveal");
        if (band && !band.querySelector(".mediarow:not([hidden])")) {
          band.hidden = true;
        }
      };
    })(img);
    if (img.complete && img.naturalWidth === 0) hide();
    else img.addEventListener("error", hide);
  }
}

function initClipToggles() {
  var frames = document.querySelectorAll(".mediarow__frame");
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (var i = 0; i < frames.length; i++) {
    (function (frame) {
      var video = frame.querySelector("video");
      if (!video) return;

      var toggle = frame.querySelector("[data-clip-toggle]");
      var full = frame.querySelector("[data-clip-fullscreen]");
      var fill = frame.querySelector("[data-clip-fill]");

      if (toggle) {
        var pause = toggle.querySelector('[data-clip-icon="pause"]');
        var play = toggle.querySelector('[data-clip-icon="play"]');

        var syncPlay = function () {
          pause.hidden = video.paused;
          play.hidden = !video.paused;
          toggle.setAttribute("aria-label", video.paused ? "Play clip" : "Pause clip");
        };

        toggle.addEventListener("click", function () {
          if (video.paused) video.play();
          else video.pause();
        });

        video.addEventListener("play", syncPlay);
        video.addEventListener("pause", syncPlay);

        if (still) {
          video.autoplay = false;
          video.pause();
        }
        syncPlay();
      }

      if (full) {
        var enter = full.querySelector('[data-clip-icon="enter"]');
        var exit = full.querySelector('[data-clip-icon="exit"]');

        var syncFull = function () {
          var on = document.fullscreenElement === frame;
          enter.hidden = on;
          exit.hidden = !on;
          full.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
        };

        full.addEventListener("click", function () {
          if (document.fullscreenElement === frame) document.exitFullscreen();
          else if (frame.requestFullscreen) frame.requestFullscreen();
        });

        document.addEventListener("fullscreenchange", syncFull);
        syncFull();
      }

      if (fill) {
        video.addEventListener("timeupdate", function () {
          var d = video.duration;
          fill.style.width = d ? (video.currentTime / d) * 100 + "%" : 0;
        });
      }
    })(frames[i]);
  }
}

var API_BASE = "/api";

function api(path, options) {
  var opts = options || {};
  var headers = { "X-Requested-With": "fetch" };

  var isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;

  if (opts.body && !isForm) headers["Content-Type"] = "application/json";
  if (opts.headers) {
    for (var key in opts.headers) headers[key] = opts.headers[key];
  }

  return fetch(API_BASE + path, {
    method: opts.method || "GET",
    credentials: "same-origin",
    headers: headers,
    body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined
  });
}

/* Response -> value, or an Error carrying what the server said. 204 and an
   unreadable body both become null rather than a throw. */
function ok(res, fallback) {
  if (res.ok) return res.status === 204 ? null : res.json().catch(function () { return null; });
  return res.json().then(
    function (b) { throw new Error(b.message || fallback); },
    function () { throw new Error(fallback); }
  );
}

/* No API here: over file:// or on GitHub Pages the backend does not exist, and
   a failed call would replace a working static page with an error. */
function isOffline() {
  return location.protocol === "file:" ||
         /(^|\.)github\.io$/.test(location.hostname);
}

var ICON_SIGN_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
var ICON_SIGN_OUT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 5 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
var ICON_FILE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
var ICON_DOWNLOAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/* The vault, inline on the one page.

   The gate is the API, not this file: /vault/items answers 401 without a
   session and the files live outside the web root, so nothing here decides who
   sees what. The list starts empty in the markup and is only ever drawn from
   what the server already agreed to send, so an unauthenticated visitor is
   never told which documents exist.

   The session check on load runs only for a browser that has signed in here
   before, so a first-time visitor causes no /vault/items call at all. */
function initVaultPanel() {
  var locked = document.getElementById("vault-locked");
  if (!locked) return;

  var form = document.getElementById("vault-form");
  var open = document.getElementById("vault-open");
  var list = document.getElementById("vault-open-list");
  var status = document.getElementById("vault-status");
  var error = document.getElementById("vault-error");
  var toggle = document.getElementById("session-toggle");

  if (isOffline()) {
    status.textContent = "The vault needs the live site. It cannot be opened from a local file.";
    open.hidden = true;
    return;
  }

  function showForm(on) {
    form.hidden = !on;
    open.hidden = on;
    if (on) document.getElementById("vault-user").focus();
  }

  function signedIn(on) {
    list.hidden = !on;
    locked.hidden = on;

    if (!toggle) return;
    toggle.setAttribute("aria-label", on ? "Sign out" : "Sign in");
    toggle.title = on ? "Sign out" : "Sign in";

    var icon = toggle.querySelector("[data-session-icon]");
    if (icon) icon.innerHTML = on ? ICON_SIGN_OUT : ICON_SIGN_IN;
  }

  function openVault() {
    return api("/vault/items")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        vaultDocs((data && data.items) || []);
        remember("vault:seen", "1");
        signedIn(true);
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function signOut() {
    api("/auth/logout", { method: "POST" })
      .catch(function () {})
      .then(function () {
        forgetMe();
        try {
          localStorage.removeItem("vault:seen");
          localStorage.removeItem("admin");
        } catch (e) {}
        document.getElementById("vault-docs").textContent = "";
        signedIn(false);
        showForm(false);
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var username = document.getElementById("vault-user").value.trim();
    var password = document.getElementById("vault-pass").value;
    if (!username || !password) return;

    error.textContent = "Signing in…";

    api("/auth/login", { method: "POST", body: { username: username, password: password } })
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        // The response says which role signed in. Remembering it is what
        // decides whether edit.js is ever fetched, so a visitor never pays for
        // an editor they cannot open.
        return res.json()
          .catch(function () { return null; })
          .then(function (data) {
            forgetMe();
            if (data && data.user && data.user.role === "admin") {
              remember("admin", "1");
              loadEditor();
            }
            return openVault();
          });
      })
      .then(function () {
        error.textContent = "";
        document.getElementById("vault-pass").value = "";
      })
      .catch(function (err) {
        error.textContent = err.message === "401"
          ? "Those details did not work."
          : err.message === "429"
            ? "Too many attempts. Please wait and try again."
            : "The service is not reachable right now.";
        document.getElementById("vault-pass").value = "";
      });
  });

  open.addEventListener("click", function () { showForm(true); });
  document.getElementById("vault-signout").addEventListener("click", signOut);

  if (toggle) {
    toggle.addEventListener("click", function () {
      if (!list.hidden) return signOut();
      showForm(true);
      document.getElementById("vault").scrollIntoView({ block: "center" });
    });
  }

  if (recall("vault:seen")) openVault();   // a returning cookie, not a stored login
}

function vaultDocs(items) {
  var box = document.getElementById("vault-docs");
  box.textContent = "";

  if (!items.length) {
    box.appendChild(el("p", "muted", "Nothing has been shared with this account yet."));
    return;
  }

  items.forEach(function (item) {
    var row = el(item.available ? "a" : "span", "doc");
    if (item.available) row.href = API_BASE + "/vault/items/" + item.id + "/file";

    row.appendChild(iconSpan(ICON_FILE));
    row.appendChild(el("b", null, item.title));

    var size = item.available ? formatBytes(item.sizeBytes) : "";
    row.appendChild(el("span", "doc__size",
      item.available ? (size ? "PDF · " + size : "PDF") : "not uploaded"));

    box.appendChild(row);
  });
}

/* The subpages, which the single-page rewrite left behind.

   index.html carries the vault inline; login.html, vault/index.html and
   admin.html still wear the old .site-header chrome and still talk to the same
   API, so their bindings live here too. Each returns immediately on a page that
   does not have its elements, so index.html runs none of them. */
/* One /auth/me per page load: initAuth and initLogin both want the answer and
   both run on login.html. null means signed out, which is the normal case. */
var mePromise = null;

/** Signing in or out makes the memoized answer wrong; drop it. */
function forgetMe() {
  mePromise = null;
}

function me() {
  if (!mePromise) {
    mePromise = api("/auth/me")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return (data && data.user) || null; })
      .catch(function () { return null; });
  }
  return mePromise;
}

function initAuth() {
  var nav = document.querySelector(".site-nav");
  if (!nav || isOffline()) return;

  me().then(function (user) { if (user) showSignedIn(nav, user); });
}

function showSignedIn(nav, user) {
  if (user.role === "admin" && !nav.querySelector("[data-admin-link]")) {
    var admin = el("a", null, "Admin");
    admin.href = "/admin.html";
    admin.setAttribute("data-admin-link", "");
    if (location.pathname === "/admin.html") admin.setAttribute("aria-current", "page");
    nav.appendChild(admin);
  }

  var header = nav.parentNode;
  if (!header || header.querySelector("[data-signout]")) return;

  var out = el("button", "icon-btn site-header__signout");
  out.type = "button";
  out.title = "Sign out";
  out.setAttribute("aria-label", "Sign out");
  out.setAttribute("data-signout", "");
  out.appendChild(iconSpan(ICON_DOOR));
  out.addEventListener("click", function () {
    api("/auth/logout", { method: "POST" })
      .catch(function () {})
      .then(function () { location.href = "/index.html"; });
  });

  // Left of the theme toggle when there is one, so the header's right edge
  // does not move between a signed-out and a signed-in page.
  var toggle = document.getElementById("theme-toggle");
  if (toggle && toggle.parentNode === header) header.insertBefore(out, toggle);
  else header.appendChild(out);

  header.classList.add("has-signout");
}

/* The standalone /vault/ list. Same rule as the panel on the home page: the
   markup ships empty and every row here comes from a response the server
   already agreed to send. */
function initVault() {
  var list = document.getElementById("vault-list");
  if (!list) return;

  var status = document.getElementById("vault-status");

  if (isOffline()) {
    if (status) {
      status.textContent = "The Vault needs the live site — it cannot be opened from a local file.";
    }
    return;
  }

  api("/vault/items")
    .then(function (res) {
      if (res.status === 401) {
        location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
        throw new Error("redirecting");
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      var items = (data && data.items) || [];

      if (!items.length) {
        if (status) status.textContent = "No documents are published right now.";
        return;
      }

      items.forEach(function (item) { list.appendChild(vaultRow(item)); });

      list.hidden = false;
      if (status) status.remove();
    })
    .catch(function (err) {
      if (err && err.message === "redirecting") return;
      if (status) status.textContent = "The document list could not be loaded. Please reload.";
    });
}

function vaultRow(item) {
  var li = el("li", item.available ? "doc" : "doc doc--missing");
  var row = el(item.available ? "a" : "span", "doc__link");
  if (item.available) row.href = API_BASE + "/vault/items/" + item.id + "/file";

  var icon = iconSpan(ICON_FILE);
  icon.className = "doc__icon";

  var size = item.available ? formatBytes(item.sizeBytes) : "";

  row.appendChild(icon);
  row.appendChild(el("span", "doc__name", item.title));
  row.appendChild(el("span", "doc__meta",
    item.available ? (size ? "PDF · " + size : "PDF") : "Not uploaded"));

  if (item.available) {
    var arrow = iconSpan(ICON_DOWNLOAD);
    arrow.className = "doc__arrow";
    row.appendChild(arrow);
  }

  li.appendChild(row);
  return li;
}

/* login.html. The form has a real method/action so it is not useless without
   JS, but the API answers 200 with JSON rather than a redirect, so leaving the
   native POST alone would land the visitor on a page of raw JSON. */
function initLogin() {
  var form = document.getElementById("login-form");
  if (!form) return;

  var error = document.getElementById("login-error");
  var submit = document.getElementById("login-submit");
  var next = safeNext(new URLSearchParams(location.search).get("next"));

  if (isOffline()) {
    loginError(error, "Signing in needs the live site — it cannot be done from a local file.");
    if (submit) submit.disabled = true;
    return;
  }

  me().then(function (user) { if (user) location.replace(next); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var username = form.username.value.trim();
    var password = form.password.value;

    if (!username || !password) {
      loginError(error, "Enter both a username and a password.");
      return;
    }

    if (error) error.hidden = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Signing in…";
    }

    api("/auth/login", { method: "POST", body: { username: username, password: password } })
      .then(function (res) {
        if (res.ok) {
          location.replace(next);
          return null;
        }
        return res.json()
          .catch(function () { return {}; })
          .then(function (body) { throw new Error(loginMessage(res.status, body)); });
      })
      .catch(function (err) {
        loginError(error, err.message || "Something went wrong. Please try again.");
        form.password.value = "";
        form.password.focus();
      })
      .finally(function () {
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Sign in";
        }
      });
  });
}

function loginMessage(status, body) {
  if (status === 429) return (body && body.message) || "Too many attempts. Please wait and try again.";
  if (status === 401) return "Invalid username or password.";
  if (status === 400) return "Please check the form and try again.";
  return "Sign-in is unavailable right now. Please try again shortly.";
}

function loginError(node, message) {
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
}

/* ?next= is attacker-supplied: only a same-origin path is ever followed, so a
   protocol-relative //evil.example cannot become the destination. */
function safeNext(raw) {
  var fallback = "/vault/";
  if (!raw || raw.charAt(0) !== "/") return fallback;
  if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return fallback;
  return raw;
}

/* The on-page editor is not in any page's markup: it is fetched only for
   someone who has already signed in here as an admin, or who asked for it with
   ?edit / #edit. A visitor therefore downloads nothing extra and makes no extra
   request, which is what keeps "a published page calls no API" true.

   edit.js checks the session itself before it draws anything — the flag below
   is a hint about who is looking, never the thing that grants access. */
function loadEditor() {
  if (isOffline()) return;
  if (!document.querySelector("[data-edit]")) return;
  if (recall("admin") !== "1" && !/[?#]edit\b/.test(location.href)) return;

  // Already there: a stale flag loaded it before the session existed, and it
  // gave up. Signing in is the second chance, not a reason to fetch it twice.
  if (window.startEditor) return window.startEditor();
  if (document.getElementById("edit-js")) return;

  var tag = document.createElement("script");
  tag.id = "edit-js";
  tag.src = "edit.js";
  document.body.appendChild(tag);
}

/* Real seconds from /api/health, never a number invented in the browser. The
   call is unauthenticated and the footer simply stays without it on failure. */
function initUptime() {
  var out = document.getElementById("uptime");
  if (!out || isOffline()) return;

  api("/health")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || typeof data.uptimeSeconds !== "number") return;

      var started = Date.now() - data.uptimeSeconds * 1000;
      out.hidden = false;

      function tick() {
        out.textContent = " · uptime " + elapsed(started);
      }

      tick();
      setInterval(tick, 1000);
    })
    .catch(function () {});
}

function elapsed(since) {
  var s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  var d = Math.floor(s / 86400); s %= 86400;
  var h = Math.floor(s / 3600);  s %= 3600;
  var m = Math.floor(s / 60);    s %= 60;

  function pad(n) { return n < 10 ? "0" + n : String(n); }
  return d + "d " + pad(h) + "h " + pad(m) + "m " + pad(s) + "s";
}

function formatBytes(value) {
  var bytes = parseInt(value, 10);
  if (!isFinite(bytes) || bytes <= 0) return "";

  var units = ["B", "KB", "MB"];
  var u = 0;
  while (bytes >= 1024 && u < units.length - 1) {
    bytes /= 1024;
    u++;
  }
  return (u > 0 && bytes < 10 ? bytes.toFixed(1) : Math.round(bytes)) + " " + units[u];
}

var ICON_MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
var ICON_SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
var ICON_DOOR =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function recall(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

/* Icons are literals in this file, never fetched. The markup is ours, so
   innerHTML here is a constant, not anything a user or the server supplied. */
function iconSpan(svg) {
  var span = document.createElement("span");
  span.className = "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = svg;
  return span;
}

/* English is what the markup says; data-de carries the twin. The English text
   is captured on load so the swap works in both directions. */
function initLang() {
  var btn = document.getElementById("lang-toggle");
  if (!btn) return;

  var nodes = document.querySelectorAll("[data-de]");
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].setAttribute("data-en", nodes[i].textContent);
  }

  function apply(de) {
    document.documentElement.lang = de ? "de" : "en";
    for (var n = 0; n < nodes.length; n++) {
      nodes[n].textContent = nodes[n].getAttribute(de ? "data-de" : "data-en");
    }
    btn.textContent = de ? "EN" : "DE";          // the language it switches to
    btn.setAttribute("aria-label", de ? "Switch to English" : "Auf Deutsch umschalten");
  }

  apply(recall("lang") === "de");

  btn.addEventListener("click", function () {
    var de = document.documentElement.lang !== "de";
    apply(de);
    remember("lang", de ? "de" : "en");
  });
}

function initSplitters() {
  var splits = document.querySelectorAll(".split");
  if (!splits.length) return;

  if (!window.IntersectionObserver) {
    for (var i = 0; i < splits.length; i++) splits[i].classList.add("is-in");
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      entries[i].target.classList.add("is-in");
      io.unobserve(entries[i].target);
    }
  }, { threshold: 0.6 });

  for (var j = 0; j < splits.length; j++) io.observe(splits[j]);
}

function initThemeToggle() {
  var root = document.documentElement;
  var toggle = document.getElementById("theme-toggle");
  var icon = toggle && toggle.querySelector("[data-theme-icon], .link-box__icon");

  function apply(light) {
    root.classList.toggle("light", light);
    if (icon) icon.innerHTML = light ? ICON_SUN : ICON_MOON;
    if (toggle) toggle.setAttribute("aria-pressed", String(light));
  }

  apply(recall("theme") === "light");

  if (!toggle) return;

  toggle.addEventListener("click", function () {
    var light = !root.classList.contains("light");
    apply(light);
    remember("theme", light ? "light" : "dark");
  });
}

var GH_CACHE_KEY = "gh:contributions:v1";
var GH_CACHE_TTL = 6 * 60 * 60 * 1000;   // 6h — the source updates daily at best
var GH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var GH_ROWS = 7;                         // days in a column
var GH_WEEKS = 53;                       // a year, ending on today's column

function renderContributions() {
  var root = document.getElementById("gh");
  if (!root) return;

  var user = root.getAttribute("data-gh-user") || "7qob";
  var cached = ghReadCache(user);

  if (cached) ghDraw(root, cached.days);
  if (cached && Date.now() - cached.ts < GH_CACHE_TTL) return;

  ghFetch(user)
    .then(function (days) {
      ghWriteCache(user, days);
      ghDraw(root, days);
    })
    .catch(function (err) {
      console.error("GitHub contributions failed to load:", err);
      if (!cached) ghError(root);
    });
}

function ghFetch(user) {
  var url = "https://github-contributions-api.jogruber.de/v4/" +
            encodeURIComponent(user) + "?y=last";

  return fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      var days = (data && data.contributions) || [];
      if (!days.length) throw new Error("no contribution data");
      return days;
    });
}

function ghReadCache(user) {
  try {
    var v = JSON.parse(localStorage.getItem(GH_CACHE_KEY));
    if (!v || v.user !== user || !v.days || !v.days.length) return null;
    return v;
  } catch (e) {
    return null;   // absent, corrupt, or blocked — all mean "no cache"
  }
}

function ghWriteCache(user, days) {
  try {
    localStorage.setItem(GH_CACHE_KEY, JSON.stringify({
      user: user, ts: Date.now(), days: days
    }));
  } catch (e) {}   // private mode or quota; the graph works without a cache
}

function ghDate(s) {
  return new Date(s + "T00:00:00");
}

function ghWhen(date) {
  var d = ghDate(date);
  return d.getDate() + " " + GH_MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function ghDayText(date, count) {
  var when = ghWhen(date);
  if (!count) return "No contributions on " + when;
  return count + (count === 1 ? " contribution on " : " contributions on ") + when;
}

/* Days padded front and back to whole Sunday-first weeks, so a slice at any
   multiple of 7 is still a week boundary. */
function ghSlots(days) {
  var slots = [];
  var lead = ghDate(days[0].date).getDay();

  for (var i = 0; i < lead; i++) slots.push(null);
  for (var j = 0; j < days.length; j++) slots.push(days[j]);
  while (slots.length % GH_ROWS) slots.push(null);

  return slots;
}

function ghLabel(slots) {
  var total = 0, first = null, last = null;

  for (var i = 0; i < slots.length; i++) {
    if (!slots[i]) continue;
    total += slots[i].count;
    if (!first) first = slots[i].date;
    last = slots[i].date;
  }

  return total.toLocaleString("en-US") + " contributions, " +
         ghWhen(first) + " to " + ghWhen(last);
}

/* The graph is the whole widget: no month ruler, no weekday column, no legend,
   so the cells get the entire box. What day a cell is comes from its tooltip. */
function ghDraw(root, days) {
  var chart = root.querySelector("[data-gh-chart]");
  if (!chart) return;

  var slots = ghSlots(days);
  if (slots.length > GH_WEEKS * GH_ROWS) {
    slots = slots.slice(slots.length - GH_WEEKS * GH_ROWS);
  }
  var weeks = slots.length / GH_ROWS;

  var cells = document.createElement("div");
  cells.className = "gh-cells";
  cells.style.setProperty("--gh-weeks", String(weeks));
  cells.setAttribute("role", "img");
  cells.setAttribute("aria-label", ghLabel(slots));

  slots.forEach(function (d) {
    var cell = document.createElement("span");
    if (!d) {
      cell.className = "gh-cell gh-cell--pad";
    } else {
      cell.className = "gh-cell";
      cell.setAttribute("data-level", d.level);
      cell.setAttribute("data-date", d.date);
      cell.setAttribute("data-count", d.count);
    }
    cells.appendChild(cell);
  });

  chart.textContent = "";
  chart.appendChild(cells);

  ghTooltip(root, cells);
}

function ghTooltip(root, cells) {
  var tip = root.querySelector(".gh__tip");
  if (!tip) {
    tip = document.createElement("span");
    tip.className = "gh__tip";
    root.appendChild(tip);
  }
  tip.hidden = true;

  cells.addEventListener("mouseover", function (e) {
    var cell = e.target.closest(".gh-cell[data-date]");
    if (!cell) return;

    tip.textContent = ghDayText(cell.getAttribute("data-date"),
                                Number(cell.getAttribute("data-count")));
    tip.hidden = false;

    var c = cell.getBoundingClientRect();
    var box = root.getBoundingClientRect();
    var x = c.left - box.left + c.width / 2;

    tip.style.left = Math.max(4, Math.min(x, box.width - 4)) + "px";
    tip.style.top = (c.top - box.top) + "px";
  });

  cells.addEventListener("mouseleave", function () {
    tip.hidden = true;
  });
}

function ghError(root) {
  var chart = root.querySelector("[data-gh-chart]");
  if (!chart) return;

  chart.textContent = "";

  var msg = document.createElement("p");
  msg.className = "gh__status";
  msg.textContent = "Activity unavailable.";

  var retry = document.createElement("button");
  retry.type = "button";
  retry.className = "gh__retry";
  retry.textContent = "Retry";
  retry.addEventListener("click", function () {
    chart.textContent = "";
    var wait = document.createElement("p");
    wait.className = "gh__status";
    wait.textContent = "Loading activity…";
    chart.appendChild(wait);
    renderContributions();
  });

  msg.appendChild(document.createTextNode(" "));
  msg.appendChild(retry);
  chart.appendChild(msg);
}
