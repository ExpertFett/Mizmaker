"""Brief theme-colour override tests (v1.19.59).

Tester ask: "all the color options we brought to kneeboards, we should
bring it to the brief generator." Backend renderer now reads
brief.theme_colors as a {role: "#RRGGBB"} map and substitutes the
matching palette role. Missing / malformed entries fall through to the
renderer's auto-dark / auto-light defaults.

These tests verify the override layer works without parsing the actual
PPTX colours back out (which is fiddly with python-pptx). Instead we
check the render is byte-stable for default palettes and DIFFERS when a
non-default colour is set — that's enough to lock down that the
overrides actually flow through.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def minimal_brief() -> dict:
    """Identical shape to test_speaker_notes.py — enough to render."""
    return {
        "mission_name": "Test Mission",
        "theater": "Caucasus",
        "date": "2026-06-08",
        "time_zulu": "0900Z",
        "coalition": "blue",
        "theatre_overview": "Test theatre overview.",
        "scenario": "Test scenario.",
        "commanders_intent": "Test intent.",
        "mission_flow": "Test flow.",
        "notes": "Test notes.",
        "timeline": [],
        "threats": [],
        "air_threats": [],
        "flights": [],
        "comms": [],
        "logo_base64": "",
        "cover_image_base64": "",
        "threat_narrative": "",
        "popup_attacks": [],
    }


def test_theme_colors_unset_renders_baseline(minimal_brief):
    """Baseline: no theme_colors → renderer uses auto-dark defaults."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    out = render_wing_brief(minimal_brief)
    # Sanity: it produced a non-empty PPTX.
    assert len(out) > 1000
    # Re-rendering with the same input should be byte-identical.
    out2 = render_wing_brief(minimal_brief)
    assert out == out2


def test_theme_colors_change_render(minimal_brief):
    """A non-default accent colour should produce different bytes than
    the baseline render."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    baseline = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"accent": "#00ff00"}
    themed = render_wing_brief(minimal_brief)
    assert themed != baseline, "theme_colors override must change PPTX bytes"


def test_invalid_hex_falls_through_to_default(minimal_brief):
    """Garbage hex should be silently dropped — render = baseline."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    baseline = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"accent": "not-a-hex"}
    rendered = render_wing_brief(minimal_brief)
    assert rendered == baseline


def test_short_hex_works(minimal_brief):
    """3-char shorthand (#f80) expands to 6-char (#ff8800)."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    minimal_brief["theme_colors"] = {"accent": "#f80"}
    short = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"accent": "#ff8800"}
    long = render_wing_brief(minimal_brief)
    assert short == long


def test_empty_value_falls_through(minimal_brief):
    """An empty-string value (user cleared the field) should fall through."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    baseline = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"accent": "", "bg": ""}
    rendered = render_wing_brief(minimal_brief)
    assert rendered == baseline


def test_no_hash_prefix_accepted(minimal_brief):
    """Trim the leading "#" — the renderer should accept "ff0000" too."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    minimal_brief["theme_colors"] = {"accent": "#ff0000"}
    with_hash = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"accent": "ff0000"}
    no_hash = render_wing_brief(minimal_brief)
    assert with_hash == no_hash


def test_partial_override(minimal_brief):
    """Setting just BG should produce a different render than baseline,
    and a different render than setting BG + ACCENT (each role is
    independently honoured)."""
    pytest.importorskip("pptx")
    from services.brief_renderer import render_wing_brief
    baseline = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"bg": "#101820"}
    only_bg = render_wing_brief(minimal_brief)
    minimal_brief["theme_colors"] = {"bg": "#101820", "accent": "#ff00ff"}
    bg_and_accent = render_wing_brief(minimal_brief)
    assert only_bg != baseline
    assert bg_and_accent != only_bg
    assert bg_and_accent != baseline
