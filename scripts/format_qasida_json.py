"""Rewrite qasida JSON files into the house style described in qasida.schema.json.

The output is derived from the parsed data only, so any input layout yields the
same file. Verse and translation arrays get a blank line wherever a run of
indices in an order group starts or ends, and order entries are kept on one line.
"""

import argparse
import io
import json
import sys
from pathlib import Path

INDENT = "    "
GROUPED_ARRAYS = {("verses", "ara"), ("verses", "en"), ("translation", "en")}


def group_boundaries(data):
    """Indices that should have a blank line before them."""
    boundaries = set()
    order = data.get("order")
    if not isinstance(order, dict):
        return boundaries
    for groups in order.values():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, list):
                continue
            indices = sorted(
                {e["index"] for e in group if isinstance(e, dict) and isinstance(e.get("index"), int)}
            )
            for pos, index in enumerate(indices):
                if pos == 0 or indices[pos - 1] != index - 1:
                    boundaries.add(index)
                if pos == len(indices) - 1 or indices[pos + 1] != index + 1:
                    boundaries.add(index + 1)
    boundaries.discard(0)
    return boundaries


def scalar(value):
    return json.dumps(value, ensure_ascii=False)


def inline(value):
    if isinstance(value, dict):
        if not value:
            return "{}"
        return "{ " + ", ".join(f"{scalar(k)}: {inline(v)}" for k, v in value.items()) + " }"
    if isinstance(value, list):
        if not value:
            return "[]"
        return "[ " + ", ".join(inline(v) for v in value) + " ]"
    return scalar(value)


def render(value, path, depth, boundaries):
    pad = INDENT * (depth + 1)
    close = INDENT * depth
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [f"{pad}{scalar(k)}: {render(v, path + (k,), depth + 1, boundaries)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + "\n" + close + "}"
    if isinstance(value, list):
        if not value:
            return "[]"
        in_order = len(path) >= 2 and path[0] == "order"
        lines = []
        for i, item in enumerate(value):
            if in_order and len(path) == 3:
                text = inline(item)
            else:
                text = render(item, path + (i,), depth + 1, boundaries)
            if path in GROUPED_ARRAYS and i in boundaries:
                lines.append("")
            lines.append(pad + text)
        body = "\n".join(line + "," if line else line for line in lines[:-1])
        return "[\n" + body + ("\n" if body else "") + lines[-1] + "\n" + close + "]"
    return scalar(value)


def format_text(text):
    data = json.loads(text)
    return render(data, (), 0, group_boundaries(data)) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Rewrite qasida JSON files into the house style.")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--check", action="store_true", help="report files that would change without writing")
    args = parser.parse_args(argv)
    # Filenames carry diacritics that a Windows console code page cannot encode.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(errors="backslashreplace")

    status = 0
    for path in args.files:
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
        try:
            formatted = format_text(text)
        except json.JSONDecodeError as exc:
            print(f"{path}: invalid JSON: {exc}", file=sys.stderr)
            status = 1
            continue
        # Keep the checkout's line endings; .gitattributes normalises to LF in the repo.
        if b"\r\n" in raw:
            formatted = formatted.replace("\n", "\r\n")
        if formatted.encode("utf-8") == raw:
            continue
        status = 1
        if args.check:
            print(f"would reformat {path}")
        else:
            path.write_bytes(formatted.encode("utf-8"))
            print(f"reformatted {path}")
    return status


if __name__ == "__main__":
    sys.exit(main())
