import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { logger } from '../logger'

const POINTER_FILE_NAME = 'active-table.json'
const DEFAULT_ACTIVE_TABLE_NAME = 'documents'

/**
 * Durable marker describing a migration that is in progress or was interrupted.
 * Present on disk when a switch between embedding models started and the
 * staging table has not yet taken over as the active one. Cleared on success
 * or on explicit discard.
 */
export interface PendingMigrationMarker {
  readonly fromTable: string
  readonly toTable: string
  readonly fromDimension: number
  readonly toDimension: number
  readonly fromModel: string
  readonly toModel: string
  readonly startedAt: string
}

/**
 * Sidecar pointer describing which LanceDB table currently holds the
 * canonical document corpus plus any migration state. Callers read this on
 * init and after a pointer flip; writes are atomic via temp-file + rename.
 */
export interface ActiveTablePointer {
  readonly activeTable: string
  /** Dimension of the active table's vector column; 0 when unknown/legacy. */
  readonly activeTableDimension: number
  /** Model that produced vectors in the active table; '' when unknown/legacy. */
  readonly activeTableModel: string
  readonly pendingMigration: PendingMigrationMarker | null
}

function getPointerDirectory(): string {
  const directoryPath = join(app.getPath('userData'), 'lore-db')
  if (!existsSync(directoryPath)) mkdirSync(directoryPath, { recursive: true })
  return directoryPath
}

function getPointerFilePath(): string {
  return join(getPointerDirectory(), POINTER_FILE_NAME)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parsePendingMigration(raw: unknown): PendingMigrationMarker | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const fromTable = candidate.fromTable
  const toTable = candidate.toTable
  const fromDimension = candidate.fromDimension
  const toDimension = candidate.toDimension
  const fromModel = candidate.fromModel
  const toModel = candidate.toModel
  const startedAt = candidate.startedAt

  if (
    !isString(fromTable)
    || !isString(toTable)
    || !isFiniteNumber(fromDimension)
    || !isFiniteNumber(toDimension)
    || !isString(fromModel)
    || !isString(toModel)
    || !isString(startedAt)
  ) {
    return null
  }

  return {
    fromTable,
    toTable,
    fromDimension,
    toDimension,
    fromModel,
    toModel,
    startedAt,
  }
}

function defaultPointer(): ActiveTablePointer {
  return {
    activeTable: DEFAULT_ACTIVE_TABLE_NAME,
    activeTableDimension: 0,
    activeTableModel: '',
    pendingMigration: null,
  }
}

export function readActiveTablePointer(): ActiveTablePointer {
  const pointerFilePath = getPointerFilePath()
  if (!existsSync(pointerFilePath)) {
    return defaultPointer()
  }

  try {
    const rawContents = readFileSync(pointerFilePath, 'utf-8')
    const parsed = JSON.parse(rawContents) as Record<string, unknown>
    const activeTable = isString(parsed.activeTable) && parsed.activeTable.length > 0
      ? parsed.activeTable
      : DEFAULT_ACTIVE_TABLE_NAME
    const activeTableDimension = isFiniteNumber(parsed.activeTableDimension)
      ? parsed.activeTableDimension
      : 0
    const activeTableModel = isString(parsed.activeTableModel) ? parsed.activeTableModel : ''
    const pendingMigration = parsePendingMigration(parsed.pendingMigration)
    return { activeTable, activeTableDimension, activeTableModel, pendingMigration }
  } catch (err) {
    logger.error({ err }, '[ActiveTablePointer] Failed to parse pointer file; falling back to default')
    return defaultPointer()
  }
}

/**
 * Atomic-ish write: writes to a temp file next to the target, then renames
 * over it. On most filesystems `rename` is atomic within the same directory,
 * so readers never see a partially written pointer.
 */
export function writeActiveTablePointer(pointer: ActiveTablePointer): void {
  const pointerFilePath = getPointerFilePath()
  const temporaryFilePath = `${pointerFilePath}.tmp`
  writeFileSync(temporaryFilePath, JSON.stringify(pointer, null, 2), 'utf-8')
  renameSync(temporaryFilePath, pointerFilePath)
}
