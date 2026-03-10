import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary caught]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 text-center space-y-2">
          <div className="text-2xl">⚠️</div>
          <p className="text-red-400 font-semibold">Something went wrong</p>
          <p className="text-slate-500 text-sm">
            {this.state.error?.message ?? 'An unexpected error occurred in this panel.'}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
