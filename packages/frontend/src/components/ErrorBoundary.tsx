/**
 * ErrorBoundary global.
 *
 * Captura exceções de render/lifecycle nos descendentes e mostra um fallback
 * em vez de deixar o app virar tela branca. Erros assíncronos (Promise
 * rejeitada, fetch falhando) NÃO são pegos aqui — esses precisam de try/catch
 * ou estado de erro local.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log mínimo no console — quando houver APM (Sentry/Datadog), reportar aqui.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--navy-950)',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 460,
            background: 'var(--navy-900)',
            border: '1px solid var(--navy-700)',
            borderRadius: 16,
            padding: '32px 28px',
            textAlign: 'center',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 18px',
            }}
          >
            <AlertTriangle size={26} />
          </div>

          <h1 className="font-display font-bold text-xl text-slate-100" style={{ marginBottom: 10 }}>
            Algo deu errado
          </h1>
          <p className="text-slate-500 text-sm" style={{ marginBottom: 18 }}>
            A interface encontrou um erro inesperado. Tente recarregar a página. Se persistir,
            avise o suporte técnico com a mensagem abaixo.
          </p>

          <pre
            style={{
              textAlign: 'left',
              background: 'var(--navy-800)',
              border: '1px solid var(--navy-700)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--sl-400)',
              marginBottom: 18,
              overflowX: 'auto',
              maxHeight: 120,
            }}
          >
            {error.message}
          </pre>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn-ghost" onClick={this.reset}>
              Tentar novamente
            </button>
            <button className="btn-primary" onClick={() => window.location.assign('/')}>
              Voltar ao início
            </button>
          </div>
        </div>
      </div>
    );
  }
}
