import type { ReactNode } from "react";
import { CheckIcon } from "./icons";

/** 선택 칩: 선택은 색 + 체크 아이콘 + aria-pressed (색만으로 구분하지 않는다). */
export function Chip({
  pressed,
  onPress,
  children,
}: {
  pressed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onPress}>
      <CheckIcon />
      <span>{children}</span>
    </button>
  );
}
