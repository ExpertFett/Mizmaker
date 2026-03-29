/**
 * Kneeboard card renderer — renders a React element to PNG via html2canvas.
 *
 * Mounts the element into a hidden container, captures with html2canvas,
 * exports as PNG blob. No SVG foreignObject — avoids tainted canvas issues.
 */

import html2canvas from 'html2canvas';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';

const CARD_W = 600;
const CARD_H = 850;

export async function renderCardToBlob(element: ReactElement): Promise<Blob> {
  // Create a hidden container
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = `${CARD_W}px`;
  container.style.height = `${CARD_H}px`;
  container.style.overflow = 'hidden';
  document.body.appendChild(container);

  // Mount the React element
  const root = createRoot(container);
  root.render(element);

  // Wait for render to flush
  await new Promise((r) => setTimeout(r, 50));

  try {
    const canvas = await html2canvas(container, {
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
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    });
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

export async function renderCardToDataUrl(element: ReactElement): Promise<string> {
  const blob = await renderCardToBlob(element);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
