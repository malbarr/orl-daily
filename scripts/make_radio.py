#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bar Daily — audio bulletin generator.

Runs inside the daily GitHub Actions job, right after fetch_articles.py has
written data/<date>.json. Produces:

    radio/bar-daily-<date>-en.mp3    the episode
    radio/episodes.json              index consumed by radio/index.html
    radio/feed.xml                   podcast RSS (Apple / Spotify / Overcast)

ZERO LLM CALLS. Every spoken sentence is assembled from fields the Bar Daily
engine already wrote (summary_en, practice_change_en, study_design, stars,
subspecialty, confidence, journal_club), so the medical wording is the source's
own and costs nothing per episode.

Voices: en-US multilingual neural via edge-tts (free, no API key). Medical
terminology is pronounced in English — the reason this edition is English.

Safe to re-run: an existing episode for the date is left alone unless --force.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from email.utils import format_datetime

try:
    import edge_tts
except ImportError:  # pragma: no cover
    sys.exit("edge-tts is not installed: pip install edge-tts")

# ── paths ────────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
DATA_DIR = os.path.join(ROOT, "data")
RADIO_DIR = os.path.join(ROOT, "radio")

# ── public identity (used in the feed) ───────────────────────────────────────
SITE = "https://malbarr.github.io/orl-daily"
FEED_URL = SITE + "/radio/feed.xml"
RADIO_URL = SITE + "/radio"
TITLE = "Bar Daily"
SUBTITLE = "The morning audio bulletin from the daily ENT literature"
AUTHOR = "Dr. Mohammad Al-Bar"
DESCRIPTION = (
    "A short daily bulletin on new otolaryngology literature: the three "
    "highest-rated papers of the day, what they found, and whether they change "
    "practice. Episodes are generated automatically with synthetic voices from "
    "the Bar Daily literature review. Not medical advice."
)

# ── voice / pacing ───────────────────────────────────────────────────────────
VOICE = {
    "HOST": "en-US-AndrewMultilingualNeural",
    "ANALYST": "en-US-AvaMultilingualNeural",
}
RATE = "-4%"
CONCURRENCY = 6
TURN_GAP = 0.38      # seconds between speaker turns
SECTION_GAP = 1.0    # seconds before each new paper
LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"   # podcast loudness target

SUB = {
    "rhinology": "Rhinology", "laryngology": "Laryngology",
    "skull_base": "Skull base", "otology": "Otology",
    "head_neck": "Head and neck", "facial_plastics": "Facial plastics",
    "pediatric": "Paediatric ENT", "business": "Practice management",
    "general": "General ENT",
}
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


# ── script assembly (no LLM) ─────────────────────────────────────────────────
def clip(text, limit):
    """Trim to a spoken-length sentence without cutting mid-word."""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for mark in (". ", "; "):
        if mark in cut:
            return cut[: cut.rfind(mark) + 1]
    return cut.rsplit(" ", 1)[0] + "."


def spoken_date(iso):
    y, m, d = iso.split("-")
    return "%s %d, %s" % (MONTHS[int(m) - 1], int(d), y)


def pick_papers(articles, n=3):
    live = [a for a in articles if not a.get("reject")]
    live.sort(key=lambda a: -int(a.get("stars") or 0))
    return live[:n]


def build_script(date, papers):
    lines = [["HOST", "This is Bar Daily, the morning bulletin for %s. "
                      "Three papers worth your time." % spoken_date(date)]]
    for i, a in enumerate(papers, 1):
        stars = int(a.get("stars") or 0)
        sub = SUB.get(a.get("subspecialty"), a.get("subspecialty") or "General ENT")
        lines.append(["HOST", "Paper %d. %s. Rated %d out of five." % (i, sub, stars)])

        design = clip(a.get("study_design"), 140)
        if design:
            lines.append(["HOST", "Study design: %s." % design.rstrip(".")])

        lines.append(["ANALYST", clip(a.get("summary_en"), 520)])

        change = clip(a.get("practice_change_en"), 300)
        if change:
            lines.append(["HOST", "Does this change practice?"])
            lines.append(["ANALYST", change])

        conf = a.get("confidence")
        if conf == "\U0001F534":
            lines.append(["HOST", "Caution. Confidence is low. "
                                  "Do not change management on this paper alone."])
        elif conf == "\U0001F7E1":
            lines.append(["HOST", "Confidence is moderate."])

        if a.get("journal_club"):
            lines.append(["HOST", "This one is flagged for journal club."])

    lines.append(["HOST", "That is the bulletin. This episode is generated "
                          "automatically with synthetic voices from the Bar Daily "
                          "literature review. It is not medical advice. Sources "
                          "are in the description. See you tomorrow."])
    return lines


# ── synthesis ────────────────────────────────────────────────────────────────
async def _one(sem, text, voice, path):
    async with sem:
        last = None
        for _ in range(3):
            try:
                await edge_tts.Communicate(text, voice, rate=RATE).save(path)
                if os.path.getsize(path) > 1000:
                    return path
            except Exception as exc:          # transient socket / 403 churn
                last = exc
            await asyncio.sleep(1.5)
        raise RuntimeError("TTS failed for %r: %s" % (text[:50], last))


async def synth_all(lines, workdir):
    sem = asyncio.Semaphore(CONCURRENCY)
    jobs = []
    for i, (role, text) in enumerate(lines):
        jobs.append(_one(sem, text, VOICE[role], os.path.join(workdir, "s%03d.mp3" % i)))
    return await asyncio.gather(*jobs)


def _silence(path, seconds):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                    "anullsrc=r=24000:cl=mono", "-t", str(seconds),
                    "-c:a", "libmp3lame", "-b:a", "48k", path], check=True)
    return path


def stitch(parts, lines, workdir, out_mp3):
    short = _silence(os.path.join(workdir, "_short.mp3"), TURN_GAP)
    long_ = _silence(os.path.join(workdir, "_long.mp3"), SECTION_GAP)
    seq = []
    for i, (_role, text) in enumerate(lines):
        if i:
            seq.append(long_ if text.startswith("Paper ") else short)
        seq.append(parts[i])
    listing = os.path.join(workdir, "concat.txt")
    with open(listing, "w", encoding="utf-8") as fh:
        for p in seq:
            fh.write("file '%s'\n" % p.replace("\\", "/"))
    os.makedirs(os.path.dirname(out_mp3), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", listing, "-af", LOUDNORM,
                    "-c:a", "libmp3lame", "-b:a", "96k", out_mp3], check=True)
    return out_mp3


def duration_seconds(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    return float(out or 0)


# ── episode index + RSS ──────────────────────────────────────────────────────
def headline(a):
    t = re.sub(r"\s+", " ", str(a.get("title_en") or "").strip()).rstrip(".")
    return t[:150]


def update_index(date, mp3, papers, seconds):
    idx_path = os.path.join(RADIO_DIR, "episodes.json")
    episodes = []
    if os.path.exists(idx_path):
        try:
            episodes = json.load(open(idx_path, encoding="utf-8"))
        except Exception:
            episodes = []
    episodes = [e for e in episodes if e.get("date") != date]
    episodes.append({
        "date": date,
        "file": os.path.basename(mp3),
        "bytes": os.path.getsize(mp3),
        "seconds": round(seconds),
        "papers": [{
            "pmid": a.get("pmid"),
            "title": headline(a),
            "stars": int(a.get("stars") or 0),
            "subspecialty": SUB.get(a.get("subspecialty"),
                                    a.get("subspecialty") or "General ENT"),
            "journal": a.get("journal"),
            "url": a.get("pubmed_url"),
            "journal_club": bool(a.get("journal_club")),
            "confidence": a.get("confidence"),
        } for a in papers],
    })
    episodes.sort(key=lambda e: e["date"], reverse=True)
    json.dump(episodes, open(idx_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return episodes


def write_feed(episodes):
    """Minimal but valid iTunes-compatible RSS 2.0."""
    def esc(s):
        return html.escape(str(s or ""), quote=True)

    items = []
    for e in episodes[:120]:
        when = dt.datetime.strptime(e["date"], "%Y-%m-%d").replace(
            hour=6, tzinfo=dt.timezone.utc)
        bullets = "".join(
            "<li>%s %s — %s</li>" % ("&#9733;" * p["stars"], esc(p["subspecialty"]),
                                     esc(p["title"]))
            for p in e["papers"])
        notes = ("<![CDATA[<p>The three highest-rated ENT papers of %s.</p><ul>%s</ul>"
                 "<p>Generated automatically with synthetic voices from the "
                 "<a href=\"%s\">Bar Daily</a> literature review. Not medical advice.</p>]]>"
                 % (e["date"], bullets, SITE))
        items.append("""  <item>
    <title>%s — %s</title>
    <description>%s</description>
    <pubDate>%s</pubDate>
    <guid isPermaLink="false">bar-daily-%s</guid>
    <enclosure url="%s/radio/%s" length="%d" type="audio/mpeg"/>
    <itunes:duration>%d</itunes:duration>
    <itunes:image href="%s/radio/cover-1500.png"/>
    <itunes:episodeType>full</itunes:episodeType>
    <itunes:explicit>false</itunes:explicit>
  </item>""" % (esc(TITLE), e["date"], notes, format_datetime(when), e["date"],
                SITE, esc(e["file"]), e["bytes"], e["seconds"], SITE))

    feed = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>%s</title>
  <link>%s</link>
  <atom:link href="%s" rel="self" type="application/rss+xml"/>
  <language>en-us</language>
  <description>%s</description>
  <itunes:author>%s</itunes:author>
  <itunes:summary>%s</itunes:summary>
  <itunes:subtitle>%s</itunes:subtitle>
  <itunes:type>episodic</itunes:type>
  <itunes:explicit>false</itunes:explicit>
  <itunes:category text="Science"><itunes:category text="Medicine"/></itunes:category>
  <itunes:category text="Health &amp; Fitness"><itunes:category text="Medicine"/></itunes:category>
  <itunes:image href="%s/radio/cover-1500.png"/>
  <itunes:owner><itunes:name>%s</itunes:name></itunes:owner>
%s
</channel>
</rss>
""" % (esc(TITLE), RADIO_URL, FEED_URL, esc(DESCRIPTION), esc(AUTHOR),
       esc(DESCRIPTION), esc(SUBTITLE), SITE, esc(AUTHOR), "\n".join(items))
    open(os.path.join(RADIO_DIR, "feed.xml"), "w", encoding="utf-8").write(feed)


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--force", action="store_true",
                    help="regenerate even if the episode already exists")
    args = ap.parse_args()

    src = os.path.join(DATA_DIR, "%s.json" % args.date)
    if not os.path.exists(src):
        print("no data file for %s — nothing to narrate" % args.date)
        return 0

    os.makedirs(RADIO_DIR, exist_ok=True)
    out_mp3 = os.path.join(RADIO_DIR, "bar-daily-%s-en.mp3" % args.date)
    if os.path.exists(out_mp3) and not args.force:
        print("episode already exists: %s" % out_mp3)
        return 0

    data = json.load(open(src, encoding="utf-8"))
    papers = pick_papers(data.get("articles") or [])
    if not papers:
        print("no non-rejected articles for %s" % args.date)
        return 0

    lines = build_script(args.date, papers)
    print("script: %d segments, %d chars" % (len(lines), sum(len(t) for _, t in lines)))

    work = tempfile.mkdtemp(prefix="bardaily_")
    try:
        parts = asyncio.run(synth_all(lines, work))
        stitch(parts, lines, work, out_mp3)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    secs = duration_seconds(out_mp3)
    if secs < 30:
        sys.exit("render looks broken: %.1f s" % secs)
    print("episode: %s (%.2f MB, %.1f min)"
          % (out_mp3, os.path.getsize(out_mp3) / 1048576, secs / 60))

    episodes = update_index(args.date, out_mp3, papers, secs)
    write_feed(episodes)
    print("index + feed updated — %d episode(s)" % len(episodes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
