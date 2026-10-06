#!/usr/bin/env python3
"""Triage legacy documents under docs/ (2026-10-06).

Adapted from ktpv5-api-server docs/archive/triage-2026-10-06.py.

Re-runnable. Scans tracked files under docs/ (outside docs/archive/) AND under docs/archive/
(mapped back to their original docs/ path, so it still works after the move), classifies each
by script, prints a table and writes docs/archive/INDEX-2026-10-06.md.

Usage (from the repo root):
  python3 docs/archive/triage-2026-10-06.py           # classify + write index (dry run)
  python3 docs/archive/triage-2026-10-06.py --apply   # also `git mv` every non-keep file

Bucket rule (first match wins):
  1. keep               - referenced_by_code (path or dated basename appears in code, see CODE_PREFIXES)
  2. archive-superseded - superseded banner in the first 15 lines
  3. archive-stale      - code_refs >= 3 and alive/refs < 0.5, or migration_refs >= 1 and none alive
  4. archive-history    - everything else
"""
import os
import re
import subprocess
import sys

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
os.chdir(ROOT)

DOCS = "docs/"
ARCH = "docs/archive/"
INDEX = "docs/archive/INDEX-2026-10-06.md"
# files created by this triage itself; never classified
META = {"docs/superpowers/README.md", INDEX, "docs/archive/triage-2026-10-06.py"}
MIGRATIONS_DIR = "retail_pos_server/prisma/migrations"
# where a reference to a document counts as "referenced_by_code"
CODE_PREFIXES = ["retail_pos_server/src", "retail_pos_app/src", "scripts",
                 "retail_pos_server/scripts", "retail_pos_app/scripts", ".github",
                 "ecosystem.config.js", "package.json", "retail_pos_server/package.json",
                 "retail_pos_app/package.json"]

SUPERSEDED_RE = re.compile(r"supersed|latest is|replaced by|대체|최신은", re.I)
STATUS_RE = re.compile(r"status|상태", re.I)
# retail_pos_server/... retail_pos_app/... scripts/... .github/... (optionally ktpv5-pos-retail/-prefixed)
CODE_REF_RE = re.compile(
    r"(?<![\w/.\-])(?:ktpv5-pos-retail/)?((?:retail_pos_server|retail_pos_app|scripts|\.github)/[A-Za-z0-9_\-./\[\]@]+)")
MIG_RE = re.compile(r"\b(\d{14}_[A-Za-z0-9_]+)")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def git_files(*prefixes):
    out = subprocess.run(["git", "ls-files", "--", *prefixes], capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if l]


def untracked_in_docs():
    out = subprocess.run(["git", "status", "--porcelain", "--ignored", "--untracked-files=all", "--", DOCS],
                         capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if l[:2] in ("??", "!!") and l[3:] not in META]


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def clean_ref(r):
    r = r.split("*")[0].split("{")[0]
    r = re.sub(r":\d+.*$", "", r)
    return r.rstrip(".,;:)/`'\"]")


def kind_of(sub):
    parts = sub.split("/")
    if len(parts) == 1:
        return "loose"
    if parts[0] == "superpowers" and len(parts) > 2:
        return parts[1]
    return parts[0]


def main():
    apply = "--apply" in sys.argv
    entries = []
    for cur in git_files(DOCS):
        if cur in META:
            continue
        sub = cur[len(ARCH):] if cur.startswith(ARCH) else cur[len(DOCS):]
        entries.append({"cur": cur, "orig": DOCS + sub, "sub": sub})

    migrations = set(os.listdir(MIGRATIONS_DIR)) if os.path.isdir(MIGRATIONS_DIR) else set()
    code_text = {}
    for cf in git_files(*CODE_PREFIXES):
        t = read(cf)
        if t is not None:
            code_text[cf] = t.splitlines()
    doc_text = {e["cur"]: read(e["cur"]) for e in entries}

    rows, unclassified = [], []
    for e in entries:
        text = doc_text[e["cur"]]
        if text is None:
            unclassified.append(e["orig"])
            continue
        base = os.path.basename(e["orig"])
        m = re.search(r"(\d{4}-\d{2}-\d{2})", base)
        if m:
            date = m.group(1)
        else:
            m8 = re.search(r"(?<!\d)(20\d{6})(?!\d)", e["sub"])
            date = f"{m8.group(1)[:4]}-{m8.group(1)[4:6]}-{m8.group(1)[6:]}" if m8 else ""
        head = text.splitlines()[:15]
        superseded = any(SUPERSEDED_RE.search(l) for l in head)
        status_line = next((l.strip() for l in head if STATUS_RE.search(l)), "")
        refs = sorted({clean_ref(r) for r in CODE_REF_RE.findall(text)}
                      - {"", "scripts", ".github", "retail_pos_server", "retail_pos_app"})
        refs_alive = sum(1 for r in refs if os.path.exists(r))
        migs = sorted(set(MIG_RE.findall(text)))
        migs_alive = sum(1 for mg in migs if mg in migrations)
        # Basename alone only counts when it carries a date; undated names (README.md,
        # 7030.zpl, ...) must match by full path (docs/<sub>).
        needles = {e["orig"]}
        if DATE_RE.search(base):
            needles.add(base)
        code_hits = []
        for cf, lines in code_text.items():
            for i, l in enumerate(lines, 1):
                if any(n in l for n in needles):
                    code_hits.append(f"{cf}:{i}")
        doc_needle = e["orig"] if base.lower() == "readme.md" else base
        ref_docs = sum(1 for other, t in doc_text.items() if other != e["cur"] and t and doc_needle in t)
        if code_hits:
            bucket = "keep"
        elif superseded:
            bucket = "archive-superseded"
        elif (len(refs) >= 3 and refs_alive / len(refs) < 0.5) or (migs and migs_alive == 0):
            bucket = "archive-stale"
        else:
            bucket = "archive-history"
        new = e["orig"] if bucket == "keep" else ARCH + e["sub"]
        rows.append(dict(orig=e["orig"], cur=e["cur"], new=new, date=date, kind=kind_of(e["sub"]),
                         superseded=superseded, status=status_line, refs=len(refs),
                         refs_alive=refs_alive, migs=len(migs), migs_alive=migs_alive,
                         code_hits=code_hits, ref_docs=ref_docs, lines=text.count("\n"),
                         bucket=bucket))

    rows.sort(key=lambda r: r["orig"])
    order = ["keep", "archive-superseded", "archive-stale", "archive-history"]
    for r in rows:
        print("\t".join(str(x) for x in (r["bucket"], r["orig"], r["date"], r["kind"],
              f"{r['refs_alive']}/{r['refs']}", f"{r['migs_alive']}/{r['migs']}",
              r["ref_docs"], r["lines"], r["status"][:60])))
    counts = {b: sum(1 for r in rows if r["bucket"] == b) for b in order}
    untracked = untracked_in_docs()
    print("\nCounts:", counts, "unclassified:", len(unclassified), file=sys.stderr)
    print("Untracked/ignored under docs/ (left in place):", untracked or "none", file=sys.stderr)

    if apply:
        for r in rows:
            if r["cur"] != r["new"]:
                os.makedirs(os.path.dirname(r["new"]), exist_ok=True)
                subprocess.check_call(["git", "mv", r["cur"], r["new"]])

    def esc(s):
        return s.replace("|", "\\|")

    out = ["# docs/ triage — 2026-10-06", "",
           "Legacy documents under `docs/` (`superpowers/{plans,specs}`, `label-mockups/`, `linkly/`, "
           "`outdated/` and the loose files directly under `docs/`) were classified by script "
           "(`docs/archive/triage-2026-10-06.py`, re-runnable) without reading them in depth, "
           "and every file not pointed at by code was moved with `git mv` to "
           "`docs/archive/<original subpath>` (superpowers files under `docs/archive/superpowers/...`). "
           "Document contents were not edited, so relative links inside moved documents may be broken.", "",
           "Bucket rule (first match wins):", "",
           "1. **keep** — the file's path (`docs/<sub>`) or dated basename appears in "
           "`retail_pos_server/src`, `retail_pos_app/src`, `scripts/` (root and per-subproject), `.github/`, "
           "`ecosystem.config.js` or any `package.json` (stays in place). Undated basenames match only by full path.",
           "2. **archive-superseded** — a banner in the first 15 lines matches "
           "`supersed|latest is|replaced by|대체|최신은`.",
           "3. **archive-stale** — ≥3 code path references (`retail_pos_server/`, `retail_pos_app/`, `scripts/`, "
           "`.github/`) with fewer than half still existing, or ≥1 migration folder reference with none existing "
           "under `retail_pos_server/prisma/migrations`.",
           "4. **archive-history** — everything else.", "",
           "Columns: `refs` = code_refs_alive/code_refs; `docs` = number of other triaged documents mentioning "
           "the basename (README files: full path).", "",
           "Untracked/ignored files under `docs/` at triage time (left in place): "
           + (", ".join(f"`{u[3:]}`" for u in untracked) if untracked else "none") + ".", "",
           "| bucket | files |", "|---|---|"]
    for b in order:
        out.append(f"| {b} | {counts[b]} |")
    if unclassified:
        out += ["", "Unclassified (unreadable): " + ", ".join(unclassified)]
    out.append("")
    keep = [r for r in rows if r["bucket"] == "keep"]
    out += ["## keep", "", "| original path | date | kind | referenced from |", "|---|---|---|---|"]
    for r in keep:
        hits = r["code_hits"]
        more = f" (+{len(hits) - 5} more)" if len(hits) > 5 else ""
        out.append(f"| `{r['orig']}` | {r['date']} | {r['kind']} | "
                   f"{', '.join('`' + h + '`' for h in hits[:5])}{more} |")
    for b in order[1:]:
        out += ["", f"## {b}", "",
                "| original path | date | kind | status_line | refs | docs | new path |",
                "|---|---|---|---|---|---|---|"]
        for r in rows:
            if r["bucket"] != b:
                continue
            st = r["status"][:80] + ("…" if len(r["status"]) > 80 else "")
            out.append(f"| `{r['orig']}` | {r['date']} | {r['kind']} | {esc(st)} | "
                       f"{r['refs_alive']}/{r['refs']} | {r['ref_docs']} | `{r['new']}` |")
    with open(INDEX, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
