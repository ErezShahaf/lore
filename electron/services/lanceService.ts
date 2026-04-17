import { app } from 'electron'
import { logger } from '../logger'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import * as lancedb from '@lancedb/lancedb'
import {
  Float32,
  Utf8,
  Bool,
  Field,
  Schema,
  FixedSizeList,
} from 'apache-arrow'
import { getEmbeddingDimension, resolveEmbeddingDimensionForModelName } from './embeddingService'
import { getSettings } from './settingsService'
import {
  readActiveTablePointer,
  writeActiveTablePointer,
  type ActiveTablePointer,
} from './activeTablePointer'
import type { LoreDocument, DatabaseStats } from '../../shared/types'

const DEFAULT_ACTIVE_TABLE_NAME = 'documents'

let connection: lancedb.Connection | null = null
let activeDocumentsTable: lancedb.Table | null = null
let activeDocumentsTableName: string = DEFAULT_ACTIVE_TABLE_NAME

function getDbPath(): string {
  const directoryPath = join(app.getPath('userData'), 'lore-db')
  if (!existsSync(directoryPath)) mkdirSync(directoryPath, { recursive: true })
  return directoryPath
}

export function buildDocumentsSchema(dimension: number): Schema {
  return new Schema([
    new Field('id', new Utf8()),
    new Field('content', new Utf8()),
    new Field('vector', new FixedSizeList(dimension, new Field('item', new Float32()))),
    new Field('type', new Utf8()),
    new Field('createdAt', new Utf8()),
    new Field('updatedAt', new Utf8()),
    new Field('date', new Utf8()),
    new Field('tags', new Utf8()),
    new Field('source', new Utf8()),
    new Field('metadata', new Utf8()),
    new Field('isDeleted', new Bool()),
  ])
}

export function docToRow(doc: LoreDocument): Record<string, unknown> {
  return {
    id: doc.id,
    content: doc.content,
    vector: Array.from(doc.vector),
    type: doc.type,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    date: doc.date,
    tags: doc.tags,
    source: doc.source,
    metadata: doc.metadata,
    isDeleted: doc.isDeleted,
  }
}

export function rowToDoc(row: Record<string, unknown>): LoreDocument {
  const rawVector = row.vector
  const vector = rawVector instanceof Float32Array
    ? rawVector
    : new Float32Array(rawVector as number[])

  return {
    id: row.id as string,
    content: row.content as string,
    vector,
    type: row.type as LoreDocument['type'],
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    date: row.date as string,
    tags: row.tags as string,
    source: row.source as string,
    metadata: row.metadata as string,
    isDeleted: row.isDeleted as boolean,
  }
}

export async function getTableVectorDimensionForHandle(
  table: lancedb.Table,
): Promise<number | null> {
  try {
    const schema = await table.schema()
    const vectorField = schema.fields.find((f: { name: string }) => f.name === 'vector')
    if (vectorField && vectorField.type instanceof FixedSizeList) {
      return vectorField.type.listSize
    }
  } catch {
    // schema introspection not available on this lancedb build; caller can fall back
  }
  return null
}

async function openOrCreateActiveTable(
  connectionHandle: lancedb.Connection,
  desiredTableName: string,
  dimension: number,
): Promise<{ table: lancedb.Table; tableName: string; wasCreated: boolean }> {
  const tableNames = await connectionHandle.tableNames()

  if (tableNames.includes(desiredTableName)) {
    return {
      table: await connectionHandle.openTable(desiredTableName),
      tableName: desiredTableName,
      wasCreated: false,
    }
  }

  if (tableNames.includes(DEFAULT_ACTIVE_TABLE_NAME)) {
    return {
      table: await connectionHandle.openTable(DEFAULT_ACTIVE_TABLE_NAME),
      tableName: DEFAULT_ACTIVE_TABLE_NAME,
      wasCreated: false,
    }
  }

  const schema = buildDocumentsSchema(dimension)
  return {
    table: await connectionHandle.createEmptyTable(DEFAULT_ACTIVE_TABLE_NAME, schema),
    tableName: DEFAULT_ACTIVE_TABLE_NAME,
    wasCreated: true,
  }
}

/**
 * Open the database and attach to the active documents table as described
 * by the pointer file. We intentionally do NOT auto-reset the table on
 * dimension mismatch — that silently destroyed user data on the next boot.
 * Reconciliation is the sync layer's responsibility (see embeddingTableSync).
 */
export async function initialize(): Promise<void> {
  const databasePath = getDbPath()
  connection = await lancedb.connect(databasePath)

  const pointer = readActiveTablePointer()
  const currentSettings = getSettings()
  const expectedDimensionForCurrentModel = resolveEmbeddingDimensionForModelName(
    currentSettings.embeddingModel,
  )

  const { table, tableName, wasCreated } = await openOrCreateActiveTable(
    connection,
    pointer.activeTable,
    expectedDimensionForCurrentModel,
  )

  activeDocumentsTable = table
  activeDocumentsTableName = tableName

  const actualDimension = await getTableVectorDimensionForHandle(table) ?? 0
  const recordedModel = wasCreated ? currentSettings.embeddingModel : pointer.activeTableModel

  writeActiveTablePointer({
    activeTable: tableName,
    activeTableDimension: actualDimension,
    activeTableModel: recordedModel,
    pendingMigration: pointer.pendingMigration,
  })

  logger.info(
    {
      databasePath,
      activeTableName: tableName,
      activeDimension: actualDimension,
      hasPendingMigration: pointer.pendingMigration !== null,
    },
    '[LanceDB] Initialized',
  )
}

export function getConnection(): lancedb.Connection {
  if (!connection) throw new Error('LanceDB not initialized')
  return connection
}

export function getActiveTableName(): string {
  return activeDocumentsTableName
}

export async function getActiveTableVectorDimension(): Promise<number | null> {
  if (!activeDocumentsTable) return null
  return getTableVectorDimensionForHandle(activeDocumentsTable)
}

/**
 * Re-read the pointer file and re-open whatever table it points at, so the
 * in-memory handle reflects the current active table. Called on init, after
 * a migration pointer flip, and after crash-recovery cleanup — ensuring that
 * code holding a reference via getTable() always sees the current active
 * table, not a stale one from module load time.
 */
export async function reopenActiveTable(): Promise<void> {
  if (!connection) throw new Error('LanceDB not initialized')
  const pointer = readActiveTablePointer()
  const tableNames = await connection.tableNames()

  const targetTableName = tableNames.includes(pointer.activeTable)
    ? pointer.activeTable
    : tableNames.includes(DEFAULT_ACTIVE_TABLE_NAME)
      ? DEFAULT_ACTIVE_TABLE_NAME
      : null

  if (targetTableName === null) {
    throw new Error(
      `Cannot reopen active table: neither "${pointer.activeTable}" nor fallback "${DEFAULT_ACTIVE_TABLE_NAME}" exists`,
    )
  }

  activeDocumentsTable = await connection.openTable(targetTableName)
  activeDocumentsTableName = targetTableName

  const actualDimension = await getTableVectorDimensionForHandle(activeDocumentsTable) ?? 0
  writeActiveTablePointer({
    activeTable: targetTableName,
    activeTableDimension: actualDimension,
    activeTableModel: pointer.activeTableModel,
    pendingMigration: pointer.pendingMigration,
  })

  logger.info(
    { activeTableName: targetTableName, activeDimension: actualDimension },
    '[LanceDB] Reopened active table',
  )
}

export async function resetTable(): Promise<void> {
  if (!connection) throw new Error('LanceDB not initialized')
  const currentSettings = getSettings()
  const dimension = getEmbeddingDimension()

  const existingTableNames = await connection.tableNames()
  const tablesToDrop = new Set<string>()
  tablesToDrop.add(activeDocumentsTableName)
  tablesToDrop.add(DEFAULT_ACTIVE_TABLE_NAME)
  for (const name of existingTableNames) {
    if (name.startsWith('documents__mig_')) tablesToDrop.add(name)
  }

  for (const name of tablesToDrop) {
    if (existingTableNames.includes(name)) {
      try {
        await connection.dropTable(name)
      } catch (err) {
        logger.warn({ err, name }, '[LanceDB] Failed to drop table during reset')
      }
    }
  }

  const schema = buildDocumentsSchema(dimension)
  activeDocumentsTable = await connection.createEmptyTable(DEFAULT_ACTIVE_TABLE_NAME, schema)
  activeDocumentsTableName = DEFAULT_ACTIVE_TABLE_NAME

  writeActiveTablePointer({
    activeTable: DEFAULT_ACTIVE_TABLE_NAME,
    activeTableDimension: dimension,
    activeTableModel: currentSettings.embeddingModel,
    pendingMigration: null,
  })

  logger.info({ dimension }, '[LanceDB] Reset: dropped old tables and created fresh documents')
}

export function setActiveTableInternal(
  table: lancedb.Table,
  tableName: string,
): void {
  activeDocumentsTable = table
  activeDocumentsTableName = tableName
}

function getTable(): lancedb.Table {
  if (!activeDocumentsTable) throw new Error('LanceDB not initialized')
  return activeDocumentsTable
}

// ── Write operations ──────────────────────────────────────────

export async function insertDocument(document: LoreDocument): Promise<void> {
  const table = getTable()
  await table.add([docToRow(document)])
}

export async function insertDocuments(documents: LoreDocument[]): Promise<void> {
  if (documents.length === 0) return
  const table = getTable()
  await table.add(documents.map(docToRow))
}

export async function updateDocument(
  id: string,
  updates: Partial<LoreDocument>,
): Promise<void> {
  const table = getTable()
  const existingDocument = await getDocumentById(id)
  if (!existingDocument) {
    logger.warn({ id }, '[LanceDB] updateDocument called for missing document')
    return
  }

  const updatedDocument: LoreDocument = {
    ...existingDocument,
    ...updates,
    vector: updates.vector ?? existingDocument.vector,
    updatedAt: new Date().toISOString(),
  }

  await table.delete(`id = '${escapeSql(id)}'`)
  await table.add([docToRow(updatedDocument)])
  logger.debug(
    {
      id: id.slice(0, 8),
      updatedColumns: Object.keys(updates),
    },
    '[LanceDB] updateDocument',
  )
}

export async function softDeleteDocument(id: string): Promise<void> {
  await updateDocument(id, { isDeleted: true })
}

export async function hardDeleteDocument(id: string): Promise<void> {
  const table = getTable()
  await table.delete(`id = '${escapeSql(id)}'`)
}

export async function hardDeleteDocuments(): Promise<void> {
  const table = getTable()
  await table.delete('isDeleted = true')
}

// ── Read operations ───────────────────────────────────────────

export async function searchSimilar(
  queryVector: Float32Array,
  limit: number,
  filter?: string,
): Promise<LoreDocument[]> {
  const table = getTable()
  let query = table.vectorSearch(Array.from(queryVector)).distanceType('cosine').limit(limit)

  const fullFilter = filter
    ? `isDeleted = false AND (${filter})`
    : 'isDeleted = false'
  query = query.where(fullFilter)

  const results = await query.toArray()
  return results.map((r) => {
    const row = r as unknown as Record<string, unknown>
    const doc = rowToDoc(row)
    if ('_distance' in row) {
      (doc as unknown as Record<string, unknown>)._distance = row._distance
    }
    return doc
  })
}

export async function getDocumentById(id: string): Promise<LoreDocument | null> {
  const table = getTable()
  const results = await table
    .query()
    .where(`id = '${escapeSql(id)}'`)
    .limit(1)
    .toArray()

  return results.length > 0 ? rowToDoc(results[0]) : null
}

export async function getDocumentsByType(type: string): Promise<LoreDocument[]> {
  const table = getTable()
  const results = await table
    .query()
    .where(`type = '${escapeSql(type)}' AND isDeleted = false`)
    .toArray()

  return results.map((r: Record<string, unknown>) => rowToDoc(r))
}

export async function getDocumentsByDateRange(
  startDate: string,
  endDate: string,
): Promise<LoreDocument[]> {
  const table = getTable()
  const results = await table
    .query()
    .where(`date >= '${escapeSql(startDate)}' AND date <= '${escapeSql(endDate)}' AND isDeleted = false`)
    .toArray()

  return results.map((r: Record<string, unknown>) => rowToDoc(r))
}

export async function getDocumentsByFilter(
  filter?: string,
  limit?: number,
): Promise<LoreDocument[]> {
  const table = getTable()
  let query = table.query()
  const fullFilter = filter
    ? `isDeleted = false AND (${filter})`
    : 'isDeleted = false'

  query = query.where(fullFilter)
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    query = query.limit(limit)
  }

  const results = await query.toArray()
  return results.map((row: Record<string, unknown>) => rowToDoc(row))
}

export async function getAllDocuments(includeDeleted = false): Promise<LoreDocument[]> {
  const table = getTable()
  let query = table.query()
  if (!includeDeleted) {
    query = query.where('isDeleted = false')
  }
  const results = await query.toArray()
  return results.map((r: Record<string, unknown>) => rowToDoc(r))
}

// ── Maintenance ───────────────────────────────────────────────

export async function cleanupOldDeleted(daysOld = 30): Promise<number> {
  const table = getTable()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysOld)

  const deletedDocs = await table
    .query()
    .where(`isDeleted = true AND updatedAt < '${cutoff.toISOString()}'`)
    .toArray()

  if (deletedDocs.length > 0) {
    await table.delete(`isDeleted = true AND updatedAt < '${cutoff.toISOString()}'`)
  }

  return deletedDocs.length
}

export async function getStats(): Promise<DatabaseStats> {
  const table = getTable()
  const all = await table.query().toArray()

  const stats: DatabaseStats = {
    totalDocuments: 0,
    deletedDocuments: 0,
    documentsByType: {},
  }

  for (const row of all) {
    if (row.isDeleted) {
      stats.deletedDocuments++
    } else {
      stats.totalDocuments++
      const type = row.type as string
      stats.documentsByType[type] = (stats.documentsByType[type] || 0) + 1
    }
  }

  return stats
}

export async function compactTable(): Promise<void> {
  const table = getTable()
  await table.optimize()
}

export function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

export type { ActiveTablePointer }
