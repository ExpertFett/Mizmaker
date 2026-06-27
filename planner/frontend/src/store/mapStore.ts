import { create } from 'zustand';
import type { UnitCategory } from '../types/mission';

export type ViewMode = 'all' | 'blue' | 'red' | 'players';
export type SpeedMode = 'gs' | 'cas' | 'tas' | 'mach';

/** Per-category visibility filter (v0.9.24). The `layers.statics`
 *  toggle was the only category-level filter through v0.9.23; this
 *  generalises it to all 5 DCS unit categories. Default: every
 *  category visible EXCEPT statics, mirroring the previous default
 *  (statics hidden to declutter). */
export type UnitCategoryFilter = Record<UnitCategory, boolean>;

interface MapState {
  layers: Record<string, any>;
  viewMode: ViewMode;
  hiddenGroupIds: Set<number>;
  /** Per-category unit visibility — see UnitCategoryFilter. */
  unitCategoryFilter: UnitCategoryFilter;
  /** When true, the mission maker's map render mimics a joined
   *  flight lead's view — applies the visibility filter, drops
   *  red coalition + threats, etc. Off by default; toggled from
   *  the Visibility tab so the user can sanity-check their intel
   *  plan before flight leads join. (v0.9.27) */
  previewAsFlightLead: boolean;
  adminMode: boolean;
  speedMode: SpeedMode;
  addWaypointMode: boolean;
  measureMode: boolean;
  /** v1.19.74 — collaborative highlight pen. Open to EVERY session
   *  participant (host, co-editor, flight lead, pilot) — the point is
   *  that a wingman can mark something their lead missed. */
  highlightMode: boolean;
  editorMode: boolean;
  floatingPanelPos: { x: number; y: number };
  /** User-resized flight-panel size; {w:-1,h:-1} = use the default size. */
  floatingPanelSize: { w: number; h: number };
  selectedWpIndex: number | null;

  toggleLayer: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGroupVisibility: (groupId: number) => void;
  /** Flip a single unit category in the filter (e.g. show/hide all
   *  vehicles). Pairs with the dropdown UI in MapToolbar / LayerSwitcher. */
  toggleUnitCategory: (cat: UnitCategory) => void;
  /** Bulk-set the filter — used by the "All" / "None" buttons in the
   *  category dropdown. */
  setUnitCategoryFilter: (filter: UnitCategoryFilter) => void;
  setPreviewAsFlightLead: (on: boolean) => void;
  setAdminMode: (on: boolean) => void;
  setSpeedMode: (mode: SpeedMode) => void;
  setAddWaypointMode: (on: boolean) => void;
  setMeasureMode: (on: boolean) => void;
  setHighlightMode: (on: boolean) => void;
  setEditorMode: (on: boolean) => void;
  setFloatingPanelPos: (pos: { x: number; y: number }) => void;
  setFloatingPanelSize: (size: { w: number; h: number }) => void;
  setSelectedWpIndex: (idx: number | null) => void;
  /** Pin the basemap selection (one of "dark" | "light" | "satellite" | ...).
   *  Lives in the layers map alongside the boolean show/hide flags. */
  setBaseMap: (id: string) => void;
  /** Pin the OSM language layer (e.g. "en", "ru"). Same nesting as
   *  setBaseMap — a single string in the layers record. */
  setMapLang: (lang: string) => void;
}

export const useMapStore = create<MapState>((set) => ({
  layers: {
    units: true,
    routes: true,
    threats: true,
    airbases: true,
    bullseye: true,  // BE per coalition — visible by default for nav reference
    statics: false,  // hidden by default — declutter
    plannerDrawings: true,
    triggerZones: true,
    baseMap: 'dark',
    mapLang: 'en',
  },
  viewMode: 'all',
  hiddenGroupIds: new Set(),
  unitCategoryFilter: {
    plane: true,
    helicopter: true,
    vehicle: true,
    ship: true,
    static: false,  // mirrors the v0.9.23 `layers.statics` default
  },
  previewAsFlightLead: false,
  adminMode: false,
  speedMode: 'gs' as SpeedMode,
  addWaypointMode: false,
  measureMode: false,
  highlightMode: false,
  editorMode: false,
  floatingPanelPos: { x: -1, y: -1 }, // -1 = use default
  floatingPanelSize: { w: -1, h: -1 }, // -1 = use default size
  selectedWpIndex: null,

  toggleLayer: (id) =>
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleGroupVisibility: (groupId) =>
    set((s) => {
      const next = new Set(s.hiddenGroupIds);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { hiddenGroupIds: next };
    }),

  toggleUnitCategory: (cat) =>
    set((s) => ({
      unitCategoryFilter: { ...s.unitCategoryFilter, [cat]: !s.unitCategoryFilter[cat] },
    })),

  setUnitCategoryFilter: (filter) => set({ unitCategoryFilter: filter }),

  setPreviewAsFlightLead: (on) => set({ previewAsFlightLead: on }),

  setAdminMode: (on) => set({ adminMode: on }),
  setSpeedMode: (mode) => set({ speedMode: mode }),
  setAddWaypointMode: (on) => set({ addWaypointMode: on, measureMode: false, highlightMode: false }),
  setMeasureMode: (on) => set({ measureMode: on, addWaypointMode: false, highlightMode: false }),
  setHighlightMode: (on) => set({ highlightMode: on, measureMode: false, addWaypointMode: false }),
  setEditorMode: (on) => set({ editorMode: on }),
  setFloatingPanelPos: (pos) => set({ floatingPanelPos: pos }),
  setFloatingPanelSize: (size) => set({ floatingPanelSize: size }),
  setSelectedWpIndex: (idx) => set({ selectedWpIndex: idx }),

  setBaseMap: (id) => set((s) => ({ layers: { ...s.layers, baseMap: id } })),

  setMapLang: (lang) => set((s) => ({ layers: { ...s.layers, mapLang: lang } })),
}));
