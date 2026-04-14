function padDatePart(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  return `${year}-${month}-${day}`
}

export function parseLocalDate(dateString: string): Date {
  const [yearString, monthString, dayString] = dateString.split('-')
  const year = Number(yearString)
  const month = Number(monthString)
  const day = Number(dayString)
  return new Date(year, month - 1, day)
}

export function getLocalDateRangeForDay(dateString: string): { fromIso: string; toIso: string } {
  const start = parseLocalDate(dateString)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function dayOfWeekName(date: Date): string {
  return DAY_NAMES[date.getDay()] ?? 'Unknown'
}

export function subtractDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - days)
  return result
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date)
  const day = result.getDay()
  const diff = day === 0 ? 6 : day - 1
  result.setDate(result.getDate() - diff)
  return result
}

export function getLocalDateRangeForWeek(startDateString: string): { fromIso: string; toIso: string } {
  const start = parseLocalDate(startDateString)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)

  return {
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
  }
}
