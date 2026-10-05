const DAY_MS = 24 * 60 * 60 * 1000;

function calendarParts(date: Date, formatter: Intl.DateTimeFormat) {
    const parts = formatter.formatToParts(date);
    const value = (name: string) => Number(parts.find((part) => part.type === name)?.value);
    return { year: value("year"), month: value("month"), day: value("day") };
}

function dayKey(date: Date, formatter: Intl.DateTimeFormat): number {
    const { year, month, day } = calendarParts(date, formatter);
    return year * 10000 + month * 100 + day;
}

function startOfDayUtc(year: number, month: number, day: number, formatter: Intl.DateTimeFormat): Date {
    const calendarDate = new Date(0);
    calendarDate.setUTCFullYear(year, month - 1, day);
    const calendarUtc = calendarDate.getTime();
    const target = year * 10000 + month * 100 + day;
    let lower = calendarUtc - 2 * DAY_MS;
    let upper = calendarUtc + 2 * DAY_MS;
    // Busca el primer instante UTC perteneciente al día local. No presupone offset ni duración fija del día.
    while (lower < upper) {
        const middle = lower + Math.floor((upper - lower) / 2);
        if (dayKey(new Date(middle), formatter) < target) lower = middle + 1;
        else upper = middle;
    }
    return new Date(lower);
}

export function todayRange(now: Date, timeZone: string): { start: Date; end: Date } {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const { year, month, day } = calendarParts(now, formatter);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return {
        start: startOfDayUtc(year, month, day, formatter),
        end: startOfDayUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), formatter),
    };
}

export function localDateRange(from: string, to: string, timeZone: string): { start: Date; end: Date } {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
    const [toYear, toMonth, toDay] = to.split("-").map(Number);
    const next = new Date(0);
    next.setUTCFullYear(toYear!, toMonth! - 1, toDay! + 1);
    return {
        start: startOfDayUtc(fromYear!, fromMonth!, fromDay!, formatter),
        end: startOfDayUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), formatter),
    };
}
