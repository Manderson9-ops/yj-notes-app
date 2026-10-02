import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * 앱 안 확인 대화상자(브라우저 기본 confirm 은 쓰지 않는다). <dialog> 모달: 포커스 가두기·Esc 닫기는 브라우저가 한다.
 * 기본 포커스는 안전한 쪽(취소)에 둔다.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "취소",
  secondaryLabel,
  onSecondary,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 취소와 확인 사이의 선택지(예: 지우지 않고 계속). 둘 다 있을 때만 보인다. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancelRef.current?.focus(); // 안전한 쪽(취소)에서 시작
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={onCancel}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="actions">
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button type="button" className="btn" disabled={busy} onClick={onSecondary}>
            {secondaryLabel}
          </button>
        ) : null}
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
