const judgeCheckTypes = new Set([
  'responseJudge',
  'dataJudge',
  'retrievalJudge',
])

export function isJudgeCheckType(checkType: string | undefined): boolean {
  if (typeof checkType !== 'string' || checkType.length === 0) {
    return false
  }
  return judgeCheckTypes.has(checkType)
}

export function categorizeCheckType(checkType: string | undefined): 'judge' | 'deterministic' | 'unknown' {
  if (typeof checkType !== 'string' || checkType.length === 0) {
    return 'unknown'
  }
  if (judgeCheckTypes.has(checkType)) {
    return 'judge'
  }
  return 'deterministic'
}
