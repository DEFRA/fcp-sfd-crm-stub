import Boom from '@hapi/boom'
import Joi from 'joi'
import { parseSelect, pickSelected } from '#/utils/odata.js'
import { createIncident, getIncidentById } from '#/store/incidents.js'
import { record } from '#/store/request-history.js'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_NOT_FOUND = 404
const ONLINE_SUBMISSIONS_EXPAND = 'incident_rpa_onlinesubmissions'

const postPayloadSchema = Joi.object({
  title: Joi.string(),
  description: Joi.string(),
  incident_rpa_onlinesubmissions: Joi.array().items(Joi.object().unknown(true))
}).unknown(true)

const getQuerySchema = Joi.object({
  $select: Joi.string(),
  $expand: Joi.string()
}).unknown(true)

const parseExpand = (expand) => {
  if (!expand || typeof expand !== 'string') {
    return null
  }

  const normalized = expand.replace(/\s+/g, '')

  if (normalized === ONLINE_SUBMISSIONS_EXPAND) {
    return {
      field: ONLINE_SUBMISSIONS_EXPAND,
      selectedFields: null
    }
  }

  const prefix = `${ONLINE_SUBMISSIONS_EXPAND}($select=`
  if (!normalized.startsWith(prefix) || !normalized.endsWith(')')) {
    return null
  }

  const selectedFieldsRaw = normalized.slice(prefix.length, -1)
  const selectedFields = parseSelect(selectedFieldsRaw)

  return {
    field: ONLINE_SUBMISSIONS_EXPAND,
    selectedFields
  }
}

const buildIncidentResponse = (incident, query) => {
  const topLevelRecord = {
    incidentid: incident.incidentid,
    title: incident.title,
    description: incident.description
  }

  const selectedTopLevelFields = parseSelect(query.$select)
  const response = pickSelected(topLevelRecord, selectedTopLevelFields)
  const expand = parseExpand(query.$expand)

  if (expand?.field === ONLINE_SUBMISSIONS_EXPAND) {
    response[ONLINE_SUBMISSIONS_EXPAND] = incident.incident_rpa_onlinesubmissions.map(
      (onlineSubmission) => pickSelected(onlineSubmission, expand.selectedFields)
    )
  }

  return response
}

export const incidentsPost = {
  method: 'POST',
  path: '/api/data/v9.2/incidents',
  options: {
    validate: {
      payload: postPayloadSchema
    }
  },
  handler: (request, h) => {
    const incident = createIncident(request.payload)
    const response = h.response({ incidentid: incident.incidentid }).code(HTTP_STATUS_OK)
    recordRequest(request, HTTP_STATUS_OK)
    return response
  }
}

export const incidentsGet = {
  method: 'GET',
  path: '/api/data/v9.2/incidents({incidentid})',
  options: {
    validate: {
      query: getQuerySchema,
      params: Joi.object({
        incidentid: Joi.string().required()
      })
    }
  },
  handler: (request, h) => {
    const incident = getIncidentById(request.params.incidentid)

    if (!incident) {
      recordRequest(request, HTTP_STATUS_NOT_FOUND)
      throw Boom.notFound('Incident not found')
    }

    const response = h.response(buildIncidentResponse(incident, request.query)).code(HTTP_STATUS_OK)
    recordRequest(request, HTTP_STATUS_OK)
    return response
  }
}

function recordRequest(request, responseStatus) {
  record({
    method: request.method.toUpperCase(),
    endpoint: request.path,
    requestBody: request.payload ?? null,
    responseStatus
  })
}