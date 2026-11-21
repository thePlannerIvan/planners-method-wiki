/* Planners Method Wiki — 阅读器交互 */
(function () {
  "use strict";

  var search = document.getElementById("search");
  var searchWrap = document.querySelector(".search-wrap");
  var searchCount = document.querySelector(".search-count");
  var emptyState = document.querySelector(".empty-state");
  var expandAllBtn = document.getElementById("expand-all");
  var collapseAllBtn = document.getElementById("collapse-all");
  var lenses = Array.prototype.slice.call(document.querySelectorAll(".lens"));
  var modules = Array.prototype.slice.call(document.querySelectorAll(".module"));
  var navlinks = Array.prototype.slice.call(document.querySelectorAll(".navlink"));

  /* ---------- 展开 / 收起 ---------- */

  function setOpen(lens, open, auto) {
    lens.classList.toggle("is-open", open);
    var head = lens.querySelector(".lens-head");
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
    if (auto) lens.classList.toggle("is-auto-open", open);
    else lens.classList.remove("is-auto-open");
    expandAllBtn.setAttribute("aria-pressed", "false");
  }

  lenses.forEach(function (lens) {
    var head = lens.querySelector(".lens-head");
    head.addEventListener("click", function () {
      setOpen(lens, !lens.classList.contains("is-open"), false);
    });
  });

  expandAllBtn.addEventListener("click", function () {
    lenses.forEach(function (lens) {
      if (!lens.classList.contains("is-filtered")) setOpen(lens, true, false);
    });
    expandAllBtn.setAttribute("aria-pressed", "true");
    collapseAllBtn.setAttribute("aria-pressed", "false");
  });

  collapseAllBtn.addEventListener("click", function () {
    lenses.forEach(function (lens) {
      setOpen(lens, false, false);
    });
    collapseAllBtn.setAttribute("aria-pressed", "true");
    expandAllBtn.setAttribute("aria-pressed", "false");
  });

  /* ---------- 搜索 ---------- */

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function highlight(el, text, query) {
    if (!el) return;
    if (!query) {
      el.innerHTML = escapeHtml(text);
      return;
    }
    var lower = text.toLowerCase();
    var q = query.toLowerCase();
    var out = "";
    var i = 0;
    var idx = lower.indexOf(q);
    while (idx !== -1) {
      out += escapeHtml(text.slice(i, idx));
      out += "<mark>" + escapeHtml(text.slice(idx, idx + q.length)) + "</mark>";
      i = idx + q.length;
      idx = lower.indexOf(q, i);
    }
    out += escapeHtml(text.slice(i));
    el.innerHTML = out;
  }

  function runSearch() {
    var raw = search.value.trim();
    var q = raw.toLowerCase();
    searchWrap.classList.toggle("has-value", raw.length > 0);
    document.body.classList.toggle("is-searching", raw.length > 0);
    var visible = 0;

    lenses.forEach(function (lens) {
      var hay = lens.getAttribute("data-search") || "";
      var hit = !q || hay.indexOf(q) !== -1;
      lens.classList.toggle("is-filtered", !hit);
      if (hit) {
        visible += 1;
        if (q) {
          highlight(lens.querySelector(".lens-name"), lens.getAttribute("data-name") || "", raw);
          highlight(lens.querySelector(".lens-q"), lens.getAttribute("data-q") || "", raw);
          if (!lens.classList.contains("is-open")) setOpen(lens, true, true);
        } else {
          highlight(lens.querySelector(".lens-name"), lens.getAttribute("data-name") || "", "");
          highlight(lens.querySelector(".lens-q"), lens.getAttribute("data-q") || "", "");
          if (lens.classList.contains("is-auto-open")) setOpen(lens, false, false);
        }
      }
    });

    modules.forEach(function (mod) {
      var any = mod.querySelector(".lens:not(.is-filtered)");
      mod.classList.toggle("is-hidden", !any);
    });

    if (q) {
      searchCount.textContent = visible + " / " + lenses.length;
    } else {
      searchCount.textContent = "";
    }
    var emptyQuery = document.getElementById("empty-query");
    if (emptyQuery) emptyQuery.textContent = raw;
    emptyState.classList.toggle("is-visible", visible === 0);

    navlinks.forEach(function (link) {
      var target = document.getElementById(link.getAttribute("data-target"));
      link.style.opacity = target && target.classList.contains("is-hidden") ? "0.35" : "";
    });
  }

  search.addEventListener("input", runSearch);
  search.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var first = document.querySelector(".lens:not(.is-filtered)");
      if (first) {
        var mod = first.closest(".module");
        if (mod) window.scrollTo({ top: mod.offsetTop - 80, behavior: "smooth" });
      }
    }
    if (e.key === "Escape") {
      search.value = "";
      runSearch();
      search.blur();
    }
  });

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      search.focus();
      search.select();
    }
    if (e.key === "Escape") {
      lenses.forEach(function (lens) {
        if (lens.classList.contains("is-open")) setOpen(lens, false, false);
      });
    }
  });

  /* ---------- 目录高亮 ---------- */

  var ticking = false;
  function updateActive() {
    ticking = false;
    var anchor = window.scrollY + 140;
    var current = null;
    modules.forEach(function (mod) {
      if (!mod.classList.contains("is-hidden") && mod.offsetTop <= anchor) current = mod;
    });
    if (!current) current = modules.filter(function (m) { return !m.classList.contains("is-hidden"); })[0] || null;
    navlinks.forEach(function (link) {
      var target = document.getElementById(link.getAttribute("data-target"));
      link.classList.toggle("is-active", !!current && target === current);
    });
  }

  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateActive);
      }
    },
    { passive: true }
  );

  navlinks.forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      if (search.value.trim()) {
        search.value = "";
        runSearch();
      }
      var target = document.getElementById(link.getAttribute("data-target"));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + target.id);
      }
    });
  });

  /* ---------- 复制 ID ---------- */

  document.querySelectorAll(".copybtn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var value = btn.getAttribute("data-copy") || "";
      var done = function () {
        var old = btn.textContent;
        btn.textContent = "已复制";
        btn.classList.add("is-done");
        setTimeout(function () {
          btn.textContent = old;
          btn.classList.remove("is-done");
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch (err) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });

  /* ---------- 深链 ---------- */

  function openHash() {
    var id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains("lens")) {
      setOpen(el, true, false);
      setTimeout(function () {
        el.scrollIntoView({ block: "start" });
      }, 60);
    } else {
      el.scrollIntoView({ block: "start" });
    }
  }

  window.addEventListener("hashchange", openHash);

  /* ---------- 初始化 ---------- */

  updateActive();
  if (window.location.hash) {
    setTimeout(openHash, 120);
  }
})();
