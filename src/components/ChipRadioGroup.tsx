import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon } from "./icons";

export interface ChipRadioOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * 칩 모양의 라디오 그룹(한 개만 고른다): role="radiogroup" + role="radio"/aria-checked.
 * 키보드: 화살표(←↑ 이전, →↓ 다음)·Home·End 로 옮기며 고르고, Tab 은 그룹에 한 번만 멈춘다(roving tabindex).
 * 선택 모양은 공용 .chip 규칙(테두리 한 겹 + 굵게 + 체크 아이콘)을 그대로 쓴다.
 */
export function ChipRadioGroup<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  label,
}: {
  options: readonly ChipRadioOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  /** 보이는 라벨 요소의 id. 없으면 label(aria-label)을 쓴다. */
  labelledBy?: string;
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabbable = selected >= 0 ? selected : 0;

  const move = (to: number) => {
    const n = options.length;
    const i = ((to % n) + n) % n;
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    refs.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(i + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(i - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
      default:
    }
  };

  return (
    <div
      className="chip-row"
      role="radiogroup"
      {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": label })}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          className="chip"
          aria-checked={i === selected}
          tabIndex={i === tabbable ? 0 : -1}
          onClick={() => {
            onChange(o.value);
          }}
          onKeyDown={(e) => {
            onKey(e, i);
          }}
        >
          <CheckIcon />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
