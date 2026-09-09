/* Admin panel only. It shares api() and isOffline() with script.js, which every
   page loads first.

   Use textContent, never innerHTML, for anything the server stored: this panel
   displays usernames and user-agent strings from failed logins, which is
   attacker-chosen text held verbatim, as it should be. */
document.addEventListener("DOMContentLoaded", function () {
  var gate = document.getElementById("admin-gate");
  var body = document.getElementById("admin-body");
  if (!gate || !body) return;

  if (isOffline()) {
    gate.textContent = "The admin panel needs the live site. It cannot be opened from a local file.";
    return;
  }

  api("/auth/me")
    .then(function (res) {
      if (res.status === 401) {
        location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
        throw new Error("redirecting");
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data.user || data.user.role !== "admin") {
        gate.textContent = "This area is for administrators. You are signed in as " + data.user.username + ".";
        return;
      }

      gate.remove();
      body.hidden = false;
      initTabs(document.getElementById("admin-sections"), guardSectionSwitch);
      initTabs(document.getElementById("telemetry-tabs"), null);
      loadPanel("projects");
    })
    .catch(function (err) {
      if (err && err.message === "redirecting") return;
      gate.textContent = "Could not reach the server. Please reload.";
    });
});

var loaded = {};

function initTabs(strip, guard) {
  if (!strip) return;
  var tabs = [].slice.call(strip.querySelectorAll(".admin-tab"));

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      if (guard && !guard()) return;
      selectTab(tabs, tab);
    });

    tab.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(tab);
      var next = null;

      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];

      if (next) {
        e.preventDefault();
        if (guard && !guard()) return;
        selectTab(tabs, next);
        next.focus();
      }
    });
  });
}

function selectTab(tabs, active) {
  tabs.forEach(function (tab) {
    var on = tab === active;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;

    var panel = document.getElementById("panel-" + tab.getAttribute("data-panel"));
    if (panel) panel.hidden = !on;
  });

  loadPanel(active.getAttribute("data-panel"));
}

function loadPanel(name) {
  if (loaded[name]) return;
  loaded[name] = true;

  var loaders = {
    projects: loadProjects,
    home: loadHomePage,
    files: loadFiles,
    access: loadAccess,
    logins: loadLogins,
    sessions: loadSessions,
    downloads: loadDownloads,
    audit: loadAudit
  };

  if (loaders[name]) loaders[name]();
}

function reload(name) {
  loaded[name] = false;
  loadPanel(name);
}

function renderTable(table, headers, rows, buildRow) {
  table.textContent = "";

  var thead = el("thead");
  var headRow = el("tr");
  headers.forEach(function (h) {
    headRow.appendChild(el("th", null, h));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = el("tbody");

  if (!rows.length) {
    var empty = el("tr");
    var cell = el("td", "admin-empty", "Nothing here yet.");
    cell.colSpan = headers.length;
    empty.appendChild(cell);
    tbody.appendChild(empty);
  } else {
    rows.forEach(function (row) {
      var tr = el("tr");
      buildRow(row).forEach(function (value) {
        if (value instanceof Node) {
          var wrap = el("td");
          wrap.appendChild(value);
          tr.appendChild(wrap);
        } else {
          tr.appendChild(el("td", null, value === null || value === undefined ? "·" : value));
        }
      });
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
}

function button(label, className, onClick) {
  var b = el("button", "admin-btn " + (className || ""), label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function when(value) {
  if (!value) return "·";
  var d = new Date(String(value).replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function shortAgent(value) {
  if (!value) return "·";
  var text = String(value);
  var span = el("span", null, text.length > 38 ? text.slice(0, 38) + "…" : text);
  span.title = text;
  return span;
}

function fail(table, error) {
  renderTable(table, ["Error"], [{}], function () {
    return ["Could not load this section. " + (error && error.message ? error.message : "")];
  });
}

function loadAccess() {
  loadOverview();
  loadUsers();
  loadPanel("logins");
}

function loadOverview() {
  var host = document.getElementById("overview-stats");
  var note = document.getElementById("overview-retention");

  api("/admin/overview")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      host.textContent = "";

      [
        ["Accounts", d.users.active + " active", d.users.total + " total, " + d.users.admins + " admin"],
        ["Sessions", d.sessions.active, "signed in right now"],
        ["Logins (24h)", d.logins.succeeded24h + " ok", d.logins.failed24h + " failed, " + d.logins.distinctIps24h + " addresses"],
        ["Downloads", d.downloads.last30Days, "in the last 30 days · " + d.downloads.total + " total"]
      ].forEach(function (stat) {
        var tile = el("div", "admin-stat");
        tile.appendChild(el("span", "admin-stat__label", stat[0]));
        tile.appendChild(el("span", "admin-stat__value", stat[1]));
        tile.appendChild(el("span", "admin-stat__note", stat[2]));
        host.appendChild(tile);
      });

      note.textContent =
        "Login attempts and downloads are deleted automatically after " +
        d.retentionDays + " days. Nothing about anonymous visitors is recorded at all.";
    })
    .catch(function () {
      host.textContent = "";
      host.appendChild(el("p", "admin-note", "Could not load the overview."));
    });
}

function loadUsers() {
  var table = document.getElementById("users-table");
  var form = document.getElementById("create-user-form");
  var out = document.getElementById("new-credentials");

  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      createUser(form, out);
    });
  }

  api("/admin/users")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(
        table,
        ["Username", "Role", "Status", "Issued to", "Last login", ""],
        d.rows,
        function (u) {
          var actions = el("span", "admin-actions");

          actions.appendChild(button(u.disabled_at ? "Enable" : "Disable", "", function () {
            var verb = u.disabled_at ? "enable" : "disable";
            if (!confirm("Really " + verb + " " + u.username + "?")) return;

            api("/admin/users/" + u.id, {
              method: "PATCH",
              body: { disabled: !u.disabled_at }
            }).then(function (res) {
              if (!res.ok) return res.json().then(function (b) { alert(b.message || "Failed."); });
              reload("access");
            });
          }));

          actions.appendChild(button("Reset password", "", function () {
            if (!confirm("Reset the password for " + u.username + "? Their current one stops working immediately.")) return;

            api("/admin/users/" + u.id + "/password", { method: "POST" })
              .then(function (res) { return res.json(); })
              .then(function (b) {
                if (b.password) showSecret(out, b.username, b.password, "Password reset");
                else alert(b.message || "Failed.");
                reload("access");
              });
          }));

          return [
            u.username,
            u.role,
            u.disabled_at ? "disabled" : "active",
            u.note,
            when(u.last_login_at),
            actions
          ];
        }
      );
    })
    .catch(function (e) { fail(table, e); });
}

function createUser(form, out) {
  var body = {
    username: form.username.value.trim(),
    role: form.role.value
  };
  var note = form.note.value.trim();
  if (note) body.note = note;

  if (!body.username) return;

  api("/admin/users", { method: "POST", body: body })
    .then(function (res) { return ok(res, "Could not create the account."); })
    .then(function (created) {
      showSecret(out, created.username, created.password, "Account created");
      form.reset();
      reload("access");
    })
    .catch(function (err) {
      alert(err.message);
    });
}

function showSecret(host, username, password, title) {
  if (!host) return;

  host.textContent = "";
  host.appendChild(el("p", "admin-secret__title", title));

  var line = el("p", "admin-secret__value");
  line.appendChild(el("span", null, username + "  /  "));

  var code = el("code", null, password);
  line.appendChild(code);
  host.appendChild(line);

  host.appendChild(button("Copy password", "admin-btn--accent", function () {
    navigator.clipboard.writeText(password).then(function () {
      alert("Copied.");
    }, function () {
      alert("Could not copy. Select it by hand.");
    });
  }));

  host.appendChild(el("p", "admin-secret__note",
    "Shown once. Only the hash is stored, so nobody, not even you, can read this back later. If it is lost, reset it."));

  host.hidden = false;
}

function loadLogins() {
  var table = document.getElementById("logins-table");

  api("/admin/logins?limit=100")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(table, ["When", "Username", "Result", "Reason", "Address", "Browser"], d.rows, function (a) {
        return [
          when(a.created_at),
          a.username,
          a.success ? "ok" : "failed",
          a.reason,
          a.ip,
          shortAgent(a.user_agent)
        ];
      });
    })
    .catch(function (e) { fail(table, e); });
}

function loadSessions() {
  var table = document.getElementById("sessions-table");

  api("/admin/sessions")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(table, ["User", "Role", "Started", "Last seen", "Address", "Browser", ""], d.rows, function (s) {
        return [
          s.username,
          s.role,
          when(s.created_at),
          when(s.last_seen_at),
          s.ip,
          shortAgent(s.user_agent),
          button("Revoke", "", function () {
            if (!confirm("Log out " + s.username + " on this session?")) return;
            api("/admin/sessions/" + s.id, { method: "DELETE" }).then(function () {
              reload("sessions");
            });
          })
        ];
      });
    })
    .catch(function (e) { fail(table, e); });
}

function loadDownloads() {
  var table = document.getElementById("downloads-table");

  api("/admin/downloads?limit=100")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(table, ["When", "Who", "Document", "Address", "Browser"], d.rows, function (row) {
        return [
          when(row.created_at),
          row.username,
          row.item_title,
          row.ip,
          shortAgent(row.user_agent)
        ];
      });
    })
    .catch(function (e) { fail(table, e); });
}

function loadAudit() {
  var table = document.getElementById("audit-table");

  api("/admin/audit?limit=100")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(table, ["When", "Who", "Action", "Target", "Detail", "Address"], d.rows, function (a) {
        return [when(a.created_at), a.actor_name, a.action, a.target, a.detail, a.ip];
      });
    })
    .catch(function (e) { fail(table, e); });
}

function loadFiles() {
  var picker = document.getElementById("media-upload");

  if (picker && !picker.dataset.bound) {
    picker.dataset.bound = "1";
    picker.addEventListener("change", function () {
      if (!picker.files.length) return;
      picker.disabled = true;

      var queue = [].slice.call(picker.files).reduce(function (chain, file) {
        return chain.then(function () { return uploadMedia(file); });
      }, Promise.resolve());

      queue
        .catch(function (err) { alert(err.message); })
        .then(function () {
          picker.disabled = false;
          picker.value = "";
          loadMediaTable();
        });
    });
  }

  loadMediaTable();
  loadDocuments();
}

function loadMediaTable() {
  var table = document.getElementById("media-table");

  api("/admin/media")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(
        table,
        ["Preview", "Name", "Type", "Size", "Dimensions", ""],
        d.rows,
        function (m) {
          return [
            mediaThumb(m, "5rem"),
            m.original_name || m.filename,
            m.mime,
            formatBytes(m.size_bytes),
            m.width && m.height ? m.width + " × " + m.height : "·",
            button("Delete", "", function () {
              if (!confirm("Delete " + m.filename + "? Pages that still use it will refuse this.")) return;
              api("/admin/media/" + m.id, { method: "DELETE" })
                .then(function (res) { return ok(res, "Failed."); })
                .then(function () { loadMediaTable(); })
                .catch(function (err) { alert(err.message); });
            })
          ];
        }
      );
    })
    .catch(function (e) { fail(table, e); });
}

function loadDocuments() {
  var table = document.getElementById("documents-table");
  var form = document.getElementById("create-document-form");

  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = { slug: form.slug.value.trim(), title: form.title.value.trim() };
      if (!body.slug || !body.title) return;

      api("/admin/vault-items", { method: "POST", body: body })
        .then(function (res) { return ok(res, "Could not create the document."); })
        .then(function () {
          form.reset();
          loadDocuments();
        })
        .catch(function (err) { alert(err.message); });
    });
  }

  api("/admin/vault-items")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(table, ["Title", "File", "On disk", "Shown", "Order", ""], d.rows, function (item) {
        var titleInput = el("input", "admin-input");
        titleInput.type = "text";
        titleInput.value = item.title;
        titleInput.maxLength = 120;

        var orderInput = el("input", "admin-input admin-input--narrow");
        orderInput.type = "number";
        orderInput.value = item.sortOrder;
        orderInput.min = "0";

        var shown = el("input");
        shown.type = "checkbox";
        shown.checked = item.visible;

        var actions = el("span", "admin-actions");

        actions.appendChild(button("Save", "admin-btn--accent", function () {
          api("/admin/vault-items/" + item.id, {
            method: "PATCH",
            body: {
              title: titleInput.value.trim(),
              visible: shown.checked,
              sortOrder: Number(orderInput.value)
            }
          })
            .then(function (res) { return ok(res, "Failed."); })
            .then(function () { loadDocuments(); })
            .catch(function (err) { alert(err.message); });
        }));

        var pdfInput = el("input", "admin-input");
        pdfInput.type = "file";
        pdfInput.accept = "application/pdf";
        pdfInput.addEventListener("change", function () {
          if (!pdfInput.files.length) return;
          pdfInput.disabled = true;

          var fd = new FormData();
          fd.append("file", pdfInput.files[0]);

          api("/admin/vault-items/" + item.id + "/file", { method: "POST", body: fd })
            .then(function (res) { return ok(res, "Upload failed."); })
            .then(function () { loadDocuments(); })
            .catch(function (err) {
              alert(err.message);
              pdfInput.disabled = false;
              pdfInput.value = "";
            });
        });
        actions.appendChild(pdfInput);

        actions.appendChild(button("Delete", "", function () {
          if (!confirm("Delete " + item.title + "? The file comes off the Pi with it; past downloads stay in the log.")) return;
          api("/admin/vault-items/" + item.id, { method: "DELETE" })
            .then(function (res) { return ok(res, "Failed."); })
            .then(function () { loadDocuments(); })
            .catch(function (err) { alert(err.message); });
        }));

        return [
          titleInput,
          item.filename,
          item.available ? "yes · " + formatBytes(item.sizeBytes) : "missing",
          shown,
          orderInput,
          actions
        ];
      });
    })
    .catch(function (e) { fail(table, e); });
}

var CHIP_ICONS = ["nodes", "image", "python", "rust", "proxy", "stream",
                  "cloud", "react", "typescript", "kobold", "node"];

var HOME_SLOTS = [
  ["feature", "Feature", "wide · two rows"],
  ["tall",    "Tall",    "two rows"],
  ["smallA",  "Small A", ""],
  ["smallB",  "Small B", ""]
];

var DEFAULT_ACCENT = "#ff1e2f";

function loadProjects() {
  var form = document.getElementById("create-project-form");

  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = form.title.value.trim();
      if (!title) return;

      api("/admin/projects", { method: "POST", body: { title: title } })
        .then(function (res) { return ok(res, "Could not create the page."); })
        .then(function (created) {
          form.reset();
          openProjectEditor(created.id);
        })
        .catch(function (err) { alert(err.message); });
    });
  }

  loadProjectsTable();
}

function loadProjectsTable() {
  var table = document.getElementById("projects-table");

  api("/admin/projects")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderTable(
        table,
        ["Title", "Slug", "Status", "Home", "Published", ""],
        d.rows,
        function (p) {
          var actions = el("span", "admin-actions");

          actions.appendChild(button("Edit", "admin-btn--accent", function () {
            openProjectEditor(p.id);
          }));

          if (p.publishedAt) {
            actions.appendChild(button("Unpublish", "", function () {
              if (!confirm("Take project-" + p.slug + ".html off the site? It also leaves the home page and the index.")) return;
              api("/admin/projects/" + p.id + "/unpublish", { method: "POST" })
                .then(function (res) { return ok(res, "Failed."); })
                .then(function () { reload("projects"); loaded.home = false; })
                .catch(function (err) { alert(err.message); });
            }));
          }

          actions.appendChild(button("Delete", "", function () {
            var warning = p.publishedAt
              ? "Delete " + p.title + "? Its page comes off the site immediately."
              : "Delete the draft " + p.title + "?";
            if (!confirm(warning)) return;
            api("/admin/projects/" + p.id, { method: "DELETE" })
              .then(function (res) { return ok(res, "Failed."); })
              .then(function () { reload("projects"); loaded.home = false; })
              .catch(function (err) { alert(err.message); });
          }));

          var published = p.publishedAt ? when(p.publishedAt) : "draft";
          if (p.publishedAt && p.updatedAt > p.publishedAt) published += " · edits pending";

          return [p.title, p.slug, p.status, slotLabel(p.homeSlot), published, actions];
        }
      );
    })
    .catch(function (e) { fail(table, e); });
}

function slotLabel(slot) {
  var found = null;
  HOME_SLOTS.forEach(function (s) { if (s[0] === slot) found = s[1]; });
  return found || "not shown";
}

function loadHomePage() {
  var host = document.getElementById("home-editor");

  api("/admin/projects")
    .then(function (r) { return r.json(); })
    .then(function (d) { buildHomeEditor(host, d.rows || []); })
    .catch(function () {
      host.textContent = "";
      host.appendChild(el("p", "admin-note", "Could not load the pages."));
    });
}

function buildHomeEditor(host, rows) {
  host.textContent = "";

  var placed = rows.filter(function (r) { return r.homeSlot; });
  var live = rows.filter(function (r) { return r.publishedAt && r.visible; });

  function republish(afterwards) {
    return api("/admin/projects/render", { method: "POST" })
      .then(function (res) { return ok(res, "Could not write the pages."); })
      .then(function () { if (afterwards) afterwards(); })
      .catch(function (err) { alert(err.message); });
  }

  function refresh() {
    republish(function () { reload("home"); loaded.projects = false; loadProjectsTable(); });
  }

  var bar = el("div", "pe-bar");
  var state = el("span", "pe-bar__state");
  var unplaced = placed.filter(function (p) { return !(p.publishedAt && p.visible); }).length;
  state.textContent = unplaced
    ? unplaced + " placed page" + (unplaced === 1 ? " is" : "s are") + " not published, so " +
      (unplaced === 1 ? "it does" : "they do") + " not appear on the home page yet."
    : placed.length + " of 4 cells in use.";
  bar.appendChild(state);
  bar.appendChild(el("span", "pe-bar__spacer"));
  bar.appendChild(button("Preview ↗", "", function () { window.open("/", "_blank"); }));
  bar.appendChild(button("Write the pages again", "admin-btn--accent", function () {
    republish(function () { alert("Home page, index and every published project page rewritten."); });
  }));
  host.appendChild(bar);

  host.appendChild(el("p", "pe-annot",
    "The bento has four project cells. Only published, listed pages appear in them. Everything else on the " +
    "home page (the hero, the about card, the GitHub graph, the link stack) is hand-written and untouched by this."));

  var cells = el("section", "pe-card");
  cells.appendChild(el("span", "pe-card__label", "The four cells"));

  var map = el("div", "pe-slots pe-slots--lg");
  map.setAttribute("role", "group");
  map.setAttribute("aria-label", "Home page cells");

  HOME_SLOTS.forEach(function (slot) {
    var holder = null;
    rows.forEach(function (r) { if (r.homeSlot === slot[0]) holder = r; });

    var cell = el("button", "pe-slot pe-slot--" + slot[0]);
    cell.type = "button";
    cell.setAttribute("aria-pressed", holder ? "true" : "false");
    if (holder) {
      cell.setAttribute("data-taken", "1");
      if (holder.accent) cell.style.setProperty("--edge-brand", holder.accent);
    }

    var name = el("strong");
    name.appendChild(el("span", "pe-slot__dot"));
    name.appendChild(document.createTextNode(slot[1]));
    cell.appendChild(name);
    cell.appendChild(el("span", "pe-slot__name", holder ? holder.title : "empty"));
    if (slot[2]) cell.appendChild(el("span", "pe-slot__name", slot[2]));

    cell.addEventListener("click", function () {
      var select = document.getElementById("slot-" + slot[0]);
      if (select) { select.focus(); }
    });

    map.appendChild(cell);
  });

  cells.appendChild(map);

  var grid = el("div", "pe-grid");
  grid.style.marginTop = "var(--stack-md)";

  HOME_SLOTS.forEach(function (slot) {
    var field = el("label", "pe-field");
    field.appendChild(el("span", "pe-field__label", slot[1]));

    var select = el("select", "admin-input");
    select.id = "slot-" + slot[0];
    select.appendChild(new Option("(empty)", ""));
    rows.forEach(function (r) {
      select.appendChild(new Option(r.title, String(r.id)));
    });

    var holder = null;
    rows.forEach(function (r) { if (r.homeSlot === slot[0]) holder = r; });
    select.value = holder ? String(holder.id) : "";

    select.addEventListener("change", function () {
      var id = Number(select.value);
      var previous = holder;

      var call = id
        ? api("/admin/projects/" + id, { method: "PUT", body: { homeSlot: slot[0] } })
        : previous
          ? api("/admin/projects/" + previous.id, { method: "PUT", body: { homeSlot: null } })
          : Promise.resolve(null);

      Promise.resolve(call)
        .then(function (res) { return res ? ok(res, "Could not place the page.") : null; })
        .then(function () { refresh(); })
        .catch(function (err) { alert(err.message); reload("home"); });
    });

    field.appendChild(select);
    grid.appendChild(field);
  });

  cells.appendChild(grid);
  cells.appendChild(el("p", "pe-field__hint",
    "Picking a page that already holds another cell swaps the two. A cell can never hold two pages, and a page " +
    "can never hold two cells. With fewer than four placed, the cards close up from the top and the grid reflows " +
    "so there is no hole."));
  host.appendChild(cells);

  var order = el("section", "pe-card");
  order.appendChild(el("span", "pe-card__label", "Order on projects.html"));
  order.appendChild(el("p", "pe-field__hint",
    "The index page and the prev/next pager at the bottom of every project follow this order, independently of the bento."));

  var table = el("table", "admin-table");
  var sorted = rows.slice().sort(function (a, b) {
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
  });

  function move(index, delta) {
    if (index + delta < 0 || index + delta >= sorted.length) return;

    var next = sorted.slice();
    var moved = next.splice(index, 1)[0];
    next.splice(index + delta, 0, moved);

    Promise.all(next.map(function (row, i) {
      if (row.sortOrder === i * 10) return null;
      return api("/admin/projects/" + row.id, { method: "PUT", body: { sortOrder: i * 10 } })
        .then(function (res) { return ok(res, "Could not reorder."); });
    }).filter(Boolean))
      .then(function () { refresh(); })
      .catch(function (err) { alert(err.message); reload("home"); });
  }

  renderTable(table, ["#", "Page", "Status", "Listed", "Home", ""], sorted, function (row) {
    var i = sorted.indexOf(row);

    var listed = el("input");
    listed.type = "checkbox";
    listed.checked = row.visible;
    listed.title = "Shown on projects.html, in the pagers and on the home page";
    listed.addEventListener("change", function () {
      api("/admin/projects/" + row.id, { method: "PUT", body: { visible: listed.checked } })
        .then(function (res) { return ok(res, "Failed."); })
        .then(function () { refresh(); })
        .catch(function (err) { alert(err.message); reload("home"); });
    });

    var actions = el("span", "admin-actions");
    actions.appendChild(button("▲", "", function () { move(i, -1); }));
    actions.appendChild(button("▼", "", function () { move(i, 1); }));

    return [
      i + 1,
      row.title + (row.publishedAt ? "" : " · draft"),
      row.status,
      listed,
      slotLabel(row.homeSlot),
      actions
    ];
  });

  order.appendChild(el("div", "admin-scroll")).appendChild(table);
  host.appendChild(order);

  if (!live.length) {
    host.appendChild(el("p", "pe-annot",
      "Nothing is published yet, so the home page has no project cards and the bento is drawn without them."));
  }
}

function measureFile(file) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var done = function (w, h) {
      URL.revokeObjectURL(url);
      resolve({ width: w || null, height: h || null });
    };

    if (file.type.indexOf("image/") === 0) {
      var img = new Image();
      img.onload = function () { done(img.naturalWidth, img.naturalHeight); };
      img.onerror = function () { done(null, null); };
      img.src = url;
    } else if (file.type === "video/mp4") {
      var video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = function () { done(video.videoWidth, video.videoHeight); };
      video.onerror = function () { done(null, null); };
      video.src = url;
    } else {
      done(null, null);
    }
  });
}

function uploadMedia(file) {
  return measureFile(file).then(function (dims) {
    var fd = new FormData();
    fd.append("file", file);
    if (dims.width) fd.append("width", dims.width);
    if (dims.height) fd.append("height", dims.height);

    return api("/admin/media", { method: "POST", body: fd });
  }).then(function (res) {
    return ok(res, "Upload failed.");
  });
}

function mediaLabel(m) {
  var name = m.original_name || m.filename;
  var size = m.size_bytes ? " · " + formatBytes(m.size_bytes) : "";
  var dims = m.width && m.height ? " · " + m.width + "×" + m.height : "";
  return name + dims + size;
}

function mediaThumb(m, width) {
  var node;
  if (m && m.mime === "video/mp4") {
    node = el("video", "pe-thumb");
    node.muted = true;
    node.playsInline = true;
    node.preload = "metadata";
    node.src = "/assets/up/" + m.filename;
  } else if (m) {
    node = el("img", "pe-thumb");
    node.loading = "lazy";
    node.decoding = "async";
    node.alt = "";
    node.src = "/assets/up/" + m.filename;
  } else {
    node = el("div", "pe-thumb");
  }
  if (width) node.style.width = width;
  return node;
}

function mediaPicker(mediaRows, currentId, accept, onPick) {
  var root = el("div");
  var preview = el("div");
  var meta = el("span", "pe-row__meta");

  var select = el("select", "admin-input");
  select.appendChild(new Option("(choose an upload)", ""));
  mediaRows.forEach(function (m) {
    select.appendChild(new Option(mediaLabel(m), String(m.id)));
  });
  if (currentId) select.value = String(currentId);

  var file = el("input", "admin-input");
  file.type = "file";
  if (accept) file.accept = accept;

  function current() {
    var id = Number(select.value) || 0;
    var found = null;
    mediaRows.forEach(function (m) { if (m.id === id) found = m; });
    return found;
  }

  function paint() {
    var m = current();
    preview.textContent = "";
    preview.appendChild(mediaThumb(m));
    meta.textContent = m ? mediaLabel(m) : "No file chosen yet.";
    if (onPick) onPick(m);
  }

  select.addEventListener("change", paint);

  file.addEventListener("change", function () {
    if (!file.files.length) return;
    file.disabled = true;

    uploadMedia(file.files[0])
      .then(function (row) {
        var known = mediaRows.some(function (m) { return m.id === row.id; });
        if (!known) {
          mediaRows.unshift(row);
          select.insertBefore(new Option(mediaLabel(row), String(row.id)), select.options[1]);
        }
        select.value = String(row.id);
        paint();
      })
      .catch(function (err) { alert(err.message); })
      .finally(function () {
        file.disabled = false;
        file.value = "";
      });
  });

  root.appendChild(preview);
  root.appendChild(meta);
  root.appendChild(select);
  root.appendChild(file);
  paint();

  return {
    root: root,
    read: function () { return Number(select.value) || 0; },
    mime: function () { var m = current(); return m ? m.mime : ""; }
  };
}

function peField(labelText, control, hint, wide) {
  var wrap = el("label", "pe-field" + (wide ? " pe-field--wide" : ""));
  wrap.appendChild(el("span", "pe-field__label", labelText));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el("span", "pe-field__hint", hint));
  return wrap;
}

function peInput(value, maxLength, className) {
  var input = el("input", "admin-input" + (className ? " " + className : ""));
  input.type = "text";
  if (maxLength) input.maxLength = maxLength;
  input.value = value || "";
  return input;
}

function peArea(value, rows, maxLength) {
  var area = el("textarea", "admin-input");
  area.rows = rows || 4;
  if (maxLength) area.maxLength = maxLength;
  area.value = value || "";
  return area;
}

function peSelect(options, value) {
  var select = el("select", "admin-input");
  options.forEach(function (opt) {
    select.appendChild(new Option(opt[1], opt[0]));
  });
  select.value = value || "";
  return select;
}

function peCheck(labelText, checked) {
  var label = el("label", "pe-check");
  var input = el("input");
  input.type = "checkbox";
  input.checked = !!checked;
  label.appendChild(input);
  label.appendChild(document.createTextNode(" " + labelText));
  return { root: label, input: input };
}

function peRadio(name, labelText, checked, value) {
  var label = el("label", "pe-check");
  var input = el("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = !!checked;
  label.appendChild(input);
  label.appendChild(document.createTextNode(" " + labelText));
  return { root: label, input: input };
}

function splitParas(value) {
  return value.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function slugify(title) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

function hsvToRgb(h, s, v) {
  var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  var t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return t.map(function (n) { return Math.round((n + m) * 255); });
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
  if (d) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: mx ? d / mx : 0, v: mx };
}

function toHex(rgb) {
  return "#" + rgb.map(function (n) { return n.toString(16).padStart(2, "0"); }).join("");
}

function buildColorPicker(initial, presets, title, onChange) {
  var root = el("div", "pe-color");

  var sv = el("div", "pe-color__sv");
  sv.setAttribute("role", "application");
  sv.setAttribute("aria-label", "Saturation and brightness");
  var svKnob = el("span", "pe-color__knob");
  sv.appendChild(svKnob);

  var hue = el("div", "pe-color__hue");
  hue.setAttribute("role", "application");
  hue.setAttribute("aria-label", "Hue");
  var hueKnob = el("span", "pe-color__knob pe-color__knob--hue");
  hue.appendChild(hueKnob);

  var side = el("div", "pe-color__side");
  var hex = el("input", "admin-input pe-color__hex");
  hex.type = "text";
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute("aria-label", "Accent colour, hex");
  hex.value = initial || DEFAULT_ACCENT;
  side.appendChild(hex);

  var presetRow = el("div", "pe-color__presets");
  presets.forEach(function (value) {
    var b = el("button", "pe-color__preset");
    b.type = "button";
    b.style.background = value;
    b.setAttribute("aria-label", value);
    b.addEventListener("click", function () {
      hex.value = value;
      fromHex();
    });
    presetRow.appendChild(b);
  });
  side.appendChild(presetRow);
  side.appendChild(el("span", "pe-field__hint", "One colour. The rim's shade and tint are derived from it, in both themes."));

  var demo = el("div", "box box--edge box--link is-custom pe-color__demo");
  demo.appendChild(el("span", "box__label", "Featured"));
  var demoHead = el("div", "project-box__head");
  var demoName = el("span", "project-box__name", title || "This project");
  demoHead.appendChild(demoName);
  demo.appendChild(demoHead);

  root.appendChild(sv);
  root.appendChild(hue);
  root.appendChild(side);
  root.appendChild(demo);

  var state = { h: 0, s: 1, v: 1 };

  var ready = false;

  function paint(pushHex) {
    var value = toHex(hsvToRgb(state.h, state.s, state.v));
    sv.style.setProperty("--pick-hue", toHex(hsvToRgb(state.h, 1, 1)));
    svKnob.style.left = (state.s * 100) + "%";
    svKnob.style.top = ((1 - state.v) * 100) + "%";
    hueKnob.style.top = ((state.h / 360) * 100) + "%";
    demo.style.setProperty("--edge-brand", value);
    if (pushHex) hex.value = value;
    if (ready && onChange) onChange(value);
  }

  function fromHex() {
    var v = hex.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    state = rgbToHsv(parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16));
    paint(false);
  }

  function drag(elm, onMove) {
    function run(e) {
      var r = elm.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      );
      paint(true);
    }
    elm.addEventListener("pointerdown", function (e) {
      elm.setPointerCapture(e.pointerId);
      run(e);
      function mv(ev) { run(ev); }
      function up() { elm.removeEventListener("pointermove", mv); }
      elm.addEventListener("pointermove", mv);
      elm.addEventListener("pointerup", up, { once: true });
    });
  }

  drag(sv, function (x, y) { state.s = x; state.v = 1 - y; });
  drag(hue, function (_, y) { state.h = y * 360; });

  hex.addEventListener("input", fromHex);

  fromHex();
  ready = true;

  return {
    root: root,
    read: function () {
      var v = hex.value.trim().toLowerCase();
      return /^#[0-9a-f]{6}$/.test(v) ? v : null;
    },
    setTitle: function (value) { demoName.textContent = value || "This project"; }
  };
}

var editorDirty = false;

function markDirty(on) {
  editorDirty = on;
  var state = document.getElementById("pe-state");
  if (!state) return;
  state.setAttribute("data-dirty", on ? "1" : "0");
  if (on) state.textContent = "Unsaved changes";
}

function guardUnsaved() {
  if (!editorDirty) return true;
  return confirm("This page has unsaved changes. Leave them behind?");
}

function guardSectionSwitch() {
  var editor = document.getElementById("project-editor");
  if (!editor || editor.hidden) return true;
  return guardUnsaved();
}

window.addEventListener("beforeunload", function (e) {
  if (!editorDirty) return;
  e.preventDefault();
  e.returnValue = "";
});

function openProjectEditor(id) {
  var host = document.getElementById("project-editor");
  var list = document.getElementById("projects-list");

  Promise.all([
    api("/admin/projects/" + id).then(function (r) {
      if (!r.ok) throw new Error("Could not load the project.");
      return r.json();
    }),
    api("/admin/media").then(function (r) { return r.json(); }),
    api("/admin/projects").then(function (r) { return r.json(); })
  ])
    .then(function (results) {
      list.hidden = true;
      host.hidden = false;
      window.scrollTo(0, 0);
      buildProjectEditor(host, results[0], results[1].rows || [], results[2].rows || []);
    })
    .catch(function (err) { alert(err.message); });
}

function closeProjectEditor() {
  markDirty(false);
  document.getElementById("project-editor").hidden = true;
  document.getElementById("project-editor").textContent = "";
  document.getElementById("projects-list").hidden = false;
  reload("projects");
}

function buildProjectEditor(host, record, mediaRows, allProjects) {
  host.textContent = "";
  editorDirty = false;

  var bands = [];    // ordered band cards, each { root, read, kind }
  var chipRows = []; // ordered chip rows

  var column = el("div", "pe");
  host.appendChild(column);

  column.addEventListener("input", function () { markDirty(true); });
  column.addEventListener("change", function () { markDirty(true); });

  var bar = el("div", "pe-bar");
  var state = el("span", "pe-bar__state");
  state.id = "pe-state";

  function describe() {
    if (!record.publishedAt) return "Draft. Not on the site yet.";
    var s = "Published " + when(record.publishedAt) + " as project-" + record.slug + ".html.";
    if (record.updatedAt > record.publishedAt) s += " Saved edits are not published yet.";
    return s;
  }

  function setState(text) {
    state.textContent = text;
    state.setAttribute("data-dirty", "0");
    editorDirty = false;
  }

  bar.appendChild(button("← All pages", "", function () {
    if (!guardUnsaved()) return;
    closeProjectEditor();
  }));
  bar.appendChild(el("span", "pe-bar__spacer"));
  bar.appendChild(state);

  bar.appendChild(button("Save", "", function () {
    saveProject()
      .then(function () { setState("Saved. " + describe()); })
      .catch(function (err) { alert(err.message); });
  }));

  bar.appendChild(button("Preview ↗", "", function () {
    var tab = window.open("about:blank", "_blank");
    saveProject().then(function () {
      var url = "/api/admin/projects/" + record.id + "/preview";
      if (tab) tab.location = url;
      else window.open(url, "_blank");
    }).catch(function (err) {
      if (tab) tab.close();
      alert(err.message);
    });
  }));

  bar.appendChild(button(record.publishedAt ? "Publish again" : "Publish", "admin-btn--accent", function () {
    saveProject().then(function () {
      if (!confirm("Publish project-" + slugInput.value.trim() + ".html to the live site?")) return null;
      return api("/admin/projects/" + record.id + "/publish", { method: "POST" })
        .then(function (res) { return ok(res, "Publish failed."); })
        .then(function () {
          markDirty(false);
          loaded.home = false;
          openProjectEditor(record.id);
        });
    }).catch(function (err) { alert(err.message); });
  }));

  if (record.publishedAt) {
    bar.appendChild(button("Unpublish", "", function () {
      if (!confirm("Take project-" + record.slug + ".html off the site?")) return;
      api("/admin/projects/" + record.id + "/unpublish", { method: "POST" })
        .then(function (res) { return ok(res, "Failed."); })
        .then(function () {
          markDirty(false);
          loaded.home = false;
          openProjectEditor(record.id);
        })
        .catch(function (err) { alert(err.message); });
    }));
  }

  column.appendChild(bar);
  setState(describe());

  column.appendChild(el("p", "pe-annot",
    "The form is in the order the page renders: identity at the top, bands in the middle, the repo link at the " +
    "bottom. What you fill in top to bottom is what a reader sees top to bottom."));

  var head = el("section", "pe-card");
  head.appendChild(el("span", "pe-card__label", "The project"));
  var grid = el("div", "pe-grid");

  var titleInput = peInput(record.title, 120, "pe-input--title");
  grid.appendChild(peField("Title", titleInput, null, true));

  var slugInput = peInput(record.slug, 48);
  slugInput.disabled = !!record.publishedAt;
  var slugTouched = !!record.publishedAt;
  slugInput.addEventListener("input", function () { slugTouched = true; });
  grid.appendChild(peField(
    "Slug",
    slugInput,
    record.publishedAt
      ? "Locked: it is the published file's name. Unpublish to change it."
      : "Follows the title until you touch it. Becomes project-<slug>.html, and locks once published.",
    false
  ));

  titleInput.addEventListener("input", function () {
    if (!slugTouched) slugInput.value = slugify(titleInput.value);
    accent.setTitle(titleInput.value.trim());
  });

  var repoInput = peInput(record.repoUrl, 200);
  repoInput.type = "url";
  repoInput.placeholder = "https://github.com/…";
  grid.appendChild(peField("Repository", repoInput,
    "A small link at the very bottom of the page. Leave empty and no link is rendered.", false));

  var ledeArea = peArea(record.lede, 3, 500);
  grid.appendChild(peField("Description", ledeArea,
    "One text, two jobs: the opening line of the project page and the blurb on both index cards.", true));

  var blurbWrap = el("div", "pe-field pe-field--wide");
  var blurbToggle = peCheck("Use a shorter text on the cards", !!record.cardBlurb);
  var blurbArea = peArea(record.cardBlurb, 2, 300);
  blurbArea.placeholder = "A sentence for the home bento and the projects index.";
  var blurbField = peField("Card text", blurbArea,
    "Used on both index cards instead of the description. The page itself keeps the long one.", false);
  blurbField.style.marginTop = "var(--stack-sm)";
  if (!record.cardBlurb) blurbField.classList.add("pe-hidden");

  blurbToggle.input.addEventListener("change", function () {
    blurbField.classList.toggle("pe-hidden", !blurbToggle.input.checked);
    if (blurbToggle.input.checked) blurbArea.focus();
    else blurbArea.value = "";
  });

  blurbWrap.appendChild(blurbToggle.root);
  blurbWrap.appendChild(blurbField);
  grid.appendChild(blurbWrap);

  // Index-facing, like the card text above it: the picture is what tells the
  // rows apart now that a project's colour is one hairline at the seam's end.
  var coverWrap = el("div", "pe-field pe-field--wide");
  coverWrap.appendChild(el("span", "pe-field__label", "Cover picture"));
  var cover = mediaPicker(mediaRows, record.coverMediaId,
    "image/png,image/jpeg,image/webp,image/gif");
  coverWrap.appendChild(cover.root);
  coverWrap.appendChild(el("span", "pe-field__hint",
    "The picture beside this project on the projects index, cropped to 16:9. " +
    "Leave it empty and the row is words only."));
  grid.appendChild(coverWrap);

  var statusSelect = peSelect([["", "·"], ["WIP", "WIP"], ["Featured", "Featured"]], record.status);
  grid.appendChild(peField("Status", statusSelect, null, false));

  var inUse = [];
  allProjects.forEach(function (p) {
    if (p.accent && p.id !== record.id && inUse.indexOf(p.accent) === -1) inUse.push(p.accent);
  });
  if (!inUse.length) inUse = ["#ff4d00", "#eafb2e", "#4e8c5a", "#52c23a", "#35e0ff", "#ff1e2f"];

  var accentWrap = el("div", "pe-field pe-field--wide");
  accentWrap.appendChild(el("span", "pe-field__label", "Accent"));
  var accent = buildColorPicker(record.accent || DEFAULT_ACCENT, inUse, record.title, function () {
    markDirty(true);
  });
  accentWrap.appendChild(accent.root);
  grid.appendChild(accentWrap);

  var chipsWrap = el("div", "pe-field pe-field--wide");
  chipsWrap.appendChild(el("span", "pe-field__label", "Chips"));
  var chipsHost = el("div", "admin-actions");
  chipsHost.style.flexWrap = "wrap";
  chipsWrap.appendChild(chipsHost);

  function addChipRow(chip) {
    var labelInput = peInput(chip.label, 60);
    labelInput.style.maxWidth = "10rem";
    labelInput.setAttribute("aria-label", "Chip label");

    var iconSelect = peSelect(
      [["", "no icon"]].concat(CHIP_ICONS.map(function (n) { return [n, n]; })),
      chip.icon
    );
    iconSelect.style.maxWidth = "9rem";
    iconSelect.setAttribute("aria-label", "Chip icon");

    var remove = button("✕", "", function () {
      chipsHost.removeChild(labelInput);
      chipsHost.removeChild(iconSelect);
      chipsHost.removeChild(remove);
      chipRows.splice(chipRows.indexOf(entry), 1);
      markDirty(true);
    });
    remove.setAttribute("aria-label", "Remove chip");

    var entry = {
      read: function () {
        var label = labelInput.value.trim();
        if (!label) return null;
        return { label: label, icon: iconSelect.value || null };
      }
    };

    chipRows.push(entry);
    chipsHost.insertBefore(labelInput, addChip);
    chipsHost.insertBefore(iconSelect, addChip);
    chipsHost.insertBefore(remove, addChip);
  }

  var addChip = button("+ Chip", "", function () { addChipRow({ label: "", icon: null }); });
  chipsHost.appendChild(addChip);
  (record.chips || []).forEach(addChipRow);

  grid.appendChild(chipsWrap);
  head.appendChild(grid);
  column.appendChild(head);

  var placement = el("p", "pe-annot");
  placement.appendChild(document.createTextNode(
    "One card per band, in the order they appear on the page. Foldable wraps that band in the closed <details> " +
    "the site already uses, so nothing inside a folded band is downloaded until a reader opens it. Where this " +
    "project sits on the home page is set in "));
  placement.appendChild(button("Home page", "", function () {
    if (!guardUnsaved()) return;
    closeProjectEditor();
    var tab = document.getElementById("tab-home");
    if (tab) tab.click();
  }));
  placement.appendChild(document.createTextNode("."));
  column.appendChild(placement);

  var bandsHost = el("div");
  column.appendChild(bandsHost);

  function repaint() {
    bandsHost.textContent = "";
    bands.forEach(function (b) { bandsHost.appendChild(b.root); });
  }

  function addBand(block, kind) {
    var entry = buildBandCard(block, kind, mediaRows, {
      moveUp: function () {
        var i = bands.indexOf(entry);
        if (i > 0) { bands.splice(i, 1); bands.splice(i - 1, 0, entry); repaint(); markDirty(true); }
      },
      moveDown: function () {
        var i = bands.indexOf(entry);
        if (i < bands.length - 1) { bands.splice(i, 1); bands.splice(i + 1, 0, entry); repaint(); markDirty(true); }
      },
      remove: function () {
        if (!confirm("Remove this band?")) return;
        bands.splice(bands.indexOf(entry), 1);
        repaint();
        markDirty(true);
      }
    });
    bands.push(entry);
    bandsHost.appendChild(entry.root);
    return entry;
  }

  (record.blocks || []).forEach(function (block) {
    addBand(block, bandKind(block, mediaRows));
  });

  var adders = el("div", "pe-adders");
  adders.appendChild(button("+ Text", "", function () {
    addBand({ type: "text", heading: "", body: [], collapsible: false }, "text");
    markDirty(true);
  }));
  adders.appendChild(button("+ Images / GIFs", "", function () {
    addBand({ type: "media", heading: "", rows: [], collapsible: false }, "images");
    markDirty(true);
  }));
  adders.appendChild(button("+ Video", "", function () {
    addBand({ type: "media", heading: "", rows: [], collapsible: true }, "video");
    markDirty(true);
  }));
  column.appendChild(adders);

  column.appendChild(el("p", "pe-annot",
    "Those three are the whole catalogue. A project page is a description, some words, and some pictures."));

  function saveProject() {
    var body = {
      title: titleInput.value.trim(),
      status: statusSelect.value || null,
      accent: accent.read(),
      coverMediaId: cover.read() || null,
      repoUrl: repoInput.value.trim() || null,
      lede: ledeArea.value.trim() || null,
      cardBlurb: blurbToggle.input.checked ? (blurbArea.value.trim() || null) : null,
      chips: chipRows.map(function (c) { return c.read(); }).filter(Boolean),
      blocks: bands.map(function (b) { return b.read(); })
    };
    if (!slugInput.disabled) body.slug = slugInput.value.trim();

    if (!body.title) return Promise.reject(new Error("The page needs a title."));
    if (!body.slug && !slugInput.disabled) return Promise.reject(new Error("The page needs a slug."));

    return api("/admin/projects/" + record.id, { method: "PUT", body: body })
      .then(function (res) { return ok(res, "Could not save."); })
      .then(function () {
        record.title = body.title;
        if (body.slug) record.slug = body.slug;
        markDirty(false);
      });
  }
}

function bandKind(block, mediaRows) {
  if (block.type === "text") return "text";
  var rows = block.rows || [];
  if (!rows.length) return "images";
  var allVideo = rows.every(function (r) {
    var m = null;
    mediaRows.forEach(function (x) { if (x.id === r.mediaId) m = x; });
    return m && m.mime === "video/mp4";
  });
  return allVideo ? "video" : "images";
}

var rowSeq = 0;

function buildBandCard(block, kind, mediaRows, controls) {
  var root = el("section", "pe-card pe-band");
  var isText = kind === "text";

  var head = el("div", "pe-band__head");
  head.appendChild(el("span", "pe-band__kind", isText ? "Text" : kind === "video" ? "Video" : "Images"));

  var heading = peInput(block.heading, 120);
  heading.setAttribute("aria-label", "Band heading");
  heading.placeholder = isText ? "What it does" : "My setup";
  head.appendChild(heading);

  var fold = peCheck("Foldable", block.collapsible);
  fold.input.addEventListener("change", function () {
    root.classList.toggle("pe-band--folded", fold.input.checked);
  });
  if (block.collapsible) root.classList.add("pe-band--folded");
  head.appendChild(fold.root);

  var actions = el("div", "admin-actions");
  var up = button("▲", "", controls.moveUp);
  up.setAttribute("aria-label", "Move band up");
  var down = button("▼", "", controls.moveDown);
  down.setAttribute("aria-label", "Move band down");
  var kill = button("✕", "", controls.remove);
  kill.setAttribute("aria-label", "Remove band");
  actions.appendChild(up);
  actions.appendChild(down);
  actions.appendChild(kill);
  head.appendChild(actions);

  root.appendChild(head);

  if (isText) {
    var body = peArea((block.body || []).join("\n\n"), 6);
    root.appendChild(peField("Paragraphs", body,
      "One blank line starts a new paragraph. `code` and [label](url) are the only markup.", false));

    return {
      root: root,
      kind: kind,
      read: function () {
        return {
          type: "text",
          heading: heading.value.trim(),
          body: splitParas(body.value),
          collapsible: fold.input.checked
        };
      }
    };
  }

  var accept = kind === "video" ? "video/mp4" : "image/png,image/jpeg,image/webp,image/gif";
  var rowsHost = el("div");
  root.appendChild(rowsHost);
  var rowEntries = [];

  function repaintRows() {
    rowsHost.textContent = "";
    rowEntries.forEach(function (r) { rowsHost.appendChild(r.root); });
  }

  function addRow(row) {
    var name = "layout-" + (rowSeq++);
    var card = el("div", "pe-row");

    var left = el("div");
    var fields = el("div", "pe-row__fields");

    var layout = row.layout || (kind === "video" ? "below" : "beside");
    var layoutTouched = !!row.layout;

    var title = peInput(row.title, 120);
    title.setAttribute("aria-label", "Row title");
    title.placeholder = "What this one is";

    var text = peArea((row.body || []).join("\n\n"), 3);
    text.setAttribute("aria-label", "Row text");
    text.placeholder = "The words beside it. Blank line between paragraphs.";

    var alt = peInput(row.alt, 300);
    alt.setAttribute("aria-label", "Alt text");
    alt.placeholder = "Alt text: what the picture shows";

    var beside = peRadio(name, "Text beside", layout === "beside", "beside");
    var below = peRadio(name, "Text below", layout === "below", "below");

    function setLayout(value) {
      beside.input.checked = value === "beside";
      below.input.checked = value === "below";
      card.classList.toggle("pe-row--below", value === "below");
    }

    [beside, below].forEach(function (r) {
      r.input.addEventListener("change", function () {
        layoutTouched = true;
        setLayout(r.input.value);
      });
    });

    var radios = el("div", "pe-radios");
    radios.appendChild(beside.root);
    radios.appendChild(below.root);
    radios.appendChild(el("span", "pe-bar__spacer"));

    var rowUp = button("▲", "", function () {
      var i = rowEntries.indexOf(entry);
      if (i > 0) { rowEntries.splice(i, 1); rowEntries.splice(i - 1, 0, entry); repaintRows(); }
    });
    rowUp.setAttribute("aria-label", "Move row up");
    var rowDown = button("▼", "", function () {
      var i = rowEntries.indexOf(entry);
      if (i < rowEntries.length - 1) { rowEntries.splice(i, 1); rowEntries.splice(i + 1, 0, entry); repaintRows(); }
    });
    rowDown.setAttribute("aria-label", "Move row down");
    var rowKill = button("✕", "", function () {
      rowEntries.splice(rowEntries.indexOf(entry), 1);
      repaintRows();
    });
    rowKill.setAttribute("aria-label", "Remove row");

    radios.appendChild(rowUp);
    radios.appendChild(rowDown);
    radios.appendChild(rowKill);

    var picker = mediaPicker(mediaRows, row.mediaId, accept, function (m) {
      if (!m || layoutTouched) return;
      setLayout(m.mime === "video/mp4" ? "below" : "beside");
    });
    left.appendChild(picker.root);

    fields.appendChild(title);
    fields.appendChild(text);
    fields.appendChild(alt);
    fields.appendChild(radios);

    card.appendChild(left);
    card.appendChild(fields);
    setLayout(layout);

    var entry = {
      root: card,
      read: function () {
        return {
          mediaId: picker.read(),
          title: title.value.trim(),
          alt: alt.value.trim(),
          body: splitParas(text.value),
          layout: below.input.checked ? "below" : "beside"
        };
      }
    };

    rowEntries.push(entry);
    rowsHost.appendChild(card);
  }

  (block.rows || []).forEach(addRow);

  var add = button(kind === "video" ? "+ Add a clip" : "+ Add an image / GIF", "", function () {
    addRow({});
  });
  var drop = el("div", "pe-drop");
  drop.appendChild(add);
  drop.appendChild(el("span", "pe-field__hint",
    "Size and dimensions are read from the file itself; the fold's “N clips · X MB” hint is computed from them."));
  root.appendChild(drop);

  return {
    root: root,
    kind: kind,
    read: function () {
      return {
        type: "media",
        heading: heading.value.trim(),
        collapsible: fold.input.checked,
        rows: rowEntries.map(function (r) { return r.read(); })
      };
    }
  };
}
