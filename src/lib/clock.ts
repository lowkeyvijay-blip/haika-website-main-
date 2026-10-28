export interface Clock {
  now(): Date;
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Clock date is invalid.");
  }

  return date;
}

export function createFixedClock(value: string | Date): Clock {
  const fixed = toDate(value);

  return {
    now: () => new Date(fixed.getTime()),
  };
}

export function createSystemClock(): Clock {
  return {
    now: () => new Date(),
  };
}

export interface ManualClock extends Clock {
  set(value: string | Date): void;
  advanceBy(milliseconds: number): void;
}

export function createManualClock(initial: string | Date): ManualClock {
  let current = toDate(initial);

  return {
    now: () => new Date(current.getTime()),
    set: (value) => {
      current = toDate(value);
    },
    advanceBy: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}
