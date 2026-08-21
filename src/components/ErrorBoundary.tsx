import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Nothing external to report to yet — at minimum this keeps the crash
    // visible in the console instead of a silent blank screen.
    // eslint-disable-next-line no-console
    console.error('Aviyana crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0b1a33] px-6">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <h1 className="text-lg font-bold text-white">Something went wrong</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Aviyana ran into an unexpected error and couldn't continue. Your data is safe — reloading
              usually fixes this.
            </p>
            {this.state.message && (
              <p className="text-[11px] text-slate-500 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono break-words">
                {this.state.message}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#f4c115] hover:bg-[#e0b010] text-[#0b1a33] font-semibold text-sm transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
