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