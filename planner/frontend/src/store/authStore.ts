/**
 * Auth store — Discord identity gate (BYOK-style, no accounts/database).
 *
 * The backend signs a minimal {id, username, global_name, avatar} payload into
 * an httpOnly cookie; this store just mirrors "who am I" for the UI and tracks
 * whether the user chose to continue as a guest. Login is OPTIONAL — guests
 * use the full app; logging in is identity only.
 */

import { create } from 'zustand';

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface AuthState {
  /** Logged-in Discord user, or null (guest / not logged in). */
  user: DiscordUser | null;
  /** True once /api/auth/me has resolved — gates the landing-page decision. */
  checked: boolean;
  /** True if the user clicked "Continue as guest" THIS session. Intentionally
   *  NOT persisted — the landing page is the front door and should reappear on
   *  a fresh load for anyone who isn't logged in. Logged-in users skip it via
   *  the auth cookie. */
  enteredAsGuest: boolean;
  checkMe: () => Promise<void>;
  enterGuest: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  checked: false,
  enteredAsGuest: false,

  checkMe: async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      set({ user: data.user ?? null, checked: true });
    } catch {
      set({ user: null, checked: true });
    }
  },

  enterGuest: () => set({ enteredAsGuest: true }),

  logout: async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    set({ user: null, enteredAsGuest: false });
  },
}));

/** Display name for a Discord user (prefers the friendly global name). */
export function discordDisplayName(u: DiscordUser | null): string {
  if (!u) return '';
  return u.global_name || u.username || 'Pilot';
}

/** Avatar CDN URL for a Discord user, or null when they have no custom avatar. */
export function discordAvatarUrl(u: DiscordUser | null): string | null {
  if (!u || !u.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
}
