import { readFileSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../../../src/server.js'

const WEB_API_PATH = '/api/data/v9.2'
const CRN = '2024001'
const SBI = '123456789'
const CASE_TYPE = 'Common Licence'

// Output of buildChangesetRequest in fcp-sfd-crm; see test/unit/odata-batch.test.js.
const changeset = readFileSync(
  new URL('../../fixtures/consumer-changeset.txt', import.meta.url),
  'utf8'
)
const CHANGESET_CONTENT_TYPE =
  'multipart/mixed;boundary=batch_0f0f0f0f-0000-4000-8000-000000000001'

// Ids used in the changeset fixture.
const CASE_ID = '11111111-1111-4111-8111-111111111111'
const ONLINE_SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'
const FIRST_FILE_METADATA_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_TYPES_ID = '99999999-9999-4999-8999-999999999999'
const SECOND_FILE_METADATA_ID = 'cccccccc-3333-4333-8333-333333333333'

// Copied from buildQuery in fcp-sfd-crm (src/repos/crm.js), so the stub
// receives query strings encoded exactly as the consumer sends them.
const buildQuery = (params) =>
  Object.entries(params)
    .map(([key, value]) => {
      const encodedKey = encodeURIComponent(key)
      const encodedValue = encodeURIComponent(value)
        .replaceAll('%2C', ',')
        .replaceAll('%3D', '=')
      return `${encodedKey}=${encodedValue}`
    })
    .join('&')

const metadataPayload = (name) => ({
  rpa_name: name,
  rpa_blobfileid: 'dddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'rpa_DocumentTypeMetaId@odata.bind': `/rpa_documenttypeses(${DOCUMENT_TYPES_ID})`,
  'rpa_RelatedOnlineSubmissionId@odata.bind': `/rpa_onlinesubmissions(${ONLINE_SUBMISSION_ID})`,
  rpa_filemimetype: 'application/pdf'
})

describe('#consumer-flow', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  const inject = (options) => server.inject(options)

  const postChangeset = () =>
    inject({
      method: 'POST',
      url: `${WEB_API_PATH}/$batch`,
      payload: changeset,
      headers: { 'content-type': CHANGESET_CONTENT_TYPE }
    })

  const patchMetadata = (metadataId, name) =>
    inject({
      method: 'PATCH',
      url: `${WEB_API_PATH}/rpa_activitymetadatas(${metadataId})`,
      payload: metadataPayload(name),
      headers: { 'if-none-match': '*' }
    })

  test('replays case creation for two files and a redelivery of the first', async () => {
    const resetResponse = await inject({ method: 'POST', url: '/stub/reset' })
    expect(resetResponse.statusCode).toBe(204)

    // Token, via the client secret strategy.
    const tokenResponse = await inject({
      method: 'POST',
      url: '/oauth2/v2.0/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        client_id: 'stub-client-id',
        client_secret: 'stub-client-secret',
        grant_type: 'client_credentials',
        scope: 'stub-scope'
      }).toString()
    })
    expect(tokenResponse.statusCode).toBe(200)

    // Lookups.
    const contactResponse = await inject({
      method: 'GET',
      url: `${WEB_API_PATH}/contacts?${buildQuery({
        $select: 'contactid',
        $filter: `rpa_capcustomerid eq '${CRN}'`
      })}`
    })
    expect(JSON.parse(contactResponse.payload).value[0].contactid).toEqual(
      expect.any(String)
    )

    const accountResponse = await inject({
      method: 'GET',
      url: `${WEB_API_PATH}/accounts?${buildQuery({
        $select: 'accountid',
        $filter: `rpa_sbinumber eq '${SBI}'`
      })}`
    })
    expect(JSON.parse(accountResponse.payload).value[0].accountid).toEqual(
      expect.any(String)
    )

    const documentTypeResponse = await inject({
      method: 'GET',
      url: `${WEB_API_PATH}/rpa_documenttypeses?${buildQuery({
        $select:
          '_rpa_scheme_value,_rpa_subject_value,_rpa_teamrouting_value,rpa_documenttypesid',
        $filter: `rpa_documenttype eq '${CASE_TYPE}'`
      })}`
    })
    expect(JSON.parse(documentTypeResponse.payload).value[0]).toEqual({
      _rpa_scheme_value: expect.any(String),
      _rpa_subject_value: expect.any(String),
      _rpa_teamrouting_value: expect.any(String),
      rpa_documenttypesid: expect.any(String)
    })

    // First file: case creation changeset.
    const firstChangesetResponse = await postChangeset()
    expect(firstChangesetResponse.statusCode).toBe(200)
    expect(
      firstChangesetResponse.payload.match(/HTTP\/1\.1 204 No Content/g)
    ).toHaveLength(3)

    // Second file: the case exists, so read the online submission activity id.
    const incidentResponse = await inject({
      method: 'GET',
      url: `${WEB_API_PATH}/incidents(${CASE_ID})?${buildQuery({
        $select: 'incidentid,title',
        $expand:
          'incident_rpa_onlinesubmissions($select=activityid,rpa_onlinesubmissionid)'
      })}`
    })
    expect(incidentResponse.statusCode).toBe(200)
    const activityId = JSON.parse(incidentResponse.payload)
      .incident_rpa_onlinesubmissions[0].activityid
    expect(activityId).toBe(ONLINE_SUBMISSION_ID)

    const secondFileMetadataResponse = await patchMetadata(
      SECOND_FILE_METADATA_ID,
      'second-file.pdf'
    )
    expect(secondFileMetadataResponse.statusCode).toBe(204)

    // Redelivery of the first file: the changeset is suppressed as a duplicate,
    // then the first file's metadata is written on its own and already exists.
    const repeatedChangesetResponse = await postChangeset()
    expect(repeatedChangesetResponse.statusCode).toBe(412)

    const fallbackMetadataResponse = await patchMetadata(
      FIRST_FILE_METADATA_ID,
      'fixture.pdf'
    )
    expect(fallbackMetadataResponse.statusCode).toBe(412)

    // The token endpoint does not record history.
    const history = JSON.parse(
      (await inject({ method: 'GET', url: '/stub/requests' })).payload
    )
    expect(
      history.map(({ method, endpoint, responseStatus }) => ({
        method,
        endpoint,
        responseStatus
      }))
    ).toEqual([
      {
        method: 'GET',
        endpoint: `${WEB_API_PATH}/contacts`,
        responseStatus: 200
      },
      {
        method: 'GET',
        endpoint: `${WEB_API_PATH}/accounts`,
        responseStatus: 200
      },
      {
        method: 'GET',
        endpoint: `${WEB_API_PATH}/rpa_documenttypeses`,
        responseStatus: 200
      },
      {
        method: 'POST',
        endpoint: `${WEB_API_PATH}/$batch`,
        responseStatus: 200
      },
      {
        method: 'GET',
        endpoint: `${WEB_API_PATH}/incidents(${CASE_ID})`,
        responseStatus: 200
      },
      {
        method: 'PATCH',
        endpoint: `${WEB_API_PATH}/rpa_activitymetadatas(${SECOND_FILE_METADATA_ID})`,
        responseStatus: 204
      },
      {
        method: 'POST',
        endpoint: `${WEB_API_PATH}/$batch`,
        responseStatus: 412
      },
      {
        method: 'PATCH',
        endpoint: `${WEB_API_PATH}/rpa_activitymetadatas(${FIRST_FILE_METADATA_ID})`,
        responseStatus: 412
      }
    ])

    expect(
      history[3].requestBody.parts.map((part) => part.responseStatus)
    ).toEqual([204, 204, 204])
    expect(
      history[6].requestBody.parts.map((part) => part.responseStatus)
    ).toEqual([412, null, null])
  })
})
