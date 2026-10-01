import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackspaceIcon } from "../components/icons";
import { ApiError, api } from "../lib/api";
import { sessionQueryKey } from "../lib/session";

const MIN_LEN = 4;
const MAX_LEN = 12;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function lockMessage(sec: number): string {
  return `잠시 잠겼어요. ${String(Math.max(1, Math.ceil(sec / 60)))}분 뒤에 다시 해 주세요.`;
}

/** S00. Shows no child information and no app data. */
export function PinScreen() {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [lockedSec, setLockedSec] = useState(0);
  const locked = lockedSec > 0;

  const login = useMutation({
    mutationFn: (value: string) => api("POST", "/session", { body: { pin: value } }),
    onSuccess: async () => {
      setMessage("");
      await qc.invalidateQueries({ queryKey: sessionQueryKey });
    },
    onError: (error) => {
      setPin("");
      if (error instanceof ApiError && error.status === 429) {
        setLockedSec(error.retryAfterSec ?? 60);
        setMessage("");
      } else if (error instanceof ApiError && error.status === 401) {
        setMessage("PIN 이 맞지 않아요.");
      } else if (error instanceof ApiError && error.status === 0) {
        setMessage("연결이 안 돼요. 인터넷을 확인하고 다시 해 주세요.");
      } else {
        setMessage("잠시 문제가 생겼어요. 다시 해 주세요.");
      }
    },
  });

  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => {
      setLockedSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [locked]);

  const busy = login.isPending;
  const disabled = busy || locked;

  const addDigit = useCallback(
    (d: string) => {
      if (disabled) return;
      setMessage("");
      setPin((p) => (p.length < MAX_LEN ? p + d : p));
    },
    [disabled],
  );
  const erase = useCallback(() => {
    if (disabled) return;
    setMessage("");
    setPin((p) => p.slice(0, -1));
  }, [disabled]);
  const submit = useCallback(() => {
    if (disabled || pin.length < MIN_LEN) return;
    login.mutate(pin);
  }, [disabled, pin, login]);

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        addDigit(e.key);
      } else if (e.key === "Backspace") {
        erase();
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [addDigit, erase]);

  const status = locked ? lockMessage(lockedSec) : busy ? "확인하는 중이에요." : message;
  const slots = Math.max(MIN_LEN, pin.length);

  return (
    <main className="pin-screen">
      <h1 className="pin-title">가족 기록</h1>
      <p className="pin-hint" id="pin-hint">
        PIN 을 눌러 주세요.
      </p>
      <div className="pin-dots" aria-hidden="true">
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={i < pin.length ? "pin-dot filled" : "pin-dot"} />
        ))}
      </div>
      <p className="sr-only">{pin.length}자리 입력됨</p>
      <p className="pin-status" role="status" aria-live="polite">
        {status}
      </p>
      <div className="keypad" role="group" aria-label="숫자 키패드" aria-describedby="pin-hint">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="key"
            disabled={disabled}
            onClick={() => {
              addDigit(k);
            }}
          >
            {k}
          </button>
        ))}
        <button type="button" className="key key-aux" disabled={disabled} onClick={erase}>
          <BackspaceIcon />
          <span>지우기</span>
        </button>
        <button
          type="button"
          className="key"
          disabled={disabled}
          onClick={() => {
            addDigit("0");
          }}
        >
          0
        </button>
        <button
          type="button"
          className="key key-primary"
          disabled={disabled || pin.length < MIN_LEN}
          onClick={submit}
        >
          확인
        </button>
      </div>
    </main>
  );
}
