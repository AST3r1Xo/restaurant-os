import { LockKeyhole } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function PrivateOrderNotFound() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-5 py-16">
      <EmptyState
        icon={LockKeyhole}
        eyebrow="Private order"
        title="This order isn’t available here."
        description="Orders are available only to the guest who placed them during an active dining visit. Once staff close the visit, customer access ends. Please ask restaurant staff for assistance."
        href="/"
        action="Back to menu"
      />
    </main>
  );
}
