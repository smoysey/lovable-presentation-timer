import { Component, type ErrorInfo, type ReactNode } from "react";
import { closeWindow } from "@/lib/tauriWindow";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in console for production debugging since this is a desktop overlay
    // eslint-disable-next-line no-console
    console.error("Lovable Timer crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-screen w-screen flex-col items-center justify-center gap-3 rounded-xl border border-destructive/50 bg-card p-4 text-card-foreground"
        >
          <p className="text-sm font-semibold text-destructive">Timer crashed</p>
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
            >
              Reload UI
            </button>
            <button
              type="button"
              onClick={() => void closeWindow()}
              className="rounded-md border border-border px-3 py-1 text-xs font-semibold"
            >
              Quit
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
