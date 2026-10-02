import type { ReactNode } from "react";

/** 가로로 스크롤되는 표 영역. 키보드로 닿아야 하므로 tabIndex 를 둔다(axe scrollable-region-focusable). */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 영역은 키보드로 닿아야 한다
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
