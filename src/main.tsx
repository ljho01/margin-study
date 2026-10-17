import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "next-themes";
import { Button } from "@/components/ui/button";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "katex/dist/katex.min.css";
import "./styles.css";
class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null; stack: string }
> {
  state = { error: null as Error | null, stack: "" };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ stack: info.componentStack ?? "" });
    console.error(error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-lg font-semibold">렌더링 오류</h1>
        <pre className="whitespace-pre-wrap text-sm text-destructive">
          {this.state.error.message}
          {import.meta.env.DEV && this.state.stack}
        </pre>
        <Button onClick={() => location.reload()}>다시 열기</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
