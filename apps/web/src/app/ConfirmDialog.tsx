import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ConfirmContext,
  type Confirm,
  type ConfirmOptions,
} from "./confirmContext.js";

type Request = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
  returnFocus: HTMLElement | null;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const settle = useCallback((confirmed: boolean) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    setRequest(null);
    current.resolve(confirmed);
    queueMicrotask(() => current.returnFocus?.focus());
  }, []);

  const confirm = useCallback<Confirm>((input) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = {
        options: typeof input === "string" ? { message: input } : input,
        resolve,
        returnFocus:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      };
      pending.current = next;
      setRequest(next);
    });
  }, []);

  useEffect(() => {
    if (request) cancelButton.current?.focus();
  }, [request]);
  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    [],
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      settle(false);
    } else if (event.key === "Tab") {
      const first = cancelButton.current;
      const last = confirmButton.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="account-dialog-backdrop confirm-dialog-backdrop">
          <div
            className="account-dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-description"
            onKeyDown={onKeyDown}
          >
            <h2 id="confirm-dialog-title">
              {request.options.title ?? "Confirm action"}
            </h2>
            <p id="confirm-dialog-description">{request.options.message}</p>
            <div className="account-dialog-actions">
              <button
                ref={cancelButton}
                type="button"
                className="button"
                onClick={() => settle(false)}
              >
                Cancel
              </button>
              <button
                ref={confirmButton}
                type="button"
                className={`button ${request.options.destructive ? "danger" : "primary"}`}
                onClick={() => settle(true)}
              >
                {request.options.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
