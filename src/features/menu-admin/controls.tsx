"use client";
import { useEffect, useRef } from "react";
import type {
  ReactNode,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  ButtonHTMLAttributes,
} from "react";
export const fieldClass =
  "mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-offset-2 focus:border-accent disabled:opacity-50";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
export function Button({
  primary,
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  selected?: boolean;
}) {
  return (
    <button
      {...props}
      className={`${buttonClass} ${primary ? "border-accent bg-accent text-white hover:bg-accent/90" : selected ? "border-accent bg-accent-soft text-accent" : "border-line bg-white text-foreground hover:bg-accent-soft"} ${className}`}
    />
  );
}
export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input {...props} className={fieldClass} />
      {hint && (
        <span className="mt-1.5 block text-xs font-normal leading-5 text-muted">
          {hint}
        </span>
      )}
    </label>
  );
}
export function TextArea({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <textarea {...props} className={fieldClass} />
    </label>
  );
}
export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select {...props} className={fieldClass}>
        {children}
      </select>
    </label>
  );
}
export function Check({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" {...props} className="size-4 accent-accent" />
      {label}
    </label>
  );
}
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 sm:p-7">
      <h2 className="font-display text-2xl">{title}</h2>
      {description && (
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          {description}
        </p>
      )}
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

export function EditorDialog({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={onClose}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(95vw,560px)] overflow-auto rounded-3xl bg-background p-6 shadow-xl backdrop:bg-foreground/30"
    >
      {children}
    </dialog>
  );
}
