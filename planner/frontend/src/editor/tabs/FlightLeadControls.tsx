/**
 * Flight lead controls panel.
 *
 * The numbers the cards used to hardcode, grouped the way a flight lead thinks
 * about them rather than by which file they came from. Every control shows its
 * default, and the whole block resets in one click, because the point of the
 * defaults is that they are safe to return to.
 *
 * Scope is worth reading off the layout: the SOP group is set once for the
 * squadron, the rest are per-mission calls.
 */

import { useState } from 'react';
import {
  DEFAULT_OPTIONS, type KneeboardOptions,
} from '../../kneeboard/options';

interface Props {
  value: KneeboardOptions;
  onChange: (next: KneeboardOptions) => void;
}

const C = {
  bg: '#1e1e1e',
  line: '#333333',
  text: '#dddddd',
  dim: '#888888',
  accent: '#7aa7ff',
  warn: '#e0b566',
};

const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 108px',
  alignItems: 'center',
  gap: 8,
  padding: '3px 0',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#262626',
  border: `1px solid ${C.line}`,
  borderRadius: 3,
  color: C.text,
  fontSize: 12,
  padding: '3px 6px',
  fontFamily: 'inherit',
};

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span style={{ fontSize: 12, color: C.text }}>
      {children}
      {hint && <span style={{ color: C.dim, fontSize: 11, display: 'block' }}>{hint}</span>}
    </span>
  );
}

function Num({ label, hint, value, onChange, step = 1, min, max, suffix }: {
  label: string; hint?: string; value: number;
  onChange: (n: number) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <label style={row}>
      <Label hint={hint}>{label}</Label>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number" value={value} step={step} min={min} max={max}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          style={inputStyle}
        />
        {suffix && <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{suffix}</span>}
      </span>
    </label>
  );
}

function Choice<T extends string>({ label, hint, value, options, onChange }: {
  label: string; hint?: string; value: T;
  options: readonly { v: T; t: string }[]; onChange: (v: T) => void;
}) {
  return (
    <label style={row}>
      <Label hint={hint}>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={inputStyle}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </label>
  );
}

function Group({ title, scope, children, open, onToggle }: {
  title: string; scope: 'SOP' | 'Flight' | 'App';
  children: React.ReactNode; open: boolean; onToggle: () => void;
}) {
  const scopeColor = scope === 'SOP' ? C.accent : scope === 'Flight' ? C.warn : C.dim;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, marginBottom: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '7px 10px', color: C.text, fontSize: 12.5, fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span style={{ color: C.dim, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{
          fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: scopeColor, border: `1px solid ${scopeColor}`, borderRadius: 2,
          padding: '1px 5px',
        }}>{scope}</span>
      </button>
      {open && <div style={{ padding: '0 10px 9px' }}>{children}</div>}
    </div>
  );
}

export function FlightLeadControls({ value, onChange }: Props) {
  const [open, setOpen] = useState<string | null>('fuel');
  const toggle = (k: string) => setOpen(open === k ? null : k);

  // Each setter replaces one group, leaving the rest untouched.
  const set = <K extends keyof KneeboardOptions>(k: K, patch: Partial<KneeboardOptions[K]>) =>
    onChange({ ...value, [k]: { ...value[k], ...patch } });

  const setPopup = (patch: Partial<KneeboardOptions['weapons']['popup']>) =>
    onChange({
      ...value,
      weapons: { ...value.weapons, popup: { ...value.weapons.popup, ...patch } },
    });

  const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_OPTIONS);

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 4, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Flight lead controls</span>
        <span style={{ fontSize: 11, color: C.dim, flex: 1 }}>
          {isDefault ? 'all defaults' : 'customised'}
        </span>
        {!isDefault && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_OPTIONS)}
            style={{
              fontSize: 10, cursor: 'pointer', padding: '2px 7px',
              background: 'transparent', color: C.accent,
              border: `1px solid ${C.line}`, borderRadius: 2,
            }}
          >
            reset all
          </button>
        )}
      </div>

      <Group title="Fuel" scope="SOP" open={open === 'fuel'} onToggle={() => toggle('fuel')}>
        <Num label="Bingo floor" hint="Bingo never computes below this"
             value={value.fuel.bingoFloorLbs} step={100} min={0}
             suffix="lb" onChange={(n) => set('fuel', { bingoFloorLbs: n })} />
        <Num label="Joker" hint="Fraction of start fuel"
             value={Math.round(value.fuel.jokerPct * 100)} step={1} min={0} max={100}
             suffix="%" onChange={(n) => set('fuel', { jokerPct: n / 100 })} />
        <Num label="Bingo" hint="Fraction of start, before the floor"
             value={Math.round(value.fuel.bingoPct * 100)} step={1} min={0} max={100}
             suffix="%" onChange={(n) => set('fuel', { bingoPct: n / 100 })} />
        <Num label="Joker margin" hint="Kept at least this far above bingo"
             value={value.fuel.jokerMarginLbs} step={100} min={0}
             suffix="lb" onChange={(n) => set('fuel', { jokerMarginLbs: n })} />
        <Num label="Known cruise flow" hint="Scales the burn model to a gauge reading; 0 = model only"
             value={value.fuel.knownCruisePph} step={100} min={0}
             suffix="pph" onChange={(n) => set('fuel', { knownCruisePph: n })} />
        <label style={row}>
          <Label hint="Compare recovery fuel to the landing weight limit">Recovery weight check</Label>
          <input type="checkbox" checked={value.fuel.checkRecoveryWeight}
                 onChange={(e) => set('fuel', { checkRecoveryWeight: e.target.checked })}
                 style={{ justifySelf: 'start' }} />
        </label>
        <Num label="Trap limit override" hint="0 = published figure for the airframe"
             value={value.fuel.trapLimitLbs} step={500} min={0}
             suffix="lb" onChange={(n) => set('fuel', { trapLimitLbs: n })} />
      </Group>

      <Group title="Threats" scope="Flight" open={open === 'threats'} onToggle={() => toggle('threats')}>
        <Num label="Threat floor" hint="Hide systems shorter-ranged than this; 0 keeps all"
             value={value.threats.minRangeKm} step={1} min={0}
             suffix="km" onChange={(n) => set('threats', { minRangeKm: n })} />
        <Num label="Site clustering" hint="Same system within this merges to one row"
             value={value.threats.siteRadiusNm} step={0.5} min={0}
             suffix="nm" onChange={(n) => set('threats', { siteRadiusNm: n })} />
        <Choice label="Ring shows" hint="What the drawn circle means"
                value={value.threats.ringBasis}
                options={[
                  { v: 'max', t: 'Max range' },
                  { v: 'practical', t: 'Practical' },
                  { v: 'both', t: 'Both rings' },
                ] as const}
                onChange={(v) => set('threats', { ringBasis: v })} />
        {value.threats.ringBasis !== 'max' && (
          <Num label="Practical factor" hint="Fraction of max range; no per-system WEZ data exists"
               value={Math.round(value.threats.practicalFactor * 100)} step={5} min={10} max={100}
               suffix="%" onChange={(n) => set('threats', { practicalFactor: n / 100 })} />
        )}
      </Group>

      <Group title="Navigation &amp; terrain" scope="SOP" open={open === 'nav'} onToggle={() => toggle('nav')}>
        <Num label="MSA buffer" hint="Over the highest terrain in the corridor"
             value={value.nav.msaBufferFt} step={100} min={0}
             suffix="ft" onChange={(n) => set('nav', { msaBufferFt: n })} />
        <Num label="MSA corridor" hint="Sampled either side of track"
             value={value.nav.msaCorridorNm} step={1} min={1}
             suffix="nm" onChange={(n) => set('nav', { msaCorridorNm: n })} />
        <Num label="Waypoints / strip sheet" hint="Fewer means a bigger map"
             value={value.nav.waypointsPerStripPage} step={1} min={2} max={20}
             onChange={(n) => set('nav', { waypointsPerStripPage: n })} />
        <Choice label="Strip orientation" hint="Track-up rotates each sheet so the leg runs up the page"
                value={value.nav.stripOrientation}
                options={[
                  { v: 'north', t: 'North-up' },
                  { v: 'track', t: 'Track-up' },
                ] as const}
                onChange={(v) => set('nav', { stripOrientation: v })} />
        <Num label="Pinned scale" hint="NM across the frame; 0 = each map fits its own legs"
             value={value.nav.pinnedScaleNm} step={5} min={0}
             suffix="nm" onChange={(n) => set('nav', { pinnedScaleNm: n })} />
        <Choice label="Map base layer" value={value.nav.mapLayer}
                options={[
                  { v: 'satellite', t: 'Satellite' },
                  { v: 'dark', t: 'Dark topo' },
                  { v: 'none', t: 'None' },
                ] as const}
                onChange={(v) => set('nav', { mapLayer: v })} />
      </Group>

      <Group title="Diverts" scope="Flight" open={open === 'diverts'} onToggle={() => toggle('diverts')}>
        <Num label="How many diverts" hint="Drives every card that lists them"
             value={value.diverts.count} step={1} min={1} max={20}
             onChange={(n) => set('diverts', { count: n })} />
        <Num label="Search radius" hint="Route-relevant within this of any waypoint"
             value={value.diverts.searchRadiusNm} step={5} min={5}
             suffix="nm" onChange={(n) => set('diverts', { searchRadiusNm: n })} />
        <Choice label="Enemy fields" value={value.diverts.enemyFields}
                options={[
                  { v: 'hide', t: 'Hide' },
                  { v: 'mark', t: 'List, marked' },
                  { v: 'include', t: 'Include' },
                ] as const}
                onChange={(v) => set('diverts', { enemyFields: v })} />
      </Group>

      <Group title="Comms" scope="SOP" open={open === 'comms'} onToggle={() => toggle('comms')}>
        <label style={row}>
          <Label hint="Comma separated MHz; empty drops the rung">Guard</Label>
          <input
            type="text"
            value={value.comms.guardMhz.join(', ')}
            onChange={(e) => set('comms', {
              guardMhz: e.target.value.split(',')
                .map((x) => parseFloat(x.trim()))
                .filter((n) => Number.isFinite(n) && n > 0),
            })}
            style={inputStyle}
          />
        </label>
        <label style={row}>
          <Label hint="Preset channel tags, e.g. L / R">Radio labels</Label>
          <input
            type="text"
            value={value.comms.radioLabels.join(' / ')}
            onChange={(e) => {
              const parts = e.target.value.split('/').map((x) => x.trim());
              set('comms', { radioLabels: [parts[0] ?? 'L', parts[1] ?? 'R'] });
            }}
            style={inputStyle}
          />
        </label>
      </Group>

      <Group title="Popup attack limits" scope="SOP" open={open === 'popup'} onToggle={() => toggle('popup')}>
        <div style={{ fontSize: 11, color: C.dim, padding: '2px 0 6px' }}>
          What a profile is judged against. These were fixed values the card
          claimed your SOP overrode.
        </div>
        <Num label="Pull-out G" value={value.weapons.popup.recoveryG} step={0.5} min={1.5} max={9}
             suffix="g" onChange={(n) => setPopup({ recoveryG: n })} />
        <Num label="Terrain floor" hint="Clearance at the bottom of the pull-out"
             value={value.weapons.popup.terrainMarginFt} step={100} min={0}
             suffix="ft" onChange={(n) => setPopup({ terrainMarginFt: n })} />
        <Num label="Ingress hard deck" value={value.weapons.popup.ingressHardDeckFtAgl}
             step={50} min={0} suffix="ft" onChange={(n) => setPopup({ ingressHardDeckFtAgl: n })} />
        <Num label="Frag clearance" hint="Minimum release for unguided bombs"
             value={value.weapons.popup.minReleaseAglFt} step={100} min={0}
             suffix="ft" onChange={(n) => setPopup({ minReleaseAglFt: n })} />
        <Num label="Popup angle min" value={value.weapons.popup.popupAngleDeg.min} step={1} min={1} max={89}
             suffix="°" onChange={(n) => setPopup({ popupAngleDeg: { ...value.weapons.popup.popupAngleDeg, min: n } })} />
        <Num label="Popup angle max" value={value.weapons.popup.popupAngleDeg.max} step={1} min={1} max={89}
             suffix="°" onChange={(n) => setPopup({ popupAngleDeg: { ...value.weapons.popup.popupAngleDeg, max: n } })} />
        <Num label="Dive angle min" value={value.weapons.popup.diveAngleDeg.min} step={1} min={1} max={89}
             suffix="°" onChange={(n) => setPopup({ diveAngleDeg: { ...value.weapons.popup.diveAngleDeg, min: n } })} />
        <Num label="Dive angle max" value={value.weapons.popup.diveAngleDeg.max} step={1} min={1} max={89}
             suffix="°" onChange={(n) => setPopup({ diveAngleDeg: { ...value.weapons.popup.diveAngleDeg, max: n } })} />
      </Group>

      <Group title="Weapons &amp; laser" scope="Flight" open={open === 'weapons'} onToggle={() => toggle('weapons')}>
        <Num label="Target chip" hint="Half-width of a DMPI imagery chip"
             value={value.weapons.targetChipNm} step={0.05} min={0.05}
             suffix="nm" onChange={(n) => set('weapons', { targetChipNm: n })} />
        <Num label="Laser code base" hint="Ladder start when the SOP sets none"
             value={value.weapons.laserCodeBase} step={1} min={1111} max={1777}
             onChange={(n) => set('weapons', { laserCodeBase: n })} />
      </Group>

      <Group title="Weather" scope="SOP" open={open === 'weather'} onToggle={() => toggle('weather')}>
        <label style={row}>
          <Label hint="Show the contrail band on the weather card">Contrails</Label>
          <input
            type="checkbox"
            checked={value.weather.showContrails}
            onChange={(e) => set('weather', { showContrails: e.target.checked })}
            style={{ justifySelf: 'start' }}
          />
        </label>
        <Num label="Contrail onset" value={value.weather.contrailOnsetC} step={1} max={0}
             suffix="°C" onChange={(n) => set('weather', { contrailOnsetC: n })} />
        <Num label="Contrail top" value={value.weather.contrailTopC} step={1} max={0}
             suffix="°C" onChange={(n) => set('weather', { contrailTopC: n })} />
      </Group>

      <Group title="Presentation" scope="App" open={open === 'layout'} onToggle={() => toggle('layout')}>
        <Choice label="Table density" hint="Rows per card before it paginates"
                value={value.layout.density}
                options={[
                  { v: 'compact', t: 'Compact' },
                  { v: 'normal', t: 'Normal' },
                  { v: 'large', t: 'Large print' },
                ] as const}
                onChange={(v) => set('layout', { density: v })} />
        <Choice label="Notes box" value={value.layout.notesSize}
                options={[
                  { v: 'none', t: 'None' },
                  { v: 'quarter', t: 'Quarter card' },
                  { v: 'half', t: 'Half card' },
                ] as const}
                onChange={(v) => set('layout', { notesSize: v })} />
        <label style={row}>
          <Label hint="Card types in deck order, comma separated; unlisted keep their place">
            Card order
          </Label>
          <input
            type="text"
            value={value.layout.cardOrder.join(', ')}
            onChange={(e) => set('layout', {
              cardOrder: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
            })}
            style={inputStyle}
          />
        </label>
        <Choice label="Store names" hint="On the station loadout diagram"
                value={value.layout.storeNames}
                options={[
                  { v: 'short', t: 'Short' },
                  { v: 'full', t: 'Full' },
                ] as const}
                onChange={(v) => set('layout', { storeNames: v })} />
      </Group>
    </div>
  );
}
