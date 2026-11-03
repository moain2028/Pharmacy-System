#!/usr/bin/env python3
"""Extract files from an agent JSON output, tolerating truncation (finish=length).
Usage: salvage.py <out.json> [--write] [--root DIR]
Prints each file path + size; with --write writes complete files (and partial last file marked)."""
import json, re, sys, os

def decode_json_string(s):
    # s is the content of a JSON string without the surrounding quotes, possibly truncated
    try:
        return json.loads('"' + s + '"')
    except Exception:
        # drop trailing incomplete escape
        for cut in range(1, 7):
            try:
                return json.loads('"' + s[:-cut] + '"')
            except Exception:
                pass
        return None

def salvage(raw):
    try:
        d = json.loads(raw)
        return [(f["path"], f["content"], True) for f in d["files"]], d.get("notes", "")
    except Exception:
        pass
    files = []
    # find each {"path":"...","content":"
    pat = re.compile(r'\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"')
    positions = [(m.start(), m.end(), m.group(1)) for m in pat.finditer(raw)]
    for i, (s, e, path) in enumerate(positions):
        # scan string content until unescaped quote
        j = e
        complete = False
        while j < len(raw):
            c = raw[j]
            if c == '\\':
                j += 2
                continue
            if c == '"':
                complete = True
                break
            j += 1
        body = raw[e:j]
        content = decode_json_string(body)
        if content is None:
            continue
        files.append((path, content, complete))
    return files, ""

if __name__ == "__main__":
    src = sys.argv[1]
    write = "--write" in sys.argv
    root = "."
    if "--root" in sys.argv:
        root = sys.argv[sys.argv.index("--root") + 1]
    raw = open(src, encoding="utf8").read()
    files, notes = salvage(raw)
    for path, content, complete in files:
        print(f"{'OK  ' if complete else 'PART'} {path} {len(content)} chars")
        if write:
            full = os.path.join(root, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf8") as fh:
                fh.write(content)
                if not complete:
                    fh.write("\n// <<TRUNCATED BY MODEL OUTPUT LIMIT — needs completion>>\n")
    if notes:
        print("NOTES:", notes[:2000])
