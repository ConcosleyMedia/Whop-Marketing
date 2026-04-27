import {
  Activity,
  AlertCircle,
  CalendarClock,
  CircleAlert,
  Clock,
  DollarSign,
  Flag,
  Mail,
  MailOpen,
  MailX,
  MousePointerClick,
  Undo2,
  UserMinus,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineActivity = {
  id: string;
  activity_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
};

type Style = { icon: LucideIcon; tone: "green" | "red" | "amber" | "blue" | "gray" };

const STYLE_BY_TYPE: Record<string, Style> = {
  "membership.activated": { icon: UserPlus, tone: "green" },
  "membership.deactivated": { icon: UserMinus, tone: "red" },
  "membership.cancel_at_period_end_changed": { icon: CalendarClock, tone: "amber" },
  "payment.created": { icon: Clock, tone: "gray" },
  "payment.pending": { icon: Clock, tone: "gray" },
  "payment.succeeded": { icon: DollarSign, tone: "green" },
  "payment.failed": { icon: XCircle, tone: "red" },
  "refund.succeeded": { icon: Undo2, tone: "amber" },
  "dispute.created": { icon: AlertCircle, tone: "red" },
  "dispute.updated": { icon: AlertCircle, tone: "red" },
  "email.sent": { icon: Mail, tone: "blue" },
  "email.opened": { icon: MailOpen, tone: "blue" },
  "email.clicked": { icon: MousePointerClick, tone: "blue" },
  "email.unsubscribed": { icon: MailX, tone: "red" },
  "email.bounced": { icon: CircleAlert, tone: "red" },
  "email.spam_reported": { icon: Flag, tone: "red" },
};

const TONE_CLASSES: Record<Style["tone"], string> = {
  green: "bg-green-100 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-300 dark:ring-green-900",
  red: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  amber: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  blue: "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  gray: "bg-muted text-muted-foreground ring-border",
};

function styleFor(activityType: string): Style {
  return STYLE_BY_TYPE[activityType] ?? { icon: Activity, tone: "gray" };
}

function formatAmount(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const amount = metadata.amount;
  const currency = (metadata.currency as string) ?? "usd";
  if (typeof amount !== "number") return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

export function ActivityTimeline({ items }: { items: TimelineActivity[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No activity yet.
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 border-l pl-6">
      {items.map((item) => {
        const { icon: Icon, tone } = styleFor(item.activity_type);
        const amount = formatAmount(item.metadata);
        return (
          <li key={item.id} className="relative">
            <span
              className={cn(
                "absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-background",
                TONE_CLASSES[tone],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
                {amount ? (
                  <p className="mt-0.5 text-xs font-medium tabular-nums">
                    {amount}
                  </p>
                ) : null}
              </div>
              <time
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
                dateTime={item.occurred_at}
                title={formatDateTime(item.occurred_at)}
              >
                {formatRelative(item.occurred_at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
