/** Shared kneeboard card constants and styles */

export const W = 600;
export const H = 850;
export const FONT = "'Consolas', 'Courier New', monospace";
export const BG = '#0a1520';
export const BORDER = '#1a3a5a';
export const TEXT = '#ccdae8';
export const DIM = '#5a7a8a';
export const ACCENT = '#4a8fd4';
export const ROW_ALT = 'rgba(74, 143, 212, 0.04)';
export const WARN = '#d9a050';

export const cardRoot: React.CSSProperties = {
  width: W,
  height: H,
  background: BG,
  fontFamily: FONT,
  color: TEXT,
  padding: 0,
  boxSizing: 'border-box',
  overflow: 'hidden',
};

export const headerStyle: React.CSSProperties = {
  padding: '10px 16px 8px',
  borderBottom: `2px solid ${ACCENT}`,
};

export const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: TEXT,
  letterSpacing: 1,
};

export const subtitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: DIM,
  marginTop: 2,
};

export const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: ACCENT,
  textTransform: 'uppercase',
  letterSpacing: 1,
  padding: '6px 16px 4px',
  borderBottom: `1px solid ${BORDER}`,
};

export const cell: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: `1px solid ${BORDER}`,
  fontSize: 10,
  fontFamily: FONT,
  color: TEXT,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

export const th: React.CSSProperties = {
  ...cell,
  fontSize: 9,
  color: ACCENT,
  fontWeight: 600,
  textAlign: 'center',
  borderBottom: `2px solid ${BORDER}`,
  padding: '4px 6px',
};

export const footerStyle: React.CSSProperties = {
  padding: '4px 16px',
  borderTop: `1px solid ${BORDER}`,
  fontSize: 8,
  color: DIM,
  textAlign: 'right',
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
};

export const row: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: '4px 16px',
  fontSize: 10,
};

export const label: React.CSSProperties = {
  color: DIM,
  fontSize: 9,
};

export const value: React.CSSProperties = {
  color: TEXT,
  fontSize: 10,
};
