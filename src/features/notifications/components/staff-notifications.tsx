"use client";
import { useMemo } from "react";
import { useTableOperations } from "@/features/sessions/components/table-operations-provider";
import { staffNotices } from "../model";
import { NotificationProvider } from "./notification-center";

export function StaffNotifications({
  children,
}: {
  children: React.ReactNode;
}) {
  const operations = useTableOperations();
  const notices = useMemo(
    () => staffNotices(operations.value),
    [operations.value],
  );
  return (
    <NotificationProvider
      scope={`staff:${operations.value.restaurantId}`}
      notices={notices}
      demo={operations.demo}
      refresh={operations.refresh}
      description={
        operations.demo
          ? "Sample table activity. Live notifications are disabled in demo mode."
          : operations.connection !== "live" || operations.error
            ? "Connection interrupted. Reconnecting to the restaurant; check the latest data before acting."
            : "New orders and bill requests appear automatically while this workspace is open. Responding resolves the alert."
      }
    >
      {children}
    </NotificationProvider>
  );
}
