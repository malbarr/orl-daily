/**
 * ORL Daily — Main Application JavaScript
 * © 2026 Mohammad Al-Bar | MIT License
 *
 * Functions exposed globally (for inline HTML event handlers and keyboard shortcuts):
 *   closeModal(id)
 *   closeFlashCard()
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────
const SUBSPEC_LABELS = {
  ar: {
    rhinology:       'الأنف والجيوب',
    skull_base:      'قاعدة الجمجمة',
    laryngology:     'الحنجرة',
    facial_plastics: 'التجميل الوجهي',
    otology:         'الأذن',
    head_neck:       'الرأس والرقبة',
    pediatric:       'Pediatric ENT',
    sleep:           'اضطرابات النوم',
    business:        'الاقتصاد والصناعة',
    general:         'عام',
  },
  en: {
    rhinology:       'Rhinology',
    skull_base:      'Skull Base',
    laryngology:     'Laryngology',
    facial_plastics: 'Facial Plastics',
    otology:         'Otology',
    head_neck:       'Head & Neck',
    pediatric:       'Pediatric ENT',
    sleep:           'Sleep Medicine',
    business:        'Business / Industry',
    general:         'General',
  },
};

const SUBSPEC_COLORS = {
  rhinology:       '#c0392b',
  skull_base:      '#8e44ad',
  laryngology:     '#d35400',
  facial_plastics: '#16a085',
  otology:         '#2980b9',
  head_neck:       '#27ae60',
  pediatric:       '#e67e22',
  sleep:           '#7f8c8d',
  business:        '#2c3e50',
  general:         '#34495e',
};

// ── App State ──────────────────────────────────────────────────────────────────
const state = {
  lang:         localStorage.getItem('orl-lang') || 'en',
  filter:       'all',
  articles:     [],      // all articles for current date
  allDates:     [],      // list of available dates from index.json
  currentDate:  null,
  searchQuery:  '',
};

// ── DOM Helpers ────────────────────────────────────────────────────────────────
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// ── Initialization ─────────────────────────────────────────────────────────────
async function init() {
  applyLang(state.lang, false);
  bindHeader();
  bindFilterTabs();
  showLoading();

  try {
    const idx = await fetchJSON('./data/index.json');
    state.allDates = (idx.dates || []).sort().reverse();
    populateDatePicker(state.allDates);

    if (state.allDates.length > 0) {
      await loadDate(state.allDates[0]);
    } else {
      showEmpty();
    }
  } catch (err) {
    console.error('[ORL Daily] Failed to load index.json:', err);
    showError(
      state.lang === 'ar'
        ? 'تعذّر تحميل البيانات. تأكد من الاتصال بالإنترنت.'
        : 'Failed to load data. Check your internet connection.'
    );
  }
}

// ── Data Loading ───────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url + '?_=' + Date.now());
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

async function loadDate(dateStr) {
  showLoading();
  state.currentDate  = dateStr;
  state.filter       = 'all';
  state.searchQuery  = '';

  // Update date picker
  const picker = $('#date-picker');
  if (picker) picker.value = dateStr;

  // Update date display in header
  const dateDisplay = $('#current-date-display');
  if (dateDisplay) dateDisplay.textContent = formatDate(dateStr);

  // Reset search input
  const searchInput = $('#search-input');
  if (searchInput) searchInput.value = '';

  setActiveFilterTab('all');

  try {
    const data = await fetchJSON(`./data/${dateStr}.json`);
    state.articles = data.articles || [];
    renderArticles();
  } catch (err) {
    console.error('[ORL Daily] Failed to load date:', err);
    showError(
      state.lang === 'ar'
        ? `تعذّر تحميل مقالات ${dateStr}`
        : `Could not load articles for ${dateStr}`
    );
  }
}

// ── Language ───────────────────────────────────────────────────────────────────
function applyLang(lang, save = true) {
  state.lang = lang;
  if (save) localStorage.setItem('orl-lang', lang);

  document.body.classList.remove('lang-ar', 'lang-en');
  document.body.classList.add('lang-' + lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

  // Update lang-switcher active state
  $$('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  const search = $('#search-input');
  if (search) {
    const ph = { ar: 'بحث…', en: 'Search…' };
    search.setAttribute('placeholder', ph[lang] || 'Search…');
  }

  if (state.currentDate) {
    const dateDisplay = $('#current-date-display');
    if (dateDisplay) dateDisplay.textContent = formatDate(state.currentDate);
  }

  if (state.allDates.length) populateDatePicker(state.allDates);
  if (state.articles.length) renderArticles();
}

function toggleLang() {
  const cycle = { en: 'ar', ar: 'en' };
  applyLang(cycle[state.lang] || 'en');
}

// ── Text Helpers ───────────────────────────────────────────────────────────────
function getText(article, field) {
  const arKey = field + '_ar';
  const enKey = field + '_en';
  if (state.lang === 'ar') return article[arKey] || article[enKey] || '';
  return article[enKey] || article[arKey] || '';
}

function renderStars(n) {
  const count = Math.max(0, Math.min(5, parseInt(n) || 0));
  return '⭐'.repeat(count) + '☆'.repeat(5 - count);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    // Append noon UTC to avoid timezone day shifts
    const d = new Date(dateStr + 'T12:00:00Z');
    if (isNaN(d.getTime())) return dateStr;
    const localeMap = { ar: 'ar-SA-u-ca-gregory' };
    const locale = localeMap[state.lang] || 'en-GB';
    return d.toLocaleDateString(locale, {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC', calendar: 'gregory'
    });
  } catch {
    return dateStr;
  }
}

function getSubspecLabel(subspec) {
  return (SUBSPEC_LABELS[state.lang] || SUBSPEC_LABELS.en)[subspec] || subspec;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max).trimEnd() + '…';
}

// ── Security: HTML escaping ────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return escHtml(String(str || ''));
}

// ── Filter & Search ────────────────────────────────────────────────────────────
function getFilteredArticles() {
  let articles = state.articles;

  if (state.filter === 'jc') {
    articles = articles.filter(a => a.journal_club);
  } else if (state.filter === 'watch') {
    articles = articles.filter(a => a.watch || a.drug_watch);
  } else if (state.filter !== 'all') {
    articles = articles.filter(a => a.subspecialty === state.filter);
  }

  if (state.searchQuery.trim()) {
    const q = state.searchQuery.trim().toLowerCase();
    articles = articles.filter(a => {
      const haystack = [
        a.title_ar, a.title_en,
        a.summary_ar, a.summary_en,
        a.journal, a.subspecialty,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  return articles;
}

function filterBySubspecialty(sub) {
  state.filter = sub;
  setActiveFilterTab(sub);
  renderArticles();
}

function searchArticles(query) {
  state.searchQuery = query;
  renderArticles();
}

// ── Render Cards ───────────────────────────────────────────────────────────────
function renderArticles() {
  const grid = $('#articles-grid');
  if (!grid) return;

  const articles = getFilteredArticles();
  grid.innerHTML = '';

  // Update per-tab counts
  updateTabCounts();

  // Update article count bar
  const bar = $('#article-count-bar');
  if (bar) {
    const total = state.articles.length;
    const jcCount = state.articles.filter(a => a.journal_club).length;
    if (total > 0) {
      const totalLabel = state.lang === 'ar'
        ? `${total} مقالة اليوم`
        : `${total} articles today`;
      const jcLabel = jcCount > 0
        ? (state.lang === 'ar' ? ` · 🎯 ${jcCount} Journal Club` : ` · 🎯 ${jcCount} Journal Club`)
        : '';
      bar.textContent = totalLabel + jcLabel;
      bar.classList.add('visible');
    } else {
      bar.classList.remove('visible');
    }
  }

  if (!articles.length) {
    grid.innerHTML = `<div class="state-card" role="status">
      <p>${state.lang === 'ar' ? 'لا توجد مقالات مطابقة' : 'No matching articles found'}</p>
    </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  articles.forEach(article => frag.appendChild(buildCard(article)));
  grid.appendChild(frag);
}

function buildCard(article) {
  const subspec = article.subspecialty || 'general';
  const title   = getText(article, 'title');
  const summary = getText(article, 'summary');
  const date    = formatDate(article.pub_date || article.date);
  const stars   = parseInt(article.stars) || 0;

  const card = document.createElement('article');
  card.className = 'article-card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.dataset.pmid = article.pmid;

  const jcBadge = article.journal_club
    ? `<span class="badge jc" aria-label="Journal Club">🎯 JC</span>` : '';
  const watchActive = article.watch || article.drug_watch;
  const watchIcon = { drug: '💊', device: '🔬', technology: '💡', instrument: '🔧' }[article.watch_type] || '👁';
  const dwBadge = watchActive
    ? `<span class="badge dw" aria-label="Watch">${watchIcon} Watch</span>` : '';
  const confBadge = article.confidence
    ? `<span class="badge confidence" title="${escAttr(article.confidence === '🟢' ? 'Practice-changing' : article.confidence === '🔴' ? 'Weak evidence' : 'Worth knowing')}">${escHtml(article.confidence)}</span>` : '';

  card.innerHTML = `
    <div class="card-subspecialty-bar ${escAttr(subspec)}" aria-hidden="true"></div>
    <div class="card-body">
      <div class="card-badges">
        <span class="badge subspecialty ${escAttr(subspec)}">${escHtml(getSubspecLabel(subspec))}</span>
        <span class="badge stars" aria-label="${stars} stars">${renderStars(stars)}</span>
        ${confBadge}
        ${jcBadge}
        ${dwBadge}
      </div>
      <h3 class="card-title">${escHtml(title)}</h3>
      <div class="card-meta">${escHtml(article.journal || '')}${date ? ' &bull; ' + escHtml(date) : ''}</div>
      <p class="card-summary">${escHtml(summary)}</p>
    </div>
    <div class="card-actions">
      <button class="btn btn-read"  data-action="read"  aria-label="${state.lang === 'ar' ? 'قراءة المقالة كاملةً' : 'Read full article'}">
        ${state.lang === 'ar' ? 'اقرأ الكامل' : 'Read Full'}
      </button>
      <button class="btn btn-audio" data-action="audio" aria-label="${state.lang === 'ar' ? 'استمع للملخص' : 'Listen to summary'}">
        🎧 ${state.lang === 'ar' ? 'استمع' : 'Listen'}
      </button>
      <button class="btn btn-flash" data-action="flash" aria-label="Flash Card">
        📸 Flash Card
      </button>
    </div>
  `;

  // Event delegation
  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'read')  openArticle(article.pmid);
      if (action === 'audio') openArticleWithAudio(article.pmid);
      if (action === 'flash') showFlashCard(article.pmid);
    } else {
      openArticle(article.pmid);
    }
  });

  // Keyboard accessibility
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openArticle(article.pmid);
    }
  });

  return card;
}

// ── Article Modal ──────────────────────────────────────────────────────────────
function findArticle(pmid) {
  return state.articles.find(a => String(a.pmid) === String(pmid));
}

function openModal(pmid) { openArticle(pmid); }  // public alias

function openArticle(pmid) {
  const article = findArticle(pmid);
  if (!article) return;

  const overlay = $('#article-modal');
  const box     = $('#article-modal-box');
  if (!overlay || !box) return;

  box.innerHTML = buildArticleModal(article);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Focus modal for accessibility
  setTimeout(() => box.focus(), 60);

  // Bind close button
  const closeBtn = $('#article-modal-close', box);
  if (closeBtn) closeBtn.addEventListener('click', () => closeModal('article-modal'));

  // Close on overlay click
  overlay.addEventListener('click', function handler(e) {
    if (e.target === overlay) {
      closeModal('article-modal');
      overlay.removeEventListener('click', handler);
    }
  });

  // MCQ
  const mcqContainer = $('#mcq-container', box);
  if (mcqContainer && article.mcq && article.mcq.length) {
    renderMCQ(article, mcqContainer);
  }

  // Audio
  bindAudioPlayer(article, box);

  // Flash card button inside modal
  const btnFlash = $('#btn-flash-from-modal', box);
  if (btnFlash) btnFlash.addEventListener('click', () => showFlashCard(pmid));
}

function openArticleWithAudio(pmid) {
  openArticle(pmid);
  setTimeout(() => {
    const playBtn = $('#audio-play-btn');
    if (playBtn) playBtn.click();
  }, 400);
}

function buildArticleModal(article) {
  const subspec  = article.subspecialty || 'general';
  const title    = getText(article, 'title');
  const summary  = getText(article, 'summary');
  const practice = getText(article, 'practice_change');
  const future   = getText(article, 'future_impact');
  const why      = getText(article, 'why_important');
  const vs       = getText(article, 'vs_previous');
  const stars    = parseInt(article.stars) || 0;
  const date     = formatDate(article.pub_date || article.date);

  const subsLabel = getSubspecLabel(subspec);

  const jcReason = state.lang === 'ar' ? article.jc_reason_ar : (article.jc_reason_en || article.jc_reason_ar);
  const jcBadge = article.journal_club
    ? `<span class="badge jc" style="font-size:0.82rem;padding:0.25rem 0.8rem;">🎯 Journal Club${jcReason ? ' — ' + escHtml(jcReason) : ''}</span>` : '';

  const watchDetail = state.lang === 'ar'
    ? (article.watch_detail_ar || article.drug_watch_detail_ar)
    : (article.watch_detail_en || article.watch_detail_ar || article.drug_watch_detail_ar);
  const watchIsActive = article.watch || article.drug_watch;
  const wIcon = { drug: '💊', device: '🔬', technology: '💡', instrument: '🔧' }[article.watch_type] || '👁';
  const wLabel = { drug: 'Drug Watch', device: 'Device Watch', technology: 'Tech Watch', instrument: 'Instrument Watch' }[article.watch_type] || 'Watch';
  const dwBanner = (watchIsActive && watchDetail)
    ? `<div class="drug-watch-banner" role="alert">
        ${wIcon} <strong>${wLabel}:</strong> ${escHtml(watchDetail)}
       </div>` : '';

  const researchGapText = state.lang === 'ar' ? article.research_gap_ar : (article.research_gap_en || article.research_gap_ar);
  const researchGap = researchGapText
    ? `<div class="section-block block-research">
        <h4>🔬 ${state.lang === 'ar' ? 'فجوة بحثية' : 'Research Gap'}</h4>
        <p>${escHtml(researchGapText)}</p>
       </div>` : '';

  const pdfLink = article.pdf_url
    ? `<a class="btn-link" href="${escAttr(article.pdf_url)}" target="_blank" rel="noopener noreferrer">📄 ${state.lang === 'ar' ? 'PDF مجاني' : 'Free PDF'}</a>` : '';

  const pubmedLink = article.pubmed_url
    ? `<a class="btn-link" href="${escAttr(article.pubmed_url)}" target="_blank" rel="noopener noreferrer">🔗 PubMed</a>` : '';

  const doiLink = article.doi
    ? `<a class="btn-link" href="https://doi.org/${escAttr(article.doi)}" target="_blank" rel="noopener noreferrer">🌐 DOI</a>` : '';

  return `
    <div class="modal-header">
      <div style="flex:1;min-width:0;">
        <div class="modal-header-title">${escHtml(title)}</div>
        <div class="modal-header-meta">
          <span class="badge subspecialty ${escAttr(subspec)}" style="font-size:0.7rem;">${escHtml(subsLabel)}</span>
          ${article.confidence ? `<span class="badge confidence" style="font-size:0.7rem;" title="${escAttr(article.confidence === '🟢' ? 'Practice-changing' : article.confidence === '🔴' ? 'Weak evidence' : 'Worth knowing')}">${escHtml(article.confidence)}</span>` : ''}
          ${article.study_design ? `<span style="font-size:0.72rem;opacity:0.75;margin-left:0.4rem;">📐 ${escHtml(article.study_design)}</span>` : ''}
          &ensp;${escHtml(article.journal || '')}${date ? ' · ' + escHtml(date) : ''}
        </div>
      </div>
      <button class="modal-close" id="article-modal-close" aria-label="${state.lang === 'ar' ? 'إغلاق' : 'Close'}">✕</button>
    </div>

    <div class="modal-body">

      ${dwBanner}

      <!-- Audio Player -->
      <div class="audio-player" id="audio-player-section" aria-label="${state.lang === 'ar' ? 'مشغل الصوت' : 'Audio player'}">
        <button class="audio-play-btn" id="audio-play-btn" aria-label="${state.lang === 'ar' ? 'تشغيل' : 'Play'}">▶</button>
        <div class="audio-info">
          <div class="audio-title">🎧 ${state.lang === 'ar' ? 'اسمع الملخص أثناء القيادة' : 'Listen while driving'}</div>
          <audio id="article-audio" preload="none" aria-label="${state.lang === 'ar' ? 'ملف صوتي' : 'Audio file'}">
            <source src="./audio/${escAttr(article.pmid)}.mp3" type="audio/mpeg" />
          </audio>
        </div>
      </div>

      <!-- Summary -->
      <div class="section-block block-summary">
        <h4>📋 ${state.lang === 'ar' ? 'الملخص' : 'Summary'}</h4>
        <p>${escHtml(summary)}</p>
      </div>

      <!-- Practice Change -->
      <div class="section-block block-practice">
        <h4>🔄 ${state.lang === 'ar' ? 'يغير الممارسة السريرية اليوم' : 'Practice Change Today'}</h4>
        <p>${escHtml(practice)}</p>
      </div>

      <!-- Future Impact -->
      <div class="section-block block-future">
        <h4>⏳ ${state.lang === 'ar' ? 'التأثير المستقبلي' : 'Future Impact'}</h4>
        <p>${escHtml(future)}</p>
      </div>

      <!-- Why Important -->
      <div class="section-block block-why">
        <h4>💡 ${state.lang === 'ar' ? 'لماذا هذه المقالة مهمة؟' : 'Why It Matters'}</h4>
        <p>${escHtml(why)}</p>
      </div>

      <!-- vs Previous -->
      <div class="section-block block-vs">
        <h4>📏 ${state.lang === 'ar' ? 'ماذا غيّرت مقارنةً بالمعرفة السابقة؟' : 'vs Previous Knowledge'}</h4>
        <p>${escHtml(vs)}</p>
      </div>

      <!-- Stars & JC -->
      <div class="stars-row">
        <span class="stars-display" aria-label="${stars} stars">${renderStars(stars)}</span>
        ${jcBadge}
        <span class="stars-reason">${escHtml(state.lang === 'ar' ? (article.stars_reason_ar || '') : (article.stars_reason_en || article.stars_reason_ar || ''))}</span>
      </div>

      ${researchGap}

      <!-- MCQ -->
      <div id="mcq-container"></div>

      <!-- Links Row -->
      <div class="modal-links">
        ${pdfLink}
        ${pubmedLink}
        ${doiLink}
        <button class="btn-link" id="btn-flash-from-modal">📸 Flash Card</button>
        <button class="btn-link" onclick="window.print()">🖨️ ${state.lang === 'ar' ? 'طباعة' : 'Print'}</button>
      </div>

    </div>
  `;
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';

  // Stop any playing audio
  const audio = document.getElementById('article-audio');
  if (audio) { try { audio.pause(); audio.currentTime = 0; } catch (e) {} }
}

// ── Audio Player ───────────────────────────────────────────────────────────────
function playAudio(pmid) {
  openArticleWithAudio(pmid);
}

function bindAudioPlayer(article, container) {
  const playBtn = $('#audio-play-btn', container);
  const audio   = $('#article-audio', container);
  if (!playBtn || !audio) return;

  let audioFailed = false;

  audio.addEventListener('error', () => {
    if (!audioFailed) {
      audioFailed = true;
      // Hide audio element, show script fallback
      const section = $('#audio-player-section', container);
      if (section) showAudioScript(article, section);
    }
  }, { once: true });

  playBtn.addEventListener('click', () => {
    if (audioFailed) {
      showAudioScript(article, $('#audio-player-section', container));
      return;
    }
    if (audio.paused) {
      audio.play()
        .then(() => { playBtn.textContent = '⏸'; playBtn.setAttribute('aria-label', state.lang === 'ar' ? 'إيقاف' : 'Pause'); })
        .catch(() => {
          audioFailed = true;
          showAudioScript(article, $('#audio-player-section', container));
        });
    } else {
      audio.pause();
      playBtn.textContent = '▶';
      playBtn.setAttribute('aria-label', state.lang === 'ar' ? 'تشغيل' : 'Play');
    }
  });

  audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });
  audio.addEventListener('play',  () => { playBtn.textContent = '⏸'; });
}

function showAudioScript(article, section) {
  if (!section) return;
  const script = state.lang === 'ar' ? (article.audio_script_ar || '') : (article.audio_script_en || article.audio_script_ar || '');
  const label  = state.lang === 'ar'
    ? '📜 النص الصوتي (ملف MP3 غير متوفر بعد)'
    : '📜 Audio script (MP3 not available yet)';
  section.innerHTML = `
    <div style="width:100%;padding:0.25rem 0;">
      <div style="font-size:0.78rem;opacity:0.6;margin-bottom:0.6rem;">${escHtml(label)}</div>
      <div class="audio-script-fallback">${escHtml(script)}</div>
    </div>
  `;
}

// ── MCQ ────────────────────────────────────────────────────────────────────────
function renderMCQ(article, container) {
  if (!article.mcq || !article.mcq.length) return;

  const section = document.createElement('div');
  section.className = 'mcq-section';
  section.setAttribute('aria-label', state.lang === 'ar' ? 'اختبر نفسك' : 'Test Yourself');

  const header = document.createElement('div');
  header.className = 'mcq-header';
  header.textContent = state.lang === 'ar' ? '📝 اختبر نفسك' : '📝 Test Yourself';
  section.appendChild(header);

  article.mcq.forEach((q, qi) => {
    const qDiv = document.createElement('div');
    qDiv.className = 'mcq-question';
    qDiv.id = `mcq-q-${qi}`;

    // Question number label
    const numDiv = document.createElement('div');
    numDiv.className = 'mcq-q-number';
    numDiv.textContent = state.lang === 'ar' ? `السؤال ${qi + 1}` : `Question ${qi + 1}`;
    qDiv.appendChild(numDiv);

    // Question text
    const qText = document.createElement('div');
    qText.className = 'mcq-q-text';
    qText.textContent = state.lang === 'ar' ? (q.q_ar || q.q_en || '') : (q.q_en || q.q_ar || '');
    qDiv.appendChild(qText);

    // Options
    const optsDiv = document.createElement('div');
    optsDiv.className = 'mcq-options';
    optsDiv.id = `mcq-opts-${qi}`;

    const opts = state.lang === 'ar' ? (q.options_ar || q.options_en || []) : (q.options_en || q.options_ar || []);
    opts.forEach((optText, oi) => {
      const btn = document.createElement('button');
      btn.className = 'mcq-option';
      btn.type = 'button';
      btn.textContent = optText;
      btn.dataset.qi      = qi;
      btn.dataset.oi      = oi;
      btn.dataset.correct = q.answer;
      btn.setAttribute('aria-label', optText);
      optsDiv.appendChild(btn);
    });

    qDiv.appendChild(optsDiv);

    // Explanation (hidden until answered)
    const expDiv = document.createElement('div');
    expDiv.className = 'mcq-explanation';
    expDiv.id = `mcq-exp-${qi}`;
    expDiv.textContent = state.lang === 'ar' ? (q.explanation_ar || q.explanation_en || '') : (q.explanation_en || q.explanation_ar || '');
    qDiv.appendChild(expDiv);

    section.appendChild(qDiv);
  });

  container.innerHTML = '';
  container.appendChild(section);

  // Event delegation for option clicks
  section.addEventListener('click', e => {
    const btn = e.target.closest('.mcq-option');
    if (!btn || btn.disabled) return;
    const qi      = parseInt(btn.dataset.qi, 10);
    const oi      = parseInt(btn.dataset.oi, 10);
    const correct = parseInt(btn.dataset.correct, 10);
    revealAnswer(qi, oi, correct, section);
  });
}

function revealAnswer(qi, selectedOi, correctOi, container) {
  // Disable all options for this question
  const allOpts = $$(`[data-qi="${qi}"]`, container);
  allOpts.forEach(btn => {
    btn.disabled = true;
    const oi = parseInt(btn.dataset.oi, 10);
    if (oi === correctOi) {
      btn.classList.add('correct');
    } else if (oi === selectedOi) {
      btn.classList.add('wrong');
    }
  });

  // Show explanation
  const expEl = $(`#mcq-exp-${qi}`, container);
  if (expEl) expEl.classList.add('visible');
}

// ── Flash Card ─────────────────────────────────────────────────────────────────
function showFlashCard(pmid) {
  const article = findArticle(pmid);
  if (!article) return;

  const modal = $('#flash-card-modal');
  const box   = $('#flash-card-box');
  if (!modal || !box) return;

  box.innerHTML = buildFlashCard(article);
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Focus
  setTimeout(() => box.focus(), 60);

  // Button bindings
  const btnClose      = $('#fc-close',      box);
  const btnPrint      = $('#fc-print',      box);
  const btnScreenshot = $('#fc-screenshot', box);

  if (btnClose)      btnClose.addEventListener('click', closeFlashCard);
  if (btnPrint)      btnPrint.addEventListener('click', printFlashCard);
  if (btnScreenshot) btnScreenshot.addEventListener('click', () => screenshotFlashCard(pmid));

  // Close on overlay click
  modal.addEventListener('click', function handler(e) {
    if (e.target === modal) {
      closeFlashCard();
      modal.removeEventListener('click', handler);
    }
  });

  // Generate QR code if library available
  if (typeof QRCode !== 'undefined' && article.doi) {
    generateQRCode(
      `https://doi.org/${article.doi}`,
      $('#fc-qr-container', box)
    );
  }
}

function buildFlashCard(article) {
  const subspec  = article.subspecialty || 'general';
  const title    = getText(article, 'title');
  const summary  = getText(article, 'summary');
  const practice = getText(article, 'practice_change');
  const future   = getText(article, 'future_impact');
  const vs       = getText(article, 'vs_previous');
  const stars    = parseInt(article.stars) || 0;
  const date     = formatDate(article.pub_date || article.date || state.currentDate || '');
  const subsLabel = getSubspecLabel(subspec);

  const jcBadge = article.journal_club
    ? `<span class="badge jc" style="font-size:0.68rem;">🎯 JC</span>` : '';

  // First MCQ for flash card
  const mcq0 = article.mcq && article.mcq[0];
  const mcq0q = state.lang === 'ar' ? (mcq0 && (mcq0.q_ar || mcq0.q_en) || '') : (mcq0 && (mcq0.q_en || mcq0.q_ar) || '');
  const mcq0opts = mcq0 ? (state.lang === 'ar' ? (mcq0.options_ar || mcq0.options_en || []) : (mcq0.options_en || mcq0.options_ar || [])) : [];
  const mcqHtml = mcq0 ? `
    <div class="fc-section">
      <div class="fc-section-label">MCQ</div>
      <div class="fc-mcq-q">${escHtml(mcq0q)}</div>
      <div class="fc-mcq-opts">
        ${mcq0opts.map(o => `<div>${escHtml(o)}</div>`).join('')}
      </div>
    </div>
  ` : '';

  return `
    <!-- Controls bar (hidden in print) -->
    <div class="flash-card-controls">
      <span>📸 Flash Card</span>
      <div class="flash-controls-actions">
        <button class="btn-fc-action" id="fc-print"
          title="${state.lang === 'ar' ? 'طباعة' : 'Print'}">
          🖨️ ${state.lang === 'ar' ? 'طباعة' : 'Print'}
        </button>
        <button class="btn-fc-action" id="fc-screenshot"
          title="${state.lang === 'ar' ? 'حفظ كصورة' : 'Save as image'}">
          📷 ${state.lang === 'ar' ? 'صورة' : 'Screenshot'}
        </button>
        <button class="btn-fc-action" id="fc-close"
          aria-label="${state.lang === 'ar' ? 'إغلاق' : 'Close'}">✕</button>
      </div>
    </div>

    <!-- Printable / screenshottable card -->
    <div class="flash-card-print" id="flash-card-print">

      <!-- Card header bar -->
      <div class="fc-top-bar">
        <span>
          ORL Daily &bull;
          ${escHtml(date)} &bull;
          <span style="text-transform:capitalize">${escHtml(subsLabel)}</span>
        </span>
        <div class="fc-top-badges">
          <span style="color:#f1c40f;letter-spacing:0.04em;" aria-label="${stars} stars">${renderStars(stars)}</span>
          ${jcBadge}
        </div>
      </div>

      <div class="fc-body">

        <!-- Title & Journal -->
        <div class="fc-section">
          <div class="fc-title">${escHtml(title)}</div>
          <div class="fc-journal">${escHtml(article.journal || '')}</div>
        </div>

        <!-- Summary (truncated) -->
        <div class="fc-section">
          <div class="fc-section-label">${state.lang === 'ar' ? 'الملخص' : 'Summary'}</div>
          <div style="font-size:0.85rem;line-height:1.65;">${escHtml(truncate(summary, 320))}</div>
        </div>

        <!-- Key takeaways -->
        <div class="fc-section">
          <div class="fc-bullet"><strong>🔄</strong> ${escHtml(truncate(practice, 180))}</div>
          <div class="fc-bullet"><strong>⏳</strong> ${escHtml(truncate(future, 150))}</div>
          <div class="fc-bullet"><strong>📏</strong> ${escHtml(truncate(vs, 150))}</div>
        </div>

        ${mcqHtml}

        <!-- Footer -->
        <div class="fc-footer">
          <div>
            <div class="fc-footer-brand">ORL Daily</div>
            <div>© 2026 Mohammad Al-Bar</div>
            ${article.pubmed_url ? `<div style="font-size:0.68rem;margin-top:0.15rem;opacity:0.75;">${escHtml(article.pubmed_url)}</div>` : ''}
          </div>
          <div class="fc-qr-container" id="fc-qr-container">
            <div class="fc-qr-placeholder">QR<br>Code</div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function closeFlashCard() {
  const modal = document.getElementById('flash-card-modal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function printFlashCard() {
  window.print();
}

async function screenshotFlashCard(pmid) {
  const el = document.getElementById('flash-card-print');
  if (!el) return;

  if (typeof html2canvas === 'function') {
    try {
      const canvas = await html2canvas(el, {
        scale:   2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `orl-daily-${pmid || 'card'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.warn('[ORL Daily] html2canvas error:', err);
      const msg = state.lang === 'ar'
        ? 'تعذّر إنشاء الصورة. استخدم زر الطباعة واحفظ كـ PDF.'
        : 'Screenshot failed. Use Print → Save as PDF instead.';
      alert(msg);
    }
  } else {
    // Fallback: guide user to use browser print
    const msg = state.lang === 'ar'
      ? 'لحفظ الصورة: استخدم زر الطباعة ثم اختر «حفظ كـ PDF»'
      : 'To save as image: use Print → Save as PDF';
    alert(msg);
    printFlashCard();
  }
}

// ── QR Code ────────────────────────────────────────────────────────────────────
function generateQRCode(url, container) {
  if (!container || !url) return;
  try {
    container.innerHTML = '';
    new QRCode(container, {
      text:          url,
      width:         60,
      height:        60,
      correctLevel:  QRCode.CorrectLevel.M,
    });
  } catch (e) {
    console.warn('[ORL Daily] QRCode generation failed:', e);
  }
}

// ── Date Picker ────────────────────────────────────────────────────────────────
function populateDatePicker(dates) {
  const picker = document.getElementById('date-picker');
  if (!picker) return;
  const currentVal = picker.value || state.currentDate;
  picker.innerHTML = '';
  dates.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = formatDate(d);
    if (d === currentVal) opt.selected = true;
    picker.appendChild(opt);
  });
}

// ── Filter Tabs ────────────────────────────────────────────────────────────────
function bindFilterTabs() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    filterBySubspecialty(tab.dataset.filter);
  });
}

function setActiveFilterTab(filter) {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === filter);
    tab.setAttribute('aria-selected', tab.dataset.filter === filter ? 'true' : 'false');
  });
}

function updateTabCounts() {
  const articles = state.articles;
  if (!articles.length) return;

  // Count per subspecialty
  const counts = {};
  articles.forEach(a => {
    const s = a.subspecialty || 'general';
    counts[s] = (counts[s] || 0) + 1;
    // journal_club tab
    if (a.journal_club) counts['jc'] = (counts['jc'] || 0) + 1;
    // watch tab
    if (a.watch_type) counts['watch'] = (counts['watch'] || 0) + 1;
  });
  counts['all'] = articles.length;

  document.querySelectorAll('.filter-tab').forEach(tab => {
    const f = tab.dataset.filter;
    // Remove old badge
    const old = tab.querySelector('.tab-count');
    if (old) old.remove();
    const n = counts[f] || 0;
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'tab-count';
      badge.textContent = n;
      tab.appendChild(badge);
    }
  });
}

// ── Header Bindings ────────────────────────────────────────────────────────────
function bindHeader() {
  // Language switcher buttons
  $$('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => applyLang(btn.dataset.lang));
  });

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => searchArticles(e.target.value));
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchArticles('');
      }
    });
  }

  // Date picker
  const picker = document.getElementById('date-picker');
  if (picker) {
    picker.addEventListener('change', e => {
      if (e.target.value) loadDate(e.target.value);
    });
  }
}

// ── Loading / Empty / Error States ────────────────────────────────────────────
function showLoading() {
  const grid = document.getElementById('articles-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="state-card" role="status" aria-busy="true">
        <div class="spinner"></div>
        <p>${state.lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>
      </div>`;
  }
}

function showEmpty() {
  const grid = document.getElementById('articles-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="state-card" role="status">
        <p style="font-size:2rem;margin-bottom:0.5rem;">📰</p>
        <p>${state.lang === 'ar' ? 'لا توجد مقالات متاحة حالياً. تعود غداً!' : 'No articles available yet. Check back tomorrow!'}</p>
      </div>`;
  }
}

function showError(msg) {
  const grid = document.getElementById('articles-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="state-card" role="alert">
        <p style="font-size:1.8rem;margin-bottom:0.5rem;">⚠️</p>
        <p style="color:#c0392b;">${escHtml(msg)}</p>
      </div>`;
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// Export globals needed by inline handlers
window.closeModal     = closeModal;
window.closeFlashCard = closeFlashCard;
window.playAudio      = playAudio;
window.openModal      = openModal;
