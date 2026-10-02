import { Component, type ReactNode } from "react";

/**
 * 보조 조각(배너 건수·대기열 동기화 등)이 내려받아지지 않아도(연결이 끊긴 채 처음 여는 경우 등) 앱 전체가 멈추지 않게 한다.
 * 실패하면 fallback(기본: 아무것도 안 보임)을 보인다.
 */
export class QuietBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
