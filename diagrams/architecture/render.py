#!/usr/bin/env python3
"""Render the architecture diagram with matching SVG and PNG exports."""

from pathlib import Path
import re
import struct
import subprocess


directory = Path(__file__).resolve().parent
source = directory / "architecture.mmd"
styles = directory / "architecture.css"
svg = directory / "architecture.svg"
png = directory / "architecture.png"

for output, scale in ((svg, "1"), (png, "2")):
    subprocess.run(
        ["mmdc", "-i", str(source), "-o", str(output), "-b", "#FFFFFF", "-s", scale, "-C", str(styles)],
        check=True,
    )

width, height = struct.unpack(">II", png.read_bytes()[16:24])
source_text = source.read_text()
title_offset = re.search(r"\.cluster-label foreignObject \{ transform: translateX\((-?\d+)px\)", source_text)
if title_offset is None:
    raise RuntimeError("Backend title offset not found in Mermaid source")

svg_text = svg.read_text()
replacements = (
    (r'<svg id="my-svg" width="100%"', f'<svg id="my-svg" width="{width}" height="{height}"'),
    (r"max-width: [0-9.]+px;", f"max-width: {width}px;"),
    (r'(<g class="cluster-label"[^>]*><foreignObject)(\s)', rf'\1 style="transform:translateX({title_offset.group(1)}px)"\2'),
)
for pattern, replacement in replacements:
    svg_text, count = re.subn(pattern, replacement, svg_text, count=1)
    if count != 1:
        raise RuntimeError(f"Expected one SVG match for {pattern!r}, found {count}")
svg.write_text(svg_text)
print(f"Rendered {svg.name} and {png.name} at {width}×{height}")
