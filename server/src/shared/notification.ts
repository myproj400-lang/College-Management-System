import { logger } from "./logger";
import { env } from "../config/env";

// Integration boundary (Master Prompt §3, SRS §3 dependencies): no email
// or SMS provider has been selected or credentialed yet. This interface
// is what a real provider adapter will implement; ConsoleNotificationPort
// below is a development-only stand-in that never claims delivery
// succeeded to a real inbox. It must not be used outside development/test.
export interface NotificationEvent {
  to: string;
  template: "email-verification" | "password-reset" | "account-status-changed";
  data: Record<string, string>;
}

export interface NotificationPort {
  send(event: NotificationEvent): Promise<void>;
}

// Test-only inspection buffer so integration tests can retrieve a
// verification/reset token without scraping log output. Never read in
// application code - only from test files.
export const sentNotifications: NotificationEvent[] = [];

class ConsoleNotificationPort implements NotificationPort {
  async send(event: NotificationEvent): Promise<void> {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "ConsoleNotificationPort must not be used in production. Configure a real email/SMS provider adapter first."
      );
    }
    logger.info({ event }, "[dev-only notification stub] would send notification");
    if (env.NODE_ENV === "test") {
      sentNotifications.push(event);
    }
  }
}

// Swap this for a real provider adapter once one is selected and
// credentialed (open dependency, see server/README.md and CRS D-07).
export const notificationPort: NotificationPort = new ConsoleNotificationPort();
