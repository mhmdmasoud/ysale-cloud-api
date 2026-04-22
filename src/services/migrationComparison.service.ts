type NumberMap = Record<string, number | null | undefined>

const toNumberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const compareMigrationResult = (input: {
  countsBefore: NumberMap
  countsAfter: NumberMap
  totalsBefore: NumberMap
  totalsAfter: NumberMap
  warnings?: unknown[]
  errors?: unknown[]
}) => {
  const countResult: Record<string, { before: number | null; after: number | null; matched: boolean; difference: number | null }> = {}
  const totalResult: Record<string, { before: number | null; after: number | null; matched: boolean; difference: number | null }> = {}
  const warnings = Array.isArray(input.warnings) ? [...input.warnings] : []
  const errors = Array.isArray(input.errors) ? [...input.errors] : []

  for (const key of Object.keys(input.countsBefore || {})) {
    const before = toNumberOrNull(input.countsBefore[key])
    const after = toNumberOrNull(input.countsAfter?.[key])
    const difference = before === null || after === null ? null : after - before
    const matched = difference === 0
    countResult[key] = { before, after, matched, difference }
    if (!matched && (before || 0) > 0) {
      errors.push({ code: 'COUNT_MISMATCH', key, before, after, difference })
    }
  }

  for (const key of Object.keys(input.totalsBefore || {})) {
    const before = toNumberOrNull(input.totalsBefore[key])
    const after = toNumberOrNull(input.totalsAfter?.[key])
    const difference = before === null || after === null ? null : Number((after - before).toFixed(4))
    const matched = difference === null ? before === null && after === null : Math.abs(difference) <= 0.01
    totalResult[key] = { before, after, matched, difference }
    if (!matched) {
      warnings.push({ code: 'TOTAL_MISMATCH', key, before, after, difference })
    }
  }

  return {
    status: errors.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'success',
    counts: countResult,
    totals: totalResult,
    warnings,
    errors,
  }
}
