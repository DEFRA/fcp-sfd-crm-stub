import { readFileSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import { resetIncidents } from '../../../src/store/incidents.js'

describe('#crm-incidents', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    resetIncidents()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('creates an incident and returns incidentid', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        title: 'Document Upload - SBI 123456789',
        description: 'Online submission with attached documents',
        incident_rpa_onlinesubmissions: [
          {
            subject: 'Document Upload',
            description: 'Test submission',
            rpa_onlinesubmissionid: 'ols-123'
          }
        ]
      }
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload).toEqual({ incidentid: expect.any(String) })
  })

  test('retrieves created incident with top-level select and expanded online submissions', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        title: 'Document Upload - SBI 123456789',
        description: 'Online submission with attached documents',
        incident_rpa_onlinesubmissions: [
          {
            subject: 'Document Upload',
            description: 'Test submission',
            rpa_onlinesubmissionid: 'ols-123'
          }
        ]
      }
    })

    const incidentid = JSON.parse(createResponse.payload).incidentid

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/data/v9.2/incidents(${incidentid})?$select=incidentid,title&$expand=incident_rpa_onlinesubmissions($select=rpa_onlinesubmissionid)`
    })

    expect(getResponse.statusCode).toBe(200)
    const payload = JSON.parse(getResponse.payload)
    expect(payload.incidentid).toBe(incidentid)
    expect(payload.title).toBe('Document Upload - SBI 123456789')
    expect(payload.description).toBeUndefined()
    expect(payload.incident_rpa_onlinesubmissions).toEqual([
      { rpa_onlinesubmissionid: 'ols-123' }
    ])
  })

  test('does not include expanded online submissions when $expand is not provided', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        title: 'No expand request',
        description: 'No expand response expected',
        incident_rpa_onlinesubmissions: [
          {
            subject: 'Submission without expand',
            rpa_onlinesubmissionid: 'ols-no-expand'
          }
        ]
      }
    })

    const incidentid = JSON.parse(createResponse.payload).incidentid

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/data/v9.2/incidents(${incidentid})?$select=incidentid,title`
    })

    expect(getResponse.statusCode).toBe(200)
    const payload = JSON.parse(getResponse.payload)
    expect(payload).toEqual({
      incidentid,
      title: 'No expand request'
    })
    expect(payload.incident_rpa_onlinesubmissions).toBeUndefined()
  })

  test('ignores invalid $expand value and returns top-level fields only', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        title: 'Invalid expand request',
        incident_rpa_onlinesubmissions: [
          {
            subject: 'Submission for invalid expand',
            rpa_onlinesubmissionid: 'ols-invalid-expand'
          }
        ]
      }
    })

    const incidentid = JSON.parse(createResponse.payload).incidentid

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/data/v9.2/incidents(${incidentid})?$select=incidentid,title&$expand=bad_expand($select=x)`
    })

    expect(getResponse.statusCode).toBe(200)
    const payload = JSON.parse(getResponse.payload)
    expect(payload).toEqual({
      incidentid,
      title: 'Invalid expand request'
    })
    expect(payload.incident_rpa_onlinesubmissions).toBeUndefined()
  })

  test('generates missing online submission ids during creation and returns them via expand', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        title: 'Generated IDs',
        incident_rpa_onlinesubmissions: [
          {
            subject: 'No id provided'
          }
        ]
      }
    })

    const incidentid = JSON.parse(createResponse.payload).incidentid

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/data/v9.2/incidents(${incidentid})?$expand=incident_rpa_onlinesubmissions($select=rpa_onlinesubmissionid)`
    })

    expect(getResponse.statusCode).toBe(200)
    const payload = JSON.parse(getResponse.payload)
    expect(payload.incident_rpa_onlinesubmissions).toHaveLength(1)
    expect(payload.incident_rpa_onlinesubmissions[0]).toEqual({
      rpa_onlinesubmissionid: expect.any(String)
    })
  })

  test('uses default title/description and supports expand without nested $select', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        incident_rpa_onlinesubmissions: [
          {}
        ]
      }
    })

    const incidentid = JSON.parse(createResponse.payload).incidentid

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/data/v9.2/incidents(${incidentid})?$expand=incident_rpa_onlinesubmissions`
    })

    expect(getResponse.statusCode).toBe(200)
    const payload = JSON.parse(getResponse.payload)
    expect(payload.incidentid).toBe(incidentid)
    expect(payload.title).toBe('')
    expect(payload.description).toBe('')
    expect(payload.incident_rpa_onlinesubmissions).toHaveLength(1)
    expect(payload.incident_rpa_onlinesubmissions[0].rpa_onlinesubmissionid).toEqual(expect.any(String))
  })

  test('returns 404 when incident does not exist', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/data/v9.2/incidents(non-existent-id)?$select=incidentid,title'
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('#crm-incidents read-through of PATCH-created records', () => {
  let server

  const WEB_API_PATH = '/api/data/v9.2'
  const CASE_ID = '11111111-1111-4111-8111-111111111111'
  const ONLINE_SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'
  const OTHER_CASE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
  const OTHER_ONLINE_SUBMISSION_ID = 'bbbbbbbb-2222-4222-8222-222222222222'
  const INCIDENT_BIND = 'regardingobjectid_incident_rpa_onlinesubmission@odata.bind'

  // The query string exactly as getOnlineSubmissionActivityId in fcp-sfd-crm
  // encodes it (src/repos/crm.js).
  const consumerQuery = (caseId) =>
    `${WEB_API_PATH}/incidents(${caseId})?%24select=incidentid,title&%24expand=incident_rpa_onlinesubmissions(%24select=activityid,rpa_onlinesubmissionid)`

  const fixture = readFileSync(
    new URL('../../fixtures/consumer-changeset.txt', import.meta.url),
    'utf8'
  )

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    resetIncidents()
  })

  afterAll(async () => {
    await server.stop()
  })

  const patchRecord = (entitySet, id, payload) =>
    server.inject({
      method: 'PATCH',
      url: `${WEB_API_PATH}/${entitySet}(${id})`,
      payload,
      headers: { 'if-none-match': '*' }
    })

  test('returns the online submission activityid for a case created by the consumer $batch changeset', async () => {
    const batchResponse = await server.inject({
      method: 'POST',
      url: `${WEB_API_PATH}/$batch`,
      payload: fixture,
      headers: {
        'content-type': 'multipart/mixed;boundary=batch_0f0f0f0f-0000-4000-8000-000000000001'
      }
    })
    expect(batchResponse.statusCode).toBe(200)

    const response = await server.inject({ method: 'GET', url: consumerQuery(CASE_ID) })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      incidentid: CASE_ID,
      title: 'Document Upload - SBI 123456789',
      incident_rpa_onlinesubmissions: [
        {
          activityid: ONLINE_SUBMISSION_ID,
          rpa_onlinesubmissionid: '0123456789abcdef0123'
        }
      ]
    })
  })

  test('returns an incident and online submission created by standalone PATCH requests', async () => {
    await patchRecord('incidents', CASE_ID, { title: 'Case title' })
    await patchRecord('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID, {
      rpa_onlinesubmissionid: 'ols-patched',
      [INCIDENT_BIND]: `/incidents(${CASE_ID})`
    })

    const response = await server.inject({ method: 'GET', url: consumerQuery(CASE_ID) })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.incident_rpa_onlinesubmissions[0].activityid).toBe(ONLINE_SUBMISSION_ID)
    expect(payload.incident_rpa_onlinesubmissions[0].rpa_onlinesubmissionid).toBe('ols-patched')
  })

  test('excludes an online submission bound to a different incident', async () => {
    await patchRecord('incidents', CASE_ID, { title: 'Case' })
    await patchRecord('incidents', OTHER_CASE_ID, { title: 'Other case' })
    await patchRecord('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID, {
      [INCIDENT_BIND]: `/incidents(${CASE_ID})`
    })
    await patchRecord('rpa_onlinesubmissions', OTHER_ONLINE_SUBMISSION_ID, {
      [INCIDENT_BIND]: `/incidents(${OTHER_CASE_ID})`
    })

    const response = await server.inject({ method: 'GET', url: consumerQuery(CASE_ID) })

    const payload = JSON.parse(response.payload)
    expect(payload.incident_rpa_onlinesubmissions.map((item) => item.activityid)).toEqual([
      ONLINE_SUBMISSION_ID
    ])
  })

  test('returns an empty array under $expand for an incident with no online submissions', async () => {
    await patchRecord('incidents', CASE_ID, { title: 'Case' })

    const response = await server.inject({ method: 'GET', url: consumerQuery(CASE_ID) })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload).incident_rpa_onlinesubmissions).toEqual([])
  })

  test('returns 404 for an online submission id used as an incident id', async () => {
    await patchRecord('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID, {
      [INCIDENT_BIND]: `/incidents(${CASE_ID})`
    })

    const response = await server.inject({ method: 'GET', url: consumerQuery(ONLINE_SUBMISSION_ID) })

    expect(response.statusCode).toBe(404)
  })

  test('includes activityid for online submissions created by POST when no nested $select is given', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: `${WEB_API_PATH}/incidents`,
      payload: {
        title: 'Legacy create',
        incident_rpa_onlinesubmissions: [{ subject: 'Legacy submission', rpa_onlinesubmissionid: 'ols-legacy' }]
      }
    })
    const { incidentid } = JSON.parse(createResponse.payload)

    const response = await server.inject({
      method: 'GET',
      url: `${WEB_API_PATH}/incidents(${incidentid})?$expand=incident_rpa_onlinesubmissions`
    })

    const [onlineSubmission] = JSON.parse(response.payload).incident_rpa_onlinesubmissions
    expect(onlineSubmission).toEqual({
      activityid: expect.any(String),
      subject: 'Legacy submission',
      rpa_onlinesubmissionid: 'ols-legacy'
    })
  })

  test('does not return @odata.bind annotations in expanded online submissions', async () => {
    await patchRecord('incidents', CASE_ID, { title: 'Case' })
    await patchRecord('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID, {
      subject: 'Submission',
      'ownerid@odata.bind': '/teams(88888888-8888-4888-8888-888888888888)',
      [INCIDENT_BIND]: `/incidents(${CASE_ID})`
    })

    const response = await server.inject({
      method: 'GET',
      url: `${WEB_API_PATH}/incidents(${CASE_ID})?$expand=incident_rpa_onlinesubmissions`
    })

    expect(JSON.parse(response.payload).incident_rpa_onlinesubmissions).toEqual([
      { activityid: ONLINE_SUBMISSION_ID, subject: 'Submission' }
    ])
  })
})
