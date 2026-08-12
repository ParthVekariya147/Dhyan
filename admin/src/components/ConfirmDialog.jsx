import { useEffect, useRef } from 'react';

/**
 * §57 — nothing that changes production content happens on a single click.
 *
 * Built on <dialog> so the browser provides the modal semantics: focus is trapped,
 * Escape closes, and the rest of the page is inert. Doing that by hand is where
 * keyboard accessibility usually goes wrong (§56).
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Yes, do it',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      className="confirm"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="confirm-title"
    >
      <h2 id="confirm-title">{title}</h2>
      <div className="confirm-body">{body}</div>
      <div className="confirm-actions">
        <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : ''}`}
          type="button"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
