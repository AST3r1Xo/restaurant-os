import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center"
    >
      <Brand />
      <h1 className="mt-10 font-display text-4xl">A table we couldn’t find.</h1>
      <p className="mt-4 text-muted">
        This link may have changed. Scan the QR code at your table again or
        explore the sample menu.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm text-white"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Explore the menu
      </Link>
    </main>
  );
}
