/**
 * Dynamic weapon settings panel — renders fuse type, arming delay, laser code, etc.
 * for a selected weapon CLSID. Fetches schema from /api/launcher-settings/<clsid>.
 *
 * Handles visibility conditions: some controls only show depending on other control values
 * (e.g., arming delay options change based on selected fuse type).
 */

import { useState, useEffect, useCallback } from 'react';

interface SettingSchema {
  id: string;
  label: string;
  control: string;  // "comboList", "spinner", "laserCode"
  defValue: any;
  values?: { id: any; dispName: any; tooltip?: string }[];
  visCondition?: { id: string; value: any; bNot?: boolean }[];
  readOnly?: boolean;
}

interface LauncherSettingsData {
  displayName: string;
  settings: SettingSchema[];
}

// Cache fetched schemas
const schemaCache = new Map<string, LauncherSettingsData | null>();

export function LauncherSettingsPanel({
  clsid,
  currentSettings,
  onChange,
}: {
  clsid: string;
  currentSettings: Record<string, any>;
  onChange: (settings: Record<string, any>) => void;
}) {
  const [schema, setSchema] = useState<LauncherSettingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<Record<string, any>>(currentSettings);

  // Fetch schema on mount or CLSID change
  useEffect(() => {
    if (!clsid) return;

    const cached = schemaCache.get(clsid);
    if (cached !== undefined) {
      setSchema(cached);
      return;
    }

    setLoading(true);
    fetch(`/api/launcher-settings/${encodeURIComponent(clsid)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        schemaCache.set(clsid, data);
        setSchema(data);
        // Initialize values from defaults if not already set
        if (data?.settings) {
          const defaults: Record<string, any> = {};
          for (const s of data.settings) {
            const key = schemaIdToKey(s.id);
            defaults[key] = currentSettings[key] ?? s.defValue;
          }
          setValues(defaults);
        }
      })
      .catch(() => schemaCache.set(clsid, null))
      .finally(() => setLoading(false));
  }, [clsid]);

  const handleChange = useCallback((settingId: string, value: any) => {
    const key = schemaIdToKey(settingId);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      onChange(next);
      return next;
    });
  }, [onChange]);

  if (loading) return <div style={{ color: '#5a7a8a', fontSize: 11, padding: '4px 0' }}>Loading settings...</div>;
  if (!schema || !schema.settings || schema.settings.length === 0) return null;

  // Filter visible settings
  const visible = schema.settings.filter((s) => {
    if (!s.visCondition || s.visCondition.length === 0) return true;
    return checkVisibility(s.visCondition, values, schema.settings);
  });

  if (visible.length === 0) return null;

  return (
    <div style={{
      background: '#0a1520',
      border: '1px solid #1a2a3a',
      borderRadius: 4,
      padding: '6px 8px',
      marginTop: 4,
      fontSize: 11,
    }}>
      {visible.map((s) => {
        const key = schemaIdToKey(s.id);
        const val = values[key] ?? s.defValue;

        if (s.control === 'comboList' && s.values) {
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#5a7a8a', minWidth: 80, fontSize: 11 }}>{s.label}</span>
              <select
                value={val}
                onChange={(e) => handleChange(s.id, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}
                disabled={s.readOnly}
                style={inputStyle}
              >
                {s.values.map((v) => (
                  <option key={String(v.id)} value={v.id} title={v.tooltip}>{v.dispName}</option>
                ))}
              </select>
            </div>
          );
        }

        if (s.control === 'spinner') {
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#5a7a8a', minWidth: 80, fontSize: 11 }}>{s.label}</span>
              <input
                type="number"
                value={val}
                onChange={(e) => handleChange(s.id, Number(e.target.value))}
                disabled={s.readOnly}
                style={{ ...inputStyle, width: 70 }}
              />
            </div>
          );
        }

        if (s.control === 'laserCode') {
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#d29922', minWidth: 80, fontSize: 11 }}>{s.label || 'Laser Code'}</span>
              <input
                type="number"
                min={1111}
                max={8888}
                value={val}
                onChange={(e) => handleChange(s.id, Number(e.target.value))}
                style={{ ...inputStyle, width: 70, color: '#d29922' }}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

/** Strip "NN_prfx_" from schema IDs — same as 856's _schema_id_to_mission_key */
function schemaIdToKey(id: string): string {
  // Strip numeric prefix like "01_prfx_"
  let key = id.replace(/^\d+_prfx_/, '');
  // Preserve NFP_ prefix if present
  if (id.startsWith('NFP_')) {
    key = 'NFP_' + id.replace(/^NFP_\d+_prfx_/, '');
  }
  return key;
}

/** Evaluate visibility conditions */
function checkVisibility(
  conditions: { id: string; value: any; bNot?: boolean }[],
  values: Record<string, any>,
  allSettings: SettingSchema[],
): boolean {
  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i];
    const key = schemaIdToKey(cond.id);
    const setting = allSettings.find((s) => schemaIdToKey(s.id) === key);
    const currentVal = values[key] ?? setting?.defValue;
    let match = String(currentVal) === String(cond.value);
    if (cond.bNot) match = !match;
    if (!match) return false;
  }
  return true;
}

const inputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 11,
  padding: '3px 6px',
  fontFamily: 'monospace',
};
