import { randomUUID } from 'node:crypto'
import { deterministicUuid } from '#/utils/deterministic-uuid.js'

const incidents = new Map()

const normalizeOnlineSubmissions = (incidentid, onlineSubmissions = []) =>
  onlineSubmissions.map((onlineSubmission, index) => ({
    ...onlineSubmission,
    rpa_onlinesubmissionid: onlineSubmission.rpa_onlinesubmissionid ??
      deterministicUuid(`${incidentid}:${index}:${onlineSubmission.subject ?? ''}`)
  }))

export function createIncident(payload) {
  const incidentid = randomUUID()
  const incident = {
    incidentid,
    title: payload.title ?? '',
    description: payload.description ?? '',
    incident_rpa_onlinesubmissions: normalizeOnlineSubmissions(
      incidentid,
      payload.incident_rpa_onlinesubmissions
    )
  }

  incidents.set(incidentid, incident)
  return incident
}

export function getIncidentById(incidentid) {
  return incidents.get(incidentid) ?? null
}

export function resetIncidents() {
  incidents.clear()
}