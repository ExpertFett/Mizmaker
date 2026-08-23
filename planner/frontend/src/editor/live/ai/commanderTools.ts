/**
 * Tool schemas for the AI Mission Commander, plus the policy that decides
 * which of them need the GM's thumb before they fire.
 *
 * Everything the model sees is in aviation units (feet, knots, degrees) and
 * string enums. The integer enums Olympus actually wants — ROE 1-based,
 * alarm/EMCON 0-based — are the executors' problem, not the model's.
 *
 * Tools are filtered by the GM's role capability before they're ever offered,
 * so an ATC or JTAC seat can't be talked into spawning a regiment. The backend
 * re-checks every command regardless; this just avoids dangling the option.
 */

import type { AnthropicToolDef } from '../../../ai/anthropicClient';
import type { CmdrCaps, CmdrUnit } from './commanderTypes';

export type CommanderToolName =
  | 'get_picture' | 'search_unit_types' | 'get_airbases' | 'get_bullseye'
  | 'spawn_units' | 'move_units' | 'set_altitude_speed' | 'set_behavior'
  | 'attack_unit' | 'fire_at_point' | 'delete_units' | 'spawn_effect';

type Cap = keyof CmdrCaps;

const CATEGORY_ENUM = ['aircraft', 'helicopter', 'groundunit', 'navyunit'];

const UNIT_IDS_PROP = {
  type: 'array',
  items: { type: 'integer' },
  description: 'olympusID values from get_picture. Never invent these.',
};

interface ToolSpec {
  cap: Cap;
  def: AnthropicToolDef;
}

const SPECS: Record<CommanderToolName, ToolSpec> = {
  get_picture: {
    cap: 'command',
    def: {
      name: 'get_picture',
      description:
        'Read the live tactical picture: every alive unit with its olympusID, type, position, altitude, heading, speed and current ROE. Call this before referencing any unit — IDs change between missions and units die mid-conversation.',
      input_schema: {
        type: 'object',
        properties: {
          coalition: { type: 'string', enum: ['red', 'blue', 'neutral', 'all'], description: 'Default all.' },
          category: { type: 'string', enum: ['Aircraft', 'Helicopter', 'GroundUnit', 'NavyUnit', 'all'], description: 'Default all.' },
          query: { type: 'string', description: 'Substring match against type, callsign and group name.' },
          max_units: { type: 'integer', description: 'Default 60, hard cap 150.' },
        },
      },
    },
  },
  search_unit_types: {
    cap: 'command',
    def: {
      name: 'search_unit_types',
      description:
        'Search the server\'s unit-type database. You MUST call this before spawn_units and use a returned unit_type verbatim — Olympus silently spawns nothing for an unknown type.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORY_ENUM },
          query: { type: 'string', description: 'e.g. "Su-27", "SA-10", "Hornet".' },
          era: { type: 'string' },
          coalition: { type: 'string' },
          max_results: { type: 'integer', description: 'Default 10.' },
        },
        required: ['category', 'query'],
      },
    },
  },
  get_airbases: {
    cap: 'command',
    def: {
      name: 'get_airbases',
      description: 'List airbases on this map with coordinates and coalition. Use for spatial anchoring when the GM names a field.',
      input_schema: { type: 'object', properties: {} },
    },
  },
  get_bullseye: {
    cap: 'command',
    def: {
      name: 'get_bullseye',
      description: 'The mission bullseye lat/lng, for converting bearing/range calls into coordinates.',
      input_schema: { type: 'object', properties: {} },
    },
  },
  spawn_units: {
    cap: 'spawn',
    def: {
      name: 'spawn_units',
      description:
        'Spawn new units at a position. unit_type must come from search_unit_types. Air units may take an altitude and a loadout.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORY_ENUM },
          unit_type: { type: 'string', description: 'Exact key from search_unit_types.' },
          count: { type: 'integer', description: '1-8. Default 1.' },
          coalition: { type: 'string', enum: ['blue', 'red', 'neutral'] },
          lat: { type: 'number' },
          lng: { type: 'number' },
          altitude_ft: { type: 'number', description: 'Air/helicopter only. e.g. angels 20 = 20000.' },
          loadout_name: { type: 'string', description: 'Air only. A loadout name from search_unit_types.' },
          skill: { type: 'string', enum: ['Average', 'Good', 'High', 'Excellent', 'Random'], description: 'Default High.' },
          spread_nm: { type: 'number', description: 'Scatter multiple units by roughly this radius. Default 0.5.' },
        },
        required: ['category', 'unit_type', 'coalition', 'lat', 'lng'],
      },
    },
  },
  move_units: {
    cap: 'command',
    def: {
      name: 'move_units',
      description: 'Send units along a path of waypoints. Replaces their current tasking.',
      input_schema: {
        type: 'object',
        properties: {
          unit_ids: UNIT_IDS_PROP,
          path: {
            type: 'array',
            description: 'Ordered waypoints.',
            items: {
              type: 'object',
              properties: { lat: { type: 'number' }, lng: { type: 'number' } },
              required: ['lat', 'lng'],
            },
          },
        },
        required: ['unit_ids', 'path'],
      },
    },
  },
  set_altitude_speed: {
    cap: 'command',
    def: {
      name: 'set_altitude_speed',
      description: 'Set desired altitude and/or speed for units.',
      input_schema: {
        type: 'object',
        properties: {
          unit_ids: UNIT_IDS_PROP,
          altitude_ft: { type: 'number' },
          altitude_type: { type: 'string', enum: ['ASL', 'AGL'] },
          speed_kt: { type: 'number' },
          speed_type: { type: 'string', enum: ['CAS', 'GS'] },
        },
        required: ['unit_ids'],
      },
    },
  },
  set_behavior: {
    cap: 'command',
    def: {
      name: 'set_behavior',
      description: 'Change engagement behaviour: rules of engagement, alarm state, threat reaction, emissions, power, road-following.',
      input_schema: {
        type: 'object',
        properties: {
          unit_ids: UNIT_IDS_PROP,
          roe: { type: 'string', enum: ['free', 'designated', 'return_fire', 'hold'] },
          alarm_state: { type: 'string', enum: ['auto', 'green', 'red'] },
          reaction_to_threat: { type: 'string', enum: ['none', 'manoeuvre', 'passive', 'evade'] },
          emissions: { type: 'string', enum: ['silent', 'attack', 'defend', 'free'] },
          on_off: { type: 'boolean', description: 'Power a ground unit on or off.' },
          follow_roads: { type: 'boolean' },
        },
        required: ['unit_ids'],
      },
    },
  },
  attack_unit: {
    cap: 'command',
    def: {
      name: 'attack_unit',
      description: 'Order units to attack a specific target unit.',
      input_schema: {
        type: 'object',
        properties: {
          unit_ids: UNIT_IDS_PROP,
          target_id: { type: 'integer', description: 'olympusID of the target.' },
        },
        required: ['unit_ids', 'target_id'],
      },
    },
  },
  fire_at_point: {
    cap: 'command',
    def: {
      name: 'fire_at_point',
      description: 'Order units to fire on or bomb a map position rather than a unit.',
      input_schema: {
        type: 'object',
        properties: {
          unit_ids: UNIT_IDS_PROP,
          lat: { type: 'number' },
          lng: { type: 'number' },
          mode: { type: 'string', enum: ['fire_at_area', 'bomb_point'] },
        },
        required: ['unit_ids', 'lat', 'lng', 'mode'],
      },
    },
  },
  delete_units: {
    cap: 'delete',
    def: {
      name: 'delete_units',
      description: 'Remove units from the mission. Destructive and always needs the Game Master to approve.',
      input_schema: {
        type: 'object',
        properties: {
          unit_ids: UNIT_IDS_PROP,
          explosion: { type: 'boolean', description: 'Destroy with an explosion instead of despawning. Default false.' },
        },
        required: ['unit_ids'],
      },
    },
  },
  spawn_effect: {
    cap: 'effects',
    def: {
      name: 'spawn_effect',
      description: 'Place coloured smoke or trigger an explosion at a position.',
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['smoke', 'explosion'] },
          lat: { type: 'number' },
          lng: { type: 'number' },
          color: { type: 'string', enum: ['green', 'red', 'white', 'blue', 'orange'], description: 'Smoke only. Default green.' },
          explosion_type: { type: 'string', description: 'Explosion only.' },
          intensity: { type: 'integer', description: 'Explosion only. Default 50.' },
        },
        required: ['kind', 'lat', 'lng'],
      },
    },
  },
};

const READ_ONLY: ReadonlySet<string> = new Set<CommanderToolName>([
  'get_picture', 'search_unit_types', 'get_airbases', 'get_bullseye',
]);

export function buildTools(caps: CmdrCaps): AnthropicToolDef[] {
  return (Object.keys(SPECS) as CommanderToolName[])
    .filter((n) => caps[SPECS[n].cap])
    .map((n) => SPECS[n].def);
}

export function isKnownTool(name: string): name is CommanderToolName {
  return Object.prototype.hasOwnProperty.call(SPECS, name);
}

export function isMutating(name: string): boolean {
  return !READ_ONLY.has(name);
}

/** Which capability a tool needs — used to reject a call if the role changed
 *  mid-session (the model may still hold a stale tool list in its context). */
export function requiredCap(name: string): Cap | null {
  return isKnownTool(name) ? SPECS[name].cap : null;
}

/**
 * Destructive enough that the GM confirms even with auto-execute on. Deleting
 * the wrong group or dropping an explosion on friendlies isn't undoable, and a
 * misheard voice order is exactly how that happens.
 */
export function alwaysConfirm(name: string, input: Record<string, unknown> = {}): boolean {
  if (name === 'delete_units') return true;
  if (name === 'spawn_effect' && input.kind === 'explosion') return true;
  return false;
}

function unitLabel(id: number, units: CmdrUnit[]): string {
  const u = units.find((x) => x.olympusID === id);
  if (!u) return `#${id}`;
  return `${u.unitName || u.groupName || u.name || 'unit'} (#${id})`;
}

function labelList(ids: unknown, units: CmdrUnit[]): string {
  if (!Array.isArray(ids) || !ids.length) return 'no units';
  const named = ids.slice(0, 3).map((id) => unitLabel(Number(id), units));
  const extra = ids.length > named.length ? ` +${ids.length - named.length} more` : '';
  return named.join(', ') + extra;
}

const ROE_WORD: Record<string, string> = {
  free: 'WEAPONS FREE', designated: 'DESIGNATED ONLY',
  return_fire: 'RETURN FIRE', hold: 'WEAPONS HOLD',
};

/** The one-line human summary on the approval card. */
export function describeToolCall(
  name: string,
  input: Record<string, unknown>,
  units: CmdrUnit[],
): string {
  const ids = input.unit_ids;
  switch (name) {
    case 'get_picture':
      return `Read the picture${input.coalition && input.coalition !== 'all' ? ` (${input.coalition})` : ''}`;
    case 'search_unit_types':
      return `Look up ${input.category} types matching "${input.query}"`;
    case 'get_airbases': return 'List airbases';
    case 'get_bullseye': return 'Read the bullseye';
    case 'spawn_units': {
      const n = Number(input.count) || 1;
      const alt = input.altitude_ft ? ` at ${Number(input.altitude_ft).toLocaleString()} ft` : '';
      const at = `${Number(input.lat).toFixed(3)}, ${Number(input.lng).toFixed(3)}`;
      return `Spawn ${n}× ${input.unit_type} (${String(input.coalition).toUpperCase()})${alt} near ${at}`;
    }
    case 'move_units': {
      const pts = Array.isArray(input.path) ? input.path.length : 0;
      return `Move ${labelList(ids, units)} along ${pts} waypoint${pts === 1 ? '' : 's'}`;
    }
    case 'set_altitude_speed': {
      const bits: string[] = [];
      if (input.altitude_ft != null) bits.push(`${Number(input.altitude_ft).toLocaleString()} ft`);
      if (input.speed_kt != null) bits.push(`${Number(input.speed_kt)} kt`);
      return `Set ${bits.join(' / ') || 'altitude/speed'} for ${labelList(ids, units)}`;
    }
    case 'set_behavior': {
      const bits: string[] = [];
      if (input.roe) bits.push(ROE_WORD[String(input.roe)] || String(input.roe));
      if (input.alarm_state) bits.push(`alarm ${input.alarm_state}`);
      if (input.reaction_to_threat) bits.push(`reaction ${input.reaction_to_threat}`);
      if (input.emissions) bits.push(`EMCON ${input.emissions}`);
      if (input.on_off != null) bits.push(input.on_off ? 'power ON' : 'power OFF');
      if (input.follow_roads != null) bits.push(input.follow_roads ? 'follow roads' : 'off-road');
      return `${bits.join(', ') || 'Change behaviour'} for ${labelList(ids, units)}`;
    }
    case 'attack_unit':
      return `${labelList(ids, units)} attack ${unitLabel(Number(input.target_id), units)}`;
    case 'fire_at_point': {
      const verb = input.mode === 'bomb_point' ? 'Bomb' : 'Fire at';
      return `${labelList(ids, units)}: ${verb} ${Number(input.lat).toFixed(3)}, ${Number(input.lng).toFixed(3)}`;
    }
    case 'delete_units':
      return `DELETE ${labelList(ids, units)}${input.explosion ? ' (with explosion)' : ''}`;
    case 'spawn_effect':
      return `${input.kind === 'explosion' ? 'Explosion' : `${input.color || 'green'} smoke`} at ${Number(input.lat).toFixed(3)}, ${Number(input.lng).toFixed(3)}`;
    default:
      return `${name}(${JSON.stringify(input).slice(0, 120)})`;
  }
}
