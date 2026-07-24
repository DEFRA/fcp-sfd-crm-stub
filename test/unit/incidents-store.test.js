import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { config } from '../../src/config.js'
import { createIncident, getIncidentById, resetIncidents } from '../../src/store/incidents.js'

describe('#incidents-store', () => {
  const originalMaxSize = config.get('incidentStore.maxSize')
  const originalMaxAgeMinutes = config.get('incidentStore.maxAgeMinutes')

  beforeEach(() => {
    resetIncidents()
    config.set('incidentStore.maxSize', originalMaxSize)
    config.set('incidentStore.maxAgeMinutes', originalMaxAgeMinutes)
    vi.useRealTimers()
  })

  afterEach(() => {
    resetIncidents()
    config.set('incidentStore.maxSize', originalMaxSize)
    config.set('incidentStore.maxAgeMinutes', originalMaxAgeMinutes)
    vi.useRealTimers()
  })

  test('evicts oldest incidents when max size is exceeded', () => {
    config.set('incidentStore.maxSize', 2)
    config.set('incidentStore.maxAgeMinutes', 0)

    const incidentOne = createIncident({ title: 'incident-one' })
    const incidentTwo = createIncident({ title: 'incident-two' })
    const incidentThree = createIncident({ title: 'incident-three' })

    expect(getIncidentById(incidentOne.incidentid)).toBeNull()
    expect(getIncidentById(incidentTwo.incidentid)).not.toBeNull()
    expect(getIncidentById(incidentThree.incidentid)).not.toBeNull()
  })

  test('expires incidents older than max age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    config.set('incidentStore.maxSize', 1000)
    config.set('incidentStore.maxAgeMinutes', 1)

    const incident = createIncident({ title: 'expiring-incident' })
    expect(getIncidentById(incident.incidentid)).not.toBeNull()

    vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'))
    expect(getIncidentById(incident.incidentid)).toBeNull()
  })

  test('retains deterministic max size under concurrent incident creation', async () => {
    config.set('incidentStore.maxSize', 50)
    config.set('incidentStore.maxAgeMinutes', 0)

    const createTasks = Array.from({ length: 200 }, (_unused, index) =>
      Promise.resolve(createIncident({ title: `incident-${index}` }))
    )

    const createdIncidents = await Promise.all(createTasks)
    const createdIds = createdIncidents.map((incident) => incident.incidentid)

    expect(new Set(createdIds).size).toBe(200)

    const retainedCount = createdIds.reduce((count, incidentid) => {
      const incident = getIncidentById(incidentid)
      return incident ? count + 1 : count
    }, 0)

    expect(retainedCount).toBe(50)
  })
})