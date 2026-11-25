import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || "Unexpected rendering error." };
  }

  componentDidCatch(error: Error) {
    console.error("Ayuva UI ErrorBoundary:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto my-12 max-w-lg rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-950 backdrop-blur-md">
          <div className="flex items-center gap-2 font-display text-lg font-semibold">
            <AlertTriangle className="size-5 shrink-0 text-rose-700" aria-hidden="true" />
            <span>Something went wrong in this view</span>
          </div>
          <p className="mt-2 text-sm">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span>Reload Application</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
