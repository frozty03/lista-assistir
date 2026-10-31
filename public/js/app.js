import { api } from './api.js';
import { createStore } from './store.js';
import { groupTitles, findListed } from './list.js';
import {
  nextEpisode,
  upNext,
  progressLabel,
  seasonPercent,
  seasonLength,
  stepSeason,
  setSeason,
  setEpisode,
} from './progress.js';
import { $, esc, reconcile, toast, openOverlay, closeOverlay, closeAllOverlays, isOverlayOpen } from './ui.js';

const IMAGES = 'https://image.tmdb.org/t/p/';
const KIND = { movie: 'Filme', series: 'Série', anime: 'Anime' };
const KIND_PLURAL = { movie: 'Filmes', series: 'Séries', anime: 'Animes' };
const NONE_OF_KIND = {
  movie: 'Nenhum filme na lista ainda.',
  series: 'Nenhuma série na lista ainda.',
  anime: 'Nenhum anime na lista ainda.',
};
const SECTION = { planned: 'Para assistir', watching: 'Assistindo agora', watched: 'Já assistimos', dropped: 'Abandonados' };
const STATUS_LABEL = { planned: 'Para assistir', watching: 'Assistindo', watched: 'Já assistimos', dropped: 'Abandonado' };
const STATUSES = { tv: ['planned', 'watching', 'watched', 'dropped'], movie: ['planned', 'watched', 'dropped'] };
const KINDS = { tv: ['series', 'anime'], movie: ['movie', 'anime'] };
const SEARCH_HINT = 'Digite o nome de um filme, série ou anime.';
// Before "+1 EP" calls a show finished, TMDB is asked about new episodes if its data is older than this.
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const SYNC_EVERY_MS = 30 * 1000;

const store = createStore(api);
const state = {
  ready: false,
  filter: 'all',
  expanded: { watched: false, dropped: false },
  detailId: null,
  results: [],
  adding: new Set(),
  refreshing: new Set(),
  lastSync: 0,
};

// ---------- Helpers ----------

// TMDB image paths look like "/qykTIEJQF8cunKD0CKOqab15wns.jpg"; anything else is ignored.
const imagePath = (path) => (typeof path === 'string' && /^\/[\w.-]+$/.test(path) ? path : null);

function posterHtml(item, size, className) {
  const path = imagePath(item.poster_path);
  if (path) return `<img class="${className}" src="${IMAGES}${size}${path}" alt="" loading="lazy" decoding="async">`;
  const initial = [...(item.title ?? '').trim()][0]?.toUpperCase() ?? '?';
  return `<div class="${className} poster-none" aria-hidden="true">${esc(initial)}</div>`;
}

function subtitle(title) {
  const parts = [KIND[title.kind]];
  if (title.year) parts.push(title.year);
  const seasons = title.media_type === 'tv' ? title.seasons.length : 0;
  if (seasons) parts.push(`${seasons} ${seasons === 1 ? 'temporada' : 'temporadas'}`);
  return parts.join(' · ');
}

function problem(err) {
  if (err.status === 0) return 'Sem conexão. Verifique a internet e tente de novo.';
  if (err.code === 'tmdb_not_configured') return 'A busca ainda não está configurada: falta o token do TMDB.';
  if (err.code === 'tmdb_unavailable') return 'O TMDB não respondeu. Tente de novo em instantes.';
  if (err.code === 'not_found') return 'O TMDB não encontrou este título.';
  return 'Algo deu errado. Tente de novo.';
}

function loginProblem(err) {
  if (err.code === 'wrong_password') return 'Senha incorreta.';
  if (err.code === 'too_many_attempts') {
    return `Muitas tentativas. Tente de novo em ${Math.max(1, Math.ceil((err.retryAfter ?? 900) / 60))} min.`;
  }
  if (err.code === 'not_configured') return 'O site ainda não tem uma senha configurada.';
  return problem(err);
}

/** Moves the blade; when the change came from a tap or the other device, it ignites. */
function setBlade(blade, percent, animate) {
  const width = `${percent}%`;
  blade.classList.toggle('is-off', percent === 0);
  if (blade.style.width === width) return;
  blade.style.width = width;
  if (animate) {
    blade.classList.remove('is-igniting');
    void blade.offsetWidth;
    blade.classList.add('is-igniting');
  }
}

// ---------- Screens ----------

function showLogin(message = '') {
  closeAllOverlays();
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = message;
  $('#password').value = '';
  $('#password').focus();
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  render();
}

const signedOut = () => showLogin('Sua sessão terminou. Entre de novo.');

async function sync() {
  if (!state.ready || $('#app').hidden || Date.now() - state.lastSync < 2000) return;
  state.lastSync = Date.now();
  try {
    await store.load();
  } catch (err) {
    if (err.status === 401) signedOut();
  }
}

// ---------- Home ----------

const cardView = {
  key: (t) => t.id,
  signature: (t) => [t.media_type, t.kind, t.title, t.poster_path].join('|'),
  render: (t) => `
    <article class="card">
      <button type="button" class="card-open" data-open="${t.id}" aria-label="Abrir ${esc(t.title)}"></button>
      ${posterHtml(t, 'w185', 'poster')}
      <div class="card-body">
        <h3 class="card-title">${esc(t.title)}</h3>
        <p class="tag">${KIND[t.kind]}</p>
        ${
          t.media_type === 'tv'
            ? `<p class="readout" data-readout></p>
               <div class="saber" data-saber aria-hidden="true"><span class="hilt"></span><span class="track"><span class="blade" data-blade></span></span></div>
               <div class="card-row">
                 <span class="pct" data-pct></span>
                 <button type="button" class="btn-ep" data-next="${t.id}" aria-label="Assistimos o próximo episódio de ${esc(t.title)}">+1 EP</button>
               </div>`
            : `<div class="card-row"><span></span><button type="button" class="btn-ep" data-status="watched" data-id="${t.id}">Já assistimos</button></div>`
        }
      </div>
    </article>`,
  update(el, t, fresh) {
    if (t.media_type !== 'tv') return;
    const percent = seasonPercent(t);
    el.querySelector('[data-readout]').textContent = progressLabel(t);
    el.querySelector('[data-pct]').textContent = percent === null ? '' : `${percent}%`;
    el.querySelector('[data-saber]').hidden = percent === null;
    el.querySelector('[data-next]').disabled = !upNext(t);
    setBlade(el.querySelector('[data-blade]'), percent ?? 0, !fresh);
  },
};

const tileView = {
  key: (t) => t.id,
  signature: (t) => [t.kind, t.title, t.year, t.poster_path].join('|'),
  render: (t) => `
    <button type="button" class="tile" data-open="${t.id}">
      ${posterHtml(t, 'w342', 'poster')}
      <span class="tile-title">${esc(t.title)}</span>
      <span class="tag">${KIND[t.kind]}${t.year ? ` · ${esc(t.year)}` : ''}</span>
    </button>`,
};

function render() {
  if (!state.ready) return;
  const groups = groupTitles(store.list, state.filter);

  $('#watching-section').hidden = groups.watching.length === 0;
  reconcile($('#watching'), groups.watching, cardView);
  $('#planned-section').hidden = groups.planned.length === 0;
  reconcile($('#planned'), groups.planned, tileView);

  for (const status of ['watched', 'dropped']) {
    const section = $(`#${status}-section`);
    const expanded = state.expanded[status];
    section.hidden = groups[status].length === 0;
    section.querySelector('[data-count]').textContent = groups[status].length;
    section.querySelector('.fold').setAttribute('aria-expanded', String(expanded));
    $(`#${status}`).hidden = !expanded;
    if (expanded) reconcile($(`#${status}`), groups[status], tileView);
  }

  const shown = Object.values(groups).reduce((sum, group) => sum + group.length, 0);
  const empty = $('#empty');
  empty.hidden = shown > 0;
  empty.textContent =
    store.list.length === 0
      ? 'A lista está vazia. Toque no + para adicionar o primeiro filme, série ou anime.'
      : (NONE_OF_KIND[state.filter] ?? '');

  for (const chip of document.querySelectorAll('[data-filter]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
  }

  if (state.detailId !== null) syncDetail();
  if (isOverlayOpen($('#search'))) renderResults();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---------- Actions ----------

async function watchNext(id) {
  let title = store.find(id);
  if (!title || title.media_type !== 'tv' || !upNext(title) || state.refreshing.has(id)) return;
  let next = nextEpisode(title);

  // Last known episode: check TMDB for new ones before calling the show finished.
  if (next.status === 'watched' && Date.now() - title.refreshed_at > REFRESH_AFTER_MS) {
    state.refreshing.add(id);
    try {
      title = (await store.refresh(id)) ?? store.find(id);
    } finally {
      state.refreshing.delete(id);
    }
    if (!title || !upNext(title)) return;
    next = nextEpisode(title);
  }

  const before = { status: title.status, season: title.season ?? 1, episode: title.episode ?? 0 };
  store.edit(id, next);
  if (next.status === 'watched') {
    toast(`Vocês terminaram ${title.title}! Agora está em “Já assistimos”.`, {
      action: 'Desfazer',
      onAction: () => store.edit(id, before),
    });
  }
}

function changeStatus(id, status) {
  const title = store.find(id);
  if (!title || title.status === status) return;
  const changes = { status };
  if (title.media_type === 'tv' && status === 'watching' && title.season === null) {
    Object.assign(changes, { season: 1, episode: 0 });
  }
  const before = { status: title.status };
  store.edit(id, changes);
  toast(`${title.title} agora está em “${SECTION[status]}”.`, { action: 'Desfazer', onAction: () => store.edit(id, before) });
}

function changeKind(id, kind) {
  const title = store.find(id);
  if (!title || title.kind === kind) return;
  store.edit(id, { kind });
  toast(`${title.title} agora aparece em “${KIND_PLURAL[kind]}”.`);
}

function moveTo(title, position) {
  if (position.season === title.season && position.episode === title.episode) return;
  store.edit(title.id, position);
}

let disarm;
async function removeTitle(button, title) {
  if (!button.classList.contains('is-armed')) {
    button.classList.add('is-armed');
    button.textContent = 'Toque de novo para remover';
    clearTimeout(disarm);
    disarm = setTimeout(() => {
      button.classList.remove('is-armed');
      button.textContent = 'Remover da lista';
    }, 4000);
    return;
  }
  clearTimeout(disarm);
  state.detailId = null;
  closeOverlay();
  if (await store.remove(title.id)) toast(`${title.title} foi removido da lista.`);
}

// ---------- A title's page ----------

function detailHtml(title) {
  const tv = title.media_type === 'tv';
  const statuses = STATUSES[title.media_type];
  const stepper = (field, label) => `
    <div class="stepper">
      <label class="stepper-label" for="${field}-input">${label}</label>
      <div class="stepper-ctl">
        <button type="button" class="step" data-step="${field}" data-delta="-1" aria-label="${label} anterior">‹</button>
        <input id="${field}-input" class="step-input" data-set="${field}" inputmode="numeric" pattern="[0-9]*" autocomplete="off">
        ${field === 'episode' ? '<span class="step-of" data-of></span>' : ''}
        <button type="button" class="step" data-step="${field}" data-delta="1" aria-label="Próxim${field === 'season' ? 'a temporada' : 'o episódio'}">›</button>
      </div>
    </div>`;

  return `
    <div class="hero" data-hero></div>
    <button type="button" class="round-btn back" data-close aria-label="Voltar">‹</button>
    <div class="detail-inner">
      <div class="detail-head">
        <div data-poster></div>
        <div class="detail-names">
          <h2 id="detail-title" class="detail-title"></h2>
          <p class="detail-sub" data-sub></p>
        </div>
      </div>
      ${
        tv
          ? `<section>
               <h3 class="section-title">Onde paramos</h3>
               ${stepper('season', 'Temporada')}
               ${stepper('episode', 'Episódio')}
               <div class="saber" data-saber aria-hidden="true"><span class="hilt"></span><span class="track"><span class="blade" data-blade></span></span></div>
               <p class="next-row"><span data-next-label></span><span class="pct" data-pct></span></p>
               <button type="button" class="btn-big" data-action="next"></button>
             </section>`
          : ''
      }
      <section>
        <h3 class="section-title" id="status-title">Status</h3>
        <div class="seg${statuses.length === 3 ? ' seg--3' : ''}" role="radiogroup" aria-labelledby="status-title">
          ${statuses
            .map((s) => `<button type="button" role="radio" class="seg-btn${s === 'dropped' ? ' seg-btn--sith' : ''}" data-status="${s}">${STATUS_LABEL[s]}</button>`)
            .join('')}
        </div>
      </section>
      <section>
        <h3 class="section-title">Sinopse</h3>
        <p class="synopsis" data-synopsis></p>
      </section>
      <section>
        <h3 class="section-title" id="kind-title">Aparece em</h3>
        <div class="seg" role="radiogroup" aria-labelledby="kind-title">
          ${KINDS[title.media_type].map((k) => `<button type="button" role="radio" class="seg-btn" data-kind="${k}">${KIND_PLURAL[k]}</button>`).join('')}
        </div>
      </section>
      <button type="button" class="danger" data-action="remove">Remover da lista</button>
    </div>`;
}

function openDetail(id, opener) {
  const title = store.find(id);
  if (!title) return;
  state.detailId = id;
  const sheet = $('#detail .sheet');
  sheet.innerHTML = detailHtml(title);
  sheet.scrollTop = 0;
  syncDetail(true);
  openOverlay($('#detail'), {
    opener,
    onClose: () => {
      state.detailId = null;
    },
  });
  if (title.media_type === 'tv' && Date.now() - title.refreshed_at > REFRESH_AFTER_MS) store.refresh(id);
}

function syncDetail(fresh = false) {
  const title = store.find(state.detailId);
  if (!title) {
    state.detailId = null;
    closeOverlay();
    return;
  }
  const sheet = $('#detail .sheet');

  const hero = sheet.querySelector('[data-hero]');
  const backdrop = imagePath(title.backdrop_path);
  const heroImage = backdrop ? `url("${IMAGES}w780${backdrop}")` : '';
  if (hero.dataset.image !== heroImage) {
    hero.style.backgroundImage = heroImage;
    hero.dataset.image = heroImage;
  }
  const poster = sheet.querySelector('[data-poster]');
  if (poster.dataset.path !== String(title.poster_path)) {
    poster.innerHTML = posterHtml(title, 'w342', 'detail-poster');
    poster.dataset.path = String(title.poster_path);
  }
  sheet.querySelector('#detail-title').textContent = title.title;
  sheet.querySelector('[data-sub]').textContent = subtitle(title);
  const synopsis = sheet.querySelector('[data-synopsis]');
  synopsis.textContent = title.overview ?? 'Sem sinopse.';
  synopsis.classList.toggle('is-missing', !title.overview);

  if (title.media_type === 'tv') {
    const season = title.season ?? 1;
    const episode = title.episode ?? 0;
    const length = seasonLength(title, season);
    const seasonInput = sheet.querySelector('[data-set="season"]');
    const episodeInput = sheet.querySelector('[data-set="episode"]');
    if (document.activeElement !== seasonInput) seasonInput.value = season;
    if (document.activeElement !== episodeInput) episodeInput.value = episode;
    sheet.querySelector('[data-of]').textContent = length ? `de ${length}` : '';

    const same = (p) => p.season === season && p.episode === episode;
    sheet.querySelector('[data-step="season"][data-delta="-1"]').disabled = same(stepSeason(title, -1));
    sheet.querySelector('[data-step="season"][data-delta="1"]').disabled = same(stepSeason(title, 1));
    sheet.querySelector('[data-step="episode"][data-delta="-1"]').disabled = episode === 0;
    sheet.querySelector('[data-step="episode"][data-delta="1"]').disabled = length !== null && episode >= length;

    const percent = seasonPercent(title);
    sheet.querySelector('[data-saber]').hidden = percent === null;
    setBlade(sheet.querySelector('[data-blade]'), percent ?? 0, !fresh);
    sheet.querySelector('[data-pct]').textContent = percent === null ? '' : `${percent}%`;

    const next = upNext(title);
    sheet.querySelector('[data-next-label]').textContent = next
      ? `Próximo: T${next.season} · E${next.episode}`
      : 'Vocês viram tudo o que já saiu.';
    const button = sheet.querySelector('[data-action="next"]');
    button.hidden = !next;
    if (next) {
      button.textContent = `+1 EP · assistimos o ${next.season === season ? `E${next.episode}` : `T${next.season} · E${next.episode}`}`;
    }
  }

  for (const b of sheet.querySelectorAll('[data-status]')) b.setAttribute('aria-checked', String(b.dataset.status === title.status));
  for (const b of sheet.querySelectorAll('[data-kind]')) b.setAttribute('aria-checked', String(b.dataset.kind === title.kind));
}

function onDetailClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) return closeOverlay();
  const title = store.find(state.detailId);
  if (!title) return;

  const { action, status, kind, step } = button.dataset;
  if (action === 'next') return watchNext(title.id);
  if (action === 'remove') return removeTitle(button, title);
  if (status) return changeStatus(title.id, status);
  if (kind) return changeKind(title.id, kind);
  if (step) {
    const delta = Number(button.dataset.delta);
    moveTo(title, step === 'season' ? stepSeason(title, delta) : setEpisode(title, (title.episode ?? 0) + delta));
  }
}

function onDetailChange(event) {
  const input = event.target.closest('[data-set]');
  const title = store.find(state.detailId);
  if (!input || !title) return;
  const value = Number.parseInt(input.value, 10);
  const position = input.dataset.set === 'season' ? setSeason(title, value) : setEpisode(title, value);
  input.value = input.dataset.set === 'season' ? position.season : position.episode;
  moveTo(title, position);
}

// ---------- Search ----------

const resultKey = (r) => `${r.media_type}:${r.tmdb_id}`;

function resultState(r) {
  if (findListed(store.list, r)) return 'listed';
  return state.adding.has(resultKey(r)) ? 'adding' : 'open';
}

const resultView = {
  key: resultKey,
  signature: (r) => [r.title, r.poster_path, resultState(r)].join('|'),
  render(r) {
    const status = resultState(r);
    const action =
      status === 'listed'
        ? '<span class="pill pill--done">Na lista ✓</span>'
        : status === 'adding'
          ? '<button type="button" class="pill" disabled>Adicionando…</button>'
          : `<button type="button" class="pill" data-add="${esc(resultKey(r))}" aria-label="Adicionar ${esc(r.title)}">+ Adicionar</button>`;
    return `
      <li class="result">
        ${posterHtml(r, 'w185', 'result-poster')}
        <div class="result-text">
          <p class="result-title">${esc(r.title)}</p>
          <p class="tag">${KIND[r.kind]}${r.year ? ` · ${esc(r.year)}` : ''}</p>
        </div>
        ${action}
      </li>`;
  },
};

const renderResults = () => reconcile($('#search-results'), state.results, resultView);
const setSearchStatus = (text) => {
  $('#search-status').textContent = text;
};

let searchTimer;
let searchController;

function openSearch(opener) {
  $('#search-input').value = '';
  $('#search-clear').hidden = true;
  state.results = [];
  renderResults();
  setSearchStatus(SEARCH_HINT);
  openOverlay($('#search'), {
    opener,
    onClose: () => {
      clearTimeout(searchTimer);
      searchController?.abort();
    },
  });
}

function onSearchInput() {
  const input = $('#search-input');
  const query = input.value.trim();
  $('#search-clear').hidden = !input.value;
  clearTimeout(searchTimer);
  if (query.length < 2) {
    searchController?.abort();
    state.results = [];
    renderResults();
    setSearchStatus(SEARCH_HINT);
    return;
  }
  searchTimer = setTimeout(() => runSearch(query), 300);
}

async function runSearch(query) {
  searchController?.abort();
  const controller = (searchController = new AbortController());
  setSearchStatus('Buscando…');
  try {
    const { results } = await api.search(query, controller.signal);
    if (controller !== searchController) return;
    state.results = results;
    renderResults();
    setSearchStatus(results.length ? '' : `Nada encontrado para “${query}”.`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.status === 401) return signedOut();
    setSearchStatus(problem(err));
  }
}

async function onSearchClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) return closeOverlay();
  const key = button.dataset.add;
  const result = key && state.results.find((r) => resultKey(r) === key);
  if (!result || state.adding.has(key)) return;

  state.adding.add(key);
  renderResults();
  try {
    const { title, existed } = await store.add(result);
    if (existed) toast(`${title.title} já estava na lista.`);
    else toast(`${title.title} agora está em “Para assistir”.`, { action: 'Desfazer', onAction: () => store.remove(title.id) });
  } catch (err) {
    if (err.status === 401) return signedOut();
    toast(problem(err));
  } finally {
    state.adding.delete(key);
    renderResults();
  }
}

// ---------- Login ----------

async function onLogin(event) {
  event.preventDefault();
  const button = $('#login-form [type="submit"]');
  const password = $('#password').value;
  if (!password) {
    $('#login-error').textContent = 'Digite a senha.';
    return;
  }
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    await api.login(password);
    await store.load();
    state.ready = true;
    state.lastSync = Date.now();
    showApp();
  } catch (err) {
    $('#login-error').textContent = loginProblem(err);
  } finally {
    button.disabled = false;
  }
}

async function onLogout() {
  try {
    await api.logout();
  } catch {
    // Offline: the session cookie stays, so this device will still be signed in next time.
  }
  showLogin();
}

// ---------- Start ----------

function bindEvents() {
  $('#login-form').addEventListener('submit', onLogin);
  $('#logout').addEventListener('click', onLogout);
  $('#add').addEventListener('click', (event) => openSearch(event.currentTarget));

  document.querySelector('.chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    render();
  });

  $('#home').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.next) return watchNext(Number(button.dataset.next));
    if (button.dataset.status) return changeStatus(Number(button.dataset.id), button.dataset.status);
    if (button.dataset.open) return openDetail(Number(button.dataset.open), button);
    if (button.dataset.fold) {
      state.expanded[button.dataset.fold] = !state.expanded[button.dataset.fold];
      render();
    }
  });

  $('#detail').addEventListener('click', onDetailClick);
  $('#detail').addEventListener('change', onDetailChange);
  $('#detail').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-set]')) event.target.blur();
  });
  // Tapping a season/episode number selects it, so typing replaces it instead of appending.
  $('#detail').addEventListener('focusin', (event) => {
    if (event.target.matches('[data-set]')) setTimeout(() => event.target.select(), 0);
  });

  $('#search').addEventListener('click', onSearchClick);
  $('#search-input').addEventListener('input', onSearchInput);
  $('#search-clear').addEventListener('click', () => {
    $('#search-input').value = '';
    onSearchInput();
    $('#search-input').focus();
  });

  // On larger screens the page sits on a dimmed backdrop; clicking it closes the page.
  for (const overlay of [$('#detail'), $('#search')]) {
    overlay.addEventListener('click', (event) => event.target === overlay && closeOverlay());
  }

  store.subscribe((event) => {
    if (event.type === 'change') return scheduleRender();
    const { code, title } = event;
    if (code === 'signed_out') signedOut();
    else if (code === 'conflict') toast(`${title.title} mudou em outro aparelho. Mostrando a versão mais recente.`);
    else if (code === 'gone') toast(`${title.title} foi removido em outro aparelho.`);
    else if (code === 'save_failed') toast('Não foi possível salvar. Verifique a conexão e tente de novo.');
  });

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
  window.addEventListener('focus', sync);
  setInterval(() => document.visibilityState === 'visible' && sync(), SYNC_EVERY_MS);
}

async function start() {
  bindEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    await store.load();
  } catch (err) {
    if (err.status === 401) return showLogin();
    toast(problem(err));
  }
  state.ready = true;
  state.lastSync = Date.now();
  showApp();
}

start();
