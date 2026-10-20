import type { OrderStatus } from "../orders/types.ts";
import type { TableWorkspace } from "../sessions/types.ts";
import { customerPath } from "../../lib/routes.ts";

export type Notice = {
  id: string;
  title: string;
  message: string;
  href: string;
  action: string;
  at: string;
  tone: "success" | "attention" | "danger";
};
export type GuestActivity = {
  restaurantId: string;
  identityKey: string | null;
  visitId: string | null;
  fetchedAt: string;
  orders: {
    id: string;
    status: OrderStatus;
    createdAt: string;
    updatedAt: string;
  }[];
  request: {
    id: string;
    status: "requested" | "acknowledged";
    requestedAt: string;
    acknowledgedAt: string | null;
  } | null;
};

// No item details, identities, private references, notes or internal cooking
// milestones belong in an alert. Follow the authorized screen for details.
export function guestNotices(
  activity: GuestActivity,
  slug: string,
  token?: string,
): Notice[] {
  if (!activity.visitId || !activity.identityKey) return [];
  const ordersHref = customerPath(slug, "orders", token);
  const notices: Notice[] = activity.orders.map((order) => {
    const state =
      order.status === "served" || order.status === "cancelled"
        ? order.status
        : "sent";
    return {
      id: `order:${order.id}:${state}`,
      title:
        state === "cancelled"
          ? "An order was cancelled"
          : state === "served"
            ? "Your order has been served"
            : "Your order was received",
      message:
        state === "cancelled"
          ? "Open your sent orders for details, or speak to the restaurant team."
          : state === "served"
            ? "Enjoy your meal. Your receipt is in Sent orders."
            : "The restaurant has your order. There is nothing else to confirm.",
      href: ordersHref,
      action: "View sent orders",
      at: state === "sent" ? order.createdAt : order.updatedAt,
      tone: state === "cancelled" ? "danger" : "success",
    };
  });
  const request = activity.request;
  if (request)
    notices.push({
      id: `bill:${request.id}:${request.status}`,
      title:
        request.status === "acknowledged"
          ? "Staff have seen your table’s bill request"
          : "The bill was requested for your table",
      message:
        request.status === "acknowledged"
          ? "The restaurant team will help you directly."
          : "Your table’s request is with the team. You do not need to send it again.",
      href: customerPath(slug, "bill", token),
      action: "View table bill",
      at: request.acknowledgedAt ?? request.requestedAt,
      tone: "success",
    });
  return sortNotices(notices);
}

export function staffNotices(
  workspace: TableWorkspace,
  previous?: TableWorkspace,
): Notice[] {
  const notices: Notice[] = workspace.tables.flatMap((table) => {
    const session = table.session;
    if (!session || !session.totals.unfinishedCount) return [];
    const prior = previous?.tables.find(
      (t) => t.session?.id === session.id,
    )?.session;
    const arrivals = prior
      ? Math.max(0, session.totals.orderCount - prior.totals.orderCount)
      : previous
        ? session.totals.orderCount
        : 0;
    return [
      {
        id: `table:${session.id}:orders:${session.totals.orderCount}`,
        title:
          arrivals > 0
            ? `${arrivals === 1 ? "New order" : `${arrivals} new orders`} · ${table.label}`
            : `${table.label} · Orders in service`,
        message:
          "Open the kitchen to review dishes. Mark them ready for service, then served when they reach the table.",
        href: "/admin",
        action: "Open kitchen",
        at: session.updatedAt,
        tone: "attention" as const,
      },
    ];
  });
  notices.push(
    ...workspace.requests.map((request) => ({
      id: `bill:${request.id}`,
      title: `${request.tableLabel} has requested the bill`,
      message: "Let the table know you have seen their request.",
      href: "/admin/tables#bill-requests",
      action: "Respond to request",
      at: request.requestedAt,
      tone: "attention" as const,
    })),
  );
  return sortNotices(notices);
}
export function sortNotices(notices: Notice[]) {
  return [...new Map(notices.map((notice) => [notice.id, notice])).values()]
    .sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
    )
    .slice(0, 30);
}
