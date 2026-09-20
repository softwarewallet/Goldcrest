import React from 'react';

interface RuntimeErrorBoundaryState {
  hasError: boolean;
  message: string;
  stack: string;
}

export class RuntimeErrorBoundary extends React.Component<
  React.PropsWithChildren,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = {
    hasError: false,
    message: '',
    stack: ''
  };

  static getDerivedStateFromError(error: Error): RuntimeErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unknown runtime error',
      stack: error?.stack || ''
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[GOLDCREST_RUNTIME_ERROR]', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-[#03070d] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl rounded-2xl border border-rose-700/70 bg-slate-900 shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 bg-rose-950/30">
            <div className="text-sm font-bold text-rose-300 tracking-wide">GOLDCREST RUNTIME ERROR</div>
            <div className="text-xs text-slate-400 mt-1">
              The application stopped rendering after a client-side exception.
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="rounded-lg border border-rose-800/60 bg-slate-950 p-3 font-mono text-sm text-rose-200 break-words">
              {this.state.message}
            </div>
            {this.state.stack && (
              <pre className="max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-400 whitespace-pre-wrap">
                {this.state.stack}
              </pre>
            )}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={this.reload}
                className="px-4 py-2 rounded-lg border border-emerald-700 bg-emerald-950/60 text-emerald-300 font-bold hover:bg-emerald-900/60"
              >
                Reload Goldcrest
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
