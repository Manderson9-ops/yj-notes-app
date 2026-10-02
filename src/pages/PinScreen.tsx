import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeDecor } from "../components/decor/ThemeDecor";
import { BackspaceIcon } from "../components/icons";
import { ApiError, api } from "../lib/api";
import { sessionQueryKey } from "../lib/session";

const MIN_LEN = 4;
const MAX_LEN = 12;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function lockMessage(sec: number): string {
  return `잠시 잠겼어요. ${String(Math.max(1, Math.ceil(sec / 60)))}분 뒤에 다시 해 주세요.`;
}

/**
 * S00. Shows no child information and no app data.
 * pinLength(서버 PIN_LENGTH)가 있으면 그 자리에서 자동 전송(확인 키 없음), 없으면 4~12자리 + 확인.
 */
export function PinScreen({ pinLength }: { pinLength?: number | undefined }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [lockedSec, setLockedSec] = useState(0);
  const [shakes, setShakes] = useState(0);
  const locked = lockedSec > 0;
  const auto = pinLength !== undefined;
  const maxLen = pinLength ?? MAX_LEN;

  // 동기 보호: 렌더 사이에 들어오는 키 입력도 중복 전송·초과 입력이 되지 않게 한다.
  const pinRef = useRef("");
  const sendingRef = useRef(false);

  const login = useMutation({
    mutationFn: (value: string) => api("POST", "/session", { body: { pin: value } }),
    onSuccess: async () => {
      setMessage("");
      await qc.invalidateQueries({ queryKey: sessionQueryKey });
    },
    onError: (error) => {
      pinRef.current = "";
      setPin("");
      if (error instanceof ApiError && error.status === 429) {
        setLockedSec(error.retryAfterSec ?? 60);
        setMessage("");
      } else if (error instanceof ApiError && error.status === 401) {
        setMessage("PIN 이 맞지 않아요.");
        setShakes((n) => n + 1);
      } else if (error instanceof ApiError && error.status === 0) {
        setMessage("연결이 안 돼요. 인터넷을 확인하고 다시 해 주세요.");
      } else {
        setMessage("잠시 문제가 생겼어요. 다시 해 주세요.");
      }
    },
    onSettled: () => {
      sendingRef.current = false;
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

  const send = useCallback(
    (value: string) => {
      sendingRef.current = true;
      login.mutate(value);
    },
    [login],
  );

  const addDigit = useCallback(
    (d: string) => {
      if (disabled || sendingRef.current || pinRef.current.length >= maxLen) return;
      setMessage("");
      setShakes(0);
      const next = pinRef.current + d;
      pinRef.current = next;
      setPin(next);
      if (auto && next.length === maxLen) send(next);
    },
    [disabled, maxLen, auto, send],
  );
  const erase = useCallback(() => {
    if (disabled || sendingRef.current) return;
    setMessage("");
    setShakes(0);
    pinRef.current = pinRef.current.slice(0, -1);
    setPin(pinRef.current);
  }, [disabled]);
  const clearAll = useCallback(() => {
    if (disabled || sendingRef.current) return;
    setMessage("");
    setShakes(0);
    pinRef.current = "";
    setPin("");
  }, [disabled]);
  const submit = useCallback(() => {
    if (auto || disabled || sendingRef.current || pinRef.current.length < MIN_LEN) return;
    send(pinRef.current);
  }, [auto, disabled, send]);

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
        e.preventDefault(); // 일부 브라우저(WebKit)에서 Backspace 가 '뒤로 가기'로 동작하는 것을 막는다
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
  const slots = pinLength ?? Math.max(MIN_LEN, pin.length);
  const dotsClass = ["pin-dots", slots > 8 ? "pin-dots-dense" : "", shakes > 0 ? "is-shaking" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="pin-screen">
      <ThemeDecor slot="pin" />
      <h1 className="pin-title">가족 기록</h1>
      <p className="pin-hint" id="pin-hint">
        PIN 을 눌러 주세요.
      </p>
      <div key={shakes} className={dotsClass} aria-hidden="true">
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
        {auto ? (
          <button
            type="button"
            className="key key-aux"
            disabled={disabled || pin.length === 0}
            onClick={clearAll}
          >
            모두 지우기
          </button>
        ) : (
          <button
            type="button"
            className="key key-primary"
            disabled={disabled || pin.length < MIN_LEN}
            onClick={submit}
          >
            확인
          </button>
        )}
      </div>
    </main>
  );
}
