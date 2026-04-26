/**
 * Shared laser-weapon detection. Used to keep `laserCapableUnits` in
 * sync when LoadoutTab edits change a unit's pylons — without this,
 * adding a laser-guided weapon to a unit didn't make it appear on
 * the LaserTab (the unit was tagged as laser-capable at upload time
 * and the tag never refreshed).
 *
 * Two-stage detection so we catch both the short-form CLSIDs DCS uses
 * for built-in weapons (`GBU-12`, `Paveway II`, etc.) AND the UUID-form
 * CLSIDs used by mods (we cross-reference against the LASER_CLSIDS set
 * the backend ships from pydcs).
 */

const LASER_NAME_PATTERN = /GBU[-\s_]?1[0246]|GBU[-\s_]?24|GBU[-\s_]?27|GBU[-\s_]?28|Paveway|LGB|KAB[-\s_]?500L|KAB[-\s_]?1500L|LJDAM|AGM[-\s_]?65[EKL]|AGM[-\s_]?114[KL]|APKWS|Maverick[-\s_]?E/i;

/**
 * True if the given pylon (by CLSID, full name, or short name) is a
 * laser-guided weapon. Pass any subset of fields that's available;
 * matches are case-insensitive substring/regex.
 *
 * @param laserClsids — the authoritative full-UUID set from the
 *   backend's pydcs LASER_CLSIDS, available on the mission store as
 *   `laserClsids`. Optional — when omitted we fall back to name match.
 */
export function isLaserPylon(
  clsid: string,
  name?: string,
  shortName?: string,
  laserClsids?: string[],
): boolean {
  if (clsid && laserClsids && laserClsids.includes(clsid)) return true;
  if (clsid && LASER_NAME_PATTERN.test(clsid)) return true;
  if (name && LASER_NAME_PATTERN.test(name)) return true;
  if (shortName && LASER_NAME_PATTERN.test(shortName)) return true;
  return false;
}

export { LASER_NAME_PATTERN };
