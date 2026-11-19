"""Generate the Panel's immutable sing-box catalog from the Agent's pinned SagerNet trees."""

import json
import re
import urllib.request
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / "internal/proxy/geo"
REVISIONS = {
    "geosite": "d5d86605baca4b3941a4a4b3403aca36df2f4adf",
    "geoip": "66c864fcfe1535549e0658569cb514dbd35756ba",
}


def snapshot(kind, tree):
    revision = REVISIONS[kind]
    if tree["sha"] != revision or tree["truncated"]:
        raise ValueError(f"Incomplete or mismatched {kind} tree")
    prefix = kind + "-"
    codes = sorted(
        item["path"][len(prefix):-4]
        for item in tree["tree"]
        if item["type"] == "blob" and item["path"].startswith(prefix)
        and item["path"].endswith(".srs")
    )
    pattern = r"[a-z0-9_@!-]{1,64}" if kind == "geosite" else r"[a-z0-9_-]{2,32}"
    if not 0 < len(codes) <= 8192 or not all(re.fullmatch(pattern, code) for code in codes):
        raise ValueError(f"Unexpected {kind} catalog")
    return "\n".join([revision, *codes, ""])


if __name__ == "__main__":
    for kind, revision in REVISIONS.items():
        url = f"https://api.github.com/repos/SagerNet/sing-{kind}/git/trees/{revision}"
        with urllib.request.urlopen(url, timeout=30) as response:
            data = snapshot(kind, json.load(response))
        (DEST / f"{kind}.txt").write_text(data, encoding="utf-8")
