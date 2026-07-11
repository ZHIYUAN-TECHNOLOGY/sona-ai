import { Component, type ReactNode } from "react";

// Error boundary for optional NATIVE components. A Fabric view whose native module isn't
// registered in the binary (the react-native-svg / skia failure mode in this precompiled-RN
// setup) throws at render — a JS require-guard can't catch that, but this can. On the first
// render error it swaps to `fallback` and stays there.
export class NativeFallbackBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; onError?: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
