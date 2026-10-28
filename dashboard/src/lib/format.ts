const TIME_ZONE = "Asia/Kolkata";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const weekdayFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: TIME_ZONE,
});

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatDateTime(value: string | undefined): string {
  if (value === undefined) {
    return "Not recorded";
  }

  const date = validDate(value);
  return date === undefined ? "Not recorded" : dateTimeFormatter.format(date);
}

export function formatDate(value: string | undefined): string {
  if (value === undefined) {
    return "Not recorded";
  }

  const date = validDate(value);
  return date === undefined ? "Not recorded" : dateFormatter.format(date);
}

export function formatWeekday(value: string): string {
  const date = validDate(value);
  return date === undefined ? value : weekdayFormatter.format(date);
}

export function formatTime(value: string): string {
  const date = validDate(value);
  return date === undefined ? value : timeFormatter.format(date);
}

export function formatRelative(value: string, now: string): string {
  const date = validDate(value);
  const reference = validDate(now);

  if (date === undefined || reference === undefined) {
    return formatDateTime(value);
  }

  const diffMs = date.getTime() - reference.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return "just now";
  }

  if (absMs < hour) {
    return relativeFormatter.format(Math.round(diffMs / minute), "minute");
  }

  if (absMs < day) {
    return relativeFormatter.format(Math.round(diffMs / hour), "hour");
  }

  return relativeFormatter.format(Math.round(diffMs / day), "day");
}

export function toDateTimeInput(value: string): string {
  const date = validDate(value);

  if (date === undefined) {
    return "";
  }

  const offset = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(offset).toISOString().slice(0, 16);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
