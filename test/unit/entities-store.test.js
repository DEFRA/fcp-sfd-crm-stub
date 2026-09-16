import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { config } from '../../src/config.js'
import {
  CONDITIONAL_UPSERT_ENTITY_SETS,
  commitConditionalCreates,
  findEntities,
  getEntity,
  hasEntity,
  resetEntities,
  upsertEntity
} from '../../src/store/entities.js'

describe('#entities-store', () => {
  const originalMaxSize = config.get('incidentStore.maxSize')
  const originalMaxAgeMinutes = config.get('incidentStore.maxAgeMinutes')

  const restoreDefaults = () => {
    resetEntities()
    config.set('incidentStore.maxSize', originalMaxSize)
    config.set('incidentStore.maxAgeMinutes', originalMaxAgeMinutes)
    vi.useRealTimers()
  }

  beforeEach(restoreDefaults)
  afterEach(restoreDefaults)

  test('permits the entity sets written by the consumer', () => {
    expect(CONDITIONAL_UPSERT_ENTITY_SETS).toEqual([
      'incidents',
      'rpa_onlinesubmissions',
      'rpa_activitymetadatas',
      'rpa_integrationinboundqueues'
    ])
  })

  describe('#getEntity and #hasEntity', () => {
    test('returns null and false for an id that has not been written', () => {
      expect(getEntity('incidents', 'missing-id')).toBeNull()
      expect(hasEntity('incidents', 'missing-id')).toBe(false)
    })

    test('returns null and false for an entity set that holds no records', () => {
      expect(getEntity('unknown_set', 'any-id')).toBeNull()
      expect(hasEntity('unknown_set', 'any-id')).toBe(false)
    })

    test('keeps records with the same id in different entity sets apart', () => {
      upsertEntity('incidents', 'shared-id', { title: 'incident' })
      upsertEntity('rpa_onlinesubmissions', 'shared-id', {
        subject: 'submission'
      })

      expect(getEntity('incidents', 'shared-id').body).toEqual({
        title: 'incident'
      })
      expect(getEntity('rpa_onlinesubmissions', 'shared-id').body).toEqual({
        subject: 'submission'
      })
    })
  })

  describe('#upsertEntity', () => {
    test('reports created on the first write and stores the record', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

      const result = upsertEntity('incidents', 'case-1', { title: 'first' })

      expect(result).toEqual({ created: true })
      expect(hasEntity('incidents', 'case-1')).toBe(true)
      expect(getEntity('incidents', 'case-1')).toEqual({
        id: 'case-1',
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
        body: { title: 'first' }
      })
    })

    test('reports not created on a repeat write and shallow merges the body', () => {
      upsertEntity('incidents', 'case-1', {
        title: 'first',
        description: 'kept'
      })

      const result = upsertEntity('incidents', 'case-1', { title: 'second' })

      expect(result).toEqual({ created: false })
      expect(getEntity('incidents', 'case-1').body).toEqual({
        title: 'second',
        description: 'kept'
      })
    })

    test('keeps the original creation time when merging', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      upsertEntity('incidents', 'case-1', { title: 'first' })

      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'))
      upsertEntity('incidents', 'case-1', { title: 'second' })

      expect(getEntity('incidents', 'case-1').createdAt).toBe(
        Date.parse('2026-01-01T00:00:00.000Z')
      )
    })

    test('does not keep a reference to the caller body', () => {
      const body = { title: 'first' }
      upsertEntity('incidents', 'case-1', body)

      body.title = 'mutated'

      expect(getEntity('incidents', 'case-1').body).toEqual({ title: 'first' })
    })
  })

  describe('#commitConditionalCreates', () => {
    const changesetWrites = () => [
      { entitySet: 'incidents', id: 'case-1', body: { title: 'case' } },
      {
        entitySet: 'rpa_onlinesubmissions',
        id: 'submission-1',
        body: { subject: 'submission' }
      },
      {
        entitySet: 'rpa_activitymetadatas',
        id: 'metadata-1',
        body: { rpa_name: 'file.pdf' }
      }
    ]

    test('commits every write when no record exists', () => {
      const result = commitConditionalCreates(changesetWrites())

      expect(result).toEqual({ committed: true })
      expect(getEntity('incidents', 'case-1').body).toEqual({ title: 'case' })
      expect(getEntity('rpa_onlinesubmissions', 'submission-1').body).toEqual({
        subject: 'submission'
      })
      expect(getEntity('rpa_activitymetadatas', 'metadata-1').body).toEqual({
        rpa_name: 'file.pdf'
      })
    })

    test('returns failedIndex 0 and commits nothing when the first record exists', () => {
      upsertEntity('incidents', 'case-1', { title: 'existing' })

      const result = commitConditionalCreates(changesetWrites())

      expect(result).toEqual({ committed: false, failedIndex: 0, status: 412 })
      expect(getEntity('incidents', 'case-1').body).toEqual({
        title: 'existing'
      })
      expect(hasEntity('rpa_onlinesubmissions', 'submission-1')).toBe(false)
      expect(hasEntity('rpa_activitymetadatas', 'metadata-1')).toBe(false)
    })

    test('returns failedIndex 2 and commits nothing when only the last record exists', () => {
      upsertEntity('rpa_activitymetadatas', 'metadata-1', {
        rpa_name: 'existing.pdf'
      })

      const result = commitConditionalCreates(changesetWrites())

      expect(result).toEqual({ committed: false, failedIndex: 2, status: 412 })
      expect(hasEntity('incidents', 'case-1')).toBe(false)
      expect(hasEntity('rpa_onlinesubmissions', 'submission-1')).toBe(false)
      expect(getEntity('rpa_activitymetadatas', 'metadata-1').body).toEqual({
        rpa_name: 'existing.pdf'
      })
    })

    test('reports a conflict when the same record appears twice in one set of writes', () => {
      const result = commitConditionalCreates([
        { entitySet: 'incidents', id: 'case-1', body: { title: 'first' } },
        { entitySet: 'incidents', id: 'case-1', body: { title: 'second' } }
      ])

      expect(result).toEqual({ committed: false, failedIndex: 1, status: 412 })
      expect(hasEntity('incidents', 'case-1')).toBe(false)
    })

    test('commits nothing and reports success for an empty set of writes', () => {
      expect(commitConditionalCreates([])).toEqual({ committed: true })
    })

    test('refuses writes that exceed the per-set limit rather than evicting its own records', () => {
      config.set('incidentStore.maxSize', 2)

      expect(() =>
        commitConditionalCreates([
          { entitySet: 'incidents', id: 'case-1', body: {} },
          { entitySet: 'incidents', id: 'case-2', body: {} },
          { entitySet: 'incidents', id: 'case-3', body: {} }
        ])
      ).toThrow(
        "Changeset writes 3 records to 'incidents', above the per-set limit of 2"
      )
      expect(hasEntity('incidents', 'case-1')).toBe(false)
      expect(hasEntity('incidents', 'case-2')).toBe(false)
      expect(hasEntity('incidents', 'case-3')).toBe(false)
    })

    test('counts the limit per entity set, not across the changeset', () => {
      config.set('incidentStore.maxSize', 2)

      const result = commitConditionalCreates([
        { entitySet: 'incidents', id: 'case-1', body: {} },
        { entitySet: 'incidents', id: 'case-2', body: {} },
        { entitySet: 'rpa_onlinesubmissions', id: 'submission-1', body: {} },
        { entitySet: 'rpa_onlinesubmissions', id: 'submission-2', body: {} }
      ])

      expect(result).toEqual({ committed: true })
      expect(hasEntity('incidents', 'case-1')).toBe(true)
      expect(hasEntity('rpa_onlinesubmissions', 'submission-1')).toBe(true)
    })
  })

  describe('#findEntities', () => {
    test('returns the records in an entity set that match the predicate', () => {
      upsertEntity('rpa_onlinesubmissions', 'submission-1', {
        case: '/incidents(case-1)'
      })
      upsertEntity('rpa_onlinesubmissions', 'submission-2', {
        case: '/incidents(case-2)'
      })
      upsertEntity('rpa_onlinesubmissions', 'submission-3', {
        case: '/incidents(case-1)'
      })

      const matches = findEntities(
        'rpa_onlinesubmissions',
        (entity) => entity.body.case === '/incidents(case-1)'
      )

      expect(matches.map((entity) => entity.id)).toEqual([
        'submission-1',
        'submission-3'
      ])
    })

    test('returns an empty array for an entity set that holds no records', () => {
      expect(findEntities('rpa_onlinesubmissions', () => true)).toEqual([])
    })
  })

  describe('retention', () => {
    test('evicts the oldest records in an entity set when max size is exceeded', () => {
      config.set('incidentStore.maxSize', 2)
      config.set('incidentStore.maxAgeMinutes', 0)

      upsertEntity('incidents', 'case-1', {})
      upsertEntity('incidents', 'case-2', {})
      upsertEntity('incidents', 'case-3', {})

      expect(hasEntity('incidents', 'case-1')).toBe(false)
      expect(hasEntity('incidents', 'case-2')).toBe(true)
      expect(hasEntity('incidents', 'case-3')).toBe(true)
    })

    test('applies max size to each entity set separately', () => {
      config.set('incidentStore.maxSize', 2)
      config.set('incidentStore.maxAgeMinutes', 0)

      upsertEntity('incidents', 'case-1', {})
      upsertEntity('incidents', 'case-2', {})
      upsertEntity('rpa_onlinesubmissions', 'submission-1', {})
      upsertEntity('rpa_onlinesubmissions', 'submission-2', {})

      expect(findEntities('incidents', () => true)).toHaveLength(2)
      expect(findEntities('rpa_onlinesubmissions', () => true)).toHaveLength(2)
    })

    test('evicts records written before a conditional commit, not by it', () => {
      config.set('incidentStore.maxSize', 2)
      config.set('incidentStore.maxAgeMinutes', 0)

      upsertEntity('incidents', 'case-1', {})
      upsertEntity('incidents', 'case-2', {})

      commitConditionalCreates([
        { entitySet: 'incidents', id: 'case-3', body: {} }
      ])

      expect(
        findEntities('incidents', () => true).map((entity) => entity.id)
      ).toEqual(['case-2', 'case-3'])
    })

    test('expires records older than max age', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

      config.set('incidentStore.maxSize', 1000)
      config.set('incidentStore.maxAgeMinutes', 1)

      upsertEntity('incidents', 'case-1', {})
      expect(getEntity('incidents', 'case-1')).not.toBeNull()

      vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'))
      expect(getEntity('incidents', 'case-1')).toBeNull()
      expect(hasEntity('incidents', 'case-1')).toBe(false)
    })

    test('allows a conditional create once the existing record has expired', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

      config.set('incidentStore.maxSize', 1000)
      config.set('incidentStore.maxAgeMinutes', 1)

      upsertEntity('incidents', 'case-1', { title: 'expired' })

      vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'))
      const result = commitConditionalCreates([
        { entitySet: 'incidents', id: 'case-1', body: { title: 'fresh' } }
      ])

      expect(result).toEqual({ committed: true })
      expect(getEntity('incidents', 'case-1').body).toEqual({ title: 'fresh' })
    })

    test('keeps records indefinitely when max age is 0', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

      config.set('incidentStore.maxAgeMinutes', 0)

      upsertEntity('incidents', 'case-1', {})

      vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
      expect(hasEntity('incidents', 'case-1')).toBe(true)
    })
  })

  describe('#resetEntities', () => {
    test('clears every entity set', () => {
      for (const entitySet of CONDITIONAL_UPSERT_ENTITY_SETS) {
        upsertEntity(entitySet, 'record-1', {})
      }

      resetEntities()

      for (const entitySet of CONDITIONAL_UPSERT_ENTITY_SETS) {
        expect(hasEntity(entitySet, 'record-1')).toBe(false)
      }
    })
  })
})
