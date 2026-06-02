/**
 * LiveErrorBoundary — catches render-time crashes in the Live terminal so
 * users get a useful error message instead of a blank screen.
 *
 * Hit blank-page bugs twice now in the LotATC scope build (Live Map). Without
 * an error boundary React unmounts the entire subtree on a thrown render and
 * the user sees... nothing. With this in place: error message, the stack
 * (collapsible), a "Reload" button, and a "Reset Live state" escape hatch
 * that wipes the `dcsopt.live.*` localStorage keys so corrupted persisted
 * state can't pin them in a broken loop.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State {
  err: Error | null;
  info: ErrorInfo | null;
  showStack: boolean;
}

export class LiveErrorBoundary extends Component<Props, State> {
  state: State = { err: null, info: null, showStack: false };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Live terminal crash:', err, info);
    this.setState({ info });
  }

  private resetLiveStorage = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('dcsopt.live.')) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    window.location.reload();
  };

  render() {
    if (!this.state.err) return this.props.children;
    const C = {
      bg: '#0d131d', border: '#243349', red: '#e0554f',
      text: '#dce6f2', textDim: '#8aa0ba', amber: '#ffd24a',
    };
    return (
      <div style={{ padding: 24, color: C.text, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: C.bg }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: 20, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 18, color: C.red, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
            ⚠ Live terminal crashed
          </div>
          <p style={{ color: C.textDim, lineHeight: 1.6 }}>
            Something in the Live UI threw during render. The error and reload
            options below give us enough to debug. Persisted scope state
            (rings, markers, BE, charts) might be the culprit — try the reset
            button if a plain reload doesn't help.
          </p>
          <div style={{ background: 'rgba(224,85,79,0.08)', border: `1px solid ${C.red}`, borderLeftWidth: 3, padding: '10px 14px', borderRadius: 4, marginTop: 14 }}>
            <div style={{ fontSize: 12, letterSpacing: 0.5, color: C.red, fontWeight: 700, marginBottom: 4 }}>
              {this.state.err.name || 'Error'}
            </div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: C.text, whiteSpace: 'pre-wrap' }}>
              {this.state.err.message}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={() => window.location.reload()} style={btnStyle('#3a6ea5', '#4a9eff')}>
              Reload page
            </button>
            <button onClick={this.resetLiveStorage} style={btnStyle('#5a3a2a', C.amber)} title="Wipes dcsopt.live.* keys then reloads">
              Reset Live state + reload
            </button>
            <button onClick={() => this.setState({ showStack: !this.state.showStack })} style={btnStyle(C.border, C.textDim)}>
              {this.state.showStack ? 'Hide' : 'Show'} stack
            </button>
          </div>
          {this.state.showStack && (
            <pre style={{ marginTop: 14, padding: 12, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11, color: C.textDim, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
{(this.state.err.stack || 'no stack') + '\n\n' + (this.state.info?.componentStack || 'no component stack')}
            </pre>
          )}
          <div style={{ marginTop: 14, fontSize: 11, color: C.textDim }}>
            If the same crash repeats after reset, please send the error
            message above (and the stack if you toggled it open).
          </div>
        </div>
      </div>
    );
  }
}

function btnStyle(border: string, color: string): React.CSSProperties {
  return {
    background: 'transparent', border: `1px solid ${border}`, color,
    padding: '7px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: 600,
  };
}
