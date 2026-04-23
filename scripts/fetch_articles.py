#!/usr/bin/env python3
"""
ORL-Bar Daily — fetch_articles.py
Fetches ENT articles from PubMed, analyzes with OpenAI GPT, saves JSON data files,
updates the date index, prunes old files, and sends a Telegram notification.
Also fetches ENT industry/business news from Google News RSS and analyzes as business articles.
"""

import os
import sys
import json
import time
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from openai import OpenAI
import html as html_module

# ─── Configuration ─────────────────────────────────────────────────────────────
OPENAI_API_KEY      = os.environ.get("OPENAI_API_KEY", "")
TELEGRAM_BOT_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID    = os.environ.get("TELEGRAM_CHAT_ID", "1276595563")
EMAIL_FOR_UNPAYWALL = "orl-daily@gmail.com"
SITE_URL            = "https://malbarrr.github.io/orl-daily"
MAX_ARTICLES        = 20   # fetch more, then filter by quality
KEEP_DAYS           = 60
PRIORITY_SUBSPECIALTIES = {'rhinology', 'skull_base', 'laryngology'}
MIN_STARS_PRIORITY  = 3   # rhinology/skull_base/laryngology: keep ≥ 3 stars
MIN_STARS_GENERAL   = 4   # all others: keep ≥ 4 stars

PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_FETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
UNPAYWALL_URL     = "https://api.unpaywall.org/v2/{doi}?email=" + EMAIL_FOR_UNPAYWALL

# Business/Industry news RSS from Google News
BUSINESS_RSS = (
    "https://news.google.com/rss/search?"
    "q=ENT+otolaryngology+medical+device+Stryker+Medtronic+Karl+Storz"
    "&hl=en&gl=US&ceid=US:en"
)
MAX_BUSINESS_ARTICLES = 3

ENT_QUERY = (
    # Specific ENT MeSH anchors — highly precise
    "(otolaryngology[MeSH] OR \"otorhinolaryngologic diseases\"[MeSH] OR "
    "sinusitis[MeSH] OR \"nasal polyps\"[MeSH] OR \"cochlear implants\"[MeSH] OR "
    "tonsillectomy[MeSH] OR \"vocal cords\"[MeSH] OR larynx[MeSH] OR "
    "\"otitis media\"[MeSH] OR \"head and neck neoplasms\"[MeSH] OR "
    "\"sleep apnea, obstructive\"[MeSH] OR rhinoplasty[MeSH] OR "
    "\"skull base\"[MeSH] OR mastoidectomy[MeSH] OR stapedectomy[MeSH] OR "
    # Specific ENT procedural/anatomical terms safe to use as [tiab]
    "tympanoplasty[tiab] OR septoplasty[tiab] OR FESS[tiab] OR "
    "\"endoscopic sinus surgery\"[tiab] OR \"skull base surgery\"[tiab] OR "
    "rhinology[tiab] OR otology[tiab] OR laryngology[tiab] OR "
    "\"cochlear implant\"[tiab] OR \"stapedectomy\"[tiab] OR "
    "\"vocal fold\"[tiab] OR \"subglottic\"[tiab] OR \"supraglottic\"[tiab] OR "
    "\"nasal polyp\"[tiab] OR \"chronic rhinosinusitis\"[tiab] OR "
    "\"laryngeal cancer\"[tiab] OR \"hypopharynx\"[tiab] OR "
    "\"parotid\"[tiab] OR \"submandibular\"[tiab] OR "
    "\"vestibular schwannoma\"[tiab] OR \"acoustic neuroma\"[tiab] OR "
    "\"obstructive sleep apnea\"[tiab] OR \"uvulopalatopharyngoplasty\"[tiab])"
)

# Priority query: Rhinology + Skull Base + Laryngology — last 2 days, catch everything
PRIORITY_QUERY = (
    "(rhinology[tiab] OR \"nasal polyp\"[tiab] OR \"chronic rhinosinusitis\"[tiab] OR "
    "sinusitis[MeSH] OR \"nasal polyps\"[MeSH] OR septoplasty[tiab] OR "
    "\"endoscopic sinus surgery\"[tiab] OR FESS[tiab] OR \"turbinate\"[tiab] OR "
    "\"skull base\"[MeSH] OR \"skull base surgery\"[tiab] OR "
    "\"endoscopic skull base\"[tiab] OR \"anterior skull base\"[tiab] OR "
    "\"lateral skull base\"[tiab] OR \"pituitary surgery\"[tiab] OR "
    "laryngology[tiab] OR \"vocal fold\"[tiab] OR \"vocal cord\"[MeSH] OR "
    "larynx[MeSH] OR \"laryngeal cancer\"[tiab] OR \"subglottic\"[tiab] OR "
    "\"supraglottic\"[tiab] OR \"laryngoscopy\"[tiab] OR \"phonosurgery\"[tiab])"
)

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ─── PubMed helpers ─────────────────────────────────────────────────────────────

def _pubmed_search(query: str, reldate: int, retmax: int) -> list:
    try:
        r = requests.get(PUBMED_SEARCH_URL, params={
            "db": "pubmed", "term": query, "datetype": "pdat",
            "reldate": str(reldate), "retmax": str(retmax),
            "sort": "relevance", "retmode": "json",
        }, timeout=30)
        r.raise_for_status()
        return r.json().get("esearchresult", {}).get("idlist", [])
    except Exception as e:
        print(f"[PubMed] Search error: {e}")
        return []

def search_pubmed() -> list:
    """Search PubMed: priority subspecialties (2 days) + general ENT (1 day)."""
    priority_pmids = _pubmed_search(PRIORITY_QUERY, reldate=2, retmax=15)
    general_pmids  = _pubmed_search(ENT_QUERY,      reldate=1, retmax=MAX_ARTICLES)
    # Merge, deduplicate, priority first
    seen = set()
    pmids = []
    for p in priority_pmids + general_pmids:
        if p not in seen:
            seen.add(p)
            pmids.append(p)
    print(f"[PubMed] Priority: {len(priority_pmids)}, General: {len(general_pmids)}, Unique: {len(pmids)}")
    return pmids


def fetch_pubmed_xml(pmids: list) -> str:
    """Fetch full XML records for a list of PMIDs."""
    params = {
        "db":      "pubmed",
        "id":      ",".join(pmids),
        "retmode": "xml",
    }
    try:
        r = requests.get(PUBMED_FETCH_URL, params=params, timeout=60)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"[PubMed] Fetch error: {e}")
        return ""


def _text_node(el, path: str, default: str = "") -> str:
    """Helper: get text from XML path."""
    node = el.find(path)
    if node is None:
        return default
    return (node.text or "").strip()


def _iter_text(el) -> str:
    """Get all text recursively from element."""
    return "".join(el.itertext()).strip() if el is not None else ""


def parse_pubmed_xml(xml_text: str) -> list:
    """Parse PubMed XML response, return list of article dicts."""
    if not xml_text:
        return []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"[XML] Parse error: {e}")
        return []

    articles = []
    for pub_article in root.findall(".//PubmedArticle"):
        try:
            medline = pub_article.find(".//MedlineCitation")
            art     = medline.find("Article") if medline is not None else None
            if art is None:
                continue

            # PMID
            pmid = _text_node(medline, "PMID")

            # Title (may contain markup, use itertext)
            title_el = art.find("ArticleTitle")
            title = _iter_text(title_el)

            # Abstract (multi-section)
            abstract_parts = []
            for ab in art.findall(".//AbstractText"):
                label = ab.get("Label", "")
                text  = _iter_text(ab)
                if label:
                    abstract_parts.append(f"{label}: {text}")
                elif text:
                    abstract_parts.append(text)
            abstract = " ".join(abstract_parts)

            # Journal
            journal = _text_node(art, "Journal/Title")

            # Publication date
            pub_date_el = art.find(".//PubDate")
            if pub_date_el is not None:
                year  = _text_node(pub_date_el, "Year",  "")
                month = _text_node(pub_date_el, "Month", "")
                day   = _text_node(pub_date_el, "Day",   "")
                pub_date = "-".join(p for p in [year, month, day] if p)
            else:
                pub_date = TODAY

            # DOI — try ELocationID first, then ArticleId
            doi = ""
            for id_el in art.findall(".//ELocationID"):
                if id_el.get("EIdType") == "doi":
                    doi = (id_el.text or "").strip()
                    break
            if not doi:
                for id_el in pub_article.findall(".//ArticleId"):
                    if id_el.get("IdType") == "doi":
                        doi = (id_el.text or "").strip()
                        break

            if pmid:
                articles.append({
                    "pmid":     pmid,
                    "title":    title,
                    "abstract": abstract,
                    "journal":  journal,
                    "pub_date": pub_date,
                    "doi":      doi,
                })
        except Exception as e:
            print(f"[XML] Error parsing article: {e}")
            continue

    print(f"[XML] Parsed {len(articles)} articles")
    return articles


# ─── Unpaywall ──────────────────────────────────────────────────────────────────

def get_pdf_url(doi: str):
    """Check Unpaywall for a free PDF URL. Returns URL string or None."""
    if not doi:
        return None
    try:
        r = requests.get(UNPAYWALL_URL.format(doi=doi), timeout=15)
        if r.status_code == 200:
            data = r.json()
            best = data.get("best_oa_location") or {}
            return best.get("url_for_pdf") or best.get("url") or None
        elif r.status_code == 404:
            return None
        else:
            print(f"[Unpaywall] Status {r.status_code} for {doi}")
    except Exception as e:
        print(f"[Unpaywall] Error for {doi}: {e}")
    return None


# ─── Claude Analysis ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a medical editor for ORL Daily, a free ENT literature review initiative. "
    "You analyze ENT articles and return structured JSON for clinicians. "
    "Return ONLY valid JSON — no markdown fences, no explanation, no preamble."
)

ANALYSIS_PROMPT = """Analyze this ENT article and return ONLY a valid JSON object (no markdown fences).

Title: {title}
Journal: {journal}
Abstract: {abstract}

QUALITY SCORING RULES — apply these to determine stars, confidence, and reject:

Study Design (base score):
- RCT or Meta-analysis/Systematic Review: strong base (+2)
- Prospective cohort/controlled study: good base (+1)
- Retrospective series n>100: acceptable
- Case series <20 patients: weak (-1)
- Case report: REJECT unless extremely rare condition/technique
- Expert opinion/Editorial: REJECT unless paradigm-shifting

Journal Tier:
- JAMA, NEJM, Lancet, Nature Medicine, JAMA Otolaryngol, Laryngoscope, Otolaryngol Head Neck Surg, Head & Neck: +1
- Unknown or predatory journal: -1 or REJECT

Clinical Impact (primary factor for stars):
- Practice-changing (changes how you operate/manage today) → confidence 🟢, high stars
- Adds useful knowledge (good to know, does not change practice yet) → confidence 🟡
- Confirms already known (no new clinical information) → confidence 🔴, consider reject

Novelty:
- New technique, new tool, new drug application, unexpected finding: +1
- Confirms prior knowledge without adding value: -1

IMMEDIATE REJECTION (set reject=true, stars=1):
- ENT is mentioned only incidentally; primary topic is another specialty
- Abstract only with no results or conclusions
- Animal or in vitro study (non-human)
- n < 10 patients
- Published before 2020 UNLESS landmark/classic study
- No clinical relevance to practicing ENT surgeons

PRIORITY SUBSPECIALTY EXCEPTIONS (rhinology, skull_base, laryngology) — do NOT reject:
- Case series ≥10 patients featuring a genuinely new technique
- Retrospective study with n > 100

JSON fields required:
- title_ar: KEEP THE ORIGINAL ENGLISH TITLE — do NOT translate the title into Arabic. title_ar must be identical to title_en.
- title_en: original English title
- study_design: brief descriptor e.g. "RCT n=120", "Prospective cohort", "Retrospective case series n=45", "Meta-analysis 12 studies", "Case report", "Expert opinion"
- summary_ar: 5-7 sentence Arabic summary. CRITICAL RULE: ALL medical, anatomical, procedural, statistical, and pharmacological terms MUST remain in English — write them with Latin characters, never transliterate or translate them into Arabic letters. Examples that must stay exactly in English: "meta-analysis", "systematic review", "corticosteroid", "upper airway", "asthma", "rhinitis", "sinusitis", "FESS", "cochlear implant", "tympanoplasty", "CPAP", "endoscope", "RCT", "odds ratio", "hazard ratio", "p-value", "confidence interval", "dupilumab", "biologic", "IgE", "eosinophil", "polyp", "adenoid", "tonsil", "laryngoscopy", "septoplasty", "turbinate", "adenoidectomy", "tonsillectomy", "stapedectomy", "mastoidectomy". Only translate connecting words, prepositions, verbs, and non-medical explanations into Arabic.
- summary_en: 5-7 line English summary
- practice_change_ar: one sentence - what changes in clinical practice today
- practice_change_en: same in English
- future_impact_ar: one sentence - future implications
- future_impact_en: same in English
- why_important_ar: one sentence - why this article matters
- why_important_en: same in English
- vs_previous_ar: one sentence - how it differs from previous guidelines/knowledge
- vs_previous_en: same in English
- stars: integer 1-5 (apply scoring rules above)
- stars_reason_ar: brief Arabic reason including study design and why this score
- stars_reason_en: same in English
- confidence: one of "\U0001f7e2" (practice-changing) or "\U0001f7e1" (worth knowing) or "\U0001f534" (weak evidence)
- reject: boolean — true if meets any IMMEDIATE REJECTION CRITERIA
- reject_reason: brief English reason if reject is true, else null
- journal_club: boolean
- jc_reason_ar: reason if journal_club is true, else null
- jc_reason_en: same in English, or null
- watch: boolean (true if article features a noteworthy drug, device, instrument, or technology worth tracking — including drugs from other specialties tried in ENT, new surgical instruments, AI tools, imaging advances, or emerging tech)
- watch_detail_ar: one sentence describing what to watch and why, or null if watch is false
- watch_detail_en: same in English, or null
- watch_type: one of "drug" | "device" | "technology" | "instrument" | null
- research_gap_ar: one sentence research gap identified, or null
- research_gap_en: same in English, or null
- subspecialty: one of: rhinology, skull_base, laryngology, otology, head_neck, pediatric, sleep, general
- audio_script_ar: 2-3 minute Arabic audio script covering all analysis points
- audio_script_en: 2-3 minute English audio script covering all analysis points
- mcq: array of exactly 3 objects, each with: q_ar, q_en, options_ar (array of 4 strings with \u0623) \u0628) \u062c) \u062f) prefix), options_en (array of 4 strings with A) B) C) D) prefix), answer (0-3 index of correct), explanation_ar, explanation_en
"""


BUSINESS_SYSTEM_PROMPT = (
    "You are a business editor for ORL-Bar Daily, an ENT industry news digest. "
    "You analyze ENT industry news (acquisitions, lawsuits, stock moves, FDA decisions) "
    "and return structured JSON for ENT surgeons. "
    "Return ONLY valid JSON — no markdown fences, no explanation, no preamble."
)

BUSINESS_ANALYSIS_PROMPT = """Analyze this ENT industry/business news item and return ONLY a valid JSON object (no markdown fences).

Title: {title}
Description: {description}

JSON fields required:
- title_en: cleaned English headline
- title_ar: Arabic translation of headline
- summary_en: 3-5 sentences — what happened (acquisition, lawsuit, stock move, FDA decision, etc.)
- summary_ar: same in Arabic
- practice_change_en: one sentence — why this matters to practicing ENT surgeons
- practice_change_ar: same in Arabic
- why_important_en: one sentence — clinical/practice impact
- why_important_ar: same in Arabic
- future_impact_en: one sentence — what this means for ENT going forward
- future_impact_ar: same in Arabic
- stars: integer 1-5 (importance to ENT surgeons)
- stars_reason_ar: brief reason for star rating
- journal_club: false
- jc_reason_ar: null
- watch: false
- watch_detail_ar: null
- watch_type: null
- research_gap_ar: null
- subspecialty: "business"
- audio_script_ar: 1-2 minute Arabic audio script about the news
- mcq: []
"""


# ─── Business / Industry news ────────────────────────────────────────────────────

def fetch_business_news() -> list:
    """Fetch ENT industry news from Google News RSS. Returns list of {title, description} dicts."""
    try:
        r = requests.get(BUSINESS_RSS, timeout=30, headers={"User-Agent": "ORL-Bar-Daily/1.0"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        items = root.findall(".//item")
        results = []
        for item in items[:MAX_BUSINESS_ARTICLES]:
            title_el = item.find("title")
            desc_el  = item.find("description")
            title = html_module.unescape((title_el.text or "").strip()) if title_el is not None else ""
            desc  = html_module.unescape((desc_el.text  or "").strip()) if desc_el  is not None else ""
            if title:
                results.append({"title": title, "description": desc})
        print(f"[Business RSS] Fetched {len(results)} news items.")
        return results
    except Exception as e:
        print(f"[Business RSS] Error: {e}")
        return []


def _strip_fences(raw: str) -> str:
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return raw.strip()


def analyze_business_with_openai(item: dict, client: OpenAI) -> dict:
    """Analyze a business news item with OpenAI. Returns parsed JSON dict."""
    prompt = BUSINESS_ANALYSIS_PROMPT.format(
        title       = item["title"],
        description = item.get("description", "(no description)"),
    )
    response = client.chat.completions.create(
        model      = "gpt-4o-mini",
        max_tokens = 2048,
        messages   = [
            {"role": "system", "content": BUSINESS_SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
    )
    raw = _strip_fences(response.choices[0].message.content.strip())
    return json.loads(raw)


def analyze_with_openai(article: dict, client: OpenAI) -> dict:
    """Send article to OpenAI for analysis. Returns parsed JSON dict."""
    prompt = ANALYSIS_PROMPT.format(
        title    = article["title"],
        journal  = article["journal"],
        abstract = article["abstract"] or "(no abstract available)",
    )
    response = client.chat.completions.create(
        model      = "gpt-4o-mini",
        max_tokens = 4096,
        messages   = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
    )
    raw = _strip_fences(response.choices[0].message.content.strip())
    return json.loads(raw)


# ─── Data management ────────────────────────────────────────────────────────────

def load_index() -> list:
    """Load list of available dates from index.json."""
    index_file = DATA_DIR / "index.json"
    if index_file.exists():
        try:
            data = json.loads(index_file.read_text(encoding="utf-8"))
            return data.get("dates", [])
        except Exception as e:
            print(f"[Index] Error reading index: {e}")
    return []


def save_index(dates: list) -> None:
    """Save sorted list of dates to index.json."""
    index_file = DATA_DIR / "index.json"
    unique_sorted = sorted(set(dates), reverse=True)
    index_file.write_text(
        json.dumps({"dates": unique_sorted}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[Index] Saved {len(unique_sorted)} dates.")


def prune_old_files(dates: list) -> list:
    """Remove data files older than KEEP_DAYS days. Returns updated dates list."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    kept = []
    for d in dates:
        if d >= cutoff:
            kept.append(d)
        else:
            f = DATA_DIR / f"{d}.json"
            if f.exists():
                f.unlink()
                print(f"[Prune] Deleted {f.name}")
    return kept


# ─── Telegram notification ──────────────────────────────────────────────────────

def send_telegram(date_str: str, articles: list) -> None:
    """Send summary notification via Telegram Bot API."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[Telegram] Credentials not configured — skipping.")
        return

    n = len(articles)
    top3 = sorted(articles, key=lambda a: a.get("stars", 0), reverse=True)[:3]
    jc_count = sum(1 for a in articles if a.get("journal_club"))
    dw_any   = any(a.get("drug_watch") for a in articles)

    lines = [
        f"\U0001f4f0 <b>ORL-Bar Daily \u2014 {date_str}</b>",
        "\u2501" * 14,
        f"{n} \u0645\u0642\u0627\u0644\u0627\u062a \u062c\u062f\u064a\u062f\u0629",
        "",
        "\u2b50 \u0623\u0628\u0631\u0632 \u0627\u0644\u0645\u0642\u0627\u0644\u0627\u062a:",
    ]

    for i, a in enumerate(top3, 1):
        title  = a.get("title_ar") or a.get("title_en", "")
        stars  = a.get("stars", 0)
        jc_tag = " \U0001f3af" if a.get("journal_club") else ""
        lines.append(f"{i}. {title} ({stars}\u2b50){jc_tag}")

    lines += [
        "",
        "\U0001f48a Drug Watch: " + ("\u0646\u0639\u0645" if dw_any else "\u0644\u0627"),
        f"\U0001f3af Journal Club: {jc_count} \u0645\u0642\u0627\u0644\u0627\u062a",
        "",
        f"\U0001f517 {SITE_URL}",
    ]

    text = "\n".join(lines)
    url  = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        r = requests.post(url, json={
            "chat_id":    TELEGRAM_CHAT_ID,
            "text":       text,
            "parse_mode": "HTML",
        }, timeout=15)
        if r.status_code == 200:
            print("[Telegram] Notification sent successfully.")
        else:
            print(f"[Telegram] Error {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"[Telegram] Request failed: {e}")


# ─── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    if not OPENAI_API_KEY:
        print("[Error] OPENAI_API_KEY not set.")
        sys.exit(1)

    print(f"=== ORL-Bar Daily fetch for {TODAY} ===")

    client = OpenAI(api_key=OPENAI_API_KEY)

    # 1. Search PubMed
    print("[Step 1] Searching PubMed…")
    pmids = search_pubmed()
    if not pmids:
        print("[Main] No articles found today. Exiting.")
        sys.exit(0)

    # 2. Fetch article metadata
    print(f"[Step 2] Fetching {len(pmids)} articles from PubMed…")
    xml_text = fetch_pubmed_xml(pmids)
    if not xml_text:
        print("[Main] Failed to fetch article XML. Exiting.")
        sys.exit(1)

    raw_articles = parse_pubmed_xml(xml_text)
    if not raw_articles:
        print("[Main] No articles parsed from XML. Exiting.")
        sys.exit(0)

    # 3. Analyze each article with Claude
    print(f"[Step 3] Analyzing {len(raw_articles)} articles with Claude…")
    analyzed = []

    for i, raw in enumerate(raw_articles):
        pmid  = raw.get("pmid", "?")
        title = raw.get("title", "")[:70]
        print(f"  [{i+1}/{len(raw_articles)}] PMID {pmid}: {title}…")

        # Unpaywall PDF lookup
        pdf_url = get_pdf_url(raw.get("doi", ""))
        if pdf_url:
            print(f"    PDF found: {pdf_url[:80]}")
        time.sleep(0.5)  # polite delay for Unpaywall

        # OpenAI analysis
        try:
            analysis = analyze_with_openai(raw, client)
        except json.JSONDecodeError as e:
            print(f"    [!] OpenAI returned invalid JSON: {e} — skipping PMID {pmid}")
            continue
        except Exception as e:
            print(f"    [!] OpenAI error for PMID {pmid}: {e} — skipping")
            continue

        # Build the final record
        record = {
            "pmid":                 pmid,
            "title_ar":             analysis.get("title_ar", raw["title"]),
            "title_en":             analysis.get("title_en", raw["title"]),
            "journal":              raw["journal"],
            "pub_date":             raw["pub_date"],
            "doi":                  raw.get("doi", ""),
            "pubmed_url":           f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            "pdf_url":              pdf_url,
            "study_design":         analysis.get("study_design", ""),
            "summary_ar":           analysis.get("summary_ar", ""),
            "summary_en":           analysis.get("summary_en", ""),
            "practice_change_ar":   analysis.get("practice_change_ar", ""),
            "practice_change_en":   analysis.get("practice_change_en", ""),
            "future_impact_ar":     analysis.get("future_impact_ar", ""),
            "future_impact_en":     analysis.get("future_impact_en", ""),
            "why_important_ar":     analysis.get("why_important_ar", ""),
            "why_important_en":     analysis.get("why_important_en", ""),
            "vs_previous_ar":       analysis.get("vs_previous_ar", ""),
            "vs_previous_en":       analysis.get("vs_previous_en", ""),
            "stars":                int(analysis.get("stars", 3)),
            "stars_reason_ar":      analysis.get("stars_reason_ar", ""),
            "stars_reason_en":      analysis.get("stars_reason_en", ""),
            "confidence":     analysis.get("confidence", "\U0001f7e1"),
            "reject":         bool(analysis.get("reject", False)),
            "reject_reason":  analysis.get("reject_reason", None),
            "journal_club":   bool(analysis.get("journal_club", False)),
            "jc_reason_ar":   analysis.get("jc_reason_ar", None),
            "jc_reason_en":   analysis.get("jc_reason_en", None),
            "watch":          bool(analysis.get("watch", False)),
            "watch_detail_ar":analysis.get("watch_detail_ar", None),
            "watch_detail_en":analysis.get("watch_detail_en", None),
            "watch_type":     analysis.get("watch_type", None),
            "research_gap_ar":analysis.get("research_gap_ar", None),
            "research_gap_en":analysis.get("research_gap_en", None),
            "subspecialty":         analysis.get("subspecialty", "general"),
            "audio_script_ar":      analysis.get("audio_script_ar", ""),
            "audio_script_en":      analysis.get("audio_script_en", ""),
            "mcq":                  analysis.get("mcq", []),
        }
        analyzed.append(record)

        # Rate limit between Claude calls
        time.sleep(1.5)

    if not analyzed:
        print("[Main] No articles successfully analyzed. Exiting.")
        sys.exit(0)

    # Quality filter
    before = len(analyzed)
    filtered = []
    for a in analyzed:
        if a.get("reject"):
            print(f"  [filter] REJECTED {a.get('pmid')} — {a.get('reject_reason', '?')}")
            continue
        sub   = a.get("subspecialty", "general")
        stars = int(a.get("stars", 0))
        min_s = MIN_STARS_PRIORITY if sub in PRIORITY_SUBSPECIALTIES else MIN_STARS_GENERAL
        if stars >= min_s:
            filtered.append(a)
        else:
            print(f"  [filter] Dropped {a.get('pmid')} ({sub}, {stars}⭐) — below threshold")
    analyzed = filtered
    print(f"[Main] After quality filter: {len(analyzed)}/{before} articles kept.")

    # 3b. Fetch and analyze business/industry news
    print("[Step 3b] Fetching ENT industry/business news…")
    business_items = fetch_business_news()
    biz_counter = 1
    for item in business_items:
        title_short = item.get("title", "")[:70]
        print(f"  [BIZ{biz_counter}] {title_short}…")
        try:
            biz_analysis = analyze_business_with_openai(item, client)
        except json.JSONDecodeError as e:
            print(f"    [!] OpenAI returned invalid JSON for business item: {e} — skipping")
            biz_counter += 1
            continue
        except Exception as e:
            print(f"    [!] OpenAI error for business item: {e} — skipping")
            biz_counter += 1
            continue

        biz_record = {
            "pmid":                 f"BIZ{TODAY.replace('-','')}{biz_counter:02d}",
            "title_ar":             biz_analysis.get("title_ar", item["title"]),
            "title_en":             biz_analysis.get("title_en", item["title"]),
            "journal":              "ENT Industry News",
            "pub_date":             TODAY,
            "doi":                  "",
            "pubmed_url":           "",
            "pdf_url":              None,
            "summary_ar":           biz_analysis.get("summary_ar", ""),
            "summary_en":           biz_analysis.get("summary_en", ""),
            "practice_change_ar":   biz_analysis.get("practice_change_ar", ""),
            "practice_change_en":   biz_analysis.get("practice_change_en", ""),
            "future_impact_ar":     biz_analysis.get("future_impact_ar", ""),
            "future_impact_en":     biz_analysis.get("future_impact_en", ""),
            "why_important_ar":     biz_analysis.get("why_important_ar", ""),
            "why_important_en":     biz_analysis.get("why_important_en", ""),
            "vs_previous_ar":       "",
            "vs_previous_en":       "",
            "stars":                int(biz_analysis.get("stars", 3)),
            "stars_reason_ar":      biz_analysis.get("stars_reason_ar", ""),
            "journal_club":   False,
            "jc_reason_ar":   None,
            "watch":          False,
            "watch_detail_ar":None,
            "watch_type":     None,
            "research_gap_ar":None,
            "subspecialty":   "business",
            "audio_script_ar":      biz_analysis.get("audio_script_ar", ""),
            "mcq":                  [],
        }
        analyzed.append(biz_record)
        biz_counter += 1
        time.sleep(1.5)

    print(f"[Main] Total articles (PubMed + Business): {len(analyzed)}")

    # 4a. Cap Journal Club at 3 articles (keep highest-starred)
    jc_articles = sorted(
        [a for a in analyzed if a.get("journal_club")],
        key=lambda a: int(a.get("stars", 0)), reverse=True
    )
    if len(jc_articles) > 3:
        demoted = jc_articles[3:]
        demoted_pmids = {a["pmid"] for a in demoted}
        for a in analyzed:
            if a["pmid"] in demoted_pmids:
                a["journal_club"] = False
                a["jc_reason_ar"] = None
        print(f"[Main] Journal Club capped at 3 — demoted {len(demoted)} article(s).")

    # 4. Save daily data file
    print(f"[Step 4] Saving data/{TODAY}.json…")
    output = {
        "date":         TODAY,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "articles":     analyzed,
    }
    out_file = DATA_DIR / f"{TODAY}.json"
    out_file.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Main] Saved: {out_file}")

    # 5. Update index.json
    print("[Step 5] Updating data/index.json…")
    dates = load_index()
    dates.append(TODAY)
    dates = prune_old_files(dates)
    save_index(dates)

    # 6. Send Telegram notification
    print("[Step 6] Sending Telegram notification…")
    send_telegram(TODAY, analyzed)

    print(f"\n=== Done: {len(analyzed)} articles for {TODAY} ===")


if __name__ == "__main__":
    main()
