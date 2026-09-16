import { randomUUID } from 'node:crypto'
import { deterministicUuid } from '#/utils/deterministic-uuid.js'
import { findEntities, getEntity, upsertEntity } from '#/store/entities.js'

const INCIDENTS = 'incidents'
const ONLINE_SUBMISSIONS = 'rpa_onlinesubmissions'
const INCIDENT_BIND_FIELD =
  'regardingobjectid_incident_rpa_onlinesubmission@odata.bind'
const ODATA_BIND_SUFFIX = '@odata.bind'

const incidentBindValue = (incidentid) => `/incidents(${incidentid})`

const withoutBindAnnotations = (body) =>
  Object.fromEntries(
    Object.entries(body).filter(([key]) => !key.endsWith(ODATA_BIND_SUFFIX))
  )

const normalizeOnlineSubmissions = (incidentid, onlineSubmissions = []) =>
  onlineSubmissions.map((onlineSubmission, index) => ({
    ...onlineSubmission,
    rpa_onlinesubmissionid:
      onlineSubmission.rpa_onlinesubmissionid ??
      deterministicUuid(
        `${incidentid}:${index}:${onlineSubmission.subject ?? ''}`
      )
  }))

// The only place an online submission is linked to its incident: by the
// regarding-object bind value, however the online submission was created.
const findOnlineSubmissions = (incidentid) =>
  findEntities(
    ONLINE_SUBMISSIONS,
    (entity) =>
      entity.body[INCIDENT_BIND_FIELD] === incidentBindValue(incidentid)
  ).map((entity) => ({
    ...withoutBindAnnotations(entity.body),
    activityid: entity.id
  }))

/**
 * Creates an incident and its nested online submissions as separate records
 * in the entity store, linking each online submission to the incident.
 * @param {{ title?: string, description?: string, incident_rpa_onlinesubmissions?: object[] }} payload
 * @returns {object} the incident as returned by getIncidentById
 */
export function createIncident(payload) {
  const incidentid = randomUUID()
  upsertEntity(INCIDENTS, incidentid, {
    title: payload.title ?? '',
    description: payload.description ?? ''
  })

  const onlineSubmissions = normalizeOnlineSubmissions(
    incidentid,
    payload.incident_rpa_onlinesubmissions
  )
  for (const onlineSubmission of onlineSubmissions) {
    upsertEntity(ONLINE_SUBMISSIONS, randomUUID(), {
      ...onlineSubmission,
      [INCIDENT_BIND_FIELD]: incidentBindValue(incidentid)
    })
  }

  return getIncidentById(incidentid)
}

/**
 * Returns an incident with its linked online submissions, each exposing its
 * record id as `activityid`. `@odata.bind` annotations are not returned.
 * @param {string} incidentid
 * @returns {{ incidentid: string, createdAt: number, title?: string, description?: string, incident_rpa_onlinesubmissions: object[] } | null}
 */
export function getIncidentById(incidentid) {
  const incident = getEntity(INCIDENTS, incidentid)
  if (!incident) {
    return null
  }

  return {
    incidentid,
    createdAt: incident.createdAt,
    title: incident.body.title,
    description: incident.body.description,
    incident_rpa_onlinesubmissions: findOnlineSubmissions(incidentid)
  }
}
