"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { QrCode, Download, Printer, RefreshCw } from "lucide-react";
import { rotateTableQRAction } from "./actions";
type Table = {
  id: string;
  label: string;
  is_active: boolean;
  updated_at: string;
};
export function TableQRManagement({
  restaurantId,
  restaurantName,
  tables,
  warning,
  demo = false,
}: {
  restaurantId: string;
  restaurantName: string;
  tables: Table[];
  warning?: string;
  demo?: boolean;
}) {
  const router = useRouter(),
    [show, setShow] = useState(false),
    [confirm, setConfirm] = useState<string>(),
    [busy, setBusy] = useState<string>(),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState<Record<string, boolean>>({});
  const available = tables.filter((t) => t.is_active);
  const disabled = !!warning || demo;
  function href(format: string, table?: Table, preview = false) {
    return `/api/admin/table-qr?restaurant=${restaurantId}&format=${format}${table ? `&table=${table.id}&v=${encodeURIComponent(table.updated_at)}` : ""}${preview ? "&preview=1" : ""}`;
  }
  async function rotate(t: Table) {
    setBusy(t.id);
    setMessage("");
    try {
      const result = await rotateTableQRAction(
        restaurantId,
        t.id,
        t.updated_at,
      );
      if (result.ok) {
        setConfirm(undefined);
        setMessage(
          `${t.label} has a new code. Replace its printed card before the next visit.`,
        );
        setFailed({});
        router.refresh();
      } else setMessage(result.message);
    } catch {
      setMessage(
        "The change could not be confirmed. Refresh to check the code before retrying.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  const linkClass =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 text-sm font-medium text-accent";
  return (
    <details className="disclosure mt-8 rounded-2xl border border-line bg-white p-5" onToggle={(event) => setShow(event.currentTarget.open)}>
      <summary className="text-base font-semibold"><span className="flex items-center gap-2"><QrCode size={20} aria-hidden="true" />Print table QR codes</span></summary>
      <section
        id="table-qr-codes"
        aria-labelledby="qr-title"
        className="mt-10 rounded-3xl border border-line bg-accent-soft/40 p-5 sm:p-7"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="qr-title"
              className="mt-3 flex items-center gap-3 font-display text-3xl"
            >
              <QrCode size={24} aria-hidden="true" />
              Table QR codes
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted">
              {available.length} active tables at {restaurantName}. Download the
              codes or print matching cards at 100% scale. Keep the white space
              around each code.
            </p>
          </div>
        </div>
        {warning && (
          <p
            role="status"
            className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900"
          >
            {warning}
          </p>
        )}
        {demo && (
          <p className="mt-4 text-xs text-muted">
            Demo preview · real QR downloads and rotation are disabled.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {disabled ? (
            <>
              <button disabled className={`${linkClass} opacity-50`}>
                <Download size={16} />
                Download all QR codes (.zip)
              </button>
              <button disabled className={`${linkClass} opacity-50`}>
                <Printer size={16} />
                Print-ready cards (.pdf)
              </button>
            </>
          ) : (
            <>
              <a href={href("zip")} className={linkClass}>
                <Download size={16} aria-hidden="true" />
                Download all QR codes (.zip)
              </a>
              <a href={href("pdf")} className={linkClass}>
                <Printer size={16} aria-hidden="true" />
                Print-ready cards (.pdf)
              </a>
            </>
          )}
        </div>
        {message && (
          <p
            role="status"
            className="mt-5 rounded-xl border border-line bg-white p-4 text-sm"
          >
            {message}
          </p>
        )}
        {show && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {available.map((t) => (
              <article
                key={`${t.id}:${t.updated_at}`}
                className="rounded-2xl border border-line bg-white p-5 text-center"
              >
                <p className="font-display text-2xl">{restaurantName}</p>
                <h3 className="mt-2 text-sm font-medium text-accent">
                  {t.label}
                </h3>
                {disabled ? (
                  <div className="mx-auto my-5 flex size-48 items-center justify-center rounded-xl bg-background text-muted">
                    <QrCode size={52} strokeWidth={1} aria-hidden="true" />
                    <span className="sr-only">
                      QR preview unavailable until HTTPS configuration is ready
                    </span>
                  </div>
                ) : failed[t.id] ? (
                  <p role="alert" className="my-6 text-sm text-amber-900">
                    The code could not be loaded. Refresh your workspace to check
                    access.
                  </p>
                ) : (
                  <Image
                    unoptimized
                    src={href("png", t, true)}
                    alt={`Scan to explore and order at ${t.label}`}
                    width={256}
                    height={256}
                    loading="lazy"
                    className="mx-auto my-3 aspect-square w-full max-w-60"
                    onError={() => setFailed((f) => ({ ...f, [t.id]: true }))}
                  />
                )}
                <p className="text-xs text-muted">Scan to explore &amp; order</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {disabled ? (
                    <button disabled className={`${linkClass} opacity-50`}>
                      Download QR
                    </button>
                  ) : (
                    <a href={href("png", t)} className={linkClass}>
                      Download QR
                    </a>
                  )}
                  <button
                    disabled={demo || !!busy}
                    onClick={() => setConfirm(t.id)}
                    className="inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-xs text-muted disabled:opacity-50"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Replace code
                  </button>
                </div>
                {confirm === t.id && (
                  <div className="mt-4 rounded-xl bg-background p-4 text-left">
                    <p className="text-xs leading-6 text-muted">
                      Replace the code for {t.label}? Its old printed cards will
                      stop working. Finish any active visit first. Historical
                      orders remain preserved.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void rotate(t)}
                        disabled={!!busy}
                        className="min-h-11 rounded-lg bg-accent px-4 text-xs text-white disabled:opacity-50"
                      >
                        {busy === t.id ? "Replacing…" : "Confirm replacement"}
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => setConfirm(undefined)}
                        className="min-h-11 px-3 text-xs text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </details>
  );
}
