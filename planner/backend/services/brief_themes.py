"""Brief template themes (v1.19.141).

Each theme is a self-contained look — palette, font stack, imagery treatment,
and an optional bundled motif (a full-slide background texture and/or a
transparent overlay). The renderer reads one of these by id and applies it
uniformly across every slide type, so adding a look is data, not code.

Fidelity note: a .pptx names fonts, it can't embed them for Google Slides, so
the identity here rides on palette + imagery tint + motif, which all travel;
a display font (VT323, Chakra Petch, …) may substitute when the deck is opened
elsewhere. Motif art lives in backend/assets/themes/.

Palette keys mirror the renderer's: bg, text, bright, accent, dim, border,
header_bg, cell_bg. Fonts: display (titles), body, mono (coords/METAR),
label (eyebrows/small caps).

imagery=True  -> place-driven slides get the AO satellite background.
tint          -> how that imagery is toned (see ao_imagery.fetch_ao_image).
bg_texture    -> a bundled full-slide PNG used as the background on themes that
                 don't use live imagery (paper grain, chart contours, carbon…).
overlay       -> a bundled transparent full-slide PNG laid over every slide
                 (grid, hazard border, scanlines, compass…).
classic_headers -> the pre-redesign full-width-underline section header.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _t(id, name, dark, palette, fonts, *, imagery=False, tint=None,
       bg_texture=None, overlay=None, classic_headers=False,
       cover="standard", description=""):
    return {
        "id": id, "name": name, "dark": dark, "imagery": imagery,
        "tint": tint, "bg_texture": bg_texture, "overlay": overlay,
        "classic_headers": classic_headers, "cover": cover,
        "description": description,
        "palette": palette, "fonts": fonts,
    }


# Font stacks. The renderer falls back gracefully; these are the intended faces.
_F_VANGUARD = {"display": "Oswald", "body": "Barlow", "mono": "Consolas", "label": "Barlow Semi Condensed"}
_F_SANS = {"display": "Arial", "body": "Arial", "mono": "Consolas", "label": "Arial"}

THEMES: List[Dict[str, Any]] = [
    # ---- Default: the satellite-imagery deck ----
    _t("vanguard", "Vanguard (satellite)", True,
       {"bg": "#12151A", "text": "#D3D7DB", "bright": "#FFFFFF", "accent": "#D98A3A",
        "dim": "#8A9098", "border": "#2C333C", "header_bg": "#1C222A", "cell_bg": "#0F1216"},
       _F_VANGUARD, imagery=True, cover="imagery",
       description="Real satellite imagery of the AO on place-driven slides, amber on charcoal. The default."),

    # ---- Classic: the pre-redesign flat deck ----
    _t("classic", "Classic (flat)", True,
       {"bg": "#1A1A1A", "text": "#E0E0E0", "bright": "#FFFFFF", "accent": "#FFA500",
        "dim": "#AAAAAA", "border": "#555555", "header_bg": "#333333", "cell_bg": "#1A1A1A"},
       _F_SANS, imagery=False, classic_headers=True, cover="standard",
       description="The original no-imagery deck: dark grey, orange accent, plain type."),

    # ---- Blueprint ----
    _t("blueprint", "Blueprint", True,
       {"bg": "#0A1626", "text": "#CFE6FF", "bright": "#EAF6FF", "accent": "#35C8FF",
        "dim": "#5A7A99", "border": "#22506E", "header_bg": "#0F2338", "cell_bg": "#0C1B2E"},
       {"display": "Chakra Petch", "body": "Barlow", "mono": "Share Tech Mono", "label": "Share Tech Mono"},
       imagery=True, tint={"duotone": [(6, 18, 34), (150, 210, 255)]},
       overlay="blueprint", cover="imagery",
       description="Navy + cyan engineering schematic — grid, corner brackets, blueprint-blue imagery."),

    # ---- Dossier ----
    _t("dossier", "Dossier", False,
       {"bg": "#DED3B8", "text": "#2B2519", "bright": "#241F16", "accent": "#A5352A",
        "dim": "#6E6250", "border": "#8A7C5E", "header_bg": "#CFC3A2", "cell_bg": "#E7DDC4"},
       {"display": "Saira Stencil One", "body": "Special Elite", "mono": "Special Elite", "label": "Special Elite"},
       imagery=False, bg_texture="dossier", cover="dossier",
       description="Manila intel folder — stencil + typewriter, TOP SECRET stamp, taped recon photos."),

    # ---- Sentinel ----
    _t("sentinel", "Sentinel", False,
       {"bg": "#F4F5F7", "text": "#38465C", "bright": "#0F1B2E", "accent": "#C8102E",
        "dim": "#7C8798", "border": "#D3D9E0", "header_bg": "#E9ECF0", "cell_bg": "#FFFFFF"},
       {"display": "Archivo", "body": "Inter", "mono": "Consolas", "label": "Archivo"},
       imagery=True, tint={"sat": 1.05, "bright": 1.0}, cover="panel",
       description="Clean white NATO/corporate — navy + red, big Archivo type, framed imagery."),

    # ---- Nighthawk ----
    _t("nighthawk", "Nighthawk", True,
       {"bg": "#040705", "text": "#8EFFC0", "bright": "#C8FFE0", "accent": "#35FF96",
        "dim": "#2A6B45", "border": "#123A24", "header_bg": "#08160D", "cell_bg": "#06110A"},
       {"display": "Oswald", "body": "Share Tech Mono", "mono": "Share Tech Mono", "label": "Share Tech Mono"},
       imagery=True, tint={"duotone": [(2, 10, 5), (120, 255, 160)]},
       overlay="nighthawk", cover="imagery",
       description="NVG phosphor green on black — scanlines, HUD reticles, night-ops feel."),

    # ---- Carbon ----
    _t("carbon", "Carbon", True,
       {"bg": "#14161D", "text": "#E8EAF0", "bright": "#FFFFFF", "accent": "#5EEAD4",
        "dim": "#9AA0B4", "border": "#2A2E3A", "header_bg": "#1B1E27", "cell_bg": "#171A22"},
       {"display": "Space Grotesk", "body": "Inter", "mono": "Consolas", "label": "Space Grotesk"},
       imagery=True, tint={"sat": 1.1, "bright": 1.0}, bg_texture="carbon", cover="panel",
       description="Dark glass + teal→violet gradient, geometric Space Grotesk. Modern tech deck."),

    # ---- Topographic ----
    _t("topographic", "Topographic", False,
       {"bg": "#ECE3CD", "text": "#3A3320", "bright": "#2A2414", "accent": "#B2337A",
        "dim": "#7A6E50", "border": "#7A6A44", "header_bg": "#DFD4B8", "cell_bg": "#E4DABF"},
       {"display": "Saira Condensed", "body": "Barlow", "mono": "Overpass Mono", "label": "Overpass Mono"},
       imagery=False, bg_texture="topographic", cover="chart",
       description="Parchment aeronautical chart — contour lines, compass rose, magenta annotations."),

    # ---- Aggressor ----
    _t("aggressor", "Aggressor", True,
       {"bg": "#0E0E11", "text": "#E6E6E6", "bright": "#FFFFFF", "accent": "#E8352B",
        "dim": "#9A9A9A", "border": "#3A3A3E", "header_bg": "#1A1A1E", "cell_bg": "#141417"},
       {"display": "Anton", "body": "Barlow", "mono": "Share Tech Mono", "label": "Saira Stencil One"},
       imagery=True, tint={"sat": 0.55, "bright": 0.55, "mul": (255, 90, 70)},
       overlay="aggressor", cover="imagery",
       description="Black + hazard-stripe red/yellow, heavy Anton stencil. OPFOR threat brief."),

    # ---- Coyote ----
    _t("coyote", "Coyote", True,
       {"bg": "#26221A", "text": "#E9DFC8", "bright": "#F2EAD6", "accent": "#C8A96A",
        "dim": "#A89A78", "border": "#4A4634", "header_bg": "#332E24", "cell_bg": "#2C2820"},
       {"display": "Oswald", "body": "Barlow", "mono": "Consolas", "label": "Saira Stencil One"},
       imagery=True, tint={"sat": 0.85, "bright": 0.82, "mul": (210, 180, 130)},
       cover="panel",
       description="Coyote brown + OD green, warm and gritty. Ground-war MARSOC palette."),

    # ---- Editorial ----
    _t("editorial", "Editorial", False,
       {"bg": "#FAF7F0", "text": "#2A2A2A", "bright": "#111111", "accent": "#A01E1E",
        "dim": "#7A7268", "border": "#D8D2C6", "header_bg": "#EFEAE0", "cell_bg": "#FFFFFF"},
       {"display": "Playfair Display", "body": "Inter", "mono": "Consolas", "label": "Inter"},
       imagery=True, tint={"sat": 1.05, "bright": 1.0}, cover="editorial",
       description="Defense-magazine feature — big Playfair serif, column grid, photo-forward."),

    # ---- Chartroom ----
    _t("chartroom", "Chartroom", True,
       {"bg": "#0C1E30", "text": "#E8E0CC", "bright": "#F2EAD0", "accent": "#C9A24A",
        "dim": "#8FA3B4", "border": "#2A4054", "header_bg": "#122A40", "cell_bg": "#0E2236"},
       {"display": "Cormorant Garamond", "body": "Barlow", "mono": "Share Tech Mono", "label": "Barlow Condensed"},
       imagery=True, tint={"duotone": [(6, 20, 36), (150, 190, 220)]},
       overlay="chartroom", cover="imagery",
       description="Navy + brass carrier ops-room — compass rose, rhumb lines, Cormorant serif."),

    # ---- Terminal ----
    _t("terminal", "Terminal", True,
       {"bg": "#0A0805", "text": "#FFB000", "bright": "#FFD67A", "accent": "#FFB000",
        "dim": "#8A6410", "border": "#4A3A08", "header_bg": "#14100A", "cell_bg": "#0F0C07"},
       {"display": "VT323", "body": "VT323", "mono": "VT323", "label": "VT323"},
       imagery=True, tint={"duotone": [(8, 5, 0), (255, 190, 60)]},
       overlay="terminal", cover="terminal",
       description="Amber CRT console — scanlines, ASCII frame, command-prompt cover. Mono throughout."),

    # ---- Swiss ----
    _t("swiss", "Swiss", False,
       {"bg": "#FFFFFF", "text": "#222222", "bright": "#111111", "accent": "#E2231A",
        "dim": "#555555", "border": "#111111", "header_bg": "#111111", "cell_bg": "#FFFFFF"},
       {"display": "Archivo", "body": "Archivo", "mono": "Consolas", "label": "Archivo"},
       imagery=True, tint={"sat": 1.0, "bright": 1.0}, cover="swiss",
       description="Austere International Typographic — stark white/black, one red, huge Archivo."),

    # ---- Whiteout ----
    _t("whiteout", "Whiteout", False,
       {"bg": "#EEF3F7", "text": "#3A4D5A", "bright": "#1E2B36", "accent": "#3A7CA5",
        "dim": "#6A8698", "border": "#B8CAD6", "header_bg": "#E1E9EF", "cell_bg": "#F7FAFC"},
       {"display": "Josefin Sans", "body": "Barlow", "mono": "Consolas", "label": "Josefin Sans"},
       imagery=True, tint={"sat": 0.55, "bright": 1.12, "mul": (210, 228, 240)},
       cover="imagery",
       description="Arctic ice-white — cool blue, thin airy type. Fits the Kola theatre."),
]

# Layout mode for the place-driven slides (cover / situation / intent / threats):
#   "overlay" — imagery fills the slide, text sits over a baked gradient.
#   "panel"   — solid/texture background, imagery in a framed inset, text beside.
# Data slides (weather, control measures, force, timeline, comms, ROE) are the
# same in both — solid background + themed palette/fonts.
_OVERLAY_LAYOUT = {"vanguard", "blueprint", "nighthawk", "aggressor",
                   "terminal", "chartroom", "whiteout"}
for _t2 in THEMES:
    _t2["layout"] = "overlay" if _t2["id"] in _OVERLAY_LAYOUT else "panel"

_BY_ID = {t["id"]: t for t in THEMES}
DEFAULT_THEME = "vanguard"


def get_theme(theme_id: Optional[str]) -> Dict[str, Any]:
    """Theme by id, falling back to the default (vanguard)."""
    return _BY_ID.get((theme_id or "").strip().lower(), _BY_ID[DEFAULT_THEME])


def list_themes() -> List[Dict[str, str]]:
    """Compact list for the frontend picker: id, name, description, dark."""
    return [{"id": t["id"], "name": t["name"], "description": t["description"],
             "dark": t["dark"]} for t in THEMES]
