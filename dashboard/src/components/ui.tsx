import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import type { LeadStatus, Task } from "../api/types";
import { initials, STATUS_LABELS } from "../lib/lookups";

function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function StatusBadge({ status }: { status: LeadStatus }): React.JSX.Element {
  return (
    <span className={`status-badge status-${status.replaceAll(" ", "-")}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function StatusPill({ status }: { status: LeadStatus }): React.JSX.Element {
  return <StatusBadge status={status} />;
}

export function TaskStatusBadge({ status }: { status: Task["status"] }): React.JSX.Element {
  return (
    <span className={`task-badge task-${status.replaceAll(" ", "-")}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "brass";

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }): React.JSX.Element {
  return (
    <span className={classNames("badge", `badge-${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  block = false,
  className,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  block?: boolean;
}): React.JSX.Element {
  return (
    <button
      className={classNames(
        "button",
        `button-${variant}`,
        block && "button-block",
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

type CardTone = "default" | "sand" | "forest";
type CardElement = "div" | "section" | "article";

export function Card({
  as: Element = "div",
  tone = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: CardElement;
  tone?: CardTone;
}): React.JSX.Element {
  return (
    <Element
      className={classNames(
        "panel",
        "card",
        tone !== "default" && `card-${tone}`,
        className,
      )}
      {...props}
    >
      {children}
    </Element>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={classNames("control", className)} {...props} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={classNames("control", className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={classNames("control", className)} {...props} />
  );
});

export function Table({
  className,
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <table className={classNames("data-table", className)} {...props}>
      {children}
    </table>
  );
}

export function Skeleton({
  width = "100%",
  height = 12,
  className,
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={classNames("skeleton", className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "error";
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function LoadingPanel({ label = "Loading" }: { label?: string }): React.JSX.Element {
  return (
    <div className="loading-panel" aria-live="polite" aria-busy="true">
      <div className="loading-skeleton" aria-hidden="true">
        <Skeleton width="34%" height={12} />
        <Skeleton className="skeleton-line-title" width="76%" />
        <Skeleton className="skeleton-line-short" height={10} />
      </div>
      <div className="loading-status">
        <span className="loader-ring" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        H
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

const AVATAR_TONE_COUNT = 6;

function avatarTone(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash % AVATAR_TONE_COUNT;
}

export function LeadAvatar({
  name,
  owner,
  size = "regular",
}: {
  name: string;
  owner?: string;
  size?: "small" | "regular";
}): React.JSX.Element {
  const tone = avatarTone(owner?.trim() || name);

  return (
    <span
      className={classNames(
        "avatar",
        size === "small" && "avatar-small",
        `avatar-tone-${tone}`,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

type ToastTone = "success" | "error" | "info";

export function Toast({
  tone,
  message,
  onDismiss,
}: {
  tone: ToastTone;
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div
      className={`toast toast-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{message}</span>
      <button
        className="toast-close"
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

interface OverlayProps {
  open: boolean;
  title: string;
  description?: string;
  kicker?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

function useOverlayFocus(open: boolean, onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeHandler.current();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  return closeRef;
}

function OverlayHeader({
  title,
  kicker,
  onClose,
  closeRef,
  titleId,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  titleId: string;
}): React.JSX.Element {
  return (
    <header className="modal-header">
      <div>
        {kicker !== undefined ? <p className="modal-kicker">{kicker}</p> : null}
        <h2 className="modal-title" id={titleId}>
          {title}
        </h2>
      </div>
      <button
        ref={closeRef}
        className="modal-close"
        type="button"
        onClick={onClose}
        aria-label="Close dialog"
      >
        ×
      </button>
    </header>
  );
}

export function Modal({
  open,
  title,
  description,
  kicker,
  onClose,
  footer,
  children,
}: OverlayProps): React.JSX.Element | null {
  const titleId = useId();
  const descriptionId = `${titleId}-description`;
  const closeRef = useOverlayFocus(open, onClose);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
      >
        <OverlayHeader
          title={title}
          kicker={kicker}
          onClose={onClose}
          closeRef={closeRef}
          titleId={titleId}
        />
        <div className="modal-body">
          {description !== undefined ? (
            <p id={descriptionId}>{description}</p>
          ) : null}
          {children}
        </div>
        {footer !== undefined ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Drawer({
  open,
  title,
  description,
  kicker,
  onClose,
  footer,
  children,
}: OverlayProps): React.JSX.Element | null {
  const titleId = useId();
  const descriptionId = `${titleId}-description`;
  const closeRef = useOverlayFocus(open, onClose);

  if (!open) {
    return null;
  }

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
      >
        <OverlayHeader
          title={title}
          kicker={kicker}
          onClose={onClose}
          closeRef={closeRef}
          titleId={titleId}
        />
        <div className="modal-body">
          {description !== undefined ? (
            <p id={descriptionId}>{description}</p>
          ) : null}
          {children}
        </div>
        {footer !== undefined ? <footer className="modal-footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}
