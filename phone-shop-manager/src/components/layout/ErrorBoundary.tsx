import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  private isChunkError(error: Error | null): boolean {
    if (!error || !error.message) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('is not a valid javascript mime type') ||
      msg.includes('failed to fetch dynamically imported') ||
      msg.includes('importing a module script failed') ||
      msg.includes('error loading dynamically imported') ||
      msg.includes('loading chunk')
    );
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    // If this is a stale chunk from a recent deployment, auto-reload to update
    if (this.isChunkError(error)) {
      const lastReload = Number(sessionStorage.getItem('last_chunk_reload_ts') || 0);
      const now = Date.now();
      if (now - lastReload > 8000) {
        sessionStorage.setItem('last_chunk_reload_ts', String(now));
        window.location.reload();
      }
    }
  }

  private handleRetry = () => {
    if (this.isChunkError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const isChunk = this.isChunkError(this.state.error);

      return (
        <div className={styles.container}>
          <div className={styles.card}>
            <div className={styles.iconWrapper} style={isChunk ? { background: '#eff6ff', color: '#2563eb' } : undefined}>
              {isChunk ? <RefreshCw size={32} /> : <AlertTriangle size={32} />}
            </div>
            <h1 className={styles.title}>
              {isChunk ? 'New Version Available' : 'Something went wrong'}
            </h1>
            <p className={styles.message}>
              {isChunk
                ? 'A new update of PhoneShop Manager was published. The app will reload to fetch the latest components.'
                : 'We encountered an unexpected error. Our team has been notified.'}
            </p>
            {this.state.error && (
              <pre className={styles.errorDetails}>
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <Button onClick={this.handleReload} leftIcon={<RefreshCw size={16} />}>
                {isChunk ? 'Update & Reload Now' : 'Reload Page'}
              </Button>
              {!isChunk && (
                <Button onClick={this.handleRetry} leftIcon={<RotateCcw size={16} />} variant="secondary">
                  Try Again
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
