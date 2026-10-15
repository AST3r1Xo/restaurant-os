"use client";
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
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-medium transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50";
export function Button({
  primary,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      className={`${buttonClass} ${primary ? "border-accent bg-accent text-white hover:bg-accent/90" : ""} ${className}`}
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
