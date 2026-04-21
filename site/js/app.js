/**
 * ORL Daily — app.js
 * Single-page application logic for the ENT literature review app.
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  lang:           'ar',          // 'ar' | 'en'
  availableDates: [],
  currentDateIdx: 0,             // index into availableDates (0 = latest)
  articles:       [],
  filtered:       [],
  activeFilter:   'all',
  searchQuery:    '',
  modalArticle:   null,
  fcArticle:      null,
  audioPlaying:   null,          // { el: <audio>, pmid }
};

// ── Subspecialty labels ──────────────────────────────────────────────────────
const SUB_LABELS = {
  rhinology:   { ar: 'Rhinology',    en: 'Rhinology' },
  laryngology: { ar: 'Laryngology',  en: 'Laryngology' },
  otology:     { ar: 'Otology',      en: 'Otology' },
  head_neck:   { ar: 'Head & Neck',  en: 'Head & Neck' },
  pediatric:   { ar: 'Pediatric',    en: 'Pediatric' },
  sleep:       { ar: 'Sleep',        en: 'Sleep' },
  general:     { ar: 'General',      en: 'General' },
};

// ── DOM references ───────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── Initialisation ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Language from localStorage
  const savedLang = localStorage.getItem('orl-lang');
  if (savedLang === 'en') {
    state.lang = 'en';
    applyLang();
  }

  // Wire static controls
  $('#btn-lang').addEventListener('click', toggleLang);
  $('#search-input').addEventListener('input', onSearch);
  $('#btn-prev').addEventListener('click', () => navigateDate(1));
  $('#btn-next').addEventListener('click', () => navigateDate(-1));

  // Filter bar
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeFilter = btn.dataset.filter;
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  // Load index then today's articles
  await loadIndex();
}

// ── Index / date loading ─────────────────────────────────────────────────────
async function loadIndex() {
  try {
    const res = await fetch('../data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.availableDates = data.dates || [];
  } catch (e) {
    console.warn('Could not load index.json:', e);
    // Fallback: try today
    const today = new Date().toISOString().slice(0, 10);
    state.availableDates = [today];
  }

  if (state.availableDates.length === 0) {
    renderEmpty('لا توجد بيانات متاحة بعد.', 'No data available yet.');
    return;
  }

  state.currentDateIdx = 0;
  updateDateNav();
  await loadArticles(state.availableDates[0]);
}

async function loadArticles(date) {
  showLoading();
  updateDateDisplay(date);

  try {
    const res = await fetch(`../data/${date}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.articles = data.articles || [];
    state.filtered  = [...state.articles];
    state.activeFilter = 'all';
    state.searchQuery  = '';
    $$('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    $('#search-input').value = '';
    renderArticles(state.filtered);
    updateCount();
  } catch (e) {
    console.error('Failed to load articles:', e);
    renderEmpty(
      'لا توجد مقالات لهذا اليوم.',
      'No articles found for this date.'
    );
  }
}

// ── Date navigation ──────────────────────────────────────────────────────────
function navigateDate(delta) {
  const newIdx = state.currentDateIdx + delta;
  if (newIdx < 0 || newIdx >= state.availableDates.length) return;
  state.currentDateIdx = newIdx;
  updateDateNav();
  loadArticles(state.availableDates[newIdx]);
}

function updateDateNav() {
  const idx = state.currentDateIdx;
  const total = state.availableDates.length;
  $('#btn-prev').disabled = idx >= total - 1;
  $('#btn-next').disabled = idx <= 0;
}

function updateDateDisplay(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const arFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const enFmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const el = $('#date-display');
  if (el) {
    el.innerHTML = `<span class="ar">${arFmt.format(date)}</span><span class="en">${enFmt.format(date)}</span>`;
  }
  // Header date
  const hd = $('#header-date');
  if (hd) {
    hd.innerHTML = `<span class="ar">${arFmt.format(date)}</span><span class="en">${enFmt.format(date)}</span>`;
  }
}

// ── Search ───────────────────────────────────────────────────────────────────
function onSearch(e) {
  state.searchQuery = e.target.value.trim().toLowerCase();
  applyFilters();
}

// ── Filter ───────────────────────────────────────────────────────────────────
function applyFilters() {
  let items = [...state.articles];

  // Subspecialty filter
  if (state.activeFilter && state.activeFilter !== 'all') {
    items = items.filter(a => a.subspecialty === state.activeFilter);
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery;
    items = items.filter(a =>
      (a.title_ar  || '').toLowerCase().includes(q) ||
      (a.title_en  || '').toLowerCase().includes(q) ||
      (a.summary_ar || '').toLowerCase().includes(q) ||
      (a.summary_en || '').toLowerCase().includes(q) ||
      (a.journal   || '').toLowerCase().includes(q)
    );
  }

  state.filtered = items;
  renderArticles(state.filtered);
  updateCount();
}

// ── Render articles ──────────────────────────────────────────────────────────
function renderArticles(articles) {
  const grid = $('#articles-grid');
  if (!grid) return;

  if (articles.length === 0) {
    grid.innerHTML = `
      <div class="state-box">
        <div class="state-box__icon">🔍</div>
        <h3 class="ar">لا توجد نتائج</h3>
        <h3 class="en">No results</h3>
        <p class="ar">جرب كلمة بحث مختلفة أو اختر تخصصاً آخر</p>
        <p class="en">Try a different search term or subspecialty</p>
      </div>`;
    return;
  }

  grid.innerHTML = articles.map(buildCardHTML).join('');

  // Wire card events
  $$('.card', grid).forEach(card => {
    const pmid = card.dataset.pmid;
    card.addEventListener('click', e => {
      // Don't open modal if clicking a button inside the card
      if (e.target.closest('.btn-icon')) return;
      openModal(pmid);
    });
  });

  $$('.btn-audio', grid).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      playAudio(btn.dataset.pmid);
    });
  });

  $$('.btn-fc', grid).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showFlashCard(btn.dataset.pmid);
    });
  });
}

function buildCardHTML(a) {
  const sub    = a.subspecialty || 'general';
  const subLbl = (SUB_LABELS[sub] || SUB_LABELS.general)[state.lang];
  const stars  = renderStars(a.stars);
  const jcBadge = a.journal_club
    ? `<span class="badge badge-jc ar">🎯 Journal Club</span><span class="badge badge-jc en">🎯 Journal Club</span>`
    : '';
  const dwBadge = a.drug_watch
    ? `<span class="badge badge-dw ar">💊 Drug Watch</span><span class="badge badge-dw en">💊 Drug Watch</span>`
    : '';
  const title   = state.lang === 'ar' ? (a.title_ar || a.title_en) : (a.title_en || a.title_ar);
  const summary = state.lang === 'ar' ? a.summary_ar : a.summary_en;
  const practice = state.lang === 'ar' ? a.practice_change_ar : a.practice_change_en;

  return `
<article class="card" data-pmid="${a.pmid}" data-sub="${sub}">
  <div class="card__accent"></div>
  <div class="card__body">
    <div class="card__badges">
      <span class="badge badge-sub" data-sub="${sub}">${subLbl}</span>
      ${jcBadge}${dwBadge}
    </div>
    <div class="card__stars">${stars}</div>
    <h2 class="card__title">
      <span class="ar">${esc(a.title_ar || a.title_en || '')}</span>
      <span class="en">${esc(a.title_en || a.title_ar || '')}</span>
    </h2>
    <p class="card__journal">${esc(a.journal || '')}</p>
    <p class="card__summary">
      <span class="ar">${esc(a.summary_ar || '')}</span>
      <span class="en">${esc(a.summary_en || '')}</span>
    </p>
    ${practice ? `<div class="card__practice">
      <span class="ar">${esc(a.practice_change_ar || '')}</span>
      <span class="en">${esc(a.practice_change_en || '')}</span>
    </div>` : ''}
  </div>
  <div class="card__footer">
    <button class="btn-icon btn-audio" data-pmid="${a.pmid}" title="استمع / Listen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <span class="ar">استمع</span><span class="en">Listen</span>
    </button>
    <button class="btn-icon btn-fc" data-pmid="${a.pmid}" title="Flash Card">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
      <span class="ar">بطاقة</span><span class="en">Flash Card</span>
    </button>
    <span class="card__footer-spacer"></span>
    <a class="btn-icon" href="${a.pubmed_url}" target="_blank" rel="noopener" title="PubMed" onclick="event.stopPropagation()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      PubMed
    </a>
  </div>
</article>`;
}

// ── Modal ────────────────────────────────────────────────────────────────────
function openModal(pmid) {
  const article = state.articles.find(a => a.pmid === pmid);
  if (!article) return;
  state.modalArticle = article;

  const overlay = $('#modal-overlay');
  const content = $('#modal-content');
  content.innerHTML = renderFullArticle(article);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Wire MCQ
  renderMCQ(article.mcq || [], 'modal-mcq');

  // Wire audio
  const playBtn = $('#modal-audio-btn');
  if (playBtn) playBtn.addEventListener('click', () => playAudio(pmid, true));

  // Wire flash card button
  const fcBtn = $('#modal-fc-btn');
  if (fcBtn) fcBtn.addEventListener('click', () => showFlashCard(pmid));

  // Close on backdrop
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  }, { once: true });
}

function closeModal() {
  const overlay = $('#modal-overlay');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  state.modalArticle = null;
  // Stop audio if playing
  stopAudio();
}

function renderFullArticle(a) {
  const sub    = a.subspecialty || 'general';
  const subLbl = (SUB_LABELS[sub] || SUB_LABELS.general)[state.lang];
  const stars  = renderStars(a.stars);
  const jcBadge = a.journal_club ? `<span class="badge badge-jc">🎯 Journal Club</span>` : '';
  const dwBadge = a.drug_watch   ? `<span class="badge badge-dw">💊 Drug Watch</span>` : '';
  const pdfLink = a.pdf_url
    ? `<a href="${a.pdf_url}" target="_blank" rel="noopener" class="ar">PDF مجاني</a><a href="${a.pdf_url}" target="_blank" rel="noopener" class="en">Free PDF</a>`
    : '';

  return `
<!-- Modal header filled by JS, this is modal__body content -->
<div class="modal__header">
  <div class="modal__header-main">
    <div class="modal__badges">
      <span class="badge badge-sub" data-sub="${sub}">${subLbl}</span>
      ${jcBadge}${dwBadge}
    </div>
    <h2 class="modal__title">
      <span class="ar">${esc(a.title_ar || a.title_en || '')}</span>
      <span class="en">${esc(a.title_en || a.title_ar || '')}</span>
    </h2>
    <div class="modal__title-en">
      <span class="ar">${esc(a.title_en || '')}</span>
    </div>
    <div class="modal__meta">
      <span class="modal__stars">${stars}</span>
      <span>${esc(a.journal || '')}</span>
      <span>${esc(a.pub_date || '')}</span>
      <a href="${a.pubmed_url}" target="_blank" rel="noopener">PubMed ↗</a>
      ${pdfLink}
    </div>
    <div class="stars-reason">
      <span class="ar">${esc(a.stars_reason_ar || '')}</span>
      <span class="en">${esc(a.stars_reason_ar || '')}</span>
    </div>
  </div>
  <button class="modal__close" id="modal-close-btn" aria-label="Close">✕</button>
</div>

<div class="modal__body" id="modal-body">

  <!-- Audio -->
  <div class="audio-player">
    <button class="audio-play-btn" id="modal-audio-btn" aria-label="Play audio">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </button>
    <div class="audio-info">
      <div class="audio-info__title ar">القراءة الصوتية</div>
      <div class="audio-info__title en">Audio Summary</div>
      <div class="audio-info__sub ar">اضغط للاستماع</div>
      <div class="audio-info__sub en">Tap to listen</div>
    </div>
    <audio id="modal-audio-el" preload="none"></audio>
  </div>

  <!-- Summary -->
  <div class="analysis-section">
    <div class="analysis-section__head">
      <span class="icon">📄</span>
      <span class="ar">الملخص</span>
      <span class="en">Summary</span>
    </div>
    <div class="analysis-section__body">
      <span class="ar">${esc(a.summary_ar || '')}</span>
      <span class="en">${esc(a.summary_en || '')}</span>
    </div>
  </div>

  <!-- Practice change -->
  <div class="highlight-box practice">
    <div class="highlight-label ar">📌 ماذا يغير اليوم</div>
    <div class="highlight-label en">📌 Practice Change Today</div>
    <div class="ar">${esc(a.practice_change_ar || '')}</div>
    <div class="en">${esc(a.practice_change_en || '')}</div>
  </div>

  <!-- Why important + vs previous -->
  <div class="analysis-section">
    <div class="analysis-section__head">
      <span class="icon">💡</span>
      <span class="ar">لماذا هذه المقالة مهمة</span>
      <span class="en">Why It Matters</span>
    </div>
    <div class="analysis-section__body">
      <div class="ar">${esc(a.why_important_ar || '')}</div>
      <div class="en">${esc(a.why_important_en || '')}</div>
    </div>
  </div>

  <div class="analysis-section">
    <div class="analysis-section__head">
      <span class="icon">🔄</span>
      <span class="ar">مقارنة بالمعرفة السابقة</span>
      <span class="en">vs. Previous Knowledge</span>
    </div>
    <div class="analysis-section__body">
      <div class="ar">${esc(a.vs_previous_ar || '')}</div>
      <div class="en">${esc(a.vs_previous_en || '')}</div>
    </div>
  </div>

  <!-- Future impact -->
  <div class="highlight-box future">
    <div class="highlight-label ar">🔭 التأثير المستقبلي</div>
    <div class="highlight-label en">🔭 Future Impact</div>
    <div class="ar">${esc(a.future_impact_ar || '')}</div>
    <div class="en">${esc(a.future_impact_en || '')}</div>
  </div>

  ${a.drug_watch && a.drug_watch_detail_ar ? `
  <div class="highlight-box dw">
    <div class="highlight-label ar">💊 Drug Watch</div>
    <div class="highlight-label en">💊 Drug Watch</div>
    <div class="ar">${esc(a.drug_watch_detail_ar)}</div>
    <div class="en">${esc(a.drug_watch_detail_ar)}</div>
  </div>` : ''}

  ${a.research_gap_ar ? `
  <div class="highlight-box gap">
    <div class="highlight-label ar">🔬 فجوة بحثية</div>
    <div class="highlight-label en">🔬 Research Gap</div>
    <div class="ar">${esc(a.research_gap_ar)}</div>
    <div class="en">${esc(a.research_gap_ar)}</div>
  </div>` : ''}

  ${a.journal_club && a.jc_reason_ar ? `
  <div class="analysis-section">
    <div class="analysis-section__head" style="color: var(--badge-jc)">
      <span class="icon">🎯</span>
      <span class="ar">توصية Journal Club</span>
      <span class="en">Journal Club Pick</span>
    </div>
    <div class="analysis-section__body">
      <div class="ar">${esc(a.jc_reason_ar)}</div>
      <div class="en">${esc(a.jc_reason_ar)}</div>
    </div>
  </div>` : ''}

  <!-- MCQ -->
  ${(a.mcq && a.mcq.length > 0) ? `
  <div class="analysis-section">
    <div class="analysis-section__head">
      <span class="icon">❓</span>
      <span class="ar">أسئلة الاختبار الذاتي</span>
      <span class="en">Self-Assessment MCQ</span>
    </div>
    <div class="analysis-section__body">
      <div id="modal-mcq" class="mcq-container"></div>
    </div>
  </div>` : ''}

  <!-- Actions -->
  <div style="display:flex;gap:.6rem;flex-wrap:wrap;padding-bottom:.25rem">
    <button class="btn-primary" id="modal-fc-btn">
      <span class="ar">📋 Flash Card</span>
      <span class="en">📋 Flash Card</span>
    </button>
    <a class="btn-outline" href="${a.pubmed_url}" target="_blank" rel="noopener">
      <span class="ar">افتح في PubMed ↗</span>
      <span class="en">Open in PubMed ↗</span>
    </a>
    ${a.pdf_url ? `<a class="btn-outline" href="${a.pdf_url}" target="_blank" rel="noopener">
      <span class="ar">PDF مجاني ↗</span>
      <span class="en">Free PDF ↗</span>
    </a>` : ''}
  </div>

</div>`;
}

// ── MCQ ───────────────────────────────────────────────────────────────────────
function renderMCQ(mcqArr, containerId) {
  const container = $(`#${containerId}`);
  if (!container || !mcqArr || mcqArr.length === 0) return;

  container.innerHTML = mcqArr.map((q, qi) => `
    <div class="mcq-item" id="mcq-${containerId}-${qi}">
      <div class="mcq-question">
        <span class="mcq-number">${qi + 1}</span>
        <span class="ar">${esc(q.q_ar || '')}</span>
        <span class="en">${esc(q.q_ar || '')}</span>
      </div>
      <div class="mcq-options">
        ${(q.options_ar || []).map((opt, oi) => `
          <button class="mcq-option" data-qi="${qi}" data-oi="${oi}" data-correct="${q.answer}" data-container="${containerId}">
            ${esc(opt)}
          </button>`).join('')}
      </div>
      <div class="mcq-explanation" id="mcq-exp-${containerId}-${qi}">
        <span class="ar">${esc(q.explanation_ar || '')}</span>
        <span class="en">${esc(q.explanation_ar || '')}</span>
      </div>
    </div>`).join('');

  // Wire option clicks
  $$('.mcq-option', container).forEach(btn => {
    btn.addEventListener('click', handleMCQAnswer);
  });
}

function handleMCQAnswer(e) {
  const btn       = e.currentTarget;
  const qi        = parseInt(btn.dataset.qi);
  const oi        = parseInt(btn.dataset.oi);
  const correct   = parseInt(btn.dataset.correct);
  const contId    = btn.dataset.container;
  const item      = $(`#mcq-${contId}-${qi}`);
  const exp       = $(`#mcq-exp-${contId}-${qi}`);

  // Prevent re-answering
  if (item.classList.contains('answered')) return;
  item.classList.add('answered');

  // Mark options
  $$('.mcq-option', item).forEach((opt, idx) => {
    opt.classList.add('answered');
    if (idx === correct) opt.classList.add(oi === correct ? 'correct' : 'reveal-correct');
  });
  if (oi !== correct) btn.classList.add('wrong');
  else btn.classList.add('correct');

  // Show explanation
  if (exp) exp.classList.add('visible');
}

// ── Flash Card ────────────────────────────────────────────────────────────────
function showFlashCard(pmid) {
  const article = state.articles.find(a => a.pmid === pmid);
  if (!article) return;
  state.fcArticle = article;

  const overlay = $('#fc-overlay');
  const card    = $('#fc-card-content');
  card.innerHTML = renderFlashCardContent(article);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  $('#fc-close').addEventListener('click', closeFlashCard);
  $('#fc-print').addEventListener('click', printFlashCard);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeFlashCard();
  }, { once: true });
}

function closeFlashCard() {
  $('#fc-overlay').classList.remove('open');
  document.body.style.overflow = '';
  state.fcArticle = null;
}

function printFlashCard() {
  window.print();
}

function renderFlashCardContent(a) {
  const stars = renderStars(a.stars);
  const sub   = a.subspecialty || 'general';
  const subLbl = (SUB_LABELS[sub] || SUB_LABELS.general)[state.lang];

  return `
    <div class="fc-row">
      <div class="fc-label ar">التخصص</div>
      <div class="fc-label en">Subspecialty</div>
      <div class="fc-value">
        <span class="badge badge-sub" data-sub="${sub}">${subLbl}</span>
      </div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">العنوان</div>
      <div class="fc-label en">Title</div>
      <div class="fc-value">
        <div class="ar">${esc(a.title_ar || a.title_en || '')}</div>
        <div class="en">${esc(a.title_en || a.title_ar || '')}</div>
      </div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">المجلة والتاريخ</div>
      <div class="fc-label en">Journal & Date</div>
      <div class="fc-value">${esc(a.journal || '')} · ${esc(a.pub_date || '')}</div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">التقييم</div>
      <div class="fc-label en">Rating</div>
      <div class="fc-value stars">${stars}</div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">الملخص</div>
      <div class="fc-label en">Summary</div>
      <div class="fc-value">
        <div class="ar">${esc(a.summary_ar || '')}</div>
        <div class="en">${esc(a.summary_en || '')}</div>
      </div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">ماذا يغير في الممارسة</div>
      <div class="fc-label en">Practice Change</div>
      <div class="fc-value">
        <div class="ar">${esc(a.practice_change_ar || '')}</div>
        <div class="en">${esc(a.practice_change_en || '')}</div>
      </div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">لماذا مهمة</div>
      <div class="fc-label en">Why It Matters</div>
      <div class="fc-value">
        <div class="ar">${esc(a.why_important_ar || '')}</div>
        <div class="en">${esc(a.why_important_en || '')}</div>
      </div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">مقارنة بالسابق</div>
      <div class="fc-label en">vs. Previous</div>
      <div class="fc-value">
        <div class="ar">${esc(a.vs_previous_ar || '')}</div>
        <div class="en">${esc(a.vs_previous_en || '')}</div>
      </div>
    </div>
    <div class="fc-row">
      <div class="fc-label ar">التأثير المستقبلي</div>
      <div class="fc-label en">Future Impact</div>
      <div class="fc-value">
        <div class="ar">${esc(a.future_impact_ar || '')}</div>
        <div class="en">${esc(a.future_impact_en || '')}</div>
      </div>
    </div>
    ${a.research_gap_ar ? `
    <div class="fc-row">
      <div class="fc-label ar">فجوة بحثية</div>
      <div class="fc-label en">Research Gap</div>
      <div class="fc-value">
        <div class="ar">${esc(a.research_gap_ar)}</div>
        <div class="en">${esc(a.research_gap_ar)}</div>
      </div>
    </div>` : ''}
    <div class="fc-row">
      <div class="fc-label">PubMed</div>
      <div class="fc-value"><a href="${a.pubmed_url}" target="_blank">${a.pubmed_url}</a></div>
    </div>`;
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playAudio(pmid, useModalEl = false) {
  const article = state.articles.find(a => a.pmid === pmid);
  if (!article) return;

  // Build expected audio URL
  const date     = state.availableDates[state.currentDateIdx];
  const audioSrc = `../site/audio/${date}-${pmid}.mp3`;

  // If already playing this, toggle pause
  if (state.audioPlaying && state.audioPlaying.pmid === pmid) {
    const el = state.audioPlaying.el;
    if (el.paused) {
      el.play();
      updateAudioUI(pmid, true);
    } else {
      el.pause();
      updateAudioUI(pmid, false);
    }
    return;
  }

  // Stop any existing
  stopAudio();

  // Try to play
  const audioEl = useModalEl ? $('#modal-audio-el') : new Audio();
  if (!audioEl) return;

  audioEl.src = audioSrc;
  audioEl.preload = 'auto';

  audioEl.onerror = () => {
    // File not available — show brief notification
    showAudioMessage(state.lang === 'ar'
      ? 'الملف الصوتي غير متاح بعد. سيتوفر مع التحديث القادم.'
      : 'Audio not available yet. It will be added in the next update.'
    );
    updateAudioUI(pmid, false);
    state.audioPlaying = null;
  };

  audioEl.onended = () => {
    updateAudioUI(pmid, false);
    state.audioPlaying = null;
  };

  state.audioPlaying = { el: audioEl, pmid };
  audioEl.play().then(() => {
    updateAudioUI(pmid, true);
  }).catch(() => {
    showAudioMessage(state.lang === 'ar'
      ? 'الملف الصوتي غير متاح بعد.'
      : 'Audio file not available yet.'
    );
    state.audioPlaying = null;
    updateAudioUI(pmid, false);
  });
}

function stopAudio() {
  if (state.audioPlaying) {
    try {
      state.audioPlaying.el.pause();
      state.audioPlaying.el.src = '';
    } catch (_) {}
    state.audioPlaying = null;
  }
  // Reset all audio buttons
  $$('.audio-play-btn.playing').forEach(b => b.classList.remove('playing'));
  $$('.btn-audio').forEach(b => b.querySelector('span.ar') && (b.querySelector('span.ar').textContent = 'استمع'));
}

function updateAudioUI(pmid, playing) {
  const modalBtn = $('#modal-audio-btn');
  if (modalBtn) {
    modalBtn.classList.toggle('playing', playing);
    modalBtn.innerHTML = playing
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  }
}

function showAudioMessage(msg) {
  // Small toast notification
  let toast = $('#audio-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'audio-toast';
    toast.style.cssText = `
      position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
      background: #1f2937; color: #fff; padding: .65rem 1.2rem;
      border-radius: 8px; font-size: .82rem; z-index: 9999;
      max-width: 90vw; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,.3);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ── Language toggle ───────────────────────────────────────────────────────────
function toggleLang() {
  state.lang = state.lang === 'ar' ? 'en' : 'ar';
  localStorage.setItem('orl-lang', state.lang);
  applyLang();

  // Re-render articles to update titles/summaries (cards use inline spans, CSS handles toggle)
  // CSS lang show/hide is handled by html[dir] — just need to re-apply lang
}

function applyLang() {
  const html = document.documentElement;
  if (state.lang === 'ar') {
    html.setAttribute('dir', 'rtl');
    html.setAttribute('lang', 'ar');
    $('#btn-lang').textContent = 'EN';
  } else {
    html.setAttribute('dir', 'ltr');
    html.setAttribute('lang', 'en');
    $('#btn-lang').textContent = 'AR';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function renderStars(n) {
  const count = Math.max(0, Math.min(5, parseInt(n) || 0));
  return '★'.repeat(count) + '☆'.repeat(5 - count);
}

function updateCount() {
  const el = $('#articles-count');
  if (!el) return;
  const n = state.filtered.length;
  el.innerHTML = state.lang === 'ar'
    ? `<span class="ar">${n} مقالة</span><span class="en">${n} articles</span>`
    : `<span class="ar">${n} مقالة</span><span class="en">${n} articles</span>`;
}

function showLoading() {
  const grid = $('#articles-grid');
  if (grid) grid.innerHTML = `
    <div class="state-box">
      <div class="spinner"></div>
      <p class="ar">جارٍ التحميل…</p>
      <p class="en">Loading…</p>
    </div>`;
}

function renderEmpty(msgAr, msgEn) {
  const grid = $('#articles-grid');
  if (grid) grid.innerHTML = `
    <div class="state-box">
      <div class="state-box__icon">📭</div>
      <p class="ar">${esc(msgAr)}</p>
      <p class="en">${esc(msgEn)}</p>
    </div>`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Keyboard handling ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#fc-overlay.open'))      closeFlashCard();
    else if ($('#modal-overlay.open')) closeModal();
  }
});

// ── Wire modal close button (delegated since modal is re-rendered) ────────────
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'modal-close-btn') closeModal();
});
