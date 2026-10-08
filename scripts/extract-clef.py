"""Extract Bravura's unmodified gClef outline into a portable SVG image.

Requires fontTools. Run from the project root after installing fontTools:
    python scripts/extract-clef.py

The glyph is copied from Steinberg's official Bravura 1.482 OTF, not drawn
or approximated here. The only transform converts font coordinates (y up)
to SVG coordinates (y down) and moves the bounds to (0, 0).
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Optional local extraction dependency; not used by the browser application.
TOOLS = ROOT / "vendor/bravura-tools"
if TOOLS.is_dir():
    sys.path.insert(0, str(TOOLS))

from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

COMMIT = "37b194378b710cc40e406ab6c4b07608bb9548ae"
SOURCE = f"https://raw.githubusercontent.com/steinbergmedia/bravura/{COMMIT}/redist/otf/Bravura.otf"
FONT_FILE = ROOT / "vendor/bravura-source.otf"
LICENSE_FILE = ROOT / "vendor/bravura-LICENSE.txt"
font = TTFont(FONT_FILE)
glyphs = font.getGlyphSet()
glyph_name = font.getBestCmap()[0xE050]
bounds_pen = BoundsPen(glyphs)
glyphs[glyph_name].draw(bounds_pen)
x_min, y_min, x_max, y_max = bounds_pen.bounds
width, height = x_max - x_min, y_max - y_min
path_pen = SVGPathPen(glyphs)
glyphs[glyph_name].draw(TransformPen(path_pen, (1, 0, 0, -1, -x_min, y_max)))
path = path_pen.getCommands()
license_text = LICENSE_FILE.read_text(encoding="utf-8-sig").strip()
version = next(record.toUnicode() for record in font["name"].names if record.nameID == 5)
staff_space = font["head"].unitsPerEm / 4
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
    f'viewBox="0 0 {width} {height}" role="img" aria-label="Treble clef">'
    f'<path fill="#263c47" d="{path}"/></svg>'
)
data_uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
asset = {
    "svg": svg,
    "dataUri": data_uri,
    "width": width,
    "height": height,
    "originX": -x_min,
    "originY": y_max,
    "staffSpace": staff_space,
    "bounds": list(bounds_pen.bounds),
    "glyph": "gClef",
    "codepoint": "U+E050",
    "fontVersion": version,
    "sourceCommit": COMMIT,
    "source": SOURCE,
}
provenance = {
    **{key: value for key, value in asset.items() if key not in ("svg", "dataUri")},
    "repository": "https://github.com/steinbergmedia/bravura",
    "license": "SIL Open Font License 1.1",
    "sourceSha256": hashlib.sha256(FONT_FILE.read_bytes()).hexdigest(),
    "unitsPerEm": font["head"].unitsPerEm,
    "officialMetadataStaffSpaces": {"bBoxNE": [2.684, 4.392], "bBoxSW": [0, -2.632]},
    "transform": "SVG x = font x - xMin; SVG y = yMax - font y",
    "alignment": "Place SVG origin (originX, originY) on G4, the second staff line from bottom. Scale by staffGap / staffSpace.",
    "extraction": "fontTools SVGPathPen, with unmodified original cubic Bezier outline",
    "licenseFile": "vendor/bravura-LICENSE.txt",
    "svgFile": "assets/treble-clef.svg",
    "browserAsset": "vendor/bravura-clef.js",
}
svg_comment = f"<!-- Bravura {version}; gClef U+E050. Source commit {COMMIT}.\n{license_text}\n-->\n"
(ROOT / "assets/treble-clef.svg").write_text(svg_comment + svg + "\n", encoding="utf-8")
(ROOT / "vendor/bravura-provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
js_comment = (
    f"/* Bravura {version}: original gClef U+E050 outline.\n"
    f" * Immutable source: {SOURCE}\n"
    " * Geometry: scale by staffGap / staffSpace. Place SVG point\n"
    " * (originX, originY) on G4, the second staff line from bottom.\n"
    " * svg may be recolored by replacing its single #263c47 fill.\n\n"
    + license_text + "\n */\n"
)
js = js_comment + "(function (root) {\n  'use strict';\n  const asset = " + json.dumps(asset, ensure_ascii=False, indent=2) + ";\n  root.BravuraClef = Object.freeze(asset);\n  if (typeof module === 'object' && module.exports) module.exports = root.BravuraClef;\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n"
(ROOT / "vendor/bravura-clef.js").write_text(js, encoding="utf-8")
print(json.dumps(provenance, ensure_ascii=False, indent=2))
