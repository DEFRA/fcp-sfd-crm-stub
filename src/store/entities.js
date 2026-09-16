import { config } from '#/config.js'

export const CONDITIONAL_UPSERT_ENTITY_SETS = Object.freeze([
  'incidents',
  'rpa_onlinesubmissions',
  'rpa_activitymetadatas',
  'rpa_integrationinboundqueues'
])

const PRECONDITION_FAILED_STATUS = 412
const MILLISECONDS_PER_MINUTE = 60 * 1000

const entitySets = new Map()

const getMaxSize = () => config.get('incidentStore.maxSize')
const getMaxAgeMinutes = () => config.get('incidentStore.maxAgeMinutes')

function getOrCreateSet(entitySet) {
  if (!entitySets.has(entitySet)) {
    entitySets.set(entitySet, new Map())
  }
  return entitySets.get(entitySet)
}

function purgeExpiredRecords(records, now) {
  const maxAgeMinutes = getMaxAgeMinutes()
  if (!records || maxAgeMinutes === 0) {
    return
  }

  const cutoff = now - maxAgeMinutes * MILLISECONDS_PER_MINUTE
  for (const [id, entity] of records.entries()) {
    if (entity.createdAt < cutoff) {
      records.delete(id)
    }
  }
}

function evictOverflowRecords(records) {
  const maxSize = getMaxSize()
  while (records.size > maxSize) {
    const oldestId = records.keys().next().value
    records.delete(oldestId)
  }
}

function getLiveSet(entitySet) {
  const records = entitySets.get(entitySet)
  purgeExpiredRecords(records, Date.now())
  return records
}

/**
 * Returns the stored record for an id in an entity set.
 * @param {string} entitySet - OData entity set name, for example `incidents`
 * @param {string} id - record id
 * @returns {{ id: string, createdAt: number, body: object } | null}
 */
export function getEntity(entitySet, id) {
  return getLiveSet(entitySet)?.get(id) ?? null
}

/**
 * Reports whether an unexpired record exists for an id in an entity set.
 * @param {string} entitySet
 * @param {string} id
 * @returns {boolean}
 */
export function hasEntity(entitySet, id) {
  return getLiveSet(entitySet)?.has(id) ?? false
}

/**
 * Creates a record, or shallow merges the body into an existing record.
 * The creation time and eviction order of an existing record are kept.
 * @param {string} entitySet
 * @param {string} id
 * @param {object} body - JSON payload as received
 * @returns {{ created: boolean }}
 */
export function upsertEntity(entitySet, id, body) {
  purgeExpiredRecords(entitySets.get(entitySet), Date.now())
  const records = getOrCreateSet(entitySet)
  const existing = records.get(id)

  if (existing) {
    existing.body = { ...existing.body, ...body }
    return { created: false }
  }

  records.set(id, { id, createdAt: Date.now(), body: { ...body } })
  evictOverflowRecords(records)
  return { created: true }
}

function findFirstConflictIndex(writes) {
  const seen = new Set()
  return writes.findIndex(({ entitySet, id }) => {
    const key = JSON.stringify([entitySet, id])
    const conflicts = seen.has(key) || hasEntity(entitySet, id)
    seen.add(key)
    return conflicts
  })
}

/**
 * Creates every record only if none of them already exists and no id repeats
 * within the writes; otherwise creates nothing and reports the first conflict.
 * The conflict check and the writes run synchronously, so no other request can
 * interleave between them.
 * @param {Array<{ entitySet: string, id: string, body: object }>} writes
 * @returns {{ committed: true } | { committed: false, failedIndex: number, status: number }}
 */
export function commitConditionalCreates(writes) {
  const failedIndex = findFirstConflictIndex(writes)
  if (failedIndex !== -1) {
    return { committed: false, failedIndex, status: PRECONDITION_FAILED_STATUS }
  }

  const now = Date.now()
  const touchedSets = new Set()
  for (const { entitySet, id, body } of writes) {
    const records = getOrCreateSet(entitySet)
    records.set(id, { id, createdAt: now, body: { ...body } })
    touchedSets.add(records)
  }

  for (const records of touchedSets) {
    evictOverflowRecords(records)
  }

  return { committed: true }
}

/**
 * Returns the unexpired records in an entity set that match a predicate,
 * oldest first.
 * @param {string} entitySet
 * @param {(entity: { id: string, createdAt: number, body: object }) => boolean} predicate
 * @returns {Array<{ id: string, createdAt: number, body: object }>}
 */
export function findEntities(entitySet, predicate) {
  const records = getLiveSet(entitySet)
  return records ? [...records.values()].filter(predicate) : []
}

/**
 * Removes every record from every entity set.
 */
export function resetEntities() {
  entitySets.clear()
}
