/**
 * Kneeboard card renderer — DOM element → PNG pipeline.
 *
 * Uses html2canvas to capture rendered DOM elements as PNG.
 * html2canvas reads computed styles and redraws on canvas — no SVG foreignObject.
 */

import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import type { ReactElement } from 'react';
import { applyKbTheme, type KneeboardTheme, type KbVarMap } from './cardStyles';

const CARD_W = 600;
const CARD_H = 850;

/**
 * Capture a visible DOM element as a PNG blob.
 */
export async function captureElementToBlob(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: '#0a1520',
    scale: 1,
    logging: false,
    useCORS: true,
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob failed'));
    }, 'image/png');
  });
}

/**
 * Render a React element into a real DOM node and capture as PNG blob.
 * The container is placed in a clipped wrapper so it's in the document
 * flow (html2canvas needs computed styles) but not visible to the user.
 */
export async function renderCardToBlob(
  element: ReactElement,
  theme: KneeboardTheme = 'night',
  customThemeVars?: KbVarMap,
): Promise<Blob> {
  // Position off-screen but fully visible — html2canvas needs computed styles
  // and skips elements that are clipped/hidden/zero-opacity
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.width = `${CARD_W}px`;
  wrapper.style.height = `${CARD_H}px`;
  wrapper.style.overflow = 'hidden';
  wrapper.style.zIndex = '-1';

  // Container is full-size — html2canvas captures this
  const container = document.createElement('div');
  container.style.width = `${CARD_W}px`;
  container.style.height = `${CARD_H}px`;
  container.style.overflow = 'hidden';
  // Set the theme's CSS variables on the captured container so the card's
  // var(--kb-*) colors resolve to the chosen palette. html2canvas reads
  // computed styles, which resolve these. (v0.9.74)
  applyKbTheme(container, theme, customThemeVars);

  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  const root = createRoot(container);
  root.render(element);

  // Wait for React to flush and browser to compute styles
  await new Promise((r) => setTimeout(r, 300));

  try {
    const canvas = await html2canvas(container, {
      width: CARD_W,
      height: CARD_H,
      // Backdrop behind the card (rarely visible — the card fills the
      // frame). Match it to the theme so any gap reads correctly.
      backgroundColor: theme === 'day' ? '#ffffff' : '#0a1520',
      scale: 1,
      logging: false,
      useCORS: true,
      // Tell html2canvas to scroll to where our element is
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
    });
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob failed'));
      }, 'image/png');
    });
  } finally {
    root.unmount();
    document.body.removeChild(wrapper);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
