import { app } from 'electron'
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
import { getEmbeddingDimension } from './embeddingService'
import type { LoreDocument, DatabaseStats } from '../../shared/types'

let db: lancedb.Connection | null = null
let documentsTable: lancedb.Table | null = null

function getDbPath(): string {
  const dir = join(app.getPath('userData'), 'lore-db')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function buildSchema(dimension: number): Schema {
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

function docToRow(doc: LoreDocument): Record<string, unknown> {
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

function rowToDoc(row: Record<string, unknown>): LoreDocument {
  const vec = row.vector
  const vector = vec instanceof Float32Array
    ? vec
    : new Float32Array(vec as number[])

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

export async function initialize(): Promise<void> {
  const dbPath = getDbPath()
  db = await lancedb.connect(dbPath)

  const dimension = getEmbeddingDimension()
  const tableNames = await db.tableNames()

  if (tableNames.includes('documents')) {
    documentsTable = await db.openTable('documents')

    const existingDim = getTableVectorDimension()
    if (existingDim !== null && existingDim !== dimension) {
      console.log(`[LanceDB] Vector dimension mismatch (table=${existingDim}, model=${dimension}), recreating table`)
      await resetTable()
      return
    }
  } else {
    const schema = buildSchema(dimension)
    documentsTable = await db.createEmptyTable('documents', schema)
  }

  console.log('[LanceDB] Initialized at', dbPath)
}

function getTableVectorDimension(): number | null {
  if (!documentsTable) return null
  try {
    const schema = documentsTable.schema
    const vectorField = schema.fields.find(f => f.name === 'vector')
    if (vectorField && vectorField.type instanceof FixedSizeList) {
      return vectorField.type.listSize
    }
  } catch {
    // schema introspection not available, skip check
  }
  return null
}

export async function resetTable(): Promise<void> {
  if (!db) throw new Error('LanceDB not initialized')

  const tableNames = await db.tableNames()
  if (tableNames.includes('documents')) {
    await db.dropTable('documents')
    console.log('[LanceDB] Dropped existing documents table')
  }

  const dimension = getEmbeddingDimension()
  const schema = buildSchema(dimension)
  documentsTable = await db.createEmptyTable('documents', schema)
  console.log(`[LanceDB] Created new documents table (dimension=${dimension})`)
}

function getTable(): lancedb.Table {
  if (!documentsTable) throw new Error('LanceDB not initialized')
  return documentsTable
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

  const valueUpdates: Record<string, string> = {}

  if (updates.content !== undefined) valueUpdates.content = `'${escapeSql(updates.content)}'`
  if (updates.type !== undefined) valueUpdates.type = `'${escapeSql(updates.type)}'`
  if (updates.date !== undefined) valueUpdates.date = `'${escapeSql(updates.date)}'`
  if (updates.tags !== undefined) valueUpdates.tags = `'${escapeSql(updates.tags)}'`
  if (updates.metadata !== undefined) valueUpdates.metadata = `'${escapeSql(updates.metadata)}'`
  if (updates.isDeleted !== undefined) valueUpdates.isDeleted = String(updates.isDeleted)

  valueUpdates.updatedAt = `'${new Date().toISOString()}'`

  await table.update(valueUpdates, { where: `id = '${escapeSql(id)}'` })
}

export async function softDeleteDocument(id: string): Promise<void> {
  await updateDocument(id, { isDeleted: true })
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
  return results.map((r: Record<string, unknown>) => {
    const doc = rowToDoc(r)
    if ('_distance' in r) {
      ;(doc as Record<string, unknown>)._distance = r._distance
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

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}
