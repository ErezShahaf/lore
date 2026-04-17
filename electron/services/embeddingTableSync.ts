import { EventEmitter } from 'events'
import { logger } from '../logger'
import { embedTexts, resolveEmbeddingDimensionForModelName } from './embeddingService'
import {
  getConnection,
  getActiveTableName,
  getActiveTableVectorDimension,
  reopenActiveTable,
  resetTable,
  buildDocumentsSchema,
  getTableVectorDimensionForHandle,
} from './lanceService'
import {
  readActiveTablePointer,
  writeActiveTablePointer,
  type PendingMigrationMarker,
} from './activeTablePointer'
import { getSettings, updateSettings } from './settingsService'
import type { EmbeddingMigrationStatus } from '../../shared/types'

const MIGRATION_BATCH_SIZE = 64
const MIGRATION_READ_COLUMNS = [
  'id',
  'content',
  'type',
  'createdAt',
  'updatedAt',
  'date',
  'tags',
  'source',
  'metadata',
  'isDeleted',
] as const

type InternalMigrationState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'migrating'
      readonly processed: number
      readonly total: number
      readonly fromModel: string
      readonly toModel: string
    }
  | {
      readonly status: 'error'
      readonly message: string
      readonly processed: number
      readonly total: number
      readonly fromModel: string
      readonly toModel: string
    }

let migrationState: InternalMigrationState = { status: 'idle' }
let cancelRequested = false
let activeMigrationPromise: Promise<void> | null = null

export const embeddingMigrationEvents = new EventEmitter()

export function getEmbeddingMigrationStatus(): EmbeddingMigrationStatus {
  return migrationState
}

function setMigrationState(next: InternalMigrationState): void {
  migrationState = next
  embeddingMigrationEvents.emit('status-changed', migrationState)
}

function generateStagingTableName(dimension: number): string {
  return `documents__mig_${dimension}_${Date.now()}`
}

async function countRowsInTable(tableName: string): Promise<number> {
  const connection = getConnection()
  const tableNames = await connection.tableNames()
  if (!tableNames.includes(tableName)) return 0
  const table = await connection.openTable(tableName)
  return table.countRows()
}

async function loadCompletedIdSet(tableName: string): Promise<Set<string>> {
  const connection = getConnection()
  const tableNames = await connection.tableNames()
  if (!tableNames.includes(tableName)) return new Set()

  const table = await connection.openTable(tableName)
  const rows = await table.query().select(['id']).toArray()
  const completedIds = new Set<string>()
  for (const row of rows) {
    const id = (row as Record<string, unknown>).id
    if (typeof id === 'string') completedIds.add(id)
  }
  return completedIds
}

export interface EnsureTableMatchesInput {
  readonly previousModelName: string
  readonly newModelName: string
}

/**
 * Single reconciliation entry point that keeps the LanceDB schema and the
 * embedding settings aligned. Called from settings:update, from pull-complete
 * when a model is auto-assigned, and from startup reconciliation.
 *
 * - Same model + same dimension → no-op (fast path).
 * - Empty table → just reset with the new dimension (cheap, no data loss).
 * - Non-empty table with a real change → run chunked migration (re-embed).
 */
export async function ensureDocumentsTableMatchesEmbeddingModel(
  input: EnsureTableMatchesInput,
): Promise<void> {
  if (migrationState.status === 'migrating') {
    logger.warn(
      { input },
      '[EmbeddingSync] A migration is already in progress; ignoring new trigger',
    )
    return
  }

  const previousDimension = resolveEmbeddingDimensionForModelName(input.previousModelName)
  const newDimension = resolveEmbeddingDimensionForModelName(input.newModelName)
  const activeTableName = getActiveTableName()

  const currentTableDimension = (await getActiveTableVectorDimension()) ?? 0
  const activeRowCount = await countRowsInTable(activeTableName)

  const modelUnchanged = input.previousModelName === input.newModelName
  const dimensionMatches = currentTableDimension === newDimension

  if (modelUnchanged && dimensionMatches) {
    return
  }

  if (activeRowCount === 0) {
    await resetTable()
    logger.info(
      { newDimension, newModel: input.newModelName },
      '[EmbeddingSync] Active table empty; reset to new dimension/model',
    )
    return
  }

  await startMigration({
    fromModel: input.previousModelName,
    toModel: input.newModelName,
    fromDimension: previousDimension,
    toDimension: newDimension,
  })
}

interface MigrationInput {
  readonly fromModel: string
  readonly toModel: string
  readonly fromDimension: number
  readonly toDimension: number
}

async function startMigration(input: MigrationInput): Promise<void> {
  if (activeMigrationPromise !== null) {
    logger.warn('[EmbeddingSync] startMigration called while one is already running')
    return activeMigrationPromise
  }
  activeMigrationPromise = runMigration(input).finally(() => {
    activeMigrationPromise = null
  })
  return activeMigrationPromise
}

async function runMigration(input: MigrationInput): Promise<void> {
  cancelRequested = false
  let totalRowCount = 0

  try {
    const connection = getConnection()
    const fromTable = getActiveTableName()
    const pointerBefore = readActiveTablePointer()

    const reuseExistingStagingTableName =
      pointerBefore.pendingMigration !== null
      && pointerBefore.pendingMigration.fromTable === fromTable
      && pointerBefore.pendingMigration.toModel === input.toModel
      && pointerBefore.pendingMigration.toDimension === input.toDimension

    const toTable = reuseExistingStagingTableName
      ? pointerBefore.pendingMigration!.toTable
      : generateStagingTableName(input.toDimension)

    const marker: PendingMigrationMarker = {
      fromTable,
      toTable,
      fromDimension: input.fromDimension,
      toDimension: input.toDimension,
      fromModel: input.fromModel,
      toModel: input.toModel,
      startedAt: pointerBefore.pendingMigration?.startedAt ?? new Date().toISOString(),
    }

    writeActiveTablePointer({
      activeTable: pointerBefore.activeTable,
      activeTableDimension: pointerBefore.activeTableDimension,
      activeTableModel: pointerBefore.activeTableModel,
      pendingMigration: marker,
    })

    totalRowCount = await countRowsInTable(fromTable)
    const completedIds = await loadCompletedIdSet(toTable)

    setMigrationState({
      status: 'migrating',
      processed: Math.min(totalRowCount, completedIds.size),
      total: totalRowCount,
      fromModel: input.fromModel,
      toModel: input.toModel,
    })

    const tableNames = await connection.tableNames()
    let stagingTable = tableNames.includes(toTable)
      ? await connection.openTable(toTable)
      : null

    if (stagingTable) {
      const existingStagingDimension = await getTableVectorDimensionForHandle(stagingTable)
      if (existingStagingDimension !== input.toDimension) {
        logger.warn(
          { toTable, existingStagingDimension, wantedDimension: input.toDimension },
          '[EmbeddingSync] Staging table has wrong dimension; dropping and recreating',
        )
        await connection.dropTable(toTable)
        completedIds.clear()
        stagingTable = null
      }
    }

    if (!stagingTable) {
      stagingTable = await connection.createEmptyTable(
        toTable,
        buildDocumentsSchema(input.toDimension),
      )
    }

    const sourceTable = await connection.openTable(fromTable)

    let offset = 0
    while (true) {
      if (cancelRequested) {
        logger.info('[EmbeddingSync] Cancel requested; stopping migration loop')
        break
      }

      const batch = await sourceTable
        .query()
        .select(Array.from(MIGRATION_READ_COLUMNS))
        .offset(offset)
        .limit(MIGRATION_BATCH_SIZE)
        .toArray()

      if (batch.length === 0) break

      const rowsNeedingEmbedding: Array<Record<string, unknown>> = []
      for (const rawRow of batch) {
        const row = rawRow as Record<string, unknown>
        const id = row.id
        if (typeof id === 'string' && !completedIds.has(id)) {
          rowsNeedingEmbedding.push(row)
        }
      }

      if (rowsNeedingEmbedding.length > 0) {
        const contentsToEmbed = rowsNeedingEmbedding.map((row) => String(row.content ?? ''))
        const vectors = await embedTexts(contentsToEmbed)

        const rowsToInsert = rowsNeedingEmbedding.map((row, index) => ({
          id: row.id,
          content: row.content,
          vector: Array.from(vectors[index]),
          type: row.type,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          date: row.date,
          tags: row.tags,
          source: row.source,
          metadata: row.metadata,
          isDeleted: row.isDeleted,
        }))

        await stagingTable.add(rowsToInsert)
        for (const row of rowsNeedingEmbedding) {
          const id = row.id
          if (typeof id === 'string') completedIds.add(id)
        }
      }

      offset += batch.length

      setMigrationState({
        status: 'migrating',
        processed: Math.min(totalRowCount, completedIds.size),
        total: totalRowCount,
        fromModel: input.fromModel,
        toModel: input.toModel,
      })
    }

    if (cancelRequested) {
      await discardStagingAndRestoreSettings()
      return
    }

    writeActiveTablePointer({
      activeTable: toTable,
      activeTableDimension: input.toDimension,
      activeTableModel: input.toModel,
      pendingMigration: null,
    })

    await reopenActiveTable()

    try {
      const finalTableNames = await connection.tableNames()
      if (finalTableNames.includes(fromTable) && fromTable !== toTable) {
        await connection.dropTable(fromTable)
      }
    } catch (dropErr) {
      logger.warn(
        { err: dropErr, fromTable },
        '[EmbeddingSync] Failed to drop old source table after pointer flip',
      )
    }

    setMigrationState({ status: 'idle' })
    logger.info(
      {
        fromModel: input.fromModel,
        toModel: input.toModel,
        totalRowCount,
      },
      '[EmbeddingSync] Migration complete',
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Embedding migration failed'
    const snapshot = migrationState
    const processed = snapshot.status === 'migrating' ? snapshot.processed : 0
    const total = snapshot.status === 'migrating' ? snapshot.total : totalRowCount

    setMigrationState({
      status: 'error',
      message: errorMessage,
      processed,
      total,
      fromModel: input.fromModel,
      toModel: input.toModel,
    })
    logger.error(
      { err, fromModel: input.fromModel, toModel: input.toModel },
      '[EmbeddingSync] Migration failed',
    )
  }
}

async function discardStagingAndRestoreSettings(): Promise<void> {
  const pointer = readActiveTablePointer()
  const marker = pointer.pendingMigration
  if (!marker) {
    setMigrationState({ status: 'idle' })
    cancelRequested = false
    return
  }

  const connection = getConnection()
  try {
    const tableNames = await connection.tableNames()
    if (tableNames.includes(marker.toTable) && marker.toTable !== marker.fromTable) {
      await connection.dropTable(marker.toTable)
    }
  } catch (err) {
    logger.warn(
      { err, toTable: marker.toTable },
      '[EmbeddingSync] Failed to drop staging table during discard',
    )
  }

  writeActiveTablePointer({
    activeTable: marker.fromTable,
    activeTableDimension: marker.fromDimension,
    activeTableModel: marker.fromModel,
    pendingMigration: null,
  })

  const currentSettings = getSettings()
  if (currentSettings.embeddingModel !== marker.fromModel) {
    updateSettings({ embeddingModel: marker.fromModel })
  }

  try {
    await reopenActiveTable()
  } catch (err) {
    logger.error({ err }, '[EmbeddingSync] Failed to reopen active table after discard')
  }

  cancelRequested = false
  setMigrationState({ status: 'idle' })
  logger.info(
    { restoredModel: marker.fromModel },
    '[EmbeddingSync] Migration discarded; previous model restored',
  )
}

/**
 * Called on startup. If a pending migration marker exists, resume from
 * where the last run stopped by loading the set of IDs already copied into
 * staging and skipping those when reading from source. Idempotent — further
 * crashes simply resume the next time. If the staging and source tables are
 * both gone, clears the marker as a last resort.
 */
export async function resumePendingMigrationIfAny(): Promise<void> {
  const pointer = readActiveTablePointer()
  const marker = pointer.pendingMigration
  if (!marker) return

  const connection = getConnection()
  const tableNames = await connection.tableNames()
  const sourceExists = tableNames.includes(marker.fromTable)
  const stagingExists = tableNames.includes(marker.toTable)

  if (!sourceExists && !stagingExists) {
    logger.warn(
      { marker },
      '[EmbeddingSync] Pending migration present but neither table exists; clearing marker',
    )
    writeActiveTablePointer({
      activeTable: pointer.activeTable,
      activeTableDimension: pointer.activeTableDimension,
      activeTableModel: pointer.activeTableModel,
      pendingMigration: null,
    })
    return
  }

  if (!sourceExists && stagingExists) {
    logger.info(
      { marker },
      '[EmbeddingSync] Source gone but staging populated — finalizing pointer flip',
    )
    writeActiveTablePointer({
      activeTable: marker.toTable,
      activeTableDimension: marker.toDimension,
      activeTableModel: marker.toModel,
      pendingMigration: null,
    })
    await reopenActiveTable()
    return
  }

  logger.info({ marker }, '[EmbeddingSync] Resuming pending migration')
  await startMigration({
    fromModel: marker.fromModel,
    toModel: marker.toModel,
    fromDimension: marker.fromDimension,
    toDimension: marker.toDimension,
  })
}

/**
 * Drop any `documents__mig_*` tables that are not the active table and not
 * referenced by a pending marker. Runs after startup reconciliation to keep
 * the DB folder tidy.
 */
export async function cleanupOrphanStagingTables(): Promise<void> {
  const pointer = readActiveTablePointer()
  const connection = getConnection()
  const tableNames = await connection.tableNames()

  for (const tableName of tableNames) {
    if (!tableName.startsWith('documents__mig_')) continue
    if (tableName === pointer.activeTable) continue
    if (pointer.pendingMigration?.toTable === tableName) continue

    try {
      await connection.dropTable(tableName)
      logger.info({ tableName }, '[EmbeddingSync] Dropped orphan staging table')
    } catch (err) {
      logger.warn({ err, tableName }, '[EmbeddingSync] Failed to drop orphan staging table')
    }
  }
}

export async function retryEmbeddingMigration(): Promise<void> {
  if (migrationState.status === 'migrating') return
  const pointer = readActiveTablePointer()
  const marker = pointer.pendingMigration
  if (!marker) {
    setMigrationState({ status: 'idle' })
    return
  }
  await startMigration({
    fromModel: marker.fromModel,
    toModel: marker.toModel,
    fromDimension: marker.fromDimension,
    toDimension: marker.toDimension,
  })
}

/**
 * Discard a pending migration (from error state or as a cooperative cancel
 * during active migration): drop the staging table, restore the previous
 * embedding model in settings, clear the marker, and return to idle. Never
 * touches the source table, so user data is preserved.
 */
export async function discardEmbeddingMigration(): Promise<void> {
  if (migrationState.status === 'migrating') {
    cancelRequested = true
    // Wait for the loop to observe the cancel and run the discard path itself.
    if (activeMigrationPromise) {
      try {
        await activeMigrationPromise
      } catch {
        // Errors already logged by runMigration
      }
    }
    return
  }

  await discardStagingAndRestoreSettings()
}

export function cancelEmbeddingMigration(): void {
  if (migrationState.status === 'migrating') {
    cancelRequested = true
  }
}
