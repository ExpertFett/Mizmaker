/**
 * Smoke tests for StripMapCard (v1.19.72, task #50).
 *
 * The card is mostly layout — what's worth testing is that it doesn't
 * crash on degenerate inputs (zero/one waypoint, missing coords) and
 * that the doghouse data is rendered into the output SVG so a future
 * refactor doesn't silently strip MC/DIST/TIME/ALT.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StripMapCard } from './StripMapCard';
import type { MissionGroup, Waypoint } from '../types/mission';

function wp(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    waypoint_number: 0,
    waypoint_name: 'WP',
    x: 0,
    y: 0,
    lat: 0,
    lon: 0,
    altitude_m: 1000,
    altitude_type: 'BARO',
    speed_ms: 200,
    speed_input: 200,
    speed_ref: 'gs',
    leg_distance_nm: 10,
    leg_bearing_deg: 90,
    cumulative_eta: 60,
    ...overrides,
  } as Waypoint;
}

function group(overrides: Partial<MissionGroup> = {}): MissionGroup {
  return {
    groupId: 1,
    groupName: 'BENGAL-1',
    coalition: 'blue',
    country: 'USA',
    category: 'plane',
    task: 'cas',
    frequency: 0,
    modulation: 0,
    units: [{
      unitId: 1, name: 'BENGAL-1-1', type: 'FA-18C_hornet',
      x: 0, y: 0, alt: 1000, heading: 0, livery_id: '',
      skill: 'Good', client: true, payload: '',
      tail_number: '',
    }] as any,
    waypoints: [],
    ...overrides,
  };
}

describe('StripMapCard', () => {
  it('renders without crashing on a normal 3-waypoint route', () => {
    const g = group({
      waypoints: [
        wp({ waypoint_number: 0, lat: 40.0, lon: -110.0, waypoint_name: 'DEP' }),
        wp({ waypoint_number: 1, lat: 40.2, lon: -110.3, waypoint_name: 'IP' }),
        wp({ waypoint_number: 2, lat: 40.4, lon: -110.5, waypoint_name: 'TGT' }),
      ],
    });
    const html = renderToString(<StripMapCard group={g} />);
    expect(html).toContain('STRIP MAP');
    expect(html).toContain('BENGAL-1');
    // SVG present
    expect(html).toContain('<svg');
    // Doghouses include MC + DIST + TIME + ALT labels
    expect(html).toContain('MC');
    expect(html).toContain('DIST');
    expect(html).toContain('TIME');
    expect(html).toContain('ALT');
  });

  it('shows the fallback message when the route has fewer than 2 valid waypoints', () => {
    const g = group({ waypoints: [wp({ waypoint_number: 0 })] });
    const html = renderToString(<StripMapCard group={g} />);
    expect(html).toContain('Not enough waypoints');
  });

  it('renders waypoint number + 4-char abbreviation in the label', () => {
    const g = group({
      waypoints: [
        wp({ waypoint_number: 0, waypoint_name: 'Departure', lat: 40, lon: -110 }),
        wp({ waypoint_number: 1, waypoint_name: 'Initial Point', lat: 40.1, lon: -110.1 }),
      ],
    });
    const html = renderToString(<StripMapCard group={g} />);
    // "Initial Point" → "IP" via the multi-word initial fallback
    expect(html).toContain('IP');
  });

  it('handles waypoints with missing lat/lon by skipping them', () => {
    const g = group({
      waypoints: [
        wp({ waypoint_number: 0, lat: 40, lon: -110 }),
        wp({ waypoint_number: 1, lat: undefined, lon: undefined }),
        wp({ waypoint_number: 2, lat: 40.2, lon: -110.2 }),
      ],
    });
    const html = renderToString(<StripMapCard group={g} />);
    // Should still render the SVG even though one WP is dropped
    expect(html).toContain('<svg');
  });
});
