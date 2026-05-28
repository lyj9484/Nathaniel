import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0a0e1a] text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">오류가 발생했습니다</h2>
            <p className="text-sm text-slate-400">
              화면을 새로고침하면 보통 해결됩니다. 반복되면 피드백으로 알려주세요.
            </p>
            <pre className="text-[11px] text-slate-500 bg-slate-950 rounded p-2 overflow-auto">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 rounded-full bg-amber-500 text-slate-950 text-sm font-medium hover:bg-amber-400"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
