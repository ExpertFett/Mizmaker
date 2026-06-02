/**
 * GuidePanel — comprehensive in-app walkthrough for DCS:OPT.
 *
 * Covers every major surface: the three modes (Editor / Plan / Live),
 * every editor tab, the kneeboard card catalogue, brief generation,
 * the LotATC controller scope, persistence/storage, and troubleshooting.
 *
 * Accessible from:
 *   - "?" button on the LandingPage + UploadPanel + MissionEditor header
 *   - URL param `?guide=1` (shareable link)
 *   - ESC closes
 *
 * Content is authored inline as React sections so we can use the real
 * component palette + inline brevity / tool chips that match what the user
 * actually sees. A "Download as Markdown" button generates a flat .md
 * dump for offline reference.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { VERSION } from '../version';

const C = {
  bg: '#0d131d',
  bgPanel: '#141b27',
  bgHover: 'rgba(74,158,255,0.08)',
  border: '#243349',
  borderHi: '#3a6ea5',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  amber: '#ffd24a',
  green: '#3fb950',
  red: '#e0554f',
};

// ---------------------------------------------------------------------------
// Section catalogue. Each entry is { id, title, body }; body is a render
// function so we can compose inline JSX (tool chips, tables, code blocks).
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  group: string;
  body: () => ReactNode;
}

const SECTIONS: Section[] = [
  // ───────── OVERVIEW ─────────
  { id: 'welcome', title: 'Welcome', group: 'OVERVIEW', body: () => (
    <>
      <p><b>DCS:OPT</b> (DCS Operations Planning Tool) is a web-based mission planning suite for DCS World. It surgically edits <code>.miz</code> files without destroying user formatting, generates kneeboard cards, builds PowerPoint briefs, and gives you a LotATC-style controller scope for running missions live.</p>
      <p>Three modes:</p>
      <Table headers={["Mode", "What it's for", "When to use"]} rows={[
        ['📝 Editor', 'Full mission editor + brief + kneeboard output', "You're authoring or fixing a .miz"],
        ['📋 Plan', 'Planning-only: kneeboards + brief, no .miz writeback', "You just want plates / a brief from a mission you didn't build"],
        ['📡 Live', 'Multi-tenant controller scope (DM seat): Olympus + SRS + scope tools', "You're running a mission live and need the controller's view"],
      ]} />
      <p>Switch modes from the dropdown in the editor header. Live mode can also be reached <i>without</i> a mission loaded via <Mono>?live=1</Mono> on the URL — useful when you only want to control an existing server.</p>
      <Callout>Ecosystem: DCS:OPT pairs with <b>DCS:OPT Ops Bot</b> (Discord bot for squadron utilities) and <b>DCS:OPT Ready Room</b> (squadron / pilot identity bridge). Tile links live on the landing page.</Callout>
    </>
  ) },
  { id: 'getting-started', title: 'Getting Started', group: 'OVERVIEW', body: () => (
    <>
      <p>First-run flow:</p>
      <Steps items={[
        <><b>Land on the home page</b> (<Mono>dcsopt.up.railway.app</Mono>). You'll see two paths: <Chip>Log in with Discord</Chip> and <Chip>Continue as guest</Chip>.</>,
        <><b>Choose login or guest.</b> Discord login is identity-only (no email, no guild check); it remembers you across visits. Guest mode works for everything except Live multi-tenant groups.</>,
        <><b>Upload Panel.</b> Drag-and-drop a <Mono>.miz</Mono> file or click to browse. The file is parsed server-side and a session is created (2 hr TTL).</>,
        <><b>Editor opens to the Map tab.</b> Sidebar on the left groups tabs into SETUP / ENTITIES / PLANNING / FLIGHTS / OUTPUT / UTIL.</>,
        <><b>When done, click <Chip>Download .miz</Chip></b> (top right). Your edits apply surgically to the original file — formatting preserved.</>,
      ]} />
      <Callout title="Privacy">
        Your <code>.miz</code> sits in server RAM for 2 hours, never on disk. AI features use your own API key (BYOK) — calls go browser→Anthropic directly; Railway never sees the key.
      </Callout>
    </>
  ) },
  { id: 'three-modes', title: 'Editor / Plan / Live', group: 'OVERVIEW', body: () => (
    <>
      <p>The Mode Switcher (top-left of the editor header) lets the same uploaded mission feed three different surfaces:</p>
      <Table headers={['Surface', 'Tabs shown', 'Can edit .miz?', 'Live tactical?']} rows={[
        ['📝 Editor', 'All tabs', '✅ Yes', '—'],
        ['📋 Plan', 'Map / SOP / Mission / Weather / Threats / Kneeboard / Brief / Edits', '⚠️ Plan-only (no writeback)', '—'],
        ['📡 Live', 'Multi-tenant groups + Olympus profiles + LotATC scope', '—', '✅ Yes'],
      ]} />
      <p><b>Editor</b> is the full workshop: callsigns, loadouts, datalinks, triggers, scripts. Best for mission designers.</p>
      <p><b>Plan</b> is curated: it strips the writeback-capable tabs, keeps the read-only planning surfaces. Best when you fly someone else's mission and want kneeboards + a brief without risk of editing the original.</p>
      <p><b>Live</b> is the DM seat: real-time unit picture from DCS via the Olympus REST API, plus the LotATC-style scope built on top (BRA / bullseye / picture-call / text comms / brevity card / 9-line). Live also runs <i>without</i> a mission loaded — pure controller seat.</p>
    </>
  ) },

  // ───────── EDITOR MODE ─────────
  { id: 'editor-overview', title: 'Editor Overview', group: 'EDITOR', body: () => (
    <>
      <p>The Editor is built around a left sidebar of tabs and a content area on the right. The sidebar groups tabs in the order you'll typically work them:</p>
      <Table headers={['Group', 'Tabs', 'Why this order']} rows={[
        ['SETUP', 'Map · SOP · SOP Check · Coalitions · Mission · Goals · Weather', 'Loading the active SOP first means everything downstream (callsigns, freqs, TACAN) starts pre-configured.'],
        ['ENTITIES', 'Carriers · Scripts · Triggers', "Carriers + Scripts auto-append trigger rules, so Triggers comes last — you're verifying, not authoring."],
        ['PLANNING', 'Threats · DMPI · Visibility · Range', 'Threats + targets drive loadouts. Doing this before FLIGHTS prevents "bring the wrong weapons."'],
        ['FLIGHTS', 'Roster · Loadout · Datalink · Radio · DTC · Livery', 'Per-flight aircraft configuration. Each tab covers one column of the .miz unit block.'],
        ['OUTPUT', 'Kneeboard · Brief · Edits', "End-of-pipeline: plates for pilots, a brief for the planning session, and an inventory of what's queued for download."],
        ['UTIL', 'Debug · Tools · Upload', 'Diagnostics + framework injectors + replacing the uploaded mission without resetting state.'],
      ]} />
      <p>Tabs persist their state across mode switches — open Loadout, change a pylon, switch to Brief, come back, your edit is still there until you Download or clear.</p>
      <Callout title="Edits queue">
        Every change you make goes into a queued <Chip>edits</Chip> list (visible in the Edits tab). Nothing touches the original Lua until you click Download. The X-Edit-Results header on the response shows what actually applied so silent edit failures can't hide.
      </Callout>
    </>
  ) },
  { id: 'editor-setup', title: 'SETUP Tabs', group: 'EDITOR', body: () => (
    <>
      <SubHead>🗺 Map</SubHead>
      <p>Full-mission OpenLayers view. All groups, threat rings, airbases, waypoints, drawings, trigger zones overlaid. Filter by coalition, group type, visibility. Click any group → route + per-waypoint detail. Use the measure tool for range + bearing checks.</p>

      <SubHead>📘 SOP</SubHead>
      <p>Standing Operating Procedure library. An active SOP supplies defaults for callsigns, common frequencies (GCI / AAR / Tower / Approach / Guard), TACAN channels, ICLS, comm cards. The Active SOP propagates into Coalitions, Carriers, Loadout presets, Kneeboard cards. Build SOPs in the tab; export/import as JSON. The vision-based <i>extractor</i> can OCR a screenshot of a real SOP card and parse it into an editable form (BYOK Anthropic key required).</p>

      <SubHead>✓ SOP Check</SubHead>
      <p>Read-only comparison: where does the loaded mission disagree with the Active SOP? Flags wrong freqs, missing TACAN assignments, non-SOP callsigns. Use before downloading.</p>

      <SubHead>⚔ Coalitions</SubHead>
      <p>Country lists per side + bullseye coordinates per coalition + briefing text (DictKey-resolved for non-English missions). Note: changing bullseye here updates the LotATC Live scope's bullseye reference too.</p>

      <SubHead>🔔 Mission</SubHead>
      <p>Cover-page data: sortie / mission name, date, start time (Zulu), description, blue/red task text, theatre. Editing here updates the brief's cover slide + the kneeboard mission-date line.</p>

      <SubHead>🎖 Goals</SubHead>
      <p>Squadron-style objective list with point values. Used by the brief tokens (<Mono>{'{{goals.red}}'}</Mono>, <Mono>{'{{goals.blue}}'}</Mono>, <Mono>{'{{goals.list}}'}</Mono>) and surfaced on the kneeboard Goals card.</p>

      <SubHead>🌤 Weather</SubHead>
      <p>QNH (inHg + hPa), surface temp, wind layers at surface / 2000 / 8000 ft, cloud preset, visibility. Edits flow to the brief Weather slide and the kneeboard Weather card.</p>
    </>
  ) },
  { id: 'editor-entities', title: 'ENTITIES Tabs', group: 'EDITOR', body: () => (
    <>
      <SubHead>⚓ Carriers</SubHead>
      <p>Carrier setup table — per-ship hull number / case recovery / TACAN / ICLS / spawn point. Selecting a carrier as a flight's launch platform auto-appends a Carrier Control trigger rule + the carrier recovery card data to that flight's kneeboards.</p>

      <SubHead>📜 Scripts</SubHead>
      <p>Embed framework Lua into the mission: <b>MOOSE</b>, <b>MIST</b>, plus mission-specific helpers (Carrier Control, TIC, AEGIS IADS). Each script you tick gets injected at download. Frameworks auto-update weekly via the GitHub Action.</p>

      <SubHead>⚡ Triggers</SubHead>
      <p>The mission's trigger list, including ones auto-added by Carriers + Scripts. Sort by phase, filter by zone, edit conditions/actions. <b>Footgun:</b> Triggers comes after Carriers + Scripts on purpose — by the time you land here, framework rules are already queued; you're verifying, not authoring.</p>
    </>
  ) },
  { id: 'editor-planning', title: 'PLANNING Tabs', group: 'EDITOR', body: () => (
    <>
      <SubHead>⚠ Threats</SubHead>
      <p>Surface threats (SAM / AAA) and enemy air picture, aggregated and ranked. Each threat has a tier (low/med/high), engagement / acquisition ranges in NM and km, and a bullseye reference. The brief's threat slide and the kneeboard threat card pull from here. AI-generated 2–4 sentence threat narrative available (BYOK key) — sits above the table on the brief slide.</p>

      <SubHead>🎯 DMPI</SubHead>
      <p>Designated mean point of impact list. Name + lat/lon/elev + weapon-delivery note. Renders as a Kneeboard DMPI card; flows into brief tokens <Mono>{'{{dmpis.list}}'}</Mono> / <Mono>{'{{dmpis.coords}}'}</Mono> / <Mono>{'{{dmpis.names}}'}</Mono>.</p>

      <SubHead>👁 Visibility</SubHead>
      <p>Per-group intel filter: which groups appear in each flight lead's kneeboard map. Lets you fog-of-war specific opposing intel without changing the .miz unit picture. Three fidelity settings: full / realistic (default) / off.</p>

      <SubHead>🎯 Range</SubHead>
      <p>Training range planner: define a range + targets + DMPIs + safety zones. Useful for Hornet School / weapons school scenarios where you're flying repeated profiles against a known target array.</p>
    </>
  ) },
  { id: 'editor-flights', title: 'FLIGHTS Tabs', group: 'EDITOR', body: () => (
    <>
      <SubHead>👥 Roster</SubHead>
      <p>Player flight roster — per-slot callsign / pilot name / aircraft type. Bulk-import from CSV or XLSX (drag-drop). Useful for squadron events where a sign-up spreadsheet needs to flow into the mission slots.</p>

      <SubHead>💣 Loadout</SubHead>
      <p>Pylon table per flight. Preset menu (incl. Fett's <Chip>Double Ugly</Chip> = 2 tanks on 5+7) gives one-click common loadouts. Auto-validation against the airframe's pylon definition (no impossible combinations). Configured loadouts auto-inject matching weapon kneeboards on download.</p>

      <SubHead>📡 Datalink</SubHead>
      <p>Link-16 / TNDL config per flight: STN, callsign, donor / team membership graph. Visual graph view shows who's transmitting / receiving from whom. Has a per-airframe defaults pass that fills sensible values when the .miz left them blank.</p>

      <SubHead>📻 Radio</SubHead>
      <p>Radio preset programming: per radio (1, 2, …), per channel (1–20), MHz + AM/FM + display name. Edit + auto-fill from active SOP. Generates a Radio Ladder kneeboard card.</p>

      <SubHead>💾 DTC</SubHead>
      <p>F-16 DTC / F/A-18 NVRAM injection — laser codes, smartbomb assignments, JDAM target points. Reads + writes the per-aircraft sub-files inside the .miz cleanly.</p>

      <SubHead>🎨 Livery</SubHead>
      <p>Per-aircraft livery override. Pick from installed liveries; "Random" picks per flight at mission load.</p>
    </>
  ) },
  { id: 'editor-output', title: 'OUTPUT Tabs', group: 'EDITOR', body: () => (
    <>
      <SubHead>📋 Kneeboard</SubHead>
      <p>The card builder. Toggle which cards generate per flight + edit each card's notes. See the <Chip>Kneeboard Cards</Chip> section below for the full card catalogue.</p>
      <p>Theme: <Chip>Night</Chip> (dark default) or <Chip>Day</Chip> (white background for daylight / printed kneeboards). Setting flows to all cards via CSS variables.</p>

      <SubHead>📝 Brief</SubHead>
      <p>PowerPoint brief generation. Two flows:</p>
      <ul style={{ marginLeft: 18 }}>
        <li><b>Build from mission</b> — auto-builds a 10–11-slide deck using the built-in dark template. Includes cover, theatre overview, scenario, commander's intent, threats (+ optional AI narrative), force composition, comms, mission flow, timeline, notes, and a Popup Attack appendix when profiles are defined.</li>
        <li><b>Upload your own .pptx</b> — squadron template. Scans for <Mono>{'{{token.path}}'}</Mono> placeholders, auto-resolves them from the mission, lets you override per-token. ~80 known tokens including SOP, DMPI, goals, threats, weather, comms, per-flight callsigns/freqs/TACAN/aircraft.</li>
      </ul>
      <p>Outputs: <Chip>PPTX</Chip> · <Chip>PDF</Chip> · <Chip>PNG ZIP</Chip> · <Chip>JPG ZIP</Chip>. PDF + image exports require LibreOffice on the server (already on Railway).</p>

      <SubHead>✎ Edits</SubHead>
      <p>Read-only inventory of every edit queued for download. Group by tab / unit. Remove an edit by its index. The summary chip in the editor header shows how many edits are queued — turns amber when ≥10.</p>
    </>
  ) },
  { id: 'editor-util', title: 'UTIL Tabs', group: 'EDITOR', body: () => (
    <>
      <SubHead>🔍 Debug</SubHead>
      <p>Parsed mission JSON viewer. Useful when an edit doesn't apply: inspect what the backend parser actually saw, compare against the .miz source.</p>

      <SubHead>🔧 Tools</SubHead>
      <p>Misc utilities: AI Settings (BYOK API key + model picker), kneeboard preview rebuild, framework re-injection.</p>

      <SubHead>📁 Upload</SubHead>
      <p>Swap the loaded mission without leaving the editor. Picks up edits that don't depend on the previous .miz; flags edits that target unit IDs that no longer exist.</p>
    </>
  ) },

  // ───────── PLAN MODE ─────────
  { id: 'plan-mode', title: 'Plan Mode', group: 'PLAN MODE', body: () => (
    <>
      <p>Plan mode hides the writeback tabs and keeps the read-only planning surfaces. The intent: you're flying someone else's mission and want a clean kneeboard + brief without risk of editing the original.</p>
      <p>Switch via the mode dropdown in the editor header. The same uploaded .miz feeds both modes — switching mode doesn't reload the file.</p>
      <Table headers={['Surface', 'In Plan mode?']} rows={[
        ['Map', '✅'],
        ['SOP / SOP Check', '✅'],
        ['Mission / Goals / Weather', '✅ (read-only display)'],
        ['Threats / DMPI', '✅'],
        ['Coalitions / Carriers / Scripts / Triggers', '❌ (hidden)'],
        ['Roster / Loadout / Datalink / Radio / DTC / Livery', '❌ (hidden)'],
        ['Kneeboard / Brief', '✅'],
        ['Edits', '❌ (no edits possible)'],
        ['Download .miz', '❌'],
        ['Download Kneeboards / Brief', '✅'],
      ]} />
      <Callout>
        Plan mode is also the right call when a tester or guest pilot wants the brief for a mission they didn't author — they get the cards + slides without permission to change the file.
      </Callout>
    </>
  ) },

  // ───────── LIVE MODE ─────────
  { id: 'live-overview', title: 'Live (DM/GCI) Overview', group: 'LIVE MODE', body: () => (
    <>
      <p>Live mode is the controller seat. It mixes <b>real-time DCS state</b> (via the Olympus REST API on the server host) with a <b>LotATC-style scope</b> we built on top: BRA math, bullseye-relative calls, picture-call panel, track history, leader-line extrapolation, GCI rings, named markers, SRS frequency directory, text comms, brevity reference, and a CAS 9-line builder.</p>
      <p>It can also run <i>without</i> a .miz uploaded — useful when you're just controlling an existing server. Append <Mono>?live=1</Mono> to the URL on the upload screen.</p>
      <p>Live is <b>multi-tenant</b>: you create a Group (you become admin / DM), invite operators by code, and the group owns Server Profiles (Olympus connection info + the optional SRS-Server URL). Up to six roles map to a capability matrix:</p>
      <Table headers={['Role', 'Can do']} rows={[
        ['admin (DM / GM)', 'manage group, spawn, command units, delete, smoke, drop markers'],
        ['commander', 'spawn, command, delete, smoke, markers'],
        ['jtac', 'effects + markers'],
        ['atc', 'effects + markers'],
        ['operator', 'observer (informational overlays only)'],
      ]} />
      <p>The Phase-1–6 controller tools (BRA, trails, labels, picture, etc.) are <b>informational</b> — every member sees them. Only the <i>unit-control</i> actions (move, attack, etc.) are gated behind the <Chip>command</Chip> capability.</p>
    </>
  ) },
  { id: 'live-setup', title: 'Live Setup', group: 'LIVE MODE', body: () => (
    <>
      <SubHead>1. Create a group</SubHead>
      <p>From the Live terminal, click <Chip>Create group</Chip>, name it (e.g. "Bengals Saturday Ops"). You become admin.</p>

      <SubHead>2. Add a server profile</SubHead>
      <p>Create a Server Profile pointing at your DCS host running Olympus:</p>
      <Table headers={['Field', 'Notes']} rows={[
        ['Olympus host', "Public IP or hostname of the DCS box."],
        ['Olympus port', "Default 4512 unless you changed Olympus' REST port."],
        ['Olympus password', "Stored encrypted server-side (Fernet). Never returned to the browser; only a 'hasPassword' flag."],
        ['LotATC URL (optional)', 'For reference / opening the LotATC stream in another tab.'],
      ]} />

      <SubHead>3. Invite operators</SubHead>
      <p>Generate an invite code for a specific role. Share the resulting <Mono>/join/...</Mono> URL — invitees skip the landing/login gate and drop straight into the group session.</p>

      <SubHead>4. (Optional) Light up the SRS poll</SubHead>
      <p>Set the <Mono>SRS_SERVER_URL</Mono> env var on Railway (the server's Web Stats endpoint). The SRS Directory will then show a <Chip>● N live</Chip> chip in its header + <Chip>● N on</Chip> pills next to any freq with tuned clients. Without the env var, the directory still works as a static reference.</p>
    </>
  ) },
  { id: 'live-scope-tour', title: 'Scope Tool Rail', group: 'LIVE MODE', body: () => (
    <>
      <p>The left tool rail in Live → Map is the complete controller-scope kit. From top to bottom:</p>
      <Table headers={['Icon', 'Tool', 'What it does']} rows={[
        ['＋ －', 'Zoom in / out', 'Standard map zoom.'],
        ['⊹', 'Pointer', 'Click a unit to select; shift-click to multi-select.'],
        ['▦', 'Selection tool', 'Batch-select by control mode / type / coalition / search. canControl-gated.'],
        ['📏', 'Measure', 'Click to drop range/bearing points along a path.'],
        ['🧽', 'Clear measurements', 'Wipe the measure path.'],
        ['📐', 'BRA tool', 'Click anchor → click target. Clicking a live unit captures alt + track for honest math. "FROM BE" shortcut appears when a bullseye is set.'],
        ['✕', 'Clear BRA', 'Reset the BRA anchor + target.'],
        ['◎', 'GCI ring', 'Drop a ring with the slider radius. Persisted.'],
        ['🧹', 'Clear GCI rings', 'Wipe all rings.'],
        ['🎯', 'Bullseye', 'Click to (re)set the bullseye reference. Auto-seeds from mission; "M" badge = manually placed.'],
        ['↺', 'Reset BE', 'Revert to the mission BE (or clear if no mission).'],
        ['📌', 'Marker', 'Drop a labelled coloured pin. Label + colour set in the floating panel.'],
        ['🗑', 'Clear markers', 'Wipe all pins.'],
        ['🛤', 'Trails', 'Cycle off / 30s / 60s / 120s. Drives BOTH breadcrumb tails and forward leader-lines.'],
        ['🏷', 'Labels', '3-state: off / basic (callsign) / rich (CALLSIGN · ALT·HDG · KT · BE bearing/range).'],
        ['📻', 'SRS Directory', 'Per-flight freq table with copy buttons. Live SRS-server pill when configured.'],
        ['💬', 'Comms log', 'Text broadcast + audit log. Composer hidden when you lack the command cap.'],
        ['📖', 'Brevity', '60 NATO/USN brevity words, searchable + collapsible.'],
        ['📋', 'CAS 9-line', "Structured CAS check-in form. canCommand-gated; 'Send to comms' broadcasts."],
        ['🐛', 'Debug', 'Inspect decoded unit JSON.'],
      ]} />
      <p>Picture-call panel (📡 PICTURE) lives in the bottom-right; toggles between BRAA and BULLSEYE relative modes.</p>
    </>
  ) },
  { id: 'live-workflow-gci', title: 'Walkthrough: Run a CAP GCI', group: 'LIVE MODE', body: () => (
    <>
      <p>Concrete sequence to use the scope as a fighter controller running a CAP / GCI shift.</p>
      <Steps items={[
        <><b>Connect.</b> Live terminal → group → select your Server Profile → Map. The status pill at top shows green when telemetry is flowing.</>,
        <><b>Set / verify bullseye.</b> If you uploaded a .miz, BE auto-seeded. Otherwise click <Chip>🎯</Chip> and drop one. Status bar shows current BE lat/lon.</>,
        <><b>Drop GCI station rings.</b> <Chip>◎</Chip> with the slider at 40 NM, click your CAP point. Drop a second 60 NM ring for the threat warning circle.</>,
        <><b>Turn on track aids.</b> <Chip>🛤</Chip> to 60s — trails AND leader-lines. <Chip>🏷</Chip> twice for rich labels (CALLSIGN · ALT·HDG · KT · BE).</>,
        <><b>Open the picture panel.</b> Click <Chip>📡 PICTURE</Chip> at bottom-right. Pick <Chip>BULLSEYE</Chip> mode. The panel updates live as bandits move; copy-to-clipboard gives you the radio-ready call.</>,
        <><b>Run a BRA on a specific bandit.</b> <Chip>📐</Chip> → click own-ship / friendly track → click bandit. Chip shows BRA + the persistent readout in the status bar carries it. Click <Chip>FROM BE</Chip> to anchor on the bullseye for a bullseye call instead.</>,
        <><b>Broadcast vectors.</b> Open <Chip>💬</Chip>. Type "UZI 1-1 vector 080, bullseye 350/40, 18K hot." Hit Send — every member's CommsLog shows it within ~1 s.</>,
        <><b>Refresh the picture between merges.</b> Cycle <Chip>🛤</Chip> to clear trails on a quiet stretch, then back up to keep the picture clean.</>,
      ]} />
      <Callout>The status bar at the bottom always shows: cursor lat/lon · BE lat/lon · current BRA call · group role · profile name. Use it as your sanity strip.</Callout>
    </>
  ) },
  { id: 'live-workflow-cas', title: 'Walkthrough: Run CAS with 9-line', group: 'LIVE MODE', body: () => (
    <>
      <p>You're acting as JTAC / FAC(A) controller; a flight is checking in for a strike.</p>
      <Steps items={[
        <><b>Set the target reference.</b> Drop a 📌 marker labelled <Mono>TGT</Mono> in the colour of choice at the target position. Drop a second marker <Mono>IP DELTA</Mono> at your chosen IP.</>,
        <><b>Open the 9-line builder.</b> <Chip>📋</Chip> in the tool rail (canCommand-gated). The form previews the formatted call live as you type.</>,
        <><b>Fill the fields:</b> IP "IP DELTA" · Heading 080 / offset L · Distance 6.5 NM · Tgt elev 320 · Tgt desc "3× BMP-2 in revetment" · Tgt loc "38T LB 12345 67890" · Mark "Sparkle" · Friendlies "None within 1 km" · Egress "S to IP DELTA" · Restrictions "FAH 060–120".</>,
        <><b>Send to comms.</b> <Chip>SEND TO COMMS</Chip> broadcasts the formatted block to every member; receipt chip confirms.</>,
        <><b>Track the run-in.</b> Use <Chip>📐</Chip> from your marker → the running-in flight for BRA, watch the leader line on their track to predict release point.</>,
        <><b>Cleared hot.</b> Open <Chip>💬</Chip> and type "ENFIELD 11, cleared hot." Quick lookup via <Chip>📖 BREVITY</Chip> if you forget the exact term.</>,
      ]} />
    </>
  ) },
  { id: 'live-persistence', title: 'What persists in Live mode', group: 'LIVE MODE', body: () => (
    <>
      <p>Everything important survives a page reload. State lives in the browser's localStorage (not on Railway), keyed under <Mono>dcsopt.live.*</Mono>:</p>
      <Table headers={['Key', 'Persisted']} rows={[
        ['dcsopt.live.gciRings', 'GCI ring list + their radii'],
        ['dcsopt.live.gciDefaultNm', 'Last default ring radius'],
        ['dcsopt.live.bullseyeManual', 'Manually placed BE (mission BE always reasserts on .miz upload)'],
        ['dcsopt.live.markers', 'Named markers + colours'],
        ['dcsopt.live.markerLabel / markerColor', 'Last-used composer values'],
        ['dcsopt.live.trailSec', 'Trail / leader-line window (0/30/60/120)'],
        ['dcsopt.live.labelsMode', 'Labels mode (off/basic/rich)'],
        ['dcsopt.live.pictureOpen / pictureMode', 'Picture panel open + BRAA vs BE mode'],
        ['dcsopt.live.srsOpen / commsOpen / brevityOpen', 'Which side-panels are open'],
        ['dcsopt.kneeboard.popupAttacks', "Popup attack profiles (cross-mode — Editor's Kneeboard tab uses the same store)"],
      ]} />
      <p>To reset everything: open browser devtools → Application → Local Storage → clear the <Mono>dcsopt.*</Mono> keys.</p>
    </>
  ) },

  // ───────── KNEEBOARDS ─────────
  { id: 'kb-overview', title: 'Kneeboard Overview', group: 'KNEEBOARDS', body: () => (
    <>
      <p>Per-flight cards rendered as PNG + injected into each player aircraft's <Mono>KNEEBOARD/&lt;aircraft&gt;/IMAGES</Mono> path on download. Cards are toggleable per mission; the active SOP feeds their defaults.</p>
      <p>Theme: <Chip>Night</Chip> (dark, default) or <Chip>Day</Chip> (white for daylight printing). The colour scheme drives every card via CSS variables.</p>
    </>
  ) },
  { id: 'kb-cards', title: 'Card Catalogue', group: 'KNEEBOARDS', body: () => (
    <>
      <Table headers={['Card', 'What it shows', 'When useful']} rows={[
        ['Lineup', 'Mission name, date, time, flight callsigns, slot table', 'Always — first card every flight gets.'],
        ['Flight', "This flight's specific callsign / freq / TACAN / aircraft / home plate / divert.", 'Per-flight bookmark.'],
        ['Comms', 'Comm card with SOP-filled slots (GCI / AAR Boom / BTW Tower / Approach / Guard).', 'Always.'],
        ['Route Detail', 'Waypoint table — name / lat-lon / alt / speed / ETA Zulu / actions.', "Long routes — pilot's main reference."],
        ['Fuel Ladder', 'Fuel state by phase (takeoff / push / target / RTB / divert).', 'Range-limited / carrier ops.'],
        ['Home Plate', 'Field info — runway / TACAN / ICLS / ATIS / pattern alt.', 'Recovery ops.'],
        ['Support Assets', 'Tankers + AWACS + JSTARS positions / freqs / TACAN.', 'Coordinated package missions.'],
        ['Radio Ladder', 'All radio presets across all flights, deduped + SOP-sorted (facility → AWACS → JTAC → tanker → strike).', 'Multi-flight coord.'],
        ['Airbase Reference', 'Theatre airfields + ICAO + runway / freq / TACAN.', 'Diverts.'],
        ['Bullseye Reference', 'Bullseye + threat bearings/ranges from it.', 'CAP / AI.'],
        ['Threat Card', 'SAM/AAA cards in the squadron DEFEND-banner style.', 'CAP / SEAD / Strike.'],
        ['Weather Brief', 'Forecast + winds aloft + cloud preset.', 'Always.'],
        ['SOP Comms', "The active SOP's comm card pasted verbatim.", 'When your SOP has a hard-set freq plan.'],
        ['Goals', "Mission goals (objectives) with point values.", 'Comp / training missions.'],
        ['DMPI', 'Targets list with coords + weapon delivery + description.', 'CAS / Strike.'],
        ['Notes', 'Free text the planner authored in the Kneeboard tab.', 'Anything that doesn\'t fit a slot.'],
        ['Weapons Reference', 'Per-store cards (AGM-65 / AGM-88 / GBU-12 / etc.) — auto-injected based on the flight\'s loadout.', "Newer pilots; training missions."],
        ['Popup Attack', 'One card per profile defined in the Kneeboard tab. Side profile + plan view + parameters.', 'CAS / Strike training.'],
      ]} />
      <Callout title="Auto-inject">
        With Loadout cards set to Auto, the weapons each flight is carrying drive which Weapons Reference cards inject. Carrying an AIM-9X? The 9X card lands in their kneeboard.
      </Callout>
    </>
  ) },
  { id: 'kb-popup-attack', title: 'Popup Attack Card', group: 'KNEEBOARDS', body: () => (
    <>
      <p>Defines an attack profile and renders both a side-profile + plan-view chart with the reference points (IP / AP / PDP / RP / TGT / REC) labelled, plus a parameter table.</p>
      <SubHead>Adding a profile</SubHead>
      <Steps items={[
        <>Editor → Kneeboard tab. Turn <Chip>Popup Attack</Chip> ON.</>,
        <>Click <Chip>+ Add profile</Chip>. Name it (e.g. "LGB Run").</>,
        <>Pick the attack type from the dropdown. Six types supported:</>,
      ]} />
      <Table headers={['Type', 'Description', 'Geometry']} rows={[
        ['Type 1 Popup', 'High-angle, ≥30° dive', 'Climb → apex (PDP) → dive to release'],
        ['Type 2 Popup', 'Medium-angle, ~15-30° dive', 'Same shape, shallower dive'],
        ['Type 3 Popup', 'Low-angle, ~10-15° dive', 'Same shape, very shallow dive'],
        ['Lay-Down', 'Level release with retarded weapons', 'Ingress alt → release over target'],
        ['Loft (Toss)', 'Pull-up + release climbing', 'Bomb arcs onto stand-off target'],
        ['Straight Dive', 'No popup; roll-in from cruise', 'Single dive from ingress to release'],
      ]} />
      <p>Click <Chip>↺</Chip> next to the type picker to reset altitudes / angles to the type's defaults (preserves the scenario fields you've tuned).</p>
      <p>Profiles persist to localStorage (<Mono>dcsopt.kneeboard.popupAttacks</Mono>) so they survive page reloads + mission re-uploads. <Chip>Clear all</Chip> in the editor header wipes the library.</p>
      <SubHead>On the brief</SubHead>
      <p>Configured popup-attack profiles automatically add a <b>POPUP ATTACK</b> slide section to the auto-built wing brief AND to each player flight's individual brief — same row layout with the side-profile thumbnail at right.</p>
      <SubHead>Via brief tokens</SubHead>
      <p>Custom template users can reference <Mono>{'{{popup_attacks.list}}'}</Mono>, <Mono>{'{{popup_attacks.count}}'}</Mono>, or per-profile <Mono>{'{{popup_attack[0].summary}}'}</Mono> / <Mono>{'.name'}</Mono> / <Mono>{'.type'}</Mono> / <Mono>{'.tgt_elev'}</Mono> / and 11 more fields.</p>
    </>
  ) },

  // ───────── BRIEF ─────────
  { id: 'brief-overview', title: 'Brief Generator', group: 'BRIEF', body: () => (
    <>
      <p>Two flows feed one PowerPoint:</p>
      <SubHead>1. Auto wing brief</SubHead>
      <p>Editor → Brief → <Chip>Build from mission</Chip>. Backend assembles a 10–11-slide deck using the dark built-in template:</p>
      <Steps items={[
        <>Cover (mission name, theatre, date, time)</>,
        <>Theatre overview (per-theatre blurb, editable)</>,
        <>Scenario (mission description + blue/red task)</>,
        <>Commander's intent</>,
        <>Route overview map (client-rendered with all tracks + threats)</>,
        <>Threats (paginated; AI prose paragraph available with BYOK key)</>,
        <>Air threats (per-airframe class + WEZ + how to fight)</>,
        <>Force composition (player flights table)</>,
        <>Comms (key/value list — GCI / tankers / divert)</>,
        <>Mission flow (high-level launch → push → action → egress)</>,
        <>Timeline (TimelineRow table)</>,
        <>Notes (special instructions)</>,
        <>Popup Attack — auto-added when profiles are defined</>,
      ]} />

      <SubHead>2. Custom .pptx template</SubHead>
      <p>Editor → Brief → upload your squadron template. Backend scans for <Mono>{'{{token.path}}'}</Mono> placeholders. The token resolution table covers ~80 paths: mission / weather / SOP / DMPIs / goals / per-flight (callsign / aircraft / freq / TACAN / ICLS / coalition / country) / popup-attacks.</p>
      <p>The token UI shows: token name | auto-resolved value | your override | a "use auto" toggle. Untoggled rows render as the literal <Mono>{'{{token}}'}</Mono> in the output so you can spot anything that didn't fill.</p>

      <SubHead>Outputs</SubHead>
      <p>Native <Chip>PPTX</Chip>; <Chip>PDF</Chip> + per-slide <Chip>PNG ZIP</Chip> / <Chip>JPG ZIP</Chip> via the server's LibreOffice rasteriser.</p>

      <SubHead>Per-flight package</SubHead>
      <p>"Build full package" generates the wing brief + one per-flight brief per player flight (5 slides each: Cover, Flight & Comms, Weather/Fuel, Route Detail, Notes; + popup-attack appendix when profiles exist). Bundled as a single .pptx for handout-style distribution.</p>
    </>
  ) },
  { id: 'brief-ai', title: 'AI Brief Enhancements', group: 'BRIEF', body: () => (
    <>
      <p>Optional BYOK Anthropic API key (set in Tools → AI Settings) unlocks:</p>
      <Table headers={['Feature', 'What it does']} rows={[
        ["Commander's intent", "Generates full prose Purpose / Method / End State paragraphs from the scenario + threats + flights."],
        ['Threat narrative', "2–4 sentence prose paragraph above the surface-threats table."],
        ['Mission flow', "High-level launch → push → action → egress rewrite tailored to mission type."],
        ['Speaker notes', "Per-slide notes the presenter reads when running the brief."],
        ['Token auto-mapping', 'For custom templates: AI guesses which mission field maps to an unrecognised token.'],
      ]} />
      <p>Every AI feature has a graceful non-AI fallback — users without a key still get a working brief.</p>
      <Callout title="BYOK privacy">
        The key sits in your browser's localStorage only. AI calls go browser → Anthropic directly (Anthropic-Dangerous-Direct-Browser-Access header). Railway never sees the key. Your bill, your usage.
      </Callout>
    </>
  ) },

  // ───────── SUITE ─────────
  { id: 'suite', title: 'DCS:OPT Suite', group: 'SUITE', body: () => (
    <>
      <p>Three sibling apps wired together:</p>
      <Table headers={['Tool', 'What it does', 'Status']} rows={[
        ['📋 Mizmaker (this tool)', 'Mission planner — editor / plan / live', 'Live'],
        ['🤖 Ops Bot', 'Mee6-style Discord bot for squadron utilities, brief drops, mission distribution.', 'Live'],
        ['🏠 Ready Room', 'Squadron / pilot identity bridge linking Discord ↔ DCS pilot name ↔ mission slots.', 'Live'],
      ]} />
      <p>Tile links on the landing page open each tool in a new tab. They share Discord login identity when you're logged in.</p>
    </>
  ) },

  // ───────── PRIVACY ─────────
  { id: 'privacy', title: 'Storage & Privacy', group: 'PRIVACY', body: () => (
    <>
      <SubHead>Where things live</SubHead>
      <Table headers={['Data', 'Where', 'Lifetime']} rows={[
        ['Uploaded .miz', 'Server RAM only (in-memory session)', '2 hr TTL or until you upload again'],
        ['Edits queue', 'Server session', 'Same — never persists to disk'],
        ['Discord identity', "Signed cookie + Supabase 'users' table (id / username / avatar / last login)", 'Until you log out / clear cookies'],
        ['Live groups + members + profiles', 'Supabase', 'Until you delete them'],
        ['Olympus passwords', 'Supabase (encrypted Fernet)', 'Until you delete the profile'],
        ['Popup attack profiles', 'Browser localStorage', "Until you Clear or delete the key"],
        ['Kneeboard cards / brief output', 'Streamed as files; never stored', '—'],
        ['BYOK Anthropic key', 'Browser localStorage', "Until you clear it"],
        ['Scope state (rings / markers / BE / panels)', 'Browser localStorage', "Persistent across reloads"],
      ]} />
      <SubHead>What we never store</SubHead>
      <ul style={{ marginLeft: 18 }}>
        <li>Your .miz files — they live in RAM only.</li>
        <li>Your AI provider key — browser-only, calls go direct.</li>
        <li>Your email / guild membership — Discord login is identify-scope only.</li>
      </ul>
    </>
  ) },

  // ───────── TROUBLESHOOTING ─────────
  { id: 'troubleshoot', title: 'Common Issues', group: 'TROUBLESHOOTING', body: () => (
    <>
      <Table headers={['Problem', 'Likely cause', 'Fix']} rows={[
        ['"Session not found or expired"', '2 hr TTL hit, or backend restarted', 'Re-upload the .miz. Live URL keeps working.'],
        ['Live: no telemetry / not connecting', 'Olympus host unreachable from Railway', "Confirm the host is publicly reachable; check port; verify the password (icon turns green when set)."],
        ['Live: connected but no units moving', "Olympus is up but mission isn't running, or feed is empty", 'Start the mission in DCS. The bottom status pill turns green when units arrive.'],
        ['"command" route returns 403', "Your group role doesn't include `command` cap", 'Admin can promote via Members tab → Edit role.'],
        ['SRS Directory shows freqs but no "● N on" pills', "SRS_SERVER_URL env var not set", "Set it on Railway (point at SRS-Server's Web Stats page)."],
        ['Edits not applying to the .miz on download', 'Surgical search window too small for a complex mission', 'Re-upload and try again; report the mission so the search window can be widened.'],
        ['Bullseye not auto-loading', "Mission has no `coalition.blue.bullseye`", "Drop one manually via 🎯; it will persist."],
        ['Popup-attack profiles disappeared', 'Browser cleared localStorage', 'Profiles need to be re-added; no server backup.'],
        ['Custom template render: token not filling', "Token isn't in our 80-token catalogue", 'Open the Edits tab → see exactly which tokens scanned + were not resolved; override via the UI.'],
        ['Brief preview requires LibreOffice error', "LibreOffice missing on the server", 'Production has it (Dockerfile). Local dev needs LibreOffice + soffice on PATH.'],
        ['Page loads slowly after deploy', 'Browser caching old bundle', "Hard reload (Ctrl+Shift+R). The version chip in the header confirms the live version."],
      ]} />
    </>
  ) },
  { id: 'env-vars', title: 'Environment Variables', group: 'TROUBLESHOOTING', body: () => (
    <>
      <p>Set in Railway → Variables tab. Most are optional — the tool degrades gracefully when they're missing.</p>
      <Table headers={['Var', 'Purpose', 'What happens when unset']} rows={[
        ['DISCORD_CLIENT_ID / SECRET', "OAuth identify-scope login", 'Discord button bounces back to landing with an error; guest mode still works.'],
        ['DISCORD_REDIRECT_URI', 'OAuth redirect target', 'Same — Discord login fails.'],
        ['APP_SECRET_KEY', "Signed cookie for login state", 'Sessions break / no login persists.'],
        ['SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', 'Live groups / members / profiles', 'Live mode shows "not configured"; Editor still works.'],
        ['PROFILE_ENC_KEY', "Encrypts Olympus passwords (Fernet)", 'Profile create returns 503 until set.'],
        ['SRS_SERVER_URL', 'Optional SRS-Server stats poll', "SRS Directory still works as static reference; pills hide."],
        ['DCS_UNIT_PHOTOS_BASE_URL', "Optional photos host for unit images in the Live spawn picker", "Spawn picker shows a placeholder icon."],
      ]} />
    </>
  ) },
];

// ---------------------------------------------------------------------------
// Reusable building blocks for sections.
// ---------------------------------------------------------------------------

function SubHead({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: '18px 0 6px', color: C.amber, fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' }}>{children}</h3>;
}

function Chip({ children }: { children: ReactNode }) {
  return <span style={{ display: 'inline-block', padding: '1px 6px', background: C.accentDim, border: `1px solid ${C.borderHi}`, borderRadius: 3, fontSize: 12, color: C.text, fontWeight: 600 }}>{children}</span>;
}

function Mono({ children }: { children: ReactNode }) {
  return <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 2, fontSize: 12, color: C.amber, fontFamily: 'ui-monospace, monospace' }}>{children}</code>;
}

function Callout({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ margin: '12px 0', padding: '8px 12px', background: 'rgba(74,158,255,0.06)', border: `1px solid ${C.borderHi}`, borderLeftWidth: 3, borderRadius: 3 }}>
      {title && <div style={{ color: C.accent, fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>}
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol style={{ margin: '8px 0 12px 22px', padding: 0, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
    </ol>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div style={{ margin: '10px 0', border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'rgba(74,158,255,0.10)' }}>
            {headers.map((h) => <th key={h} style={{ textAlign: 'left', padding: '5px 9px', color: C.accent, fontWeight: 700, letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
              {row.map((cell, j) => <td key={j} style={{ padding: '5px 9px', color: j === 0 ? C.text : C.textDim, verticalAlign: 'top' }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown serialiser — flat dump for offline download.
// ---------------------------------------------------------------------------

function buildMarkdown(): string {
  const lines: string[] = [];
  lines.push(`# DCS:OPT — User Guide`);
  lines.push('');
  lines.push(`*Version ${VERSION} · live at https://dcsopt.up.railway.app*`);
  lines.push('');
  lines.push('---');
  lines.push('');
  // Walk every section and serialise the JSX-rendered content best-effort.
  // We can't render React→string here without a heavy lib, so this is a
  // hand-curated mirror of each section's gist — kept in sync with the
  // titles + groups so the .md acts as a navigable companion.
  let currentGroup = '';
  for (const s of SECTIONS) {
    if (s.group !== currentGroup) {
      currentGroup = s.group;
      lines.push(`## ${currentGroup}`);
      lines.push('');
    }
    lines.push(`### ${s.title}`);
    lines.push('');
    lines.push(`See the in-app guide for full content (interactive tables, tool chips, walkthroughs). Open https://dcsopt.up.railway.app/?guide=1#${s.id} for the rendered version.`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main panel.
// ---------------------------------------------------------------------------

export function GuidePanel({ onClose }: { onClose: () => void }) {
  // Section selection. Default from URL hash (e.g. `#live-overview`) if it
  // matches a known id, else the welcome section.
  const initial = (() => {
    const hash = window.location.hash.replace(/^#/, '');
    return SECTIONS.find((s) => s.id === hash)?.id ?? SECTIONS[0].id;
  })();
  const [activeId, setActiveId] = useState(initial);
  const active = useMemo(() => SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0], [activeId]);

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Sync URL hash for shareability without polluting history.
  useEffect(() => {
    const u = new URL(window.location.href);
    u.hash = activeId;
    window.history.replaceState({}, '', u.toString());
  }, [activeId]);

  const download = () => {
    const md = buildMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dcsopt-guide-${VERSION}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Group sections for the sidebar.
  const groups = useMemo(() => {
    const out: { name: string; items: Section[] }[] = [];
    for (const s of SECTIONS) {
      const last = out[out.length - 1];
      if (last && last.name === s.group) last.items.push(s);
      else out.push({ name: s.group, items: [s] });
    }
    return out;
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: 48, padding: '0 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 16, background: C.bgPanel }}>
        <div style={{ fontWeight: 800, letterSpacing: 1, fontSize: 14, color: C.accent }}>DCS:OPT</div>
        <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 1 }}>USER GUIDE</div>
        <div style={{ fontSize: 11, color: C.textDim, marginLeft: 'auto' }}>{VERSION}</div>
        <button onClick={download} style={btnStyle()} title="Download as Markdown">
          Download .md
        </button>
        <button onClick={() => window.print()} style={btnStyle()} title="Print or save as PDF">
          Print
        </button>
        <button onClick={onClose} style={{ ...btnStyle(), borderColor: C.red, color: C.red }}>
          Close (Esc)
        </button>
      </div>
      {/* Body — sidebar + content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Sidebar */}
        <div style={{ width: 260, background: C.bgPanel, borderRight: `1px solid ${C.border}`, overflowY: 'auto', padding: '12px 0' }}>
          {groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 12 }}>
              <div style={{ padding: '4px 16px', fontSize: 10, letterSpacing: 1.5, color: C.textDim, fontWeight: 700 }}>{g.name}</div>
              {g.items.map((s) => {
                const on = s.id === activeId;
                return (
                  <div key={s.id} onClick={() => setActiveId(s.id)}
                       style={{ padding: '5px 16px', cursor: 'pointer', fontSize: 13, color: on ? C.accent : C.text, background: on ? C.bgHover : 'transparent', borderLeft: `3px solid ${on ? C.accent : 'transparent'}`, fontWeight: on ? 600 : 400 }}>
                    {s.title}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 40px', maxWidth: 920 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.textDim, marginBottom: 4 }}>{active.group}</div>
          <h2 style={{ margin: '0 0 14px', fontSize: 22, color: C.text }}>{active.title}</h2>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65 }}>{active.body()}</div>
          {/* Prev / Next nav */}
          <PrevNext sections={SECTIONS} activeId={activeId} onPick={setActiveId} />
        </div>
      </div>
    </div>
  );
}

function PrevNext({ sections, activeId, onPick }: { sections: Section[]; activeId: string; onPick: (id: string) => void }) {
  const idx = sections.findIndex((s) => s.id === activeId);
  const prev = idx > 0 ? sections[idx - 1] : null;
  const next = idx < sections.length - 1 ? sections[idx + 1] : null;
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 30, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
      <button onClick={() => prev && onPick(prev.id)} disabled={!prev} style={{ ...btnStyle(), opacity: prev ? 1 : 0.4, flex: 1, textAlign: 'left' }}>
        {prev ? <>← <span style={{ color: C.textDim }}>{prev.group}</span> · {prev.title}</> : 'Start of guide'}
      </button>
      <button onClick={() => next && onPick(next.id)} disabled={!next} style={{ ...btnStyle(), opacity: next ? 1 : 0.4, flex: 1, textAlign: 'right' }}>
        {next ? <><span style={{ color: C.textDim }}>{next.group}</span> · {next.title} →</> : 'End of guide'}
      </button>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    background: 'transparent', border: `1px solid ${C.border}`, color: C.text,
    padding: '5px 11px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
    fontFamily: 'inherit', letterSpacing: 0.5,
  };
}
