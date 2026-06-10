/**
 * SOP Tab — manage squadron Standard Operating Procedures.
 *
 * Features:
 *   - Library of saved SOPs (persisted to localStorage)
 *   - Upload JSON/YAML file or image (image parsing TBD via vision AI)
 *   - Pick active SOP — auto-assigns consult it in other tabs
 *   - Download sample/current SOP as JSON
 *   - View structured SOP contents
 */

import { useState, useRef, useCallback } from 'react';
import { useSopStore } from '../../sop/sopStore';
import { makeSampleSop, makeStarterSop, type StarterKind } from '../../sop/sopSamples';
import { makeId, type SOP } from '../../sop/types';
import { importOzpAsSop } from '../../sop/ozpImport';
import { useAiStore } from '../../ai/aiStore';
import { extractSopFromImages, mergePartialIntoSop } from '../../ai/sopExtractor';
import { AiSettingsPanel } from '../../panels/AiSettingsPanel';

export function SopTab() {
  const sops = useSopStore((s) => s.sops);
  const activeId = useSopStore((s) => s.activeId);
  const addSop = useSopStore((s) => s.addSop);
  const deleteSop = useSopStore((s) => s.deleteSop);
  const setActive = useSopStore((s) => s.setActive);
  const updateSop = useSopStore((s) => s.updateSop);
  const clearAll = useSopStore((s) => s.clearAll);
  const aiProvider = useAiStore((s) => s.provider);
  const aiKey = useAiStore((s) =>
    s.provider === 'anthropic' ? s.anthropicKey : s.geminiKey,
  );
  const aiModel = useAiStore((s) =>
    s.provider === 'anthropic' ? s.anthropicModel : s.geminiModel,
  );

  const [aiOpen, setAiOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  /** Per-image progress when looping over multi-image SOPs.
   *  null = not extracting; { current, total } during the loop. */
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(activeId);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const ozpInputRef = useRef<HTMLInputElement>(null);

  const selected = sops.find((s) => s.id === selectedId) || null;
  const active = sops.find((s) => s.id === activeId) || null;

  const handleJsonUpload = useCallback(async (file: File) => {
    setImportError(null);
    setImportInfo(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Minimum shape check
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.flights)) {
        throw new Error('Invalid SOP file — missing "flights" array');
      }
      // Assign a fresh id to avoid collisions with library
      const sop: SOP = {
        ...parsed,
        id: makeId(),
        updatedAt: Date.now(),
      };
      addSop(sop);
      setSelectedId(sop.id);
      setImportInfo(`Imported "${sop.name}"`);
    } catch (err) {
      setImportError(`Failed to import: ${(err as Error).message}`);
    }
  }, [addSop]);

  const handleOzpUpload = useCallback(async (file: File) => {
    setImportError(null);
    setImportInfo(null);
    try {
      const result = await importOzpAsSop(file);
      if (result.imageCount === 0) {
        throw new Error('No kneeboard images found in archive');
      }
      addSop(result.sop);
      setSelectedId(result.sop.id);
      setImportInfo(
        `Imported "${result.sop.name}" — ${result.imageCount} kneeboard images across ${result.aircraftCount} airframes. ` +
        `Edit the SOP to fill in callsigns, comms, TACAN, and laser codes based on the attached charts.`,
      );
    } catch (err) {
      setImportError(`Failed to import OZP: ${(err as Error).message}`);
    }
  }, [addSop]);

  // Read a File into a base64 SopAttachment.
  const readFileAsAttachment = useCallback(
    (file: File): Promise<import('../../sop/types').SopAttachment> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1] || '';
          resolve({
            name: file.name,
            mimeType: file.type || 'image/*',
            dataBase64: base64,
          });
        };
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
      });
    },
    [],
  );

  /** Upload one or more images as a NEW SOP. All images land in
   *  attachments[] (plural). One image still gets a sensible name. */
  const handleImageUpload = useCallback(async (files: File[]) => {
    setImportError(null);
    setImportInfo(null);
    if (files.length === 0) return;
    try {
      const attachments = await Promise.all(files.map(readFileAsAttachment));
      const namePart = files.length === 1
        ? files[0].name
        : `${files.length} images`;
      const sop: SOP = {
        id: makeId(),
        name: `SOP from image: ${namePart}`,
        updatedAt: Date.now(),
        flights: [],
        comms: [],
        tacans: [],
        attachments,
      };
      addSop(sop);
      setSelectedId(sop.id);
      setImportInfo(
        files.length === 1
          ? `Image stored on new SOP "${sop.name}". Auto-extraction from images requires the vision AI backend — edit fields manually for now.`
          : `${files.length} images stored on new SOP "${sop.name}". Use the side-by-side view to read off them while filling in the form.`,
      );
    } catch (err) {
      setImportError(`Failed to import: ${(err as Error).message}`);
    }
  }, [addSop, readFileAsAttachment]);

  /** Append images to the currently SELECTED SOP rather than creating
   *  a new one. The natural follow-up when you've already imported one
   *  image and realize you have a second/third reference card. */
  const handleAddImagesToSelected = useCallback(async (files: File[]) => {
    setImportError(null);
    setImportInfo(null);
    if (files.length === 0 || !selectedId) return;
    const target = sops.find((s) => s.id === selectedId);
    if (!target) return;
    try {
      const newAttachments = await Promise.all(files.map(readFileAsAttachment));
      // Migrate legacy `attachment` (singular) into `attachments[]` so the
      // SOP only carries one shape going forward.
      const existing = target.attachments
        ? [...target.attachments]
        : target.attachment
          ? [target.attachment]
          : [];
      updateSop({
        ...target,
        attachment: undefined,
        attachments: [...existing, ...newAttachments],
      });
      setImportInfo(
        `Added ${files.length} image${files.length !== 1 ? 's' : ''} to "${target.name}".`,
      );
    } catch (err) {
      setImportError(`Failed to add: ${(err as Error).message}`);
    }
  }, [selectedId, sops, updateSop, readFileAsAttachment]);

  const handleDrop = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    // Mixed-type drops: route each file to its handler. Common case is
    // dragging multiple kneeboard PNGs at once — those all go to the
    // same SOP via handleImageUpload (or appended to selected, if one
    // is already selected).
    const ozps = arr.filter((f) => /\.(ozp|zip)$/i.test(f.name));
    const images = arr.filter((f) =>
      f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|pdf)$/i.test(f.name),
    );
    const jsons = arr.filter((f) => !ozps.includes(f) && !images.includes(f));

    // OZPs always create a new SOP each (they're full bundles)
    for (const f of ozps) handleOzpUpload(f);

    if (images.length > 0) {
      // If an SOP is already selected and the user is just dropping more
      // reference images, append them. Otherwise create a new SOP.
      if (selectedId) {
        handleAddImagesToSelected(images);
      } else {
        handleImageUpload(images);
      }
    }

    for (const f of jsons) handleJsonUpload(f);
  }, [handleJsonUpload, handleImageUpload, handleOzpUpload, handleAddImagesToSelected, selectedId]);

  const downloadJson = useCallback((sop: SOP, filename?: string) => {
    const blob = new Blob([JSON.stringify(sop, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${sop.name.replace(/[^\w\d-]+/g, '_')}.sop.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleInstallSample = useCallback(() => {
    const sample = makeSampleSop();
    addSop(sample);
    setSelectedId(sample.id);
    setImportInfo('Loaded sample SOP. Edit as needed, then set as active.');
  }, [addSop]);

  const handleStarter = useCallback((kind: StarterKind) => {
    const sop = makeStarterSop(kind);
    addSop(sop);
    setSelectedId(sop.id);
    setImportInfo(`Created starter SOP "${sop.name}". Rename it, edit values to match your scenario, then set as active.`);
  }, [addSop]);

  /** Send the selected SOP's attached image(s) to Claude with a
   *  structured-extraction prompt; merge what comes back into the
   *  SOP's fields. The user's already-typed values WIN — extraction
   *  only fills empty fields and appends new array entries. */
  const handleExtractWithAi = useCallback(async () => {
    if (!aiKey) {
      setAiOpen(true);
      return;
    }
    if (!selected) return;
    // Collect attachments — both legacy single + multi-attachment shapes
    const atts = selected.attachments
      ? selected.attachments
      : selected.attachment
        ? [selected.attachment]
        : [];
    if (atts.length === 0) return;

    setExtracting(true);
    setImportError(null);
    setImportInfo(null);

    // Loop over images one at a time and merge each result into the
    // SOP. Per-image extraction avoids the model truncating its output
    // when a single mega-call has too many tables to enumerate. The
    // merge is dedup-by-callsign so common entries across images don't
    // get duplicated, and user-typed values win across all merges.
    setExtractProgress({ current: 0, total: atts.length });

    try {
      // Snapshot the SOP at the start; merge each image's partial
      // into a running accumulator so we only updateSop ONCE at the
      // end. Otherwise rapid React re-renders during the loop can
      // race with the next iteration's merge baseline.
      let working = { ...selected };
      let totalIn = 0;
      let totalOut = 0;
      const failures: string[] = [];

      for (let i = 0; i < atts.length; i++) {
        setExtractProgress({ current: i + 1, total: atts.length });
        try {
          const result = await extractSopFromImages(
            aiProvider, aiKey, aiModel, [atts[i]],
          );
          working = mergePartialIntoSop(working, result.partial);
          totalIn += result.usage.input_tokens;
          totalOut += result.usage.output_tokens;
        } catch (e) {
          failures.push(`${atts[i].name}: ${(e as Error).message}`);
        }
      }

      // Persist the accumulated result once at the end.
      updateSop(working);

      const partsAdded = [
        working.flights.length - selected.flights.length,
        (working.tankers?.length || 0) - (selected.tankers?.length || 0),
        (working.supportAssets?.length || 0) - (selected.supportAssets?.length || 0),
        working.comms.length - selected.comms.length,
        working.tacans.length - selected.tacans.length,
      ];
      const totalNew = partsAdded.reduce((a, b) => a + Math.max(0, b), 0);

      // v1.19.78 — comm plan (radio preset cards) lands in working.commPlan,
      // not the flat arrays, so report it separately or a pure radio-card
      // import reads as "0 new entries" and looks broken.
      const planNetsAdded = (working.commPlan?.nets.length || 0) - (selected.commPlan?.nets.length || 0);
      const planMapsAdded = (working.commPlan?.maps.length || 0) - (selected.commPlan?.maps.length || 0);
      const planNote = planMapsAdded > 0
        ? ` Comm plan: +${planMapsAdded} radio map${planMapsAdded === 1 ? '' : 's'}, +${Math.max(0, planNetsAdded)} net${planNetsAdded === 1 ? '' : 's'} (see SOP → Comm Plan).`
        : '';

      const successCount = atts.length - failures.length;
      const summary = (atts.length === 1
        ? `Extracted ${totalNew} new entr${totalNew === 1 ? 'y' : 'ies'} via ${aiModel}.`
        : `Extracted across ${successCount}/${atts.length} images via ${aiModel}: ${totalNew} new entr${totalNew === 1 ? 'y' : 'ies'} added. (${totalIn} input + ${totalOut} output tokens total)`)
        + planNote;

      if (failures.length > 0) {
        setImportError(`${summary}\n\n${failures.length} image(s) failed:\n${failures.slice(0, 3).join('\n')}${failures.length > 3 ? `\n…and ${failures.length - 3} more` : ''}`);
      } else {
        setImportInfo(summary);
      }
    } catch (err) {
      setImportError(`AI extraction failed: ${(err as Error).message}`);
    } finally {
      setExtracting(false);
      setExtractProgress(null);
    }
  }, [aiProvider, aiKey, aiModel, selected, updateSop]);

  const handleClearAll = useCallback(() => {
    if (sops.length === 0) return;
    const ok = confirm(
      `Wipe all ${sops.length} SOP${sops.length !== 1 ? 's' : ''} from localStorage? ` +
      `This is irreversible — download anything you want to keep first.`,
    );
    if (!ok) return;
    clearAll();
    setSelectedId(null);
    setImportInfo('Cleared all SOPs from browser storage.');
  }, [sops.length, clearAll]);

  const handleRename = useCallback((id: string, name: string) => {
    const sop = sops.find((s) => s.id === id);
    if (!sop) return;
    updateSop({ ...sop, name });
  }, [sops, updateSop]);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Squadron SOP
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
          Upload or compose a Standard Operating Procedures document. When an SOP is active, auto-assign buttons (callsigns, comms, TACAN, laser codes) will use its values instead of generic defaults.
        </p>
      </div>

      {/* Active SOP banner. When inactive, render a quick-select
          dropdown so the user can activate any library SOP without
          digging through the library list / detail-panel two-step. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', marginBottom: 14, borderRadius: 6,
        background: active ? 'rgba(63, 185, 80, 0.08)' : 'rgba(90, 122, 138, 0.05)',
        border: `1px solid ${active ? 'rgba(63, 185, 80, 0.35)' : '#3a3a3a'}`,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          color: active ? '#3fb950' : '#aaaaaa',
          border: `1px solid ${active ? 'rgba(63, 185, 80, 0.5)' : '#3a3a3a'}`,
          borderRadius: 3, padding: '2px 8px',
        }}>
          {active ? 'ACTIVE' : 'NO ACTIVE SOP'}
        </span>
        {active ? (
          <>
            <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 500, flex: 1 }}>
              {active.name}
            </span>
            <button onClick={() => setActive(null)} style={btnGhost}>Deactivate</button>
          </>
        ) : sops.length === 0 ? (
          <span style={{ color: '#cccccc', fontSize: 14, fontWeight: 500, flex: 1 }}>
            Auto-assigns will use generic DCS defaults. Pick a starter SOP below to get going.
          </span>
        ) : (
          <>
            <span style={{ color: '#cccccc', fontSize: 13, flex: 1 }}>
              Auto-assigns will use generic DCS defaults until you activate an SOP.
            </span>
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) setActive(e.target.value); }}
              style={{
                background: '#262626', border: '1px solid #4a8fd4',
                borderRadius: 4, color: '#4a8fd4', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, padding: '6px 10px',
                fontFamily: 'inherit',
              }}
            >
              <option value="" disabled>Activate SOP…</option>
              {sops.map((s) => (
                <option key={s.id} value={s.id} style={{ color: '#e0e0e0', background: '#1a1a1a' }}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          ref={fileInputRef} type="file" accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleJsonUpload(f); e.target.value = ''; }}
        />
        <input
          ref={imageInputRef} type="file" accept="image/*,.pdf" multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) handleImageUpload(files);
            e.target.value = '';
          }}
        />
        <input
          ref={ozpInputRef} type="file" accept=".ozp,.zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOzpUpload(f); e.target.value = ''; }}
        />
        <button onClick={() => fileInputRef.current?.click()} style={btnPrimary}>
          Upload JSON SOP
        </button>
        <button onClick={() => ozpInputRef.current?.click()} style={btnSecondary}
          title="Upload a squadron kneeboard pack (.ozp / .zip). We extract the images so you can reference them while filling in the SOP fields.">
          Upload OZP / ZIP
        </button>
        <input
          ref={addImageInputRef} type="file" accept="image/*,.pdf" multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) handleAddImagesToSelected(files);
            e.target.value = '';
          }}
        />
        <button onClick={() => imageInputRef.current?.click()} style={btnSecondary}
          title="Upload one or more SOP screenshots/photos as a NEW SOP entry. Multiple images are stored side-by-side as reference material.">
          Upload Image{selected ? ' as New SOP' : 's / PDF'}
        </button>
        {selected && (
          <button
            onClick={() => addImageInputRef.current?.click()}
            style={btnGhost}
            title={`Append additional images to "${selected.name}" rather than creating a new SOP.`}
          >
            + Add Images to "{selected.name.length > 22 ? selected.name.slice(0, 22) + '…' : selected.name}"
          </button>
        )}
        <button onClick={handleInstallSample} style={btnSecondary}>
          Load Sample SOP
        </button>
        <button
          onClick={() => downloadJson(makeSampleSop(), 'sample_sop_template.json')}
          style={btnGhost}
        >
          Download Template
        </button>
        {sops.length > 0 && (
          <button
            onClick={handleClearAll}
            style={{ ...btnDanger, marginLeft: 'auto' }}
            title="Wipe every SOP from this browser's localStorage. Useful for clearing test/proprietary entries before sharing the planner."
          >
            Clear All ({sops.length})
          </button>
        )}
      </div>

      {/* Starter SOPs — for users without a squadron SOP. Clicking
          builds a sensible default SOP they can edit instead of staring
          at an empty form. */}
      {sops.length === 0 && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: 6,
          background: 'rgba(74, 143, 212, 0.06)',
          border: '1px solid rgba(74, 143, 212, 0.25)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6ab4f0', marginBottom: 8 }}>
            DON'T HAVE AN SOP? &nbsp;Build one from a starter
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => handleStarter('modern-carrier')} style={btnStarter}>
              ⚓ Modern Carrier
            </button>
            <button onClick={() => handleStarter('modern-land')} style={btnStarter}>
              🛩 Modern Land-Based
            </button>
            <button onClick={() => handleStarter('cold-war')} style={btnStarter}>
              📻 Cold War (1985)
            </button>
            <button onClick={() => handleStarter('empty')} style={btnStarter}>
              ☐ Blank Skeleton
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#aaaaaa', marginTop: 6 }}>
            Each starter ships with realistic callsigns / freqs / TACANs for the era. Tweak to match your scenario.
          </div>
        </div>
      )}

      {(importError || importInfo) && (
        <div style={{
          padding: '8px 12px', marginBottom: 14, borderRadius: 4,
          background: importError ? 'rgba(217, 80, 80, 0.08)' : 'rgba(74, 143, 212, 0.08)',
          border: `1px solid ${importError ? 'rgba(217, 80, 80, 0.35)' : 'rgba(74, 143, 212, 0.35)'}`,
          color: importError ? '#d95050' : '#4a8fd4',
          fontSize: 13,
        }}>
          {importError || importInfo}
        </div>
      )}

      {/* Drop zone (covers area under action bar) */}
      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); handleDrop(e.dataTransfer?.files || null); }}
        style={{
          display: 'flex', gap: 16, alignItems: 'flex-start',
          minHeight: 400,
        }}
      >
        {/* Library panel — fixed-width left rail. Stays narrow because
            the SOP names are short; the detail pane gets the rest of
            the viewport. */}
        <div style={{
          flexShrink: 0, width: 240,
          background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6,
          padding: 8, position: 'sticky', top: 0,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#cccccc', letterSpacing: 0.5, padding: '4px 6px 8px' }}>
            LIBRARY ({sops.length})
          </div>
          {sops.length === 0 && (
            <div style={{ fontSize: 12, color: '#aaaaaa', padding: '12px 8px', fontStyle: 'italic' }}>
              No SOPs yet. Upload a JSON/image or load the sample.
            </div>
          )}
          {sops.map((sop) => {
            const isActive = activeId === sop.id;
            const isSelected = selectedId === sop.id;
            return (
              <div
                key={sop.id}
                onClick={() => setSelectedId(sop.id)}
                style={{
                  padding: '8px 10px', borderRadius: 4, marginBottom: 2,
                  cursor: 'pointer',
                  background: isSelected ? '#262626' : 'transparent',
                  borderLeft: `3px solid ${isActive ? '#3fb950' : 'transparent'}`,
                }}
              >
                <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>
                  {sop.name}
                </div>
                <div style={{ color: '#aaaaaa', fontSize: 11, marginTop: 2 }}>
                  {sop.flights.length} flights · {sop.comms.length} comms · {sop.tacans.length} tacans
                  {isActive && <span style={{ color: '#3fb950', marginLeft: 6 }}>● active</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <div style={{
          flex: 1, minWidth: 0,
          background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6,
          padding: 14,
        }}>
          {!selected ? (
            <div style={{
              color: '#aaaaaa', fontSize: 13, textAlign: 'center', padding: '40px 20px',
            }}>
              Select an SOP from the library — or drop a file here to import.
            </div>
          ) : (
            <SopDetail
              sop={selected}
              isActive={activeId === selected.id}
              onRename={(name) => handleRename(selected.id, name)}
              onActivate={() => setActive(selected.id)}
              onDeactivate={() => setActive(null)}
              onDelete={() => {
                if (confirm(`Delete SOP "${selected.name}"?`)) {
                  deleteSop(selected.id);
                  setSelectedId(null);
                }
              }}
              onDownload={() => downloadJson(selected)}
              onUpdate={(patch) => updateSop({ ...selected, ...patch })}
              onExtractWithAi={handleExtractWithAi}
              extracting={extracting}
              extractProgress={extractProgress}
              hasAiKey={!!aiKey}
              onOpenAiSettings={() => setAiOpen(true)}
              onAddImages={handleAddImagesToSelected}
            />
          )}
        </div>
      </div>

      <AiSettingsPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

function SopDetail({
  sop, isActive, onRename, onActivate, onDeactivate, onDelete, onDownload, onUpdate,
  onExtractWithAi, extracting, extractProgress, hasAiKey, onOpenAiSettings,
  onAddImages,
}: {
  sop: SOP;
  isActive: boolean;
  onRename: (name: string) => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onUpdate: (patch: Partial<SOP>) => void;
  onExtractWithAi: () => void;
  extracting: boolean;
  extractProgress: { current: number; total: number } | null;
  hasAiKey: boolean;
  onOpenAiSettings: () => void;
  /** v1.19.60 — append reference images to THIS SOP (existing-SOP path,
   *  not the global "create a new SOP from these images" path the top
   *  toolbar runs). */
  onAddImages: (files: File[]) => void;
}) {
  const [editName, setEditName] = useState<string | null>(null);
  const hasImages = !!sop.attachment || (sop.attachments && sop.attachments.length > 0);
  // v1.19.60 — local file input for the inline "Add images" CTA.
  // Tester report: "on the SOP page it's hard to find where I actually
  // add images to the SOP without making a new SOP, can we make it a
  // touch clearer". The top toolbar's "+ Add Images" was confusable
  // with the create-new-SOP buttons next to it. This pulls the action
  // INTO the SOP detail card so it's obviously about THIS SOP.
  const addImagesInputRef = useRef<HTMLInputElement>(null);
  const fireAdd = () => addImagesInputRef.current?.click();

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
      }}>
        {editName != null ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => { if (editName?.trim()) onRename(editName.trim()); setEditName(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { setEditName(null); }
            }}
            style={{
              flex: 1, background: '#262626', border: '1px solid #4a4a4a',
              borderRadius: 3, color: '#e0e0e0', fontSize: 17, fontWeight: 600,
              padding: '4px 8px', fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            style={{ flex: 1, color: '#e0e0e0', fontSize: 17, fontWeight: 600, cursor: 'text' }}
            onClick={() => setEditName(sop.name)}
            title="Click to rename"
          >
            {sop.name}
          </span>
        )}
        {/* AI extraction — only meaningful when the SOP has at least
            one image attached. Shows different states:
              - no key:        prompts user to open AI Settings
              - key set:       offers extraction
              - extracting:    spinner-style indicator
        */}
        {hasImages && (
          hasAiKey ? (
            <button
              onClick={onExtractWithAi}
              disabled={extracting}
              title="Loop through every attached image, sending each to the AI individually with a structured-extraction prompt. Results are merged into this SOP — empty fields fill from responses, your typed values stay put. Per-image extraction avoids the model truncating its output on dense kneeboard packs."
              style={{
                ...btnAi,
                opacity: extracting ? 0.6 : 1,
                cursor: extracting ? 'wait' : 'pointer',
              }}
            >
              {extracting
                ? (extractProgress
                    ? `⋯ Extracting ${extractProgress.current}/${extractProgress.total}…`
                    : '⋯ Extracting…')
                : '✨ Extract with AI'}
            </button>
          ) : (
            <button
              onClick={onOpenAiSettings}
              title="Connect your Anthropic API key to enable vision-based SOP extraction."
              style={btnAiDisabled}
            >
              🔑 Connect AI to Extract
            </button>
          )
        )}
        {/* v1.19.60 — inline "Add images" button, contextual to THIS SOP.
            Replaces the top-toolbar version (which sat next to the
            create-NEW-SOP buttons and was visually ambiguous). The
            label includes the current image count so it's obviously
            additive, not replacing. */}
        <input
          ref={addImagesInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) onAddImages(files);
            e.target.value = '';
          }}
        />
        <button
          onClick={fireAdd}
          style={btnGhost}
          title="Append more reference images or PDFs to this SOP. Combine with ✨ Extract with AI to read structured fields off them."
        >
          📎 Add image{hasImages ? 's…' : 's'}
        </button>
        {isActive ? (
          <button onClick={onDeactivate} style={btnGhost}>Deactivate</button>
        ) : (
          <button onClick={onActivate} style={btnPrimary}>Set Active</button>
        )}
        <button onClick={onDownload} style={btnGhost}>Download JSON</button>
        <button onClick={onDelete} style={btnDanger}>Delete</button>
      </div>

      {sop.squadron && (
        <div style={{ color: '#aaaaaa', fontSize: 12, marginBottom: 8 }}>
          Squadron: <span style={{ color: '#cccccc' }}>{sop.squadron}</span>
        </div>
      )}
      {sop.notes && (
        <div style={{ color: '#aaaaaa', fontSize: 12, marginBottom: 14, whiteSpace: 'pre-wrap' }}>
          {sop.notes}
        </div>
      )}

      {/* Stats strip — at-a-glance summary so the user knows what's
          populated without scrolling through every section. */}
      <SopStatsStrip sop={sop} />

      {/* v1.19.60 — empty-state image CTA. When the SOP has no
          attachments, surface a prominent panel telling the user they
          can drop kneeboard photos here for AI extraction. Replaces
          the previous "where do I add images" confusion (tester
          report). When images ARE attached, this collapses and the
          📎 button in the header is the entry point instead. */}
      {!hasImages && (
        <div
          onClick={fireAdd}
          style={{
            cursor: 'pointer',
            margin: '10px 0 14px',
            padding: '14px 16px',
            background: 'rgba(74, 158, 255, 0.06)',
            border: '1px dashed #2a5a8a',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <span style={{ fontSize: 26 }}>📎</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#cfe6ff', fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
              Add reference images to this SOP
            </div>
            <div style={{ color: '#8aa0ba', fontSize: 12, lineHeight: 1.45 }}>
              Drop a screenshot of your squadron's comm card, callsign list, or
              kneeboard pack — then click <strong style={{ color: '#cfe6ff' }}>✨ Extract with AI</strong>{' '}
              to auto-fill the SOP fields. Images stay attached as reference
              while you edit.
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); fireAdd(); }}
            style={{
              ...btnPrimary,
              padding: '7px 16px',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            Browse files
          </button>
        </div>
      )}

      {/* Side-by-side layout when the SOP has an attached image:
          editors on the left, image pinned on the right so the user
          can read off the source while typing. Without an image we
          fall back to a 2-column editor grid that uses the full
          width. */}
      {(sop.attachment || (sop.attachments && sop.attachments.length > 0)) ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 480px)',
          gap: 16, alignItems: 'start',
        }}>
          <div>
            <FlightsEditor sop={sop} onUpdate={onUpdate} />
            <TankersEditor sop={sop} onUpdate={onUpdate} />
            <SupportAssetsEditor sop={sop} onUpdate={onUpdate} />
            <CommsEditor sop={sop} onUpdate={onUpdate} />
            <TacansEditor sop={sop} onUpdate={onUpdate} />
            <LaserBaseEditor sop={sop} onUpdate={onUpdate} />
          </div>
          <div style={{ position: 'sticky', top: 0, maxHeight: 'calc(100vh - 80px)', overflow: 'auto' }}>
            {sop.attachment && sop.attachment.mimeType.startsWith('image/') && (
              <Section title={`SOURCE: ${sop.attachment.name}`}>
                <img
                  src={`data:${sop.attachment.mimeType};base64,${sop.attachment.dataBase64}`}
                  alt={sop.attachment.name}
                  style={{ maxWidth: '100%', border: '1px solid #3a3a3a', borderRadius: 4, display: 'block' }}
                />
                <div style={{ fontSize: 11, color: '#aaaaaa', marginTop: 6 }}>
                  Read values off this image and type into the form on the left. The Quick-Add box above each section accepts whitespace-separated tokens for fast entry.
                </div>
              </Section>
            )}
            {sop.attachments && sop.attachments.length > 0 && (
              <AttachmentGallery attachments={sop.attachments} />
            )}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 16, alignItems: 'start',
        }}>
          <div>
            <FlightsEditor sop={sop} onUpdate={onUpdate} />
            <TankersEditor sop={sop} onUpdate={onUpdate} />
            <SupportAssetsEditor sop={sop} onUpdate={onUpdate} />
          </div>
          <div>
            <CommsEditor sop={sop} onUpdate={onUpdate} />
            <TacansEditor sop={sop} onUpdate={onUpdate} />
            <LaserBaseEditor sop={sop} onUpdate={onUpdate} />
          </div>
        </div>
      )}

      <div style={{ color: '#4a4a4a', fontSize: 11, marginTop: 16, fontStyle: 'italic' }}>
        Tip: after filling in tankers &amp; flights, set the SOP active and the auto-assigns on other tabs will use these values.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SopStatsStrip — at-a-glance summary cards so wide-screen users     */
/* don't see a wall of empty space + a tall narrow column of editors. */
/* ------------------------------------------------------------------ */

function SopStatsStrip({ sop }: { sop: SOP }) {
  const stats: Array<{ label: string; value: number; color: string; tip?: string }> = [
    { label: 'FLIGHTS',     value: sop.flights.length,                color: '#4a8fd4',
      tip: 'Player flight callsigns + default freqs' },
    { label: 'TANKERS',     value: (sop.tankers || []).length,        color: '#d29922',
      tip: 'Refueling assets — drives Comms + TACAN auto-assign' },
    { label: 'SUPPORT',     value: (sop.supportAssets || []).length,  color: '#a371f7',
      tip: 'AWACS / JTAC / non-tanker support callsigns' },
    { label: 'COMMS',       value: sop.comms.length,                  color: '#3fb950',
      tip: 'Mission comm frequency table (push freqs etc.)' },
    { label: 'TACAN',       value: sop.tacans.length,                 color: '#6ab4f0',
      tip: 'Non-tanker TACAN entries (home plate, divert, etc.)' },
    { label: 'LASER BASE',  value: sop.laserCodeBase ?? 0,            color: '#ff6b8a',
      tip: 'Auto-assign starts from this base; each digit 1-7' },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 8, marginBottom: 16,
    }}>
      {stats.map((s) => (
        <div
          key={s.label}
          title={s.tip}
          style={{
            background: '#1a1a1a',
            border: `1px solid ${s.value > 0 ? `${s.color}55` : '#3a3a3a'}`,
            borderLeft: `3px solid ${s.value > 0 ? s.color : '#3a3a3a'}`,
            borderRadius: 4,
            padding: '8px 12px',
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: s.value > 0 ? s.color : '#5a6878',
          }}>
            {s.label}
          </div>
          <div style={{
            fontSize: 22, fontWeight: 700,
            color: s.value > 0 ? '#e0e0e0' : '#5a6878',
            fontFamily: "'B612 Mono', monospace",
            marginTop: 2,
          }}>
            {s.label === 'LASER BASE' && s.value === 0 ? '—' : s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline editors                                                      */
/* ------------------------------------------------------------------ */

function parseNum(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = parseFloat(v);
  return Number.isNaN(n) ? undefined : n;
}

function parseInt0(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

function FlightsEditor({ sop, onUpdate }: { sop: SOP; onUpdate: (patch: Partial<SOP>) => void }) {
  const flights = sop.flights;
  const update = (idx: number, patch: Partial<import('../../sop/types').SopFlightCallsign>) => {
    const next = flights.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onUpdate({ flights: next });
  };
  const add = () => onUpdate({ flights: [...flights, { callsign: '', priority: flights.length + 1 }] });
  const remove = (idx: number) => onUpdate({ flights: flights.filter((_, i) => i !== idx) });

  return (
    <Section title={`FLIGHT CALLSIGNS (${flights.length})`}>
      <QuickAddRow
        placeholder="Callsign  Freq  Mod    e.g.  Bengal 251.000 AM"
        hint="Tokens: callsign  freq(MHz)  AM|FM. Multi-line for batch."
        onParse={(t) => onUpdate({ flights: [...flights, {
          callsign: t[0] || '',
          defaultFreq: parseNum(t[1] || ''),
          defaultMod: (t[2] || '').toUpperCase() === 'FM' ? 'FM' : (t[2] || '').toUpperCase() === 'AM' ? 'AM' : undefined,
          priority: flights.length + 1,
        }] })}
      />
      <table style={tableStyle}>
        <thead><tr>
          <th style={{ ...thStyle, width: 50 }}>#</th>
          <th style={thStyle}>Callsign</th>
          <th style={{ ...thStyle, width: 120 }}>Default Freq</th>
          <th style={{ ...thStyle, width: 80 }}>Mod</th>
          <th style={{ ...thStyle, width: 40 }}></th>
        </tr></thead>
        <tbody>
          {flights.map((f, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <input type="number" value={f.priority ?? i + 1}
                  onChange={(e) => update(i, { priority: parseInt0(e.target.value) })}
                  style={{ ...inputStyle, width: 40 }} />
              </td>
              <td style={tdStyle}>
                <input value={f.callsign} onChange={(e) => update(i, { callsign: e.target.value })}
                  style={{ ...inputStyle, width: '95%', color: '#e0e0e0', fontWeight: 600 }} />
              </td>
              <td style={tdStyle}>
                <input type="number" step="0.025" value={f.defaultFreq ?? ''}
                  onChange={(e) => update(i, { defaultFreq: parseNum(e.target.value) })}
                  style={{ ...inputStyle, width: 90, fontFamily: "'B612 Mono', monospace" }} placeholder="MHz" />
              </td>
              <td style={tdStyle}>
                <select value={f.defaultMod || ''} onChange={(e) => update(i, { defaultMod: e.target.value as any || undefined })}
                  style={{ ...inputStyle, width: 60 }}>
                  <option value="">—</option><option value="AM">AM</option><option value="FM">FM</option>
                </select>
              </td>
              <td style={tdStyle}><button onClick={() => remove(i)} style={xBtn} title="Remove">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} style={addRowBtn}>+ Add flight callsign</button>
    </Section>
  );
}

function TankersEditor({ sop, onUpdate }: { sop: SOP; onUpdate: (patch: Partial<SOP>) => void }) {
  const tankers = sop.tankers || [];
  const update = (idx: number, patch: Partial<import('../../sop/types').SopTanker>) => {
    const next = tankers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onUpdate({ tankers: next });
  };
  const add = () => onUpdate({ tankers: [...tankers, { callsign: '' }] });
  const remove = (idx: number) => onUpdate({ tankers: tankers.filter((_, i) => i !== idx) });

  return (
    <Section title={`TANKERS (${tankers.length}) — drives TACAN + Comms auto-assign`}>
      <QuickAddRow
        placeholder="Callsign Freq Mod TACAN# Band Callsign  e.g.  Texaco 271.500 AM 41 Y TX1"
        hint="Tokens: callsign  freq(MHz)  AM|FM  tacan#  X|Y  tacan-callsign"
        onParse={(t) => onUpdate({ tankers: [...tankers, {
          callsign: t[0] || '',
          frequency: parseNum(t[1] || ''),
          modulation: (t[2] || '').toUpperCase() === 'FM' ? 'FM' : (t[2] || '').toUpperCase() === 'AM' ? 'AM' : undefined,
          tacanChannel: parseInt0(t[3] || ''),
          tacanBand: (t[4] || '').toUpperCase() === 'Y' ? 'Y' : (t[4] || '').toUpperCase() === 'X' ? 'X' : undefined,
          tacanCallsign: t[5] || undefined,
        }] })}
      />
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Callsign</th>
          <th style={{ ...thStyle, width: 100 }}>Freq</th>
          <th style={{ ...thStyle, width: 70 }}>Mod</th>
          <th style={{ ...thStyle, width: 70 }}>TACAN #</th>
          <th style={{ ...thStyle, width: 50 }}>Band</th>
          <th style={{ ...thStyle, width: 80 }}>TACAN CS</th>
          <th style={{ ...thStyle, width: 40 }}></th>
        </tr></thead>
        <tbody>
          {tankers.map((t, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <input value={t.callsign} onChange={(e) => update(i, { callsign: e.target.value })}
                  style={{ ...inputStyle, width: '95%', color: '#e0e0e0', fontWeight: 600 }} placeholder="Texaco" />
              </td>
              <td style={tdStyle}>
                <input type="number" step="0.025" value={t.frequency ?? ''}
                  onChange={(e) => update(i, { frequency: parseNum(e.target.value) })}
                  style={{ ...inputStyle, width: 80, fontFamily: "'B612 Mono', monospace" }} placeholder="MHz" />
              </td>
              <td style={tdStyle}>
                <select value={t.modulation || ''} onChange={(e) => update(i, { modulation: e.target.value as any || undefined })}
                  style={{ ...inputStyle, width: 55 }}>
                  <option value="">—</option><option value="AM">AM</option><option value="FM">FM</option>
                </select>
              </td>
              <td style={tdStyle}>
                <input type="number" min={1} max={126} value={t.tacanChannel ?? ''}
                  onChange={(e) => update(i, { tacanChannel: parseInt0(e.target.value) })}
                  style={{ ...inputStyle, width: 55, fontFamily: "'B612 Mono', monospace" }} />
              </td>
              <td style={tdStyle}>
                <select value={t.tacanBand || ''} onChange={(e) => update(i, { tacanBand: e.target.value as any || undefined })}
                  style={{ ...inputStyle, width: 45 }}>
                  <option value="">—</option><option value="X">X</option><option value="Y">Y</option>
                </select>
              </td>
              <td style={tdStyle}>
                <input value={t.tacanCallsign ?? ''} onChange={(e) => update(i, { tacanCallsign: e.target.value || undefined })}
                  style={{ ...inputStyle, width: 65, fontFamily: "'B612 Mono', monospace" }} placeholder="TX1" maxLength={3} />
              </td>
              <td style={tdStyle}><button onClick={() => remove(i)} style={xBtn} title="Remove">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} style={addRowBtn}>+ Add tanker</button>
    </Section>
  );
}

function SupportAssetsEditor({ sop, onUpdate }: { sop: SOP; onUpdate: (patch: Partial<SOP>) => void }) {
  const assets = sop.supportAssets || [];
  const update = (idx: number, patch: Partial<import('../../sop/types').SopSupportAsset>) => {
    const next = assets.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    onUpdate({ supportAssets: next });
  };
  const add = () => onUpdate({ supportAssets: [...assets, { callsign: '' }] });
  const remove = (idx: number) => onUpdate({ supportAssets: assets.filter((_, i) => i !== idx) });

  return (
    <Section title={`SUPPORT ASSETS (${assets.length}) — AWACS, JTAC, etc.`}>
      <QuickAddRow
        placeholder="Callsign Role Freq Mod   e.g.  Magic AWACS 263.000 AM"
        hint="Tokens: callsign  role  freq(MHz)  AM|FM"
        onParse={(t) => onUpdate({ supportAssets: [...assets, {
          callsign: t[0] || '',
          role: t[1] || undefined,
          frequency: parseNum(t[2] || ''),
          modulation: (t[3] || '').toUpperCase() === 'FM' ? 'FM' : (t[3] || '').toUpperCase() === 'AM' ? 'AM' : undefined,
        }] })}
      />
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Callsign</th>
          <th style={{ ...thStyle, width: 110 }}>Role</th>
          <th style={{ ...thStyle, width: 100 }}>Freq</th>
          <th style={{ ...thStyle, width: 70 }}>Mod</th>
          <th style={{ ...thStyle, width: 40 }}></th>
        </tr></thead>
        <tbody>
          {assets.map((a, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <input value={a.callsign} onChange={(e) => update(i, { callsign: e.target.value })}
                  style={{ ...inputStyle, width: '95%', color: '#e0e0e0', fontWeight: 600 }} placeholder="Magic" />
              </td>
              <td style={tdStyle}>
                <input value={a.role ?? ''} onChange={(e) => update(i, { role: e.target.value || undefined })}
                  style={{ ...inputStyle, width: '95%' }} placeholder="AWACS" />
              </td>
              <td style={tdStyle}>
                <input type="number" step="0.025" value={a.frequency ?? ''}
                  onChange={(e) => update(i, { frequency: parseNum(e.target.value) })}
                  style={{ ...inputStyle, width: 80, fontFamily: "'B612 Mono', monospace" }} placeholder="MHz" />
              </td>
              <td style={tdStyle}>
                <select value={a.modulation || ''} onChange={(e) => update(i, { modulation: e.target.value as any || undefined })}
                  style={{ ...inputStyle, width: 55 }}>
                  <option value="">—</option><option value="AM">AM</option><option value="FM">FM</option>
                </select>
              </td>
              <td style={tdStyle}><button onClick={() => remove(i)} style={xBtn}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} style={addRowBtn}>+ Add support asset</button>
    </Section>
  );
}

function CommsEditor({ sop, onUpdate }: { sop: SOP; onUpdate: (patch: Partial<SOP>) => void }) {
  const comms = sop.comms;
  const update = (idx: number, patch: Partial<import('../../sop/types').SopCommEntry>) => {
    const next = comms.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onUpdate({ comms: next });
  };
  const add = () => onUpdate({ comms: [...comms, { role: '', frequency: 0 }] });
  const remove = (idx: number) => onUpdate({ comms: comms.filter((_, i) => i !== idx) });

  return (
    <Section title={`COMM FREQUENCIES (${comms.length})`}>
      <QuickAddRow
        placeholder="Role Freq Mod  e.g.  Strike 280.000 AM"
        hint="Tokens: role(no-spaces or quoted)  freq(MHz)  AM|FM"
        onParse={(t) => onUpdate({ comms: [...comms, {
          role: t[0] || '',
          frequency: parseNum(t[1] || '') ?? 0,
          modulation: (t[2] || '').toUpperCase() === 'FM' ? 'FM' : 'AM',
        }] })}
      />
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Role</th>
          <th style={{ ...thStyle, width: 100 }}>Freq</th>
          <th style={{ ...thStyle, width: 70 }}>Mod</th>
          <th style={thStyle}>Notes</th>
          <th style={{ ...thStyle, width: 40 }}></th>
        </tr></thead>
        <tbody>
          {comms.map((c, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <input value={c.role} onChange={(e) => update(i, { role: e.target.value })}
                  style={{ ...inputStyle, width: '95%' }} placeholder="Strike Primary" />
              </td>
              <td style={tdStyle}>
                <input type="number" step="0.025" value={c.frequency || ''}
                  onChange={(e) => update(i, { frequency: parseNum(e.target.value) ?? 0 })}
                  style={{ ...inputStyle, width: 80, fontFamily: "'B612 Mono', monospace", color: '#d29922' }} />
              </td>
              <td style={tdStyle}>
                <select value={c.modulation || 'AM'} onChange={(e) => update(i, { modulation: e.target.value as any })}
                  style={{ ...inputStyle, width: 55 }}>
                  <option value="AM">AM</option><option value="FM">FM</option>
                </select>
              </td>
              <td style={tdStyle}>
                <input value={c.notes ?? ''} onChange={(e) => update(i, { notes: e.target.value || undefined })}
                  style={{ ...inputStyle, width: '95%' }} />
              </td>
              <td style={tdStyle}><button onClick={() => remove(i)} style={xBtn}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} style={addRowBtn}>+ Add comm frequency</button>
    </Section>
  );
}

function TacansEditor({ sop, onUpdate }: { sop: SOP; onUpdate: (patch: Partial<SOP>) => void }) {
  const tacans = sop.tacans;
  const update = (idx: number, patch: Partial<import('../../sop/types').SopTacanEntry>) => {
    const next = tacans.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onUpdate({ tacans: next });
  };
  const add = () => onUpdate({ tacans: [...tacans, { role: '', channel: 1, band: 'X' }] });
  const remove = (idx: number) => onUpdate({ tacans: tacans.filter((_, i) => i !== idx) });

  return (
    <Section title={`TACAN (${tacans.length}) — non-tanker entries (home plate, ship, etc.)`}>
      <QuickAddRow
        placeholder="Role Channel Band Callsign  e.g.  HomePlate 74 X TR"
        hint="Tokens: role  channel(1-126)  X|Y  callsign"
        onParse={(t) => onUpdate({ tacans: [...tacans, {
          role: t[0] || '',
          channel: parseInt0(t[1] || '') ?? 1,
          band: (t[2] || '').toUpperCase() === 'Y' ? 'Y' : 'X',
          callsign: t[3] || undefined,
        }] })}
      />
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Role</th>
          <th style={{ ...thStyle, width: 70 }}>Channel</th>
          <th style={{ ...thStyle, width: 50 }}>Band</th>
          <th style={{ ...thStyle, width: 90 }}>Callsign</th>
          <th style={thStyle}>Notes</th>
          <th style={{ ...thStyle, width: 40 }}></th>
        </tr></thead>
        <tbody>
          {tacans.map((t, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <input value={t.role} onChange={(e) => update(i, { role: e.target.value })}
                  style={{ ...inputStyle, width: '95%' }} placeholder="Home Plate" />
              </td>
              <td style={tdStyle}>
                <input type="number" min={1} max={126} value={t.channel}
                  onChange={(e) => update(i, { channel: parseInt0(e.target.value) ?? 1 })}
                  style={{ ...inputStyle, width: 55, fontFamily: "'B612 Mono', monospace" }} />
              </td>
              <td style={tdStyle}>
                <select value={t.band} onChange={(e) => update(i, { band: e.target.value as any })}
                  style={{ ...inputStyle, width: 45 }}>
                  <option value="X">X</option><option value="Y">Y</option>
                </select>
              </td>
              <td style={tdStyle}>
                <input value={t.callsign ?? ''} onChange={(e) => update(i, { callsign: e.target.value || undefined })}
                  style={{ ...inputStyle, width: 75, fontFamily: "'B612 Mono', monospace" }} />
              </td>
              <td style={tdStyle}>
                <input value={t.notes ?? ''} onChange={(e) => update(i, { notes: e.target.value || undefined })}
                  style={{ ...inputStyle, width: '95%' }} />
              </td>
              <td style={tdStyle}><button onClick={() => remove(i)} style={xBtn}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} style={addRowBtn}>+ Add TACAN entry</button>
    </Section>
  );
}

function LaserBaseEditor({ sop, onUpdate }: { sop: SOP; onUpdate: (patch: Partial<SOP>) => void }) {
  return (
    <Section title="LASER CODES">
      <div style={{ color: '#e0e0e0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        Base code:
        <input type="number" min={1111} max={7777} value={sop.laserCodeBase ?? ''}
          placeholder="1511 (default)"
          onChange={(e) => onUpdate({ laserCodeBase: parseInt0(e.target.value) })}
          style={{ ...inputStyle, width: 90, fontFamily: "'B612 Mono', monospace", color: '#d29922', fontWeight: 600 }} />
        <span style={{ color: '#aaaaaa', fontSize: 11 }}>
          Each digit must be 1-7. Auto-assign on the Laser tab starts from this code.
        </span>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

function AttachmentGallery({ attachments }: { attachments: import('../../sop/types').SopAttachment[] }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['__sop_wide__']));
  const [zoom, setZoom] = useState<import('../../sop/types').SopAttachment | null>(null);

  // Group by aircraft (empty = SOP-wide)
  const groups = new Map<string, import('../../sop/types').SopAttachment[]>();
  for (const a of attachments) {
    const key = a.aircraft || '__sop_wide__';
    let list = groups.get(key);
    if (!list) { list = []; groups.set(key, list); }
    list.push(a);
  }
  const groupKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === '__sop_wide__') return -1;
    if (b === '__sop_wide__') return 1;
    return a.localeCompare(b);
  });

  const toggleGroup = (k: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const totalImages = attachments.length;
  const aircraftCount = groups.size - (groups.has('__sop_wide__') ? 1 : 0);

  return (
    <Section title={`ATTACHMENTS (${totalImages} images · ${aircraftCount} airframe${aircraftCount !== 1 ? 's' : ''})`}>
      <div style={{ fontSize: 11, color: '#aaaaaa', marginBottom: 10 }}>
        Imported reference charts. Auto-extraction from images (vision AI) is a planned follow-up — in the meantime, click any image to zoom.
      </div>

      {groupKeys.map((gk) => {
        const list = groups.get(gk) || [];
        const isSopWide = gk === '__sop_wide__';
        const label = isSopWide ? 'SOP-wide' : gk;
        const isExpanded = expandedGroups.has(gk);
        return (
          <div key={gk} style={{ marginBottom: 10, border: '1px solid #3a3a3a', borderRadius: 4 }}>
            <div
              onClick={() => toggleGroup(gk)}
              style={{
                padding: '6px 10px', cursor: 'pointer',
                background: isExpanded ? '#1a1a1a' : 'transparent',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ color: '#aaaaaa', fontSize: 11, width: 12 }}>
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <span style={{
                color: isSopWide ? '#d29922' : '#e0e0e0',
                fontWeight: 600, fontSize: 13,
              }}>{label}</span>
              <span style={{ color: '#aaaaaa', fontSize: 11 }}>
                {list.length} image{list.length !== 1 ? 's' : ''}
              </span>
            </div>
            {isExpanded && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 8, padding: 8,
              }}>
                {list.map((a, i) => (
                  <div
                    key={i}
                    onClick={() => setZoom(a)}
                    title={a.name}
                    style={{
                      cursor: 'zoom-in',
                      background: '#1a1a1a',
                      border: '1px solid #3a3a3a',
                      borderRadius: 3,
                      overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    <img
                      src={`data:${a.mimeType};base64,${a.dataBase64}`}
                      alt={a.name}
                      style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{
                      fontSize: 10, color: '#cccccc', padding: '3px 6px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {a.category || a.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={`data:${zoom.mimeType};base64,${zoom.dataBase64}`}
            alt={zoom.name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
          <div style={{
            position: 'absolute', top: 12, left: 16, color: '#fff',
            fontSize: 14, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}>
            {zoom.aircraft ? `${zoom.aircraft} · ` : ''}{zoom.name}
          </div>
          <div style={{
            position: 'absolute', top: 12, right: 16, color: '#fff',
            fontSize: 12,
          }}>click to close</div>
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#d29922', letterSpacing: 0.5,
        textTransform: 'uppercase', marginBottom: 6, borderBottom: '1px solid #3a3a3a',
        paddingBottom: 4,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}


/** Quick-add textarea: type/paste a single line of whitespace-separated
 *  values, hit Enter, the parsed row is appended to the section's
 *  table. Significantly faster than typing into 5+ separate cells per
 *  row when the user is reading values off a screenshot or pasting
 *  from a spreadsheet. Multi-line paste (CSV-style) is supported —
 *  each newline becomes a row.
 */
function QuickAddRow({
  placeholder,
  hint,
  onParse,
}: {
  placeholder: string;
  hint: string;
  onParse: (tokens: string[]) => void;
}) {
  const [text, setText] = useState('');

  const submit = useCallback(() => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines) {
      // Split on whitespace OR comma OR tab — picks up Excel/TSV pastes
      // and freeform user typing equally well.
      const tokens = line.split(/[\s,\t]+/).filter(Boolean);
      if (tokens.length === 0) continue;
      onParse(tokens);
    }
    setText('');
  }, [text, onParse]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      marginTop: 4, marginBottom: 4,
    }}>
      <textarea
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter (without Shift) submits; Shift+Enter inserts a newline
          // for the multi-row paste case.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: '#1a1a1a',
          border: '1px solid #3a3a3a',
          borderRadius: 3,
          color: '#cccccc',
          fontSize: 12,
          padding: '4px 8px',
          fontFamily: "'B612 Mono', monospace",
          outline: 'none',
          resize: 'vertical',
          minHeight: 22,
        }}
      />
      <button
        onClick={submit}
        title="Append parsed row(s) to the table"
        style={{
          background: '#1a3a2a', border: '1px solid #3fb950',
          borderRadius: 3, color: '#3fb950', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, padding: '4px 10px',
          fontFamily: 'inherit', flexShrink: 0,
        }}
      >+ Add</button>
      <span style={{ fontSize: 10, color: '#5a6878', flexShrink: 0 }} title={hint}>
        ⓘ
      </span>
    </div>
  );
}

// `Empty` placeholder component removed — was unused after the SOP UI
// rework. Reintroduce if we add empty-state messaging to the lists.

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '4px 8px',
  color: '#aaaaaa', fontSize: 11, fontWeight: 600,
  borderBottom: '1px solid #3a3a3a', textTransform: 'uppercase', letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px', color: '#cccccc', borderBottom: '1px solid #262626',
};

const btnPrimary: React.CSSProperties = {
  background: '#4a4a4a', border: '1px solid #4a8fd4',
  borderRadius: 4, color: '#4a8fd4', cursor: 'pointer',
  fontSize: 12, fontWeight: 600, padding: '6px 14px', fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  background: 'rgba(210, 153, 34, 0.1)', border: '1px solid rgba(210, 153, 34, 0.4)',
  borderRadius: 4, color: '#d29922', cursor: 'pointer',
  fontSize: 12, fontWeight: 600, padding: '6px 14px', fontFamily: 'inherit',
};

const btnGhost: React.CSSProperties = {
  background: 'transparent', border: '1px solid #3a3a3a',
  borderRadius: 4, color: '#cccccc', cursor: 'pointer',
  fontSize: 12, padding: '6px 12px', fontFamily: 'inherit',
};

const btnDanger: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(217, 80, 80, 0.4)',
  borderRadius: 4, color: '#d95050', cursor: 'pointer',
  fontSize: 12, padding: '6px 12px', fontFamily: 'inherit',
};

const btnStarter: React.CSSProperties = {
  background: 'rgba(74, 143, 212, 0.1)',
  border: '1px solid rgba(74, 143, 212, 0.4)',
  borderRadius: 4,
  color: '#6ab4f0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 14px',
  fontFamily: 'inherit',
};

const btnAi: React.CSSProperties = {
  background: 'linear-gradient(135deg, rgba(163, 113, 247, 0.15), rgba(74, 143, 212, 0.15))',
  border: '1px solid #a371f7',
  borderRadius: 4,
  color: '#c8a8ff',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 14px',
  fontFamily: 'inherit',
  letterSpacing: 0.3,
};

const btnAiDisabled: React.CSSProperties = {
  background: 'rgba(163, 113, 247, 0.05)',
  border: '1px dashed rgba(163, 113, 247, 0.4)',
  borderRadius: 4,
  color: '#a371f7',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 14px',
  fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#cccccc',
  fontSize: 12,
  padding: '3px 6px',
  fontFamily: 'inherit',
  outline: 'none',
};

const xBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#aaaaaa',
  cursor: 'pointer',
  fontSize: 16,
  padding: '0 4px',
  lineHeight: 1,
};

const addRowBtn: React.CSSProperties = {
  marginTop: 6,
  background: 'transparent',
  border: '1px dashed #3a3a3a',
  borderRadius: 3,
  color: '#aaaaaa',
  cursor: 'pointer',
  fontSize: 11,
  padding: '4px 10px',
  fontFamily: 'inherit',
  width: '100%',
};
