(() => {
  "use strict";

  /* ======================================================================
     Data
     ====================================================================== */

  const PLATFORMS = window.PLATFORMS || [];
  const PMAP = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
  const COVERS = window.COVERS || {};
  // The full library is large, so it loads after the hand-picked games are on screen.
  let LIBRARY = null;
  let libraryPending = true;
  const HERO_DURATION = 7000;
  const CHUNK = 60;
  const TODAY = new Date().toISOString().slice(0, 10);
  const NEW_SINCE = new Date().getFullYear() - 1;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const norm = (s) => fold(s).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const slug = (s) => norm(s).replace(/ /g, "-");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString();
  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const SERIES = ["zelda", "hyrule", "mario kart", "mario party", "paper mario", "mario and luigi", "mario", "luigi", "yoshi", "wario",
    "donkey kong", "kirby", "metroid", "pokemon", "fire emblem", "xenoblade", "splatoon", "pikmin", "animal crossing", "smash",
    "bayonetta", "star fox", "f zero", "persona", "dragon quest", "final fantasy", "octopath", "castlevania", "hollow knight",
    "hades", "ori", "advance wars", "tetris", "shovel knight", "banjo", "punch out", "professor layton", "ace attorney", "sonic",
    "monster hunter", "resident evil", "wii sports", "mega man", "golden sun"];
  const MODE_NAMES = { solo: "Single-player", local: "Local multiplayer", coop: "Co-op", online: "Online", multi: "Multiplayer" };

  function seriesOf(title) {
    const t = ` ${norm(title)} `;
    return new Set(SERIES.filter((k) => t.includes(` ${k} `)).map((k) => (k === "hyrule" ? "zelda" : k)));
  }

  function makeHay(g) {
    return norm([g.title, g.dev, g.genres.join(" "), g.platforms.map((p) => PMAP[p]?.name).join(" "), g.year, g.must ? "must play" : ""].join(" "));
  }

  // Hand-picked games: blurbs, must-play flags, box art.
  const GAMES = (window.GAMES || []).map((g) => {
    const key = g.wiki || g.title;
    const c = COVERS[key];
    const out = {
      ...g,
      key,
      id: slug(g.title),
      genres: g.genres || [],
      date: `${g.year}-07-01`,
      curated: true,
      cover: c ? { src: c[0], w: c[1], h: c[2] } : null,
      series: seriesOf(g.title),
      modes: [],
    };
    out.hay = makeHay(out);
    return out;
  });
  const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

  // Full library downloaded by scripts/fetch-library.mjs (no API key in the browser).
  const igdbImg = (size, id) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

  function mergeLibrary(lib) {
    const byTitle = new Map(GAMES.map((g) => [norm(g.title), g]));
    const libImage = (i) => (!i ? null : i.startsWith("~/") ? "https://media.rawg.io/media/resize/640/-/" + i.slice(2) : i.startsWith("igdb:") ? null : i);
    const libCover = (i) => (i && i.startsWith("igdb:") ? { src: igdbImg("cover_big_2x", i.slice(5)), w: 528, h: 748, igdb: i.slice(5) } : null);
    for (const x of lib.games) {
      if (!x.t || !x.p?.length) continue;
      const match = byTitle.get(norm(x.t));
      if (match) {
        Object.assign(match, { ext: x.id, modes: x.m || [], esrb: x.e, rating: x.r, ratingsCount: x.rc, added: x.a });
        const c = !match.cover && libCover(x.i);
        if (c) applyCover(match, c);
        continue;
      }
      let id = x.id;
      if (BY_ID.has(id)) id = "r-" + id;
      const g = {
        id,
        key: x.t,
        ext: x.id,
        title: x.t,
        platforms: x.p.filter((p) => PMAP[p]),
        date: x.d || null,
        year: x.d ? Number(x.d.slice(0, 4)) : null,
        upcoming: !x.d || x.d > TODAY,
        genres: x.g || [],
        dev: x.v || "",
        summary: x.sm || "",
        score: x.s ?? null,
        rating: x.r || 0,
        ratingsCount: x.rc || 0,
        added: x.a || 0,
        esrb: x.e || null,
        modes: x.m || [],
        cover: libCover(x.i),
        image: libImage(x.i),
        blurb: "",
        must: false,
        lib: true,
        series: seriesOf(x.t),
      };
      if (!g.platforms.length) continue;
      g.hay = makeHay(g);
      GAMES.push(g);
      BY_ID.set(id, g);
    }
  }

  function computeGenres() {
    const counts = new Map();
    GAMES.forEach((g) => g.genres.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  }
  let GENRES = computeGenres();

  /* ======================================================================
     Persistence
     ====================================================================== */

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("cartridge." + k);
        return v === null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem("cartridge." + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
    },
  };

  /* My List: { [gameId]: { s: "want" | "played", t: timestamp } } */
  const myList = store.get("list", {});
  const listStatus = (g) => myList[g.id]?.s || null;
  function setListStatus(g, s) {
    if (s) myList[g.id] = { s, t: Date.now() };
    else delete myList[g.id];
    store.set("list", myList);
    refreshListUI(g);
  }

  /* ======================================================================
     State
     ====================================================================== */

  const params = new URLSearchParams(location.search);
  const validPlatform = (p) => p === "all" || !!PMAP[p];
  const SORTS = ["recommended", "score", "newest", "oldest", "az"];
  const LISTS = ["all", "want", "played"];

  const state = {
    platform: validPlatform(params.get("p")) ? params.get("p") : (validPlatform(store.get("platform", "all")) ? store.get("platform", "all") : "all"),
    q: params.get("q") || "",
    genre: params.get("g") || "all", // checked against the full genre list once the library has loaded
    sort: SORTS.includes(params.get("sort")) ? params.get("sort") : store.get("sort", "recommended"),
    must: params.get("must") === "1",
    list: LISTS.includes(params.get("list")) ? params.get("list") : null,
    extra: store.get("extra", { switch2: false, switch: false }),
  };
  if (!SORTS.includes(state.sort)) state.sort = "recommended";

  function syncURL() {
    const p = new URLSearchParams();
    if (state.platform !== "all") p.set("p", state.platform);
    if (state.list) p.set("list", state.list);
    if (state.q.trim()) p.set("q", state.q.trim());
    if (state.genre !== "all") p.set("g", state.genre);
    if (state.sort !== "recommended") p.set("sort", state.sort);
    if (state.must) p.set("must", "1");
    const qs = p.toString();
    history.replaceState(history.state, "", (qs ? "?" + qs : location.pathname) + location.hash);
  }

  /* ======================================================================
     Ranking & filtering
     ====================================================================== */

  function quality(g) {
    if (g.score) return g.score;
    if (g.rating && g.ratingsCount >= 15) return 48 + g.rating * 8.5;
    if (g.curated) return g.must ? 88 : 78;
    return 55;
  }

  const lovedEnough = (g) => g.must || quality(g) >= 80;

  function recommendRank(g) {
    const popularity = g.added ? Math.log10(g.added + 1) * 2.4 : g.curated ? 8 : 0;
    return quality(g) + (g.must ? 12 : 0) + (g.curated ? 4 : 0) + popularity + Math.max(0, (g.year || 2000) - 2016) * 0.3 - (g.upcoming ? 20 : 0);
  }

  const rankCache = new Map();
  const rank = (g) => {
    let r = rankCache.get(g);
    if (r === undefined) { r = recommendRank(g); rankCache.set(g, r); }
    return r;
  };

  const dateKey = (g) => (g.upcoming ? "" : g.date || "");
  const SORTERS = {
    recommended: (a, b) => rank(b) - rank(a) || a.title.localeCompare(b.title),
    score: (a, b) => quality(b) - quality(a) || rank(b) - rank(a),
    newest: (a, b) => (dateKey(b) > dateKey(a) ? 1 : dateKey(b) < dateKey(a) ? -1 : rank(b) - rank(a)),
    oldest: (a, b) => (a.year || 9999) - (b.year || 9999) || rank(b) - rank(a),
    az: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  };

  const onSwitchFamily = (g) => g.platforms.includes("switch") || g.platforms.includes("switch2");

  function inPlatform(g, p = state.platform) {
    if (p === "all") return true;
    if (g.platforms.includes(p)) return true;
    if (p === "switch2" && state.extra.switch2) return g.platforms.includes("switch");
    if (p === "switch" && state.extra.switch) return !!g.nso;
    return false;
  }

  function inList(g) {
    if (!state.list) return true;
    const s = listStatus(g);
    return state.list === "all" ? !!s : s === state.list;
  }

  function filtered() {
    const tokens = norm(state.q).split(" ").filter(Boolean);
    const list = GAMES.filter((g) =>
      inList(g) &&
      inPlatform(g) &&
      (state.genre === "all" || g.genres.includes(state.genre)) &&
      (!state.must || g.must) &&
      tokens.every((t) => g.hay.includes(t))
    );
    if (state.list && state.sort === "recommended") return list.sort((a, b) => (myList[b.id]?.t || 0) - (myList[a.id]?.t || 0));
    return list.sort(SORTERS[state.sort]);
  }

  function primaryPlatform(g) {
    if (state.platform !== "all" && g.platforms.includes(state.platform)) return state.platform;
    return g.platforms[0];
  }

  /* ======================================================================
     Shared bits
     ====================================================================== */

  const ICON = {
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5L2.6 9.4l6.5-.8z"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 12H7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };

  const wikiURL = (g) => "https://en.wikipedia.org/wiki/" + encodeURIComponent(g.key.replace(/ /g, "_"));
  const eshopURL = (g) => "https://www.nintendo.com/us/search/#q=" + encodeURIComponent(g.title);
  const trailerURL = (g) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${g.title} trailer`);
  const sourceFor = (lib) => (lib?.source === "IGDB"
    ? { name: "IGDB", home: "https://www.igdb.com", game: (id) => "https://www.igdb.com/games/" + encodeURIComponent(id) }
    : { name: "RAWG", home: "https://rawg.io", game: (id) => "https://rawg.io/games/" + encodeURIComponent(id) });
  let SOURCE = sourceFor(null);
  const extURL = (g) => SOURCE.game(g.ext);
  const whenText = (g) => (g.upcoming ? (g.date ? `Coming ${fmtDate(g.date)}` : "Coming soon") : g.year ? String(g.year) : "");

  function fallbackArt(g) {
    return `<div class="fallback-art"><strong>${esc(g.title)}</strong><span>${esc(PMAP[g.platforms[0]]?.name || "")}</span></div>`;
  }

  function artHTML(g, eager) {
    const loading = eager ? "eager" : "lazy";
    if (g.cover) {
      // Cards are small: let the browser take the half-size cover unless the screen is dense enough to need more.
      const srcset = g.cover.igdb
        ? ` srcset="${igdbImg("cover_big", g.cover.igdb)} 264w, ${esc(g.cover.src)} 528w" sizes="(max-width: 640px) 46vw, 190px"`
        : "";
      return `<img class="art-fg"${srcset} src="${esc(g.cover.src)}" alt="Cover art for ${esc(g.title)}" width="${g.cover.w}" height="${g.cover.h}" loading="${loading}" decoding="async">`;
    }
    if (g.image) return `<img class="art-fill" src="${esc(g.image)}" alt="${esc(g.title)}" loading="${loading}" decoding="async">`;
    return fallbackArt(g);
  }

  function wireArt(art, g) {
    const img = art.querySelector("img");
    const done = () => art.classList.add("is-loaded");
    if (!img) return done();
    const fail = () => {
      img.remove();
      art.insertAdjacentHTML("afterbegin", fallbackArt(g));
      done();
    };
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", fail, { once: true });
    }
  }

  function saveBtnHTML(g) {
    const s = listStatus(g);
    const label = s === "played" ? "Played. Remove from My List" : s === "want" ? "Saved. Remove from My List" : "Save to My List";
    return `<button class="save-btn${s ? " is-saved" : ""}" type="button" data-save="${g.id}" aria-label="${label}" title="${label}">${s === "played" ? ICON.check : ICON.bookmark}</button>`;
  }

  /* ======================================================================
     Cards
     ====================================================================== */

  function cardEl(g, eager) {
    const el = document.createElement("article");
    el.className = "card";
    el.tabIndex = 0;
    el.dataset.id = g.id;
    el.setAttribute("role", "button");
    const platNames = g.platforms.map((p) => PMAP[p]?.name).join(", ");
    el.setAttribute("aria-label", `${g.title}. ${platNames}. ${whenText(g)}${g.score ? `. Critic score ${g.score}` : ""}${g.must ? ". Must play" : ""}`);

    const corner = g.upcoming
      ? `<span class="badge badge-note">${g.date ? "Coming " + new Date(g.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "Coming soon"}</span>`
      : g.nso && !onSwitchFamily(g) ? `<span class="badge badge-note" title="Playable on Switch with Nintendo Switch Online">Switch Online</span>` : "";
    el.innerHTML =
      `<div class="art">${artHTML(g, eager)}` +
        (g.must ? `<span class="badge badge-must" title="Must play">${ICON.star}</span>` : "") +
        (g.score ? `<span class="badge badge-score" title="Critic score">${g.score}</span>` : "") +
        corner + saveBtnHTML(g) +
      `</div>` +
      `<div class="card-body"><h3 class="card-title">${esc(g.title)}</h3><p class="card-meta"></p></div>`;
    wireArt(el.querySelector(".art"), g);
    updateCardMeta(el, g);
    el.addEventListener("animationend", (e) => { if (e.target === el) el.classList.remove("enter"); });
    return el;
  }

  function updateCardMeta(el, g) {
    const p = PMAP[primaryPlatform(g)];
    const extra = g.platforms.length - 1;
    const meta = el.querySelector(".card-meta");
    const when = g.upcoming ? "Upcoming" : g.year || "";
    const html = `<span>${esc(p?.name || "")}</span>` +
      (extra > 0 ? `<span class="more-plat">+${extra}</span>` : "") +
      (when ? `<span class="dot"></span><span>${when}</span>` : "");
    if (meta.innerHTML !== html) meta.innerHTML = html;
  }

  /* ======================================================================
     Elements
     ====================================================================== */

  const $ = (s, el = document) => el.querySelector(s);
  const grid = $("#grid");
  const gridMore = $("#gridMore");
  const empty = $("#empty");
  const resultCount = $("#resultCount");
  const browseTitle = $("#browseTitle");
  const segmented = $("#platforms");
  const thumb = $(".segmented-thumb", segmented);
  const genresEl = $("#genres");
  const listTabs = $("#listTabs");
  const listExit = $("#listExit");
  const listBtn = $("#listBtn");
  const listCount = $("#listCount");
  const search = $("#search");
  const searchClear = $(".search-clear");
  const sortEl = $("#sort");
  const mustToggle = $("#mustToggle");
  const extraRow = $("#extraToggle");
  const extraToggle = $(".switch", extraRow);
  const extraLabel = $("#extraLabel");
  const heroEl = $("#hero");
  const heroSlides = $("#heroSlides");
  const heroDots = $("#heroDots");
  const topbar = $("#topbar");
  const backdrop = $("#sheetBackdrop");
  const sheet = $("#sheet");

  function updateIntro() {
    $("#lede").textContent = LIBRARY
      ? `${fmt(GAMES.length)} games from Switch 2 back to the NES, with ${GAMES.filter((g) => g.curated).length} hand-picked favorites. Filter by system, genre or what's worth your time.`
      : `${GAMES.length} great games, from Switch 2 back to the NES. Filter by system, genre or what's worth your time.`;
    if (!LIBRARY) return;
    const credit = $("#dataCredit");
    credit.hidden = false;
    credit.innerHTML = `Full game library from <a href="${SOURCE.home}" target="_blank" rel="noopener">${SOURCE.name}</a>, updated ${esc(fmtDate(String(LIBRARY.updated || "").slice(0, 10) || TODAY))}.`;
  }

  /* ======================================================================
     Platform segmented control
     ====================================================================== */

  function buildSegments() {
    const items = [{ id: "all", name: "All" }, ...PLATFORMS];
    segmented.insertAdjacentHTML("beforeend", items.map((p) =>
      `<button class="seg" type="button" role="radio" data-p="${p.id}" aria-checked="false" tabindex="-1">` +
        `<span>${esc(p.name)}</span><span class="seg-count" aria-hidden="true" hidden></span>` +
      `</button>`).join(""));
    updateSegmentCounts();
  }

  // Counts stay hidden until the full library is in, so they don't jump from a few hundred to thousands.
  function updateSegmentCounts() {
    const counts = { all: GAMES.length };
    PLATFORMS.forEach((p) => { counts[p.id] = 0; });
    GAMES.forEach((g) => g.platforms.forEach((p) => { if (p in counts) counts[p]++; }));
    segmented.querySelectorAll(".seg").forEach((b) => {
      const id = b.dataset.p;
      const name = id === "all" ? "All" : PMAP[id].name;
      const count = b.querySelector(".seg-count");
      count.hidden = libraryPending;
      count.textContent = libraryPending ? "" : fmt(counts[id]);
      b.setAttribute("aria-label", libraryPending ? name : `${name}, ${counts[id]} games`);
    });
  }

  function updateSegments(animate = true) {
    let active;
    segmented.querySelectorAll(".seg").forEach((b) => {
      const on = b.dataset.p === state.platform;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
      if (on) active = b;
    });
    if (!active) return;
    if (!animate) thumb.style.transition = "none";
    thumb.style.width = active.offsetWidth + "px";
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
    if (!animate) { void thumb.offsetWidth; thumb.style.transition = ""; }
    segmented.classList.toggle("is-overflowing", segmented.scrollWidth - segmented.clientWidth > 2);
    const target = active.offsetLeft - (segmented.clientWidth - active.offsetWidth) / 2;
    segmented.scrollTo({ left: Math.max(0, target), behavior: animate ? "smooth" : "auto" });
  }

  segmented.addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (b) setPlatform(b.dataset.p);
  });

  segmented.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const btns = [...segmented.querySelectorAll(".seg")];
    let i = btns.findIndex((b) => b.dataset.p === state.platform);
    if (e.key === "ArrowLeft") i = (i - 1 + btns.length) % btns.length;
    if (e.key === "ArrowRight") i = (i + 1) % btns.length;
    if (e.key === "Home") i = 0;
    if (e.key === "End") i = btns.length - 1;
    setPlatform(btns[i].dataset.p);
    btns[i].focus();
  });

  function setPlatform(p) {
    if (p === state.platform) return;
    state.platform = p;
    store.set("platform", p);
    updateSegments();
    updateExtraToggle();
    renderGenres();
    renderHero();
    render(true);
  }

  /* ---------- Context toggle (backward compat / Switch Online) ---------- */

  const EXTRA_LABELS = { switch2: "Include Switch 1 games", switch: "Include Switch Online classics" };

  function updateExtraToggle() {
    const label = EXTRA_LABELS[state.platform];
    extraRow.hidden = !label;
    if (!label) return;
    extraLabel.textContent = label;
    extraToggle.setAttribute("aria-checked", !!state.extra[state.platform]);
    extraRow.title = state.platform === "switch2"
      ? "Switch 2 plays almost every Switch 1 game"
      : "NES, SNES, N64, Game Boy, GBA and GameCube classics playable with a Nintendo Switch Online membership";
  }

  extraToggle.addEventListener("click", () => {
    state.extra[state.platform] = !state.extra[state.platform];
    store.set("extra", state.extra);
    updateExtraToggle();
    renderGenres();
    render(true);
  });

  mustToggle.addEventListener("click", () => {
    state.must = !state.must;
    mustToggle.setAttribute("aria-checked", state.must);
    render(true);
  });

  /* ---------- Genres ---------- */

  function renderGenres() {
    const counts = new Map();
    GAMES.forEach((g) => { if (inPlatform(g)) g.genres.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1)); });
    const list = GENRES.filter((x) => counts.get(x) || x === state.genre);
    genresEl.innerHTML =
      `<button class="chip" type="button" data-g="all" aria-pressed="${state.genre === "all"}">All genres</button>` +
      list.map((x) => `<button class="chip" type="button" data-g="${esc(x)}" aria-pressed="${state.genre === x}">${esc(x)}<span class="chip-count">${fmt(counts.get(x) || 0)}</span></button>`).join("");
  }

  genresEl.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const g = b.dataset.g;
    state.genre = state.genre === g && g !== "all" ? "all" : g;
    genresEl.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.g === state.genre));
    render(true);
  });

  /* ---------- Sort ---------- */

  sortEl.value = state.sort;
  sortEl.addEventListener("change", () => {
    state.sort = sortEl.value;
    store.set("sort", state.sort);
    render(true);
  });

  /* ---------- Search ---------- */

  let searchTimer;
  const searchBox = search.closest(".search");
  search.value = state.q;
  searchClear.hidden = !state.q;
  searchBox.classList.toggle("has-value", !!state.q);

  const heroShouldShow = () => !!heroItems.length && !state.q.trim() && !state.list;

  search.addEventListener("input", () => {
    searchClear.hidden = !search.value;
    searchBox.classList.toggle("has-value", !!search.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = search.value;
      heroEl.hidden = !heroShouldShow();
      if (!heroEl.hidden) heroSchedule(); else heroStop();
      render(true);
    }, LIBRARY ? 140 : 90);
  });

  searchClear.addEventListener("click", () => {
    search.value = "";
    search.dispatchEvent(new Event("input"));
    search.focus();
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      if (sheetOpen || pickerOpen) return;
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === "Escape" && document.activeElement === search) {
      if (search.value) { search.value = ""; search.dispatchEvent(new Event("input")); }
      else search.blur();
    }
  });

  /* ======================================================================
     Grid render (incremental, so thousands of games stay fast)
     ====================================================================== */

  const cardCache = new Map();
  const getCard = (g) => {
    let c = cardCache.get(g.id);
    if (!c) { c = cardEl(g); cardCache.set(g.id, c); }
    return c;
  };

  let currentList = [];
  let rendered = 0;

  function appendChunk(animate) {
    const slice = currentList.slice(rendered, rendered + CHUNK);
    if (!slice.length) return;
    const nodes = slice.map((g) => {
      const n = getCard(g);
      updateCardMeta(n, g);
      n.classList.remove("enter");
      return n;
    });
    grid.append(...nodes);
    if (animate && !reducedMotion.matches) {
      void grid.offsetWidth;
      nodes.slice(0, 36).forEach((n, i) => { n.style.setProperty("--i", i); n.classList.add("enter"); });
    }
    rendered += slice.length;
    gridMore.hidden = rendered >= currentList.length;
  }

  function render(animate) {
    currentList = filtered();
    rendered = 0;
    grid.replaceChildren();
    appendChunk(animate);
    requestAnimationFrame(fillViewport);

    const n = currentList.length;
    empty.hidden = n > 0 || libraryPending;
    if (!n) {
      const listEmpty = state.list && !Object.keys(myList).length;
      $("#emptyTitle").textContent = listEmpty ? "Your list is empty" : "No games match";
      $("#emptyText").textContent = listEmpty
        ? "Tap the bookmark on any game to save it here."
        : "Try a different search, genre or platform.";
      $("#clearFilters").textContent = listEmpty ? "Browse games" : "Clear filters";
    }

    const where = state.platform === "all" ? (state.list ? "" : " across all systems") : ` on ${PMAP[state.platform].name}`;
    const noun = n === 1 ? "game" : "games";
    resultCount.textContent = libraryPending ? "Loading the full library…" : state.q.trim()
      ?`${fmt(n)} ${n === 1 ? "result" : "results"} for “${state.q.trim()}”${where}`
      : `${fmt(n)} ${noun}${where}`;
    syncURL();
  }

  function fillViewport() {
    let guard = 0;
    while (rendered < currentList.length && gridMore.getBoundingClientRect().top < window.innerHeight + 900 && guard++ < 20) {
      appendChunk(false);
    }
  }

  window.addEventListener("scroll", () => {
    if (rendered < currentList.length) fillViewport();
  }, { passive: true });

  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) fillViewport();
  }, { rootMargin: "900px 0px" }).observe(gridMore);

  $("#clearFilters").addEventListener("click", () => {
    if (state.list && !Object.keys(myList).length) return setListView(null);
    state.q = "";
    search.value = "";
    searchClear.hidden = true;
    searchBox.classList.remove("has-value");
    state.genre = "all";
    state.must = false;
    mustToggle.setAttribute("aria-checked", "false");
    heroEl.hidden = !heroShouldShow();
    renderGenres();
    render(true);
    heroSchedule();
  });

  function handleSaveClick(btn) {
    const g = BY_ID.get(btn.dataset.save);
    if (!g) return;
    setListStatus(g, listStatus(g) ? null : "want");
    btn.classList.remove("pop");
    void btn.offsetWidth;
    btn.classList.add("pop");
  }

  grid.addEventListener("click", (e) => {
    const save = e.target.closest("[data-save]");
    if (save) { e.stopPropagation(); return handleSaveClick(save); }
    const c = e.target.closest(".card");
    if (c) openSheet(BY_ID.get(c.dataset.id));
  });

  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("card")) {
      e.preventDefault();
      openSheet(BY_ID.get(e.target.dataset.id));
    }
  });

  /* ======================================================================
     My List
     ====================================================================== */

  function refreshListUI(changed) {
    const n = Object.keys(myList).length;
    listCount.hidden = n === 0;
    listCount.textContent = n > 99 ? "99+" : n;
    if (changed) {
      document.querySelectorAll(`[data-save="${CSS.escape(changed.id)}"]`).forEach((b) => b.outerHTML = saveBtnHTML(changed));
      if (sheetGame === changed) updateSheetListButtons(changed);
      if (state.list) render(false);
    }
  }

  function setListView(list) {
    state.list = list;
    listBtn.setAttribute("aria-pressed", !!list);
    listTabs.hidden = !list;
    listExit.hidden = !list;
    browseTitle.textContent = list ? "My List" : "Browse";
    listTabs.querySelectorAll("[data-list]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.list === (list || "all")));
    heroEl.hidden = !heroShouldShow();
    if (heroEl.hidden) heroStop(); else heroSchedule();
    render(true);
  }

  listBtn.addEventListener("click", () => {
    setListView(state.list ? null : "all");
    $(".browse").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" });
  });
  listExit.addEventListener("click", () => setListView(null));
  listTabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-list]");
    if (b) setListView(b.dataset.list);
  });

  /* ======================================================================
     Hero carousel (hand-picked games)
     ====================================================================== */

  let heroItems = [];
  let heroIndex = 0;
  let heroTimer = 0;
  let heroStarted = 0;
  let heroRemaining = HERO_DURATION;
  let heroHover = false;

  function heroPicks() {
    const pool = GAMES.filter((g) => g.curated && g.cover && inPlatform(g));
    let picks = pool.filter((g) => g.must).sort((a, b) => b.year - a.year || (b.score ?? 0) - (a.score ?? 0));
    if (picks.length < 3) picks = pool.sort(SORTERS.recommended);
    return picks.slice(0, 6);
  }

  function renderHero() {
    heroItems = heroPicks();
    heroEl.hidden = !heroShouldShow();
    heroIndex = 0;
    heroSlides.innerHTML = heroItems.map((g, i) => {
      const p = PMAP[primaryPlatform(g)];
      const tag = g.year >= NEW_SINCE ? '<span class="new">New</span> · ' : g.must ? "Must play · " : "";
      return `<div class="hero-slide${i === 0 ? " is-active" : ""}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${heroItems.length}: ${esc(g.title)}" ${i === 0 ? "" : 'aria-hidden="true"'}>
        <div class="hero-copy">
          <p class="hero-tag">${tag}${esc(p.name)}</p>
          <h2 class="hero-title">${esc(g.title)}</h2>
          <p class="hero-blurb">${esc(g.blurb)}</p>
          <div class="hero-meta">
            ${g.score ? `<span class="score-inline">${g.score} critic score</span>` : ""}
            <span>${g.year} · ${esc(g.dev)}</span>
          </div>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" data-open="${g.id}">View details</button>
            <a class="btn btn-glass glass-btn" href="${trailerURL(g)}" target="_blank" rel="noopener">${ICON.play}Trailer</a>
          </div>
        </div>
        <div class="hero-art"><img src="${esc(g.cover.src)}" alt="Cover art for ${esc(g.title)}" width="${g.cover.w}" height="${g.cover.h}"></div>
      </div>`;
    }).join("");

    heroDots.innerHTML = heroItems.map((g, i) =>
      `<button class="hero-dot" type="button" role="tab" aria-label="Show ${esc(g.title)}" aria-selected="${i === 0}"></button>`).join("");
    heroEl.style.setProperty("--hero-duration", HERO_DURATION + "ms");
    heroEl.querySelector(".hero-controls").hidden = heroItems.length < 2;
    heroRemaining = HERO_DURATION;
    heroSchedule();
  }

  function heroGo(i) {
    if (!heroItems.length) return;
    heroIndex = (i + heroItems.length) % heroItems.length;
    heroSlides.querySelectorAll(".hero-slide").forEach((s, k) => {
      s.classList.toggle("is-active", k === heroIndex);
      if (k === heroIndex) s.removeAttribute("aria-hidden"); else s.setAttribute("aria-hidden", "true");
    });
    heroDots.querySelectorAll(".hero-dot").forEach((d) => d.setAttribute("aria-selected", "false"));
    void heroDots.offsetWidth;
    heroDots.children[heroIndex]?.setAttribute("aria-selected", "true");
    heroRemaining = HERO_DURATION;
    heroSchedule();
  }

  function heroStop() {
    clearTimeout(heroTimer);
    heroTimer = 0;
  }

  function heroSchedule() {
    heroStop();
    const paused = heroHover || sheetOpen || pickerOpen || document.hidden || heroEl.hidden || reducedMotion.matches || heroItems.length < 2;
    heroEl.classList.toggle("is-paused", paused);
    if (paused) return;
    heroStarted = performance.now();
    heroTimer = setTimeout(() => heroGo(heroIndex + 1), heroRemaining);
  }

  function heroPause() {
    if (heroTimer) heroRemaining = Math.max(400, heroRemaining - (performance.now() - heroStarted));
    heroStop();
    heroEl.classList.add("is-paused");
  }

  heroEl.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { heroHover = true; heroPause(); } });
  heroEl.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { heroHover = false; heroSchedule(); } });
  heroEl.addEventListener("focusin", () => { heroHover = true; heroPause(); });
  heroEl.addEventListener("focusout", (e) => { if (!heroEl.contains(e.relatedTarget)) { heroHover = false; heroSchedule(); } });
  document.addEventListener("visibilitychange", () => (document.hidden ? heroPause() : heroSchedule()));

  heroEl.querySelector(".hero-prev").addEventListener("click", () => heroGo(heroIndex - 1));
  heroEl.querySelector(".hero-next").addEventListener("click", () => heroGo(heroIndex + 1));
  heroDots.addEventListener("click", (e) => {
    const d = e.target.closest(".hero-dot");
    if (d) heroGo([...heroDots.children].indexOf(d));
  });
  heroSlides.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) openSheet(BY_ID.get(b.dataset.open));
  });
  heroEl.addEventListener("keydown", (e) => {
    if (e.target.closest(".hero-controls")) {
      if (e.key === "ArrowLeft") heroGo(heroIndex - 1);
      if (e.key === "ArrowRight") heroGo(heroIndex + 1);
    }
  });

  let swipeX = null;
  heroEl.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") swipeX = e.clientX; });
  heroEl.addEventListener("pointerup", (e) => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 45) heroGo(heroIndex + (dx < 0 ? 1 : -1));
  });
  heroEl.addEventListener("pointercancel", () => { swipeX = null; });

  /* ======================================================================
     Detail sheet
     ====================================================================== */

  const extractCache = new Map();
  let lastFocus = null;
  let sheetGame = null;
  let pushedHistory = false;
  let closeTimer = 0;
  let sheetOpen = false;

  function similar(g) {
    const pool = GAMES.filter((o) => o !== g && (o.curated || quality(o) >= 72));
    return pool.map((o) => {
      let s = 0;
      o.genres.forEach((x) => { if (g.genres.includes(x)) s += 3; });
      o.series.forEach((x) => { if (g.series.has(x)) s += 5; });
      o.platforms.forEach((x) => { if (g.platforms.includes(x)) s += 1; });
      if (g.dev && o.dev === g.dev) s += 2;
      if (o.must) s += 1.5;
      s += quality(o) / 40;
      return [o, s];
    }).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([o]) => o);
  }

  function listButtonsHTML(g) {
    const s = listStatus(g);
    return `<button class="btn list-toggle${s === "want" ? " is-on" : ""}" type="button" data-status="want" aria-pressed="${s === "want"}">${ICON.bookmark}${s === "want" ? "On my list" : "Want to play"}</button>` +
      `<button class="btn list-toggle${s === "played" ? " is-on" : ""}" type="button" data-status="played" aria-pressed="${s === "played"}">${ICON.check}Played</button>`;
  }

  function updateSheetListButtons(g) {
    const box = $("#sheetList", sheet);
    if (box) box.innerHTML = listButtonsHTML(g);
  }

  function sheetHTML(g) {
    const plats = g.platforms.map((p) => PMAP[p]).filter(Boolean);
    const onSwitch = onSwitchFamily(g);
    const userRating = g.rating && g.ratingsCount >= 5 ? `${g.rating.toFixed(1)} / 5 from ${fmt(g.ratingsCount)} players` : null;
    const scoreBlock = g.score
      ? `<div class="score-ring" style="--p:${g.score}"><b>${g.score}</b></div>
         <div class="score-label"><strong>Critic score</strong><span>${g.score >= 90 ? "Universal acclaim" : g.score >= 80 ? "Generally favorable" : g.score >= 70 ? "Mixed or average" : "Mixed"}</span></div>`
      : userRating
        ? `<div class="score-ring" style="--p:${Math.round(g.rating * 20)}"><b>${g.rating.toFixed(1)}</b></div>
           <div class="score-label"><strong>Player rating</strong><span>From ${fmt(g.ratingsCount)} ratings</span></div>`
        : `<div class="score-label"><strong>${g.must ? "An all-time classic" : g.upcoming ? "Not out yet" : "Not yet rated"}</strong><span>${g.upcoming ? whenText(g) : g.year && g.year < 1996 ? "Released before review aggregators" : "No aggregate score yet"}</span></div>`;
    const sub = [g.dev, g.upcoming ? whenText(g) : g.date && g.lib ? `Released ${fmtDate(g.date)}` : g.year].filter(Boolean).join(" · ");
    const art = g.cover
      ? `<img src="${esc(g.cover.src)}" alt="Cover art for ${esc(g.title)}" width="${g.cover.w}" height="${g.cover.h}">`
      : g.image ? `<img class="wide" src="${esc(g.image)}" alt="${esc(g.title)}">` : fallbackArt(g);
    const facts = [
      g.dev && ["Developer", g.dev],
      ["Released", g.upcoming ? whenText(g) : g.lib && g.date ? fmtDate(g.date) : g.year || "Unknown"],
      ["Genre", g.genres.join(", ") || "Unknown"],
      ["Platforms", plats.map((p) => p.name).join(", ")],
      ["Play it on Switch", onSwitch ? "Yes" : g.nso ? "Via Switch Online" : "No"],
      ["Critic score", g.score ?? "Not rated"],
      userRating && ["Player rating", userRating],
      g.esrb && ["Age rating", `ESRB ${g.esrb}`],
      g.modes?.length && ["Modes", g.modes.map((m) => MODE_NAMES[m]).filter(Boolean).join(", ")],
    ].filter(Boolean);

    return `
      <button class="icon-btn glass-btn sheet-close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>
      </button>
      <div class="sheet-scroll">
        <div class="sheet-top">
          <div class="sheet-art">${art}</div>
          <div class="sheet-info">
            <div class="sheet-plats">
              ${g.must ? `<span class="tag tag-must">${ICON.star}Must play</span>` : ""}
              ${plats.map((p) => `<button class="tag" type="button" data-platform="${p.id}" title="Show ${esc(p.name)} games">${esc(p.name)}</button>`).join("")}
              ${g.nso ? `<span class="tag" title="Playable on Switch with a Nintendo Switch Online membership">Switch Online</span>` : ""}
            </div>
            <h2 class="sheet-title" id="sheetTitle">${esc(g.title)}</h2>
            ${sub ? `<p class="sheet-sub">${esc(sub)}</p>` : ""}
            <div class="sheet-row">${scoreBlock}</div>
            <div class="sheet-actions">
              <div class="sheet-list" id="sheetList">${listButtonsHTML(g)}</div>
              ${onSwitch ? `<a class="btn btn-glass glass-btn" href="${eshopURL(g)}" target="_blank" rel="noopener">${ICON.bag}eShop</a>` : ""}
              <a class="btn btn-glass glass-btn" href="${trailerURL(g)}" target="_blank" rel="noopener">${ICON.play}Trailer</a>
            </div>
          </div>
        </div>
        <div class="sheet-body">
          <section class="sheet-section">
            <h3>${g.blurb ? "Why play it" : "About"}</h3>
            ${g.blurb ? `<p class="sheet-blurb">${esc(g.blurb)}</p>` : ""}
            <p class="sheet-extract" id="sheetExtract"><span class="skeleton-line"></span><span class="skeleton-line"></span><span class="skeleton-line" style="width:62%"></span></p>
          </section>
          <section class="sheet-section">
            <h3>Details</h3>
            <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
            ${g.ext ? `<p class="sheet-source"><a href="${extURL(g)}" target="_blank" rel="noopener">View on ${SOURCE.name} ${ICON.out}</a></p>` : ""}
          </section>
          <section class="sheet-section">
            <h3>You might also like</h3>
            <div class="shelf" id="shelf"></div>
          </section>
        </div>
      </div>`;
  }

  async function fetchSummary(title) {
    const res = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")));
    if (!res.ok) return null;
    const data = await res.json();
    return data?.type === "standard" ? data : null;
  }

  // Library descriptions live in a separate file, loaded the first time a game is opened.
  let summariesPromise = null;
  const loadSummaries = () => {
    if (!summariesPromise) {
      summariesPromise = LIBRARY
        ? fetch("data/summaries.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
        : Promise.resolve({});
    }
    return summariesPromise;
  };

  async function loadExtract(g) {
    const el = $("#sheetExtract");
    const show = (text, page) => {
      if (sheetGame !== g || !el.isConnected) return;
      if (!text) {
        if (g.blurb) el.remove();
        else el.innerHTML = `<span class="muted-note">No description yet. <a href="${g.ext ? extURL(g) : trailerURL(g)}" target="_blank" rel="noopener">${g.ext ? "See it on " + SOURCE.name : "Watch a trailer"}</a></span>`;
        return;
      }
      const link = "https://en.wikipedia.org/wiki/" + encodeURIComponent(page.replace(/ /g, "_"));
      el.innerHTML = `${esc(text)} <a href="${link}" target="_blank" rel="noopener">Read more on Wikipedia</a>`;
    };
    if (!g.curated && g.ext) {
      const text = g.summary || (await loadSummaries())[g.ext];
      if (text) {
        if (sheetGame === g && el.isConnected) el.innerHTML = `${esc(text)} <a href="${extURL(g)}" target="_blank" rel="noopener">More on ${SOURCE.name}</a>`;
        return;
      }
    }
    if (extractCache.has(g.id)) return show(...extractCache.get(g.id));
    let result = ["", ""];
    try {
      if (g.curated) {
        const d = await fetchSummary(g.key);
        if (d) result = [d.extract, d.title];
      } else {
        // Library games: only trust an article that is clearly about a video game.
        for (const t of [`${g.title} (video game)`, g.title]) {
          const d = await fetchSummary(t);
          if (d && /video game|game developed|game published/i.test(d.extract || "")) { result = [d.extract, d.title]; break; }
        }
      }
    } catch { /* offline */ }
    extractCache.set(g.id, result);
    show(...result);
  }

  function fillSheet(g) {
    sheetGame = g;
    sheet.innerHTML = sheetHTML(g);
    sheet.setAttribute("aria-label", g.title);
    const shelf = $("#shelf", sheet);
    similar(g).forEach((o) => shelf.appendChild(cardEl(o, false)));
    loadExtract(g);
  }

  function openSheet(g, { fromHistory = false } = {}) {
    if (!g) return;
    clearTimeout(closeTimer);
    const wasOpen = sheetOpen;
    sheetOpen = true;
    if (!wasOpen) lastFocus = document.activeElement;
    fillSheet(g);
    const hash = "#/game/" + g.id;
    if (!fromHistory && location.hash !== hash) {
      if (wasOpen) history.replaceState({ game: g.id }, "", location.search + hash);
      else { history.pushState({ game: g.id }, "", location.search + hash); pushedHistory = true; }
    }
    document.title = `${g.title} · Cartridge`;
    if (!wasOpen) {
      backdrop.hidden = false;
      document.body.classList.add("sheet-open");
      requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add("is-open")));
      heroPause();
    }
    sheet.focus({ preventScroll: true });
    $(".sheet-scroll", sheet).scrollTop = 0;
  }

  function closeSheet({ fromHistory = false } = {}) {
    if (!sheetOpen) return;
    sheetOpen = false;
    backdrop.classList.remove("is-open");
    if (!pickerOpen) document.body.classList.remove("sheet-open");
    document.title = "Cartridge · Great games for Nintendo Switch & beyond";
    sheetGame = null;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      backdrop.hidden = true;
      sheet.innerHTML = "";
      heroSchedule();
    }, reducedMotion.matches ? 0 : 420);
    if (!fromHistory) {
      if (pushedHistory) history.back();
      else history.replaceState(null, "", location.search || location.pathname);
    }
    pushedHistory = false;
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop || e.target.closest(".sheet-close")) return closeSheet();
    const save = e.target.closest("[data-save]");
    if (save) return handleSaveClick(save);
    const status = e.target.closest("[data-status]");
    if (status && sheetGame) {
      const s = status.dataset.status;
      return setListStatus(sheetGame, listStatus(sheetGame) === s ? null : s);
    }
    const card = e.target.closest(".card");
    if (card) return openSheet(BY_ID.get(card.dataset.id));
    const tag = e.target.closest("[data-platform]");
    if (tag) {
      closeSheet();
      if (state.q) { state.q = ""; search.value = ""; searchClear.hidden = true; searchBox.classList.remove("has-value"); }
      if (state.list) setListView(null);
      state.genre = "all";
      setPlatform(tag.dataset.platform);
      renderGenres();
      render(true);
      $(".browse").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" });
    }
  });

  function trapFocus(e, container) {
    const f = [...container.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key === "Tab") trapFocus(e, sheet);
  });

  function gameFromHash() {
    const m = location.hash.match(/^#\/game\/([a-z0-9-]+)$/);
    return m ? BY_ID.get(m[1]) : null;
  }

  window.addEventListener("popstate", () => {
    const g = gameFromHash();
    if (g) openSheet(g, { fromHistory: true });
    else {
      pushedHistory = false;
      closeSheet({ fromHistory: true });
      syncURL();
    }
  });

  /* ======================================================================
     Surprise me
     ====================================================================== */

  const pickerBackdrop = $("#pickerBackdrop");
  const picker = $("#picker");
  const pickerSystems = $("#pickerSystems");
  const pickerResult = $("#pickerResult");
  const pickerPool = $("#pickerPool");
  const pickerGo = $("#pickerGo");
  const opts = { loved: $("#optLoved"), played: $("#optPlayed"), want: $("#optWant") };
  let pickerOpen = false;
  let pickerFocus = null;
  let pickerPick = null;
  let pickerSpin = 0;
  let pickerHistory = [];

  const surprise = Object.assign(
    { systems: null, loved: true, skipPlayed: true, wantOnly: false },
    store.get("surprise", {})
  );

  function defaultSystems() {
    if (state.platform !== "all") return state.platform === "switch2" ? ["switch2", "switch"] : [state.platform];
    return ["switch2", "switch"];
  }

  function renderPickerSystems() {
    const sel = new Set(surprise.systems);
    pickerSystems.innerHTML = PLATFORMS.map((p) =>
      `<button class="chip" type="button" data-sys="${p.id}" aria-pressed="${sel.has(p.id)}">${esc(p.name)}</button>`).join("");
    $("#pickerPresets").querySelectorAll("[data-preset]").forEach((b) => {
      const ids = b.dataset.preset === "all" ? PLATFORMS.map((p) => p.id) : b.dataset.preset.split(",");
      b.setAttribute("aria-pressed", ids.length === sel.size && ids.every((x) => sel.has(x)));
    });
    opts.loved.setAttribute("aria-checked", surprise.loved);
    opts.played.setAttribute("aria-checked", surprise.skipPlayed);
    opts.want.setAttribute("aria-checked", surprise.wantOnly);
    updatePool();
  }

  function surprisePool() {
    const sel = new Set(surprise.systems);
    return GAMES.filter((g) =>
      g.platforms.some((p) => sel.has(p)) &&
      !g.upcoming &&
      (g.cover || g.image) &&
      (!surprise.loved || lovedEnough(g)) &&
      (!surprise.skipPlayed || listStatus(g) !== "played") &&
      (!surprise.wantOnly || listStatus(g) === "want")
    );
  }

  function updatePool() {
    const n = surprisePool().length;
    pickerPool.textContent = !surprise.systems.length ? "Choose at least one system" : `${fmt(n)} ${n === 1 ? "game" : "games"} to pick from`;
    pickerGo.disabled = n === 0;
    store.set("surprise", surprise);
  }

  function pickerCardHTML(g) {
    const plats = g.platforms.filter((p) => surprise.systems.includes(p)).map((p) => PMAP[p].name);
    const art = g.cover
      ? `<img src="${esc(g.cover.src)}" alt="Cover art for ${esc(g.title)}">`
      : `<img class="wide" src="${esc(g.image)}" alt="${esc(g.title)}">`;
    return `<div class="pick">
      <div class="pick-art">${art}</div>
      <div class="pick-info">
        <p class="pick-plats">${esc(plats.join(" · "))}</p>
        <h3>${esc(g.title)}</h3>
        <p class="pick-meta">${[g.score && `${g.score} critic score`, g.year, g.genres.slice(0, 2).join(", ")].filter(Boolean).map(esc).join(" · ")}</p>
        ${g.blurb ? `<p class="pick-blurb">${esc(g.blurb)}</p>` : ""}
        <div class="pick-actions">
          <button class="btn btn-glass glass-btn" type="button" data-pick-open>View details</button>
          <button class="btn btn-glass glass-btn" type="button" data-pick-save>${listStatus(g) ? ICON.check + "Saved" : ICON.bookmark + "Want to play"}</button>
        </div>
      </div>
    </div>`;
  }

  function spin() {
    const pool = surprisePool();
    if (!pool.length) return;
    // Weight better games a little higher, avoid repeating the last few picks.
    const recent = new Set(pickerHistory.slice(-Math.min(8, Math.floor(pool.length / 2))));
    const candidates = pool.filter((g) => !recent.has(g.id));
    const from = candidates.length ? candidates : pool;
    const weights = from.map((g) => Math.max(1, quality(g) - 60) + (g.must ? 15 : 0));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let choice = from[from.length - 1];
    for (let i = 0; i < from.length; i++) { r -= weights[i]; if (r <= 0) { choice = from[i]; break; } }
    pickerHistory.push(choice.id);
    if (choice.cover) new Image().src = choice.cover.src; // ready by the time the shuffle ends

    clearTimeout(pickerSpin);
    pickerResult.classList.add("is-spinning");
    const flips = reducedMotion.matches ? 0 : 8;
    let k = 0;
    const tick = () => {
      if (k < flips) {
        const g = from[Math.floor(Math.random() * from.length)];
        const src = g.cover?.igdb ? igdbImg("cover_small", g.cover.igdb) : g.cover?.src || g.image;
        pickerResult.innerHTML = `<div class="pick pick-blur"><div class="pick-art"><img src="${esc(src)}" alt=""></div></div>`;
        k++;
        pickerSpin = setTimeout(tick, 40 + k * k * 2.5);
      } else {
        pickerPick = choice;
        pickerResult.classList.remove("is-spinning");
        pickerResult.innerHTML = pickerCardHTML(choice);
        $("span", pickerGo).textContent = "Pick another";
        pickerResult.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
      }
    };
    tick();
  }

  function openPicker() {
    if (!surprise.systems || !surprise.systems.length) surprise.systems = defaultSystems();
    pickerFocus = document.activeElement;
    pickerOpen = true;
    pickerPick = null;
    pickerResult.innerHTML = "";
    $("span", pickerGo).textContent = "Pick a game";
    renderPickerSystems();
    pickerBackdrop.hidden = false;
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => requestAnimationFrame(() => pickerBackdrop.classList.add("is-open")));
    heroPause();
    picker.focus({ preventScroll: true });
  }

  function closePicker({ keepScrollLock = false } = {}) {
    if (!pickerOpen) return;
    pickerOpen = false;
    clearTimeout(pickerSpin);
    pickerBackdrop.classList.remove("is-open");
    if (!keepScrollLock && !sheetOpen) document.body.classList.remove("sheet-open");
    setTimeout(() => { if (!pickerOpen) pickerBackdrop.hidden = true; heroSchedule(); }, reducedMotion.matches ? 0 : 380);
    if (pickerFocus?.isConnected && !keepScrollLock) pickerFocus.focus({ preventScroll: true });
  }

  $("#surpriseBtn").addEventListener("click", openPicker);
  pickerGo.addEventListener("click", spin);

  pickerBackdrop.addEventListener("click", (e) => {
    if (e.target === pickerBackdrop || e.target.closest(".picker-close")) return closePicker();
    const sys = e.target.closest("[data-sys]");
    if (sys) {
      const set = new Set(surprise.systems);
      if (set.has(sys.dataset.sys)) set.delete(sys.dataset.sys); else set.add(sys.dataset.sys);
      surprise.systems = PLATFORMS.map((p) => p.id).filter((id) => set.has(id));
      return renderPickerSystems();
    }
    const preset = e.target.closest("[data-preset]");
    if (preset) {
      surprise.systems = preset.dataset.preset === "all" ? PLATFORMS.map((p) => p.id) : preset.dataset.preset.split(",");
      return renderPickerSystems();
    }
    const opt = e.target.closest(".switch");
    if (opt) {
      if (opt === opts.loved) surprise.loved = !surprise.loved;
      if (opt === opts.played) surprise.skipPlayed = !surprise.skipPlayed;
      if (opt === opts.want) surprise.wantOnly = !surprise.wantOnly;
      return renderPickerSystems();
    }
    if (e.target.closest("[data-pick-open]") && pickerPick) {
      const g = pickerPick;
      closePicker({ keepScrollLock: true });
      return openSheet(g);
    }
    if (e.target.closest("[data-pick-save]") && pickerPick) {
      setListStatus(pickerPick, listStatus(pickerPick) ? null : "want");
      pickerResult.innerHTML = pickerCardHTML(pickerPick);
      updatePool();
    }
  });

  pickerBackdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closePicker(); return; }
    if (e.key === "Tab") trapFocus(e, picker);
  });

  /* ======================================================================
     Theme, scroll, resize
     ====================================================================== */

  const themeBtn = $("#themeToggle");
  const THEMES = ["auto", "light", "dark"];
  function readTheme() {
    try {
      const t = localStorage.getItem("cartridge.theme");
      return t === "light" || t === "dark" ? t : "auto";
    } catch { return "auto"; }
  }
  function applyTheme(mode) {
    if (mode === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    try {
      if (mode === "auto") localStorage.removeItem("cartridge.theme");
      else localStorage.setItem("cartridge.theme", mode);
    } catch { /* storage unavailable */ }
    themeBtn.dataset.mode = mode;
    const label = `Theme: ${mode === "auto" ? "automatic" : mode}`;
    themeBtn.setAttribute("aria-label", label);
    themeBtn.title = label;
  }
  themeBtn.addEventListener("click", () => applyTheme(THEMES[(THEMES.indexOf(themeBtn.dataset.mode) + 1) % THEMES.length]));
  applyTheme(readTheme());

  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 12);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => updateSegments(false));
  });

  /* ======================================================================
     Live cover lookup for hand-picked games missing from data/covers.js
     ====================================================================== */

  async function hydrateMissingCovers() {
    const cache = store.get("coverCache", {});
    const week = 7 * 24 * 3600 * 1000;
    const now = Date.now();
    const curated = GAMES.filter((g) => g.curated && !g.cover);
    curated.forEach((g) => { const c = cache[g.key]; if (c?.src) applyCover(g, c); });
    const missing = curated.filter((g) => !g.cover && !(cache[g.key] && now - cache[g.key].t < week));
    if (!missing.length) return;
    try {
      for (let i = 0; i < missing.length; i += 50) {
        const batch = missing.slice(i, i + 50);
        const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
          action: "query", format: "json", formatversion: "2", origin: "*", redirects: "1",
          prop: "pageimages", piprop: "thumbnail", pilicense: "any", pithumbsize: "600",
          titles: batch.map((g) => g.key).join("|"),
        });
        const data = await (await fetch(url)).json();
        const alias = {};
        (data.query.normalized || []).forEach((n) => { alias[n.from] = n.to; });
        (data.query.redirects || []).forEach((r) => { alias[r.from] = r.to; });
        const pages = Object.fromEntries((data.query.pages || []).map((p) => [p.title, p]));
        batch.forEach((g) => {
          let k = alias[g.key] || g.key;
          k = alias[k] || k;
          const th = pages[k]?.thumbnail;
          cache[g.key] = th ? { src: th.source.split("?")[0], w: th.width, h: th.height, t: now } : { t: now };
          if (th) applyCover(g, cache[g.key]);
        });
      }
      store.set("coverCache", cache);
    } catch { /* offline: keep fallbacks */ }
  }

  function applyCover(g, c) {
    g.cover = { src: c.src, w: c.w, h: c.h, igdb: c.igdb };
    const card = cardCache.get(g.id);
    if (!card) return;
    const art = card.querySelector(".art");
    art.querySelector(".fallback-art, img")?.remove();
    art.classList.remove("is-loaded");
    art.insertAdjacentHTML("afterbegin", artHTML(g));
    wireArt(art, g);
  }

  /* ======================================================================
     Full library (loaded after the first render)
     ====================================================================== */

  function libraryReady() {
    libraryPending = false;
    const lib = window.LIBRARY && Array.isArray(window.LIBRARY.games) ? window.LIBRARY : null;
    if (lib) {
      LIBRARY = lib;
      SOURCE = sourceFor(lib);
      mergeLibrary(lib);
      GENRES = computeGenres();
      rankCache.clear();
    }
    if (state.genre !== "all" && !GENRES.includes(state.genre)) state.genre = "all";

    updateIntro();
    updateSegmentCounts();
    renderGenres();

    // Re-render in place, keeping at least as many cards as before so the page doesn't jump.
    const keep = rendered;
    render(false);
    while (rendered < Math.min(keep, currentList.length)) appendChunk(false);
    updateSegments(false);

    if (heroPicks().map((g) => g.id).join() !== heroItems.map((g) => g.id).join()) renderHero();
    if (pickerOpen) updatePool();

    if (sheetOpen && sheetGame) {
      const top = $(".sheet-scroll", sheet).scrollTop;
      const hadFocus = sheet.contains(document.activeElement);
      fillSheet(sheetGame);
      $(".sheet-scroll", sheet).scrollTop = top;
      if (hadFocus) sheet.focus({ preventScroll: true });
    } else {
      const g = gameFromHash();
      if (g) openSheet(g, { fromHistory: true });
    }
  }

  function loadLibrary() {
    const s = document.createElement("script");
    s.src = "data/library.js";
    s.onload = s.onerror = libraryReady;
    document.head.append(s);
  }

  /* ======================================================================
     Init
     ====================================================================== */

  buildSegments();
  mustToggle.setAttribute("aria-checked", state.must);
  updateExtraToggle();
  renderGenres();
  refreshListUI();
  renderHero();
  if (state.list) setListView(state.list); else render(false);
  updateSegments(false);
  document.fonts?.ready.then(() => updateSegments(false));

  const initial = gameFromHash();
  if (initial) openSheet(initial, { fromHistory: true });

  loadLibrary();

  if ("requestIdleCallback" in window) requestIdleCallback(hydrateMissingCovers);
  else setTimeout(hydrateMissingCovers, 1500);
})();
