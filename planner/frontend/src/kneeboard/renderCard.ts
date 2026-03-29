/**
 * Kneeboard card renderer — HTML → Canvas → PNG pipeline.
 *
 * Takes a React element, renders it to a static HTML string,
 * draws it onto a canvas via SVG foreignObject, and exports as PNG blob.
 */

import ReactDOMServer from 'react-dom/server';
import type { ReactElement } from 'react';

const CARD_W = 600;
const CARD_H = 850;

export async function renderCardToBlob(element: ReactElement): Promise<Blob> {
  const html = ReactDOMServer.renderToStaticMarkup(element);

  // Wrap in SVG foreignObject for canvas rendering
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">${html}</div>
      </foreignObject>
    </svg>`;

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG image load failed'));
    };
    img.src = url;
  });
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
