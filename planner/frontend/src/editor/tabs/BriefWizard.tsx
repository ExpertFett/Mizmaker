/**
 * BriefWizard — a guided, step-by-step front end over the Brief Generator.
 *
 * The full BriefGenTab editor exposes ~15 option cards at once, which new
 * users find intimidating. This wizard sequences the same engine into five
 * plain steps — Build → Look → Content → Deliverable → Generate — calling the
 * parent's existing handlers and driving the parent's own state (theme,
 * format, slide visibility, preview). It adds no new backend surface; it is
 * purely a friendlier path to the same download. Power users switch to the
 * advanced editor at any time via the top-right link. (v1.19.148)
 */
import { useEffect, useRef, useState } from 'react';

export interface BriefWizardProps {
  hasSession: boolean;
  brief: { mission_name?: string; theater?: string; threats?: unknown[]; air_threats?: unknown[]; flights?: unknown[] } | null;
  building: boolean;
  rendering: boolean;
  error: string | null;
  // theme
  theme: string;
  setTheme: (id: string) => void;
  themes: Array<{ id: string; name: string; description: string; dark: boolean }>;
  // format
  format: string;
  setFormat: (f: string) => void;
  availableFormats: string[];
  formatLabel: Record<string, string>;
  // slide visibility
  slideSections: { id: string; label: string }[];
  slidesOff: Set<string>;
  setSlidesOff: (s: Set<string>) => void;
  // actions (parent handlers)
  onBuild: () => void;
  onRenderWing: () => void;
  onRenderPackage: () => void;
  onPkt: () => void;
  onPreview: () => void;
  // preview state (parent-owned)
  previewOpen: boolean;
  previewSlides: string[];
  previewIdx: number;
  setPreviewIdx: (updater: number | ((i: number) => number)) => void;
  previewLoading: boolean;
  setPreviewOpen: (b: boolean) => void;
  // escape hatch
  onAdvanced: () => void;
}

type Deliverable = 'wing' | 'package' | 'pkt';

const STEPS = [
  { key: 'build', label: 'Mission' },
  { key: 'look', label: 'Design' },
  { key: 'content', label: 'Content' },
  { key: 'deliver', label: 'Output' },
  { key: 'generate', label: 'Generate' },
] as const;

// Cosmetic accent per theme id for the picker swatches only — the real deck
// uses the backend palette. Falls back to amber for unknown ids.
const THEME_ACCENT: Record<string, string> = {
  vanguard: '#e8a13a', classic: '#4a8fd4', blueprint: '#5b9bd5', dossier: '#8a1220',
  sentinel: '#3fb950', nighthawk: '#8f6ad6', carbon: '#c8c8c8', topographic: '#c9822f',
  aggressor: '#e5b800', coyote: '#c8a165', editorial: '#d0402a', chartroom: '#2f7fb5',
  terminal: '#33ff66', swiss: '#e2231a', whiteout: '#3a7fb0',
};

const AMBER = '#fbb941';
const BORDER = '#3a3a3a';

export function BriefWizard(p: BriefWizardProps) {
  const [step, setStep] = useState(0);
  const [deliverable, setDeliverable] = useState<Deliverable>('wing');
  const built = !!p.brief;
  const prevBuilt = useRef(built);

  // Auto-advance to the Design step the moment a fresh build lands, so the
  // build click flows straight into choosing a look.
  useEffect(() => {
    if (built && !prevBuilt.current && step === 0) setStep(1);
    prevBuilt.current = built;
  }, [built, step]);

  const canNext = step === 0 ? built : true;
  const go = (n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n)));

  const toggleSection = (id: string) => {
    const next = new Set(p.slidesOff);
    if (next.has(id)) next.delete(id); else next.add(id);
    p.setSlidesOff(next);
  };

  const onCount = p.slideSections.filter((s) => !p.slidesOff.has(s.id)).length;
  const pkgFormatOk = p.format === 'pptx' || p.format === 'pdf';

  return (
    <div style={{ padding: 20, color: '#e0e0e0', overflow: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Brief Generator</h2>
        <span style={{ fontSize: 12, color: '#777' }}>Guided</span>
        <span style={{ flex: 1 }} />
        <button onClick={p.onAdvanced} style={linkBtn}
          title="Show every option at once (the full editor)">
          Advanced editor →
        </button>
      </div>
      <p style={{ fontSize: 13, color: '#aaa', margin: '0 0 18px' }}>
        Five quick steps to a finished briefing. You can jump into the advanced
        editor any time to fine-tune wording.
      </p>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => {
          const done = i < step;
          const cur = i === step;
          const reachable = i === 0 || built;
          return (
            <button
              key={s.key}
              onClick={() => reachable && go(i)}
              disabled={!reachable}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: cur ? '#2a2a2a' : 'transparent',
                border: `1px solid ${cur ? AMBER : BORDER}`,
                color: cur ? AMBER : done ? '#ccc' : reachable ? '#999' : '#555',
                padding: '6px 12px', borderRadius: 20, fontSize: 12,
                cursor: reachable ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
                background: cur ? AMBER : done ? '#3fb950' : '#333',
                color: cur ? '#1a1a1a' : done ? '#0f0f0f' : '#999',
              }}>{done ? '✓' : i + 1}</span>
              {s.label}
            </button>
          );
        })}
      </div>

      {p.error && (
        <div style={{
          border: '1px solid #5a3a3a', background: '#2a1c1c', color: '#e88',
          padding: '10px 14px', borderRadius: 4, marginBottom: 16, fontSize: 13,
        }}>{p.error}</div>
      )}

      {/* ── Step 0: Build ─────────────────────────────────────────────── */}
      {step === 0 && (
        <Panel>
          {!built ? (
            <div style={{ textAlign: 'center', padding: '18px 10px' }}>
              <div style={{ fontSize: 15, marginBottom: 8 }}>
                {p.hasSession
                  ? 'Read the loaded mission and pull out flights, threats, comms, and the theatre.'
                  : 'Load a mission first, then start here.'}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 18 }}>
                Nothing is downloaded yet — this just gathers the raw material for your brief.
              </div>
              <button
                onClick={p.onBuild}
                disabled={!p.hasSession || p.building}
                style={{ ...bigPrimary, opacity: !p.hasSession || p.building ? 0.5 : 1,
                         cursor: !p.hasSession || p.building ? 'not-allowed' : 'pointer' }}
              >
                {p.building ? 'Reading mission…' : 'Analyze mission'}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 20 }}>✅</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {p.brief?.mission_name || 'Mission'} is ready to brief.
                  </div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    Here's what we found. Continue to choose a design.
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <Stat label="Theatre" value={p.brief?.theater || '—'} />
                <Stat label="Blue flights" value={String(p.brief?.flights?.length ?? 0)} />
                <Stat label="Surface threats" value={String(p.brief?.threats?.length ?? 0)} />
                <Stat label="Air threats" value={String(p.brief?.air_threats?.length ?? 0)} />
              </div>
              <button onClick={p.onBuild} disabled={p.building} style={{ ...miniBtn, marginTop: 8 }}>
                {p.building ? 'Rebuilding…' : '↻ Re-read mission'}
              </button>
            </div>
          )}
        </Panel>
      )}

      {/* ── Step 1: Design (theme) ────────────────────────────────────── */}
      {step === 1 && (
        <Panel>
          <StepTitle title="Choose a design"
            hint="Every deck holds the same info — this only changes the look. Vanguard (satellite maps) is our default." />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            {(p.themes.length ? p.themes : [{ id: 'vanguard', name: 'Vanguard', description: 'Satellite imagery', dark: true }])
              .map((t) => {
                const sel = p.theme === t.id;
                const accent = THEME_ACCENT[t.id] || AMBER;
                return (
                  <button
                    key={t.id}
                    onClick={() => p.setTheme(t.id)}
                    style={{
                      textAlign: 'left', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                      background: '#1e1e1e', overflow: 'hidden',
                      border: `2px solid ${sel ? AMBER : BORDER}`, borderRadius: 6,
                      boxShadow: sel ? `0 0 0 1px ${AMBER}` : 'none',
                    }}
                  >
                    <ThemeSwatch dark={t.dark} accent={accent} />
                    <div style={{ padding: '8px 10px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: sel ? AMBER : '#e0e0e0' }}>{t.name}</span>
                        {t.id === 'vanguard' && (
                          <span style={badge}>Default</span>
                        )}
                        {sel && <span style={{ marginLeft: 'auto', color: AMBER, fontSize: 13 }}>✓</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 3, lineHeight: 1.35, minHeight: 30 }}>
                        {t.description || (t.dark ? 'Dark theme' : 'Light theme')}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </Panel>
      )}

      {/* ── Step 2: Content (slide visibility) ────────────────────────── */}
      {step === 2 && (
        <Panel>
          <StepTitle title="What goes in the brief"
            hint={`Toggle sections off to leave them out. ${onCount} of ${p.slideSections.length} on. Edit the actual wording in the advanced editor.`} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.slideSections.map((s) => {
              const on = !p.slidesOff.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSection(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: on ? '#243024' : '#232323',
                    border: `1px solid ${on ? '#3f7d4a' : BORDER}`,
                    color: on ? '#dfe' : '#888',
                    padding: '7px 12px', borderRadius: 4, fontSize: 12.5,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: 15, height: 15, borderRadius: 3, fontSize: 11,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: on ? '#3fb950' : '#333', color: on ? '#0f0f0f' : '#666',
                  }}>{on ? '✓' : ''}</span>
                  {s.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button onClick={() => p.setSlidesOff(new Set())} style={miniBtn}>All on</button>
          </div>
        </Panel>
      )}

      {/* ── Step 3: Deliverable + format ──────────────────────────────── */}
      {step === 3 && (
        <Panel>
          <StepTitle title="What do you need" hint="Pick one deliverable. You can run the wizard again for another." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <DeliverCard
              sel={deliverable === 'wing'} onClick={() => setDeliverable('wing')}
              title="Wing brief" icon="🗂️"
              desc="One slide deck covering the whole package — theatre, threats, forces, timeline." />
            <DeliverCard
              sel={deliverable === 'package'} onClick={() => setDeliverable('package')}
              title="Full package" icon="📦"
              desc="The wing brief plus one deck per blue flight, zipped together." />
            <DeliverCard
              sel={deliverable === 'pkt'} onClick={() => setDeliverable('pkt')}
              title="Intel packet (PKT)" icon="🔎"
              desc="Standalone intel doc: friendly OOB, A/A threat grid, and recognition cards with how-to-fight." />
          </div>

          {deliverable !== 'pkt' ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>File format</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['pptx', 'pdf', 'png', 'jpg'].map((f) => {
                  const avail = p.availableFormats.includes(f);
                  const pkgBlock = deliverable === 'package' && f !== 'pptx' && f !== 'pdf';
                  const disabled = !avail || pkgBlock;
                  const sel = p.format === f;
                  return (
                    <button
                      key={f}
                      onClick={() => !disabled && p.setFormat(f)}
                      disabled={disabled}
                      title={!avail ? 'Requires LibreOffice on the server' : pkgBlock ? 'Package export is PowerPoint or PDF only' : ''}
                      style={{
                        background: sel ? '#2a2a2a' : 'transparent',
                        border: `1px solid ${sel ? AMBER : BORDER}`,
                        color: disabled ? '#555' : sel ? AMBER : '#ccc',
                        padding: '7px 14px', borderRadius: 4, fontSize: 12.5,
                        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {(p.formatLabel[f] || f).replace(/ \(.*\)/, '')}
                    </button>
                  );
                })}
              </div>
              {deliverable === 'package' && !pkgFormatOk && (
                <div style={{ fontSize: 11, color: AMBER, marginTop: 8 }}>
                  Package export is PowerPoint or PDF only — switch format above.
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#888', marginTop: 14 }}>
              The intel packet always exports as PowerPoint (.pptx).
            </div>
          )}
        </Panel>
      )}

      {/* ── Step 4: Generate ──────────────────────────────────────────── */}
      {step === 4 && (
        <Panel>
          <StepTitle title="Generate & download"
            hint="Here's your brief. Preview it, then download — or step back to change anything." />
          <div style={{
            display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#aaa',
            padding: '10px 14px', background: '#1d1d1d', border: `1px solid ${BORDER}`,
            borderRadius: 4, marginBottom: 16,
          }}>
            <span>Design: <b style={{ color: '#ccc' }}>{p.themes.find((t) => t.id === p.theme)?.name || p.theme}</b></span>
            <span>Sections: <b style={{ color: '#ccc' }}>{onCount}/{p.slideSections.length}</b></span>
            <span>Deliverable: <b style={{ color: '#ccc' }}>{
              deliverable === 'wing' ? 'Wing brief' : deliverable === 'package' ? 'Full package' : 'Intel packet'
            }</b></span>
            {deliverable !== 'pkt' && <span>Format: <b style={{ color: '#ccc' }}>{(p.format || 'pptx').toUpperCase()}</b></span>}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {deliverable === 'wing' && (
              <button onClick={p.onPreview} disabled={p.previewLoading}
                style={{ ...secondaryBtn, borderColor: p.previewOpen ? AMBER : '#4a4a4a', color: p.previewOpen ? AMBER : '#ccc' }}>
                {p.previewLoading ? 'Rendering…' : p.previewOpen ? '↻ Refresh preview' : '👁 Preview'}
              </button>
            )}
            <button
              onClick={
                deliverable === 'wing' ? p.onRenderWing
                : deliverable === 'package' ? p.onRenderPackage
                : p.onPkt
              }
              disabled={p.rendering || (deliverable === 'package' && !pkgFormatOk)}
              style={{ ...bigPrimary, opacity: p.rendering || (deliverable === 'package' && !pkgFormatOk) ? 0.5 : 1 }}
            >
              {p.rendering ? 'Rendering…'
                : deliverable === 'wing' ? '⬇ Download wing brief'
                : deliverable === 'package' ? '⬇ Download package (.zip)'
                : '⬇ Download intel packet'}
            </button>
            <span style={{ fontSize: 11, color: '#777' }}>Downloads to your browser — nothing is uploaded.</span>
          </div>

          {/* Inline preview (wing only) */}
          {deliverable === 'wing' && p.previewOpen && (
            <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#222' }}>
                <span style={{ fontSize: 12, color: '#ccc' }}>
                  Preview {p.previewSlides.length ? `${p.previewIdx + 1} / ${p.previewSlides.length}` : ''}
                </span>
                {p.previewLoading && <span style={{ fontSize: 11, color: AMBER }}>● updating…</span>}
                <span style={{ flex: 1 }} />
                <button onClick={() => p.setPreviewIdx((i) => Math.max(0, i - 1))}
                  disabled={p.previewIdx === 0 || p.previewLoading} style={{ ...miniBtn, opacity: p.previewIdx === 0 ? 0.4 : 1 }}>‹ Prev</button>
                <button onClick={() => p.setPreviewIdx((i) => Math.min(p.previewSlides.length - 1, i + 1))}
                  disabled={p.previewIdx >= p.previewSlides.length - 1 || p.previewLoading}
                  style={{ ...miniBtn, opacity: p.previewIdx >= p.previewSlides.length - 1 ? 0.4 : 1 }}>Next ›</button>
                <button onClick={() => p.setPreviewOpen(false)} style={miniBtn}>Close</button>
              </div>
              <div style={{ padding: 12, display: 'flex', justifyContent: 'center', background: '#0f0f0f', minHeight: 360 }}>
                {p.previewLoading && p.previewSlides.length === 0 ? (
                  <div style={{ color: '#aaa', fontSize: 14, padding: 60 }}>Rendering brief… (~5s)</div>
                ) : p.previewSlides[p.previewIdx] ? (
                  <img
                    src={`data:image/png;base64,${p.previewSlides[p.previewIdx]}`}
                    alt={`slide ${p.previewIdx + 1}`}
                    onClick={() => p.setPreviewIdx((i) => (i + 1 < p.previewSlides.length ? i + 1 : 0))}
                    style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain', boxShadow: '0 0 0 1px #3a3a3a', display: 'block', cursor: 'pointer' }}
                  />
                ) : (
                  <div style={{ color: '#888', fontSize: 13, padding: 60 }}>No preview yet.</div>
                )}
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ── Footer nav ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginTop: 22, alignItems: 'center' }}>
        <button onClick={() => go(step - 1)} disabled={step === 0} style={{ ...secondaryBtn, opacity: step === 0 ? 0.4 : 1 }}>
          ‹ Back
        </button>
        <span style={{ flex: 1 }} />
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => go(step + 1)}
            disabled={!canNext}
            style={{ ...bigPrimary, opacity: canNext ? 1 : 0.5, cursor: canNext ? 'pointer' : 'not-allowed' }}
            title={!canNext ? 'Analyze the mission first' : ''}
          >
            Next ›
          </button>
        ) : (
          <span style={{ fontSize: 11, color: '#777' }}>Change anything with Back, or open the Advanced editor.</span>
        )}
      </div>
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────── */

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, background: '#202020', borderRadius: 6, padding: '18px 20px' }}>
      {children}
    </div>
  );
}

function StepTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e8e8e8' }}>{title}</div>
      <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>{hint}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#1a1a1a', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '8px 14px', minWidth: 90 }}>
      <div style={{ fontSize: 10, color: '#777', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function DeliverCard({ sel, onClick, title, icon, desc }: { sel: boolean; onClick: () => void; title: string; icon: string; desc: string }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      background: sel ? '#2a2a2a' : '#1c1c1c',
      border: `2px solid ${sel ? AMBER : BORDER}`, borderRadius: 6, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: sel ? AMBER : '#e0e0e0' }}>{title}</span>
        {sel && <span style={{ marginLeft: 'auto', color: AMBER }}>✓</span>}
      </div>
      <div style={{ fontSize: 11.5, color: '#999', lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}

/** Tiny faux-slide swatch so the theme gallery reads at a glance. Cosmetic. */
function ThemeSwatch({ dark, accent }: { dark: boolean; accent: string }) {
  const bg = dark ? '#181818' : '#ece9e2';
  const line = dark ? '#3a3a3a' : '#cfcabd';
  return (
    <div style={{ height: 70, background: bg, padding: 10, position: 'relative' }}>
      <div style={{ width: '55%', height: 8, background: accent, borderRadius: 2 }} />
      <div style={{ width: '80%', height: 5, background: line, borderRadius: 2, marginTop: 7 }} />
      <div style={{ width: '70%', height: 5, background: line, borderRadius: 2, marginTop: 5 }} />
      <div style={{ width: '40%', height: 5, background: line, borderRadius: 2, marginTop: 5 }} />
      <div style={{ position: 'absolute', right: 10, bottom: 8, width: 18, height: 18, borderRadius: 2, border: `1.5px solid ${accent}` }} />
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */
const bigPrimary: React.CSSProperties = {
  background: '#2a2a2a', border: `1px solid ${AMBER}`, color: AMBER,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 4,
};
const secondaryBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #4a4a4a', color: '#ccc',
  padding: '9px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 4,
};
const miniBtn: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #4a4a4a', color: '#ccc',
  padding: '4px 11px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 3,
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#4a8fd4', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
};
const badge: React.CSSProperties = {
  fontSize: 9, color: '#1a1a1a', background: AMBER, borderRadius: 3, padding: '1px 5px', fontWeight: 700, letterSpacing: 0.5,
};
