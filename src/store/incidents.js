import { randomUUID } from 'node:crypto'
import { deterministicUuid } from '#/utils/deterministic-uuid.js'
import { config } from '#/config.js'

const incidents = new Map()

const getMaxSize = () => config.get('incidentStore.maxSize')
const getMaxAgeMinutes = () => config.get('incidentStore.maxAgeMinutes')

function purgeExpiredIncidents(now) {
  const maxAgeMinutes = getMaxAgeMinutes()
  if (maxAgeMinutes === 0) {
    return
  }

  const cutoff = now - (maxAgeMinutes * 60 * 1000)
  for (const [incidentid, incident] of incidents.entries()) {
    if (incident.createdAt < cutoff) {
      incidents.delete(incidentid)
    }
  }
}

function evictOverflowIncidents() {
  const maxSize = getMaxSize()
  while (incidents.size > maxSize) {
    const oldestIncidentId = incidents.keys().next().value
    incidents.delete(oldestIncidentId)
  }
}

const normalizeOnlineSubmissions = (incidentid, onlineSubmissions = []) =>
  onlineSubmissions.map((onlineSubmission, index) => ({
    ...onlineSubmission,
    rpa_onlinesubmissionid: onlineSubmission.rpa_onlinesubmissionid ??
      deterministicUuid(`${incidentid}:${index}:${onlineSubmission.subject ?? ''}`)
  }))

export function createIncident(payload) {
  const now = Date.now()
  purgeExpiredIncidents(now)

  const incidentid = randomUUID()
  const incident = {
    incidentid,
    createdAt: now,
    title: payload.title ?? '',
    description: payload.description ?? '',
    incident_rpa_onlinesubmissions: normalizeOnlineSubmissions(
      incidentid,
      payload.incident_rpa_onlinesubmissions
    )
  }

  incidents.set(incidentid, incident)
  evictOverflowIncidents()
  return incident
}

export function getIncidentById(incidentid) {
  purgeExpiredIncidents(Date.now())
  return incidents.get(incidentid) ?? null
}

export function resetIncidents() {
  incidents.clear()
}