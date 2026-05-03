/**
 * dmpiStore — DMPI list + map-pick mode tests.
 *
 * Covers the picking handshake (startPicking → finishPicking writes
 * lat/lon and clears mode) which is what the map-click feature relies
 * on. Without this, a regression that loses the pickingForId midway
 * could silently drop user picks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useDmpiStore } from './dmpiStore';

describe('dmpiStore', () => {
  beforeEach(() => {
    useDmpiStore.setState({ dmpis: [], pickingForId: null });
  });

  describe('add / update / remove', () => {
    it('add() appends a new DMPI with auto-numbered name', () => {
      useDmpiStore.getState().add();
      useDmpiStore.getState().add();
      const list = useDmpiStore.getState().dmpis;
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('DMPI 1');
      expect(list[1].name).toBe('DMPI 2');
    });

    it('add() returns the new id and ids are unique', () => {
      const a = useDmpiStore.getState().add();
      const b = useDmpiStore.getState().add();
      expect(a).not.toBe(b);
      expect(useDmpiStore.getState().dmpis.map((d) => d.id)).toEqual([a, b]);
    });

    it('update() patches the matched DMPI only', () => {
      const a = useDmpiStore.getState().add();
      const b = useDmpiStore.getState().add();
      useDmpiStore.getState().update(a, { name: 'Hot Pad' });
      const list = useDmpiStore.getState().dmpis;
      expect(list[0].name).toBe('Hot Pad');
      expect(list[1].name).toBe('DMPI 2');
      void b;
    });

    it('remove() drops the matched DMPI', () => {
      const a = useDmpiStore.getState().add();
      const b = useDmpiStore.getState().add();
      useDmpiStore.getState().remove(a);
      expect(useDmpiStore.getState().dmpis.map((d) => d.id)).toEqual([b]);
    });
  });

  describe('picking handshake', () => {
    it('startPicking() sets pickingForId', () => {
      const a = useDmpiStore.getState().add();
      useDmpiStore.getState().startPicking(a);
      expect(useDmpiStore.getState().pickingForId).toBe(a);
    });

    it('finishPicking() writes lat/lon to the targeted DMPI and clears mode', () => {
      const a = useDmpiStore.getState().add();
      useDmpiStore.getState().startPicking(a);
      useDmpiStore.getState().finishPicking(41.123, 44.567);
      const dm = useDmpiStore.getState().dmpis[0];
      expect(dm.lat).toBe(41.123);
      expect(dm.lon).toBe(44.567);
      expect(useDmpiStore.getState().pickingForId).toBeNull();
    });

    it('finishPicking() is a no-op when pickingForId is null', () => {
      const a = useDmpiStore.getState().add();
      // Do NOT call startPicking — this simulates an accidental map
      // click that shouldn't capture into any DMPI.
      useDmpiStore.getState().finishPicking(50, 50);
      const dm = useDmpiStore.getState().dmpis.find((d) => d.id === a)!;
      expect(dm.lat).toBe(0);
      expect(dm.lon).toBe(0);
    });

    it('cancelPicking() clears pickingForId without touching dmpis', () => {
      const a = useDmpiStore.getState().add();
      useDmpiStore.getState().startPicking(a);
      useDmpiStore.getState().cancelPicking();
      expect(useDmpiStore.getState().pickingForId).toBeNull();
      // DMPI list unchanged
      expect(useDmpiStore.getState().dmpis).toHaveLength(1);
      expect(useDmpiStore.getState().dmpis[0].lat).toBe(0);
    });

    it('removing the picked DMPI clears pickingForId', () => {
      const a = useDmpiStore.getState().add();
      useDmpiStore.getState().startPicking(a);
      useDmpiStore.getState().remove(a);
      expect(useDmpiStore.getState().pickingForId).toBeNull();
    });

    it('removing a DIFFERENT DMPI keeps pickingForId intact', () => {
      const a = useDmpiStore.getState().add();
      const b = useDmpiStore.getState().add();
      useDmpiStore.getState().startPicking(a);
      useDmpiStore.getState().remove(b);
      expect(useDmpiStore.getState().pickingForId).toBe(a);
    });
  });
});
