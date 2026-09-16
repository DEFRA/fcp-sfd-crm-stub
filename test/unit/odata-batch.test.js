import { readFileSync } from 'node:fs'
import { describe, test, expect } from 'vitest'
import {
  MAX_BATCH_PARTS,
  buildBatchResponse,
  parseChangesetRequest
} from '../../src/utils/odata-batch.js'

// Byte-exact output of buildChangesetRequest in fcp-sfd-crm
// (src/repos/dataverse-batch.js) for a case creation changeset, generated with
// pinned boundaries and synthetic ids. Regenerate it whenever that module
// changes. The file must keep CRLF line endings (see .gitattributes).
const fixture = readFileSync(
  new URL('../fixtures/consumer-changeset.txt', import.meta.url),
  'utf8'
)
const FIXTURE_CONTENT_TYPE =
  'multipart/mixed;boundary=batch_0f0f0f0f-0000-4000-8000-000000000001'
const FIXTURE_HOST = 'http://fcp-sfd-crm-stub:3001'
const BASE_URL = `${FIXTURE_HOST}/api/data/v9.2`

const CASE_ID = '11111111-1111-4111-8111-111111111111'
const ONLINE_SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'
const METADATA_ID = '33333333-3333-4333-8333-333333333333'

// Copied verbatim from parseBatchResponse in fcp-sfd-crm
// (src/repos/dataverse-batch.js). A change there must be mirrored here on
// purpose, so the stub's response is checked against what the consumer reads.
const CONSUMER_CHANGESET_BOUNDARY_PATTERN =
  /boundary=(changesetresponse_[0-9a-f-]+)/i
const CONSUMER_BATCH_BOUNDARY_FALLBACK_PATTERN =
  /--batchresponse_[0-9a-f-]+(?:--)?/i
const CONSUMER_CONTENT_ID_PATTERN = /Content-ID:\s*(\d+)/

const CRLF = '\r\n'

const buildBatchBody = (
  partRequests,
  { batch = 'batch_b', changeset = 'changeset_c' } = {}
) => {
  const changesetLines = partRequests.flatMap((partRequest, index) => [
    `--${changeset}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    `Content-ID: ${index + 1}`,
    '',
    partRequest.requestLine,
    'Content-Type: application/json',
    'If-None-Match: *',
    '',
    partRequest.body ?? '{}',
    ''
  ])

  return [
    `--${batch}`,
    `Content-Type: multipart/mixed;boundary=${changeset}`,
    '',
    ...changesetLines,
    `--${changeset}--`,
    '',
    `--${batch}--`,
    ''
  ].join(CRLF)
}

const patchLine = (path) => `PATCH ${path} HTTP/1.1`

const countMatches = (text, pattern) => text.match(pattern)?.length ?? 0

describe('#odata-batch', () => {
  describe('#parseChangesetRequest', () => {
    test('keeps CRLF line endings in the consumer fixture', () => {
      expect(fixture).toContain(CRLF)
      expect(
        fixture
          .split('\n')
          .slice(0, -1)
          .every((line) => line.endsWith('\r'))
      ).toBe(true)
    })

    test('parses the consumer changeset into three conditional upsert parts', () => {
      const result = parseChangesetRequest(FIXTURE_CONTENT_TYPE, fixture)

      expect(result.error).toBeUndefined()
      expect(result.parts).toHaveLength(3)
      expect(
        result.parts.map(({ contentId, method, entitySet, id }) => ({
          contentId,
          method,
          entitySet,
          id
        }))
      ).toEqual([
        {
          contentId: '1',
          method: 'PATCH',
          entitySet: 'incidents',
          id: CASE_ID
        },
        {
          contentId: '2',
          method: 'PATCH',
          entitySet: 'rpa_onlinesubmissions',
          id: ONLINE_SUBMISSION_ID
        },
        {
          contentId: '3',
          method: 'PATCH',
          entitySet: 'rpa_activitymetadatas',
          id: METADATA_ID
        }
      ])
    })

    test('exposes each part URL, headers and JSON body', () => {
      const [casePart, onlineSubmissionPart, metadataPart] =
        parseChangesetRequest(FIXTURE_CONTENT_TYPE, fixture).parts

      expect(casePart.url).toBe(`${BASE_URL}/incidents(${CASE_ID})`)
      expect(casePart.headers).toEqual({
        'content-type': 'application/json',
        'if-none-match': '*'
      })
      expect(casePart.body).toMatchObject({
        title: 'Document Upload - SBI 123456789',
        'ownerid@odata.bind': '/teams(88888888-8888-4888-8888-888888888888)'
      })
      expect(
        onlineSubmissionPart.body[
          'regardingobjectid_incident_rpa_onlinesubmission@odata.bind'
        ]
      ).toBe(`/incidents(${CASE_ID})`)
      expect(metadataPart.headers['if-none-match']).toBe('*')
      expect(metadataPart.body).toMatchObject({ rpa_name: 'fixture.pdf' })
    })

    test('parses relative part URLs the same as absolute ones', () => {
      const relativeFixture = fixture.replaceAll(
        `PATCH ${FIXTURE_HOST}/`,
        'PATCH /'
      )

      const absoluteParts = parseChangesetRequest(
        FIXTURE_CONTENT_TYPE,
        fixture
      ).parts
      const relativeParts = parseChangesetRequest(
        FIXTURE_CONTENT_TYPE,
        relativeFixture
      ).parts

      const withoutUrl = (part) => ({ ...part, url: undefined })
      expect(relativeParts.map(withoutUrl)).toEqual(
        absoluteParts.map(withoutUrl)
      )
      expect(relativeParts[0].url).toBe(`/api/data/v9.2/incidents(${CASE_ID})`)
    })

    test('returns zero parts for a body without CRLF framing', () => {
      const lfOnlyFixture = fixture.replaceAll(CRLF, '\n')

      expect(
        parseChangesetRequest(FIXTURE_CONTENT_TYPE, lfOnlyFixture)
      ).toEqual({ parts: [] })
    })

    test('returns zero parts for an empty body', () => {
      expect(parseChangesetRequest(FIXTURE_CONTENT_TYPE, '')).toEqual({
        parts: []
      })
    })

    test('returns zero parts for a changeset with no parts', () => {
      expect(
        parseChangesetRequest(
          'multipart/mixed;boundary=batch_b',
          buildBatchBody([])
        )
      ).toEqual({
        parts: []
      })
    })

    test('accepts a quoted boundary and a space after the media type separator', () => {
      const result = parseChangesetRequest(
        'multipart/mixed; boundary="batch_b"',
        buildBatchBody([
          { requestLine: patchLine(`/api/data/v9.2/incidents(${CASE_ID})`) }
        ])
      )

      expect(result.parts).toHaveLength(1)
    })

    test('returns invalid_json when a part body is not valid JSON', () => {
      const brokenFixture = fixture.replace('{"rpa_name":', '{rpa_name:')

      expect(
        parseChangesetRequest(FIXTURE_CONTENT_TYPE, brokenFixture)
      ).toEqual({
        error: 'invalid_json'
      })
    })

    test('returns a null body for a part with no body', () => {
      const body = buildBatchBody([
        {
          requestLine: patchLine(`/api/data/v9.2/incidents(${CASE_ID})`),
          body: ''
        }
      ])

      const result = parseChangesetRequest(
        'multipart/mixed;boundary=batch_b',
        body
      )

      expect(result.parts[0].body).toBeNull()
    })

    test('accepts exactly MAX_BATCH_PARTS parts', () => {
      const partRequests = Array.from(
        { length: MAX_BATCH_PARTS },
        (_unused, index) => ({
          requestLine: patchLine(
            `/api/data/v9.2/rpa_activitymetadatas(id-${index})`
          )
        })
      )

      const result = parseChangesetRequest(
        'multipart/mixed;boundary=batch_b',
        buildBatchBody(partRequests)
      )

      expect(result.parts).toHaveLength(MAX_BATCH_PARTS)
    })

    test('returns too_many_parts when the changeset exceeds MAX_BATCH_PARTS', () => {
      const partRequests = Array.from(
        { length: MAX_BATCH_PARTS + 1 },
        (_unused, index) => ({
          requestLine: patchLine(
            `/api/data/v9.2/rpa_activitymetadatas(id-${index})`
          )
        })
      )

      const result = parseChangesetRequest(
        'multipart/mixed;boundary=batch_b',
        buildBatchBody(partRequests)
      )

      expect(result).toEqual({ error: 'too_many_parts' })
    })

    test.each([
      ['a missing Content-Type header', undefined],
      ['a non-multipart Content-Type', 'application/json'],
      ['a multipart Content-Type without a boundary', 'multipart/mixed'],
      ['an empty boundary', 'multipart/mixed;boundary=']
    ])('returns unsupported for %s', (_description, contentType) => {
      expect(parseChangesetRequest(contentType, fixture)).toEqual({
        error: 'unsupported'
      })
    })

    test('returns unsupported for a body that is not a string', () => {
      expect(parseChangesetRequest(FIXTURE_CONTENT_TYPE, undefined)).toEqual({
        error: 'unsupported'
      })
    })

    test('returns unsupported when the batch part is not a changeset', () => {
      const body = [
        '--batch_b',
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        `GET /api/data/v9.2/incidents(${CASE_ID}) HTTP/1.1`,
        '',
        '',
        '--batch_b--',
        ''
      ].join(CRLF)

      expect(
        parseChangesetRequest('multipart/mixed;boundary=batch_b', body)
      ).toEqual({
        error: 'unsupported'
      })
    })

    test('returns unsupported when the batch holds more than one top-level part', () => {
      const singleChangeset = buildBatchBody([
        { requestLine: patchLine(`/api/data/v9.2/incidents(${CASE_ID})`) }
      ])
      const body = singleChangeset.replace(
        `--batch_b--${CRLF}`,
        `--batch_b${CRLF}Content-Type: application/http${CRLF}${CRLF}GET /api/data/v9.2/incidents HTTP/1.1${CRLF}${CRLF}${CRLF}--batch_b--${CRLF}`
      )

      expect(
        parseChangesetRequest('multipart/mixed;boundary=batch_b', body)
      ).toEqual({
        error: 'unsupported'
      })
    })

    test.each([
      [
        'a part that is not application/http',
        fixture.replace(
          'Content-Type: application/http',
          'Content-Type: text/plain'
        )
      ],
      [
        'a request line without an HTTP version',
        fixture.replace(' HTTP/1.1', '')
      ],
      [
        'a URL that does not address one record',
        fixture.replace(`incidents(${CASE_ID})`, 'incidents')
      ],
      [
        'a URL outside the Web API path',
        fixture.replace(
          '/api/data/v9.2/incidents(',
          '/api/data/v9.1/incidents('
        )
      ],
      [
        'a request header without a colon',
        fixture.replace('If-None-Match: *', 'If-None-Match *')
      ],
      [
        'a URL that cannot be parsed',
        fixture.replace(
          `${FIXTURE_HOST}/api/data/v9.2/incidents(${CASE_ID})`,
          'http://[invalid'
        )
      ]
    ])('returns unsupported for %s', (_description, body) => {
      expect(parseChangesetRequest(FIXTURE_CONTENT_TYPE, body)).toEqual({
        error: 'unsupported'
      })
    })
  })

  describe('#buildBatchResponse', () => {
    const successResults = [
      { contentId: '1', status: 204, entitySet: 'incidents', id: CASE_ID },
      {
        contentId: '2',
        status: 204,
        entitySet: 'rpa_onlinesubmissions',
        id: ONLINE_SUBMISSION_ID
      },
      {
        contentId: '3',
        status: 204,
        entitySet: 'rpa_activitymetadatas',
        id: METADATA_ID
      }
    ]

    test('names the outer boundary batchresponse_ with a lowercase UUID in the content type', () => {
      const { contentType, body } = buildBatchResponse(successResults, {
        baseUrl: BASE_URL
      })

      expect(contentType).toMatch(
        /^multipart\/mixed; boundary=batchresponse_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      const batchBoundary = contentType.split('boundary=')[1]
      expect(body.startsWith(`--${batchBoundary}${CRLF}`)).toBe(true)
      expect(body.endsWith(`--${batchBoundary}--${CRLF}`)).toBe(true)
    })

    test('produces a success response the consumer parser reads as three 204 parts', () => {
      const { contentType, body } = buildBatchResponse(successResults, {
        baseUrl: BASE_URL
      })

      const changesetMatch = CONSUMER_CHANGESET_BOUNDARY_PATTERN.exec(body)
      expect(changesetMatch).not.toBeNull()
      expect(CONSUMER_BATCH_BOUNDARY_FALLBACK_PATTERN.test(body)).toBe(true)
      expect(contentType).toMatch(/boundary=batchresponse_[0-9a-f-]+$/)

      expect(
        countMatches(body, new RegExp(CONSUMER_CONTENT_ID_PATTERN, 'g'))
      ).toBe(3)
      expect(countMatches(body, /HTTP\/1\.1 204 No Content/g)).toBe(3)
      expect(
        countMatches(body, new RegExp(`--${changesetMatch[1]}\r\n`, 'g'))
      ).toBe(3)
      expect(body).toContain(`--${changesetMatch[1]}--`)
      expect(
        [...body.matchAll(/Content-ID: (\d+)/g)].map((match) => match[1])
      ).toEqual(['1', '2', '3'])
    })

    test('adds an OData-EntityId header for each 204 part', () => {
      const { body } = buildBatchResponse(successResults, { baseUrl: BASE_URL })

      expect(body).toContain(
        `OData-EntityId: ${BASE_URL}/incidents(${CASE_ID})`
      )
      expect(body).toContain(
        `OData-EntityId: ${BASE_URL}/rpa_onlinesubmissions(${ONLINE_SUBMISSION_ID})`
      )
      expect(body).toContain(
        `OData-EntityId: ${BASE_URL}/rpa_activitymetadatas(${METADATA_ID})`
      )
    })

    test('uses CRLF for every line break', () => {
      const { body } = buildBatchResponse(successResults, { baseUrl: BASE_URL })

      expect(
        body
          .split('\n')
          .slice(0, -1)
          .every((line) => line.endsWith('\r'))
      ).toBe(true)
    })

    test('uses a fresh boundary for each response', () => {
      const first = buildBatchResponse(successResults, { baseUrl: BASE_URL })
      const second = buildBatchResponse(successResults, { baseUrl: BASE_URL })

      expect(first.contentType).not.toBe(second.contentType)
    })

    test('contains only the failing part for a conflict', () => {
      const conflictResults = [
        successResults[0],
        successResults[1],
        {
          contentId: '3',
          status: 412,
          entitySet: 'rpa_activitymetadatas',
          id: METADATA_ID
        }
      ]

      const { body } = buildBatchResponse(conflictResults, {
        baseUrl: BASE_URL
      })

      expect(CONSUMER_CHANGESET_BOUNDARY_PATTERN.test(body)).toBe(true)
      expect(countMatches(body, /HTTP\/1\.1 \d{3}/g)).toBe(1)
      expect(body).toContain(`HTTP/1.1 412 Precondition Failed${CRLF}`)
      expect(
        [...body.matchAll(/Content-ID: (\d+)/g)].map((match) => match[1])
      ).toEqual(['3'])
      expect(body).not.toContain('OData-EntityId')
    })

    test('gives a conflict part a stub-generated JSON OData error body by default', () => {
      const { body } = buildBatchResponse(
        [{ contentId: '1', status: 412, entitySet: 'incidents', id: CASE_ID }],
        { baseUrl: BASE_URL }
      )

      expect(body).toContain(
        'Content-Type: application/json; odata.metadata=minimal'
      )
      const errorJson = JSON.parse(
        body.split(CRLF).find((line) => line.startsWith('{'))
      )
      expect(errorJson).toEqual({
        error: {
          code: 'STUB_GENERATED_ERROR',
          message:
            'Generated by fcp-sfd-crm-stub, not Dataverse error text: Precondition Failed'
        }
      })
    })

    test('uses the supplied error body for a failing part', () => {
      const errorBody = { error: { code: 'custom', message: 'custom message' } }

      const { body } = buildBatchResponse(
        [
          {
            contentId: '1',
            status: 412,
            entitySet: 'incidents',
            id: CASE_ID,
            errorBody
          }
        ],
        { baseUrl: BASE_URL }
      )

      expect(body).toContain(JSON.stringify(errorBody))
    })

    test('returns an empty batch response when there are no parts', () => {
      const { contentType, body } = buildBatchResponse([], {
        baseUrl: BASE_URL
      })

      const batchBoundary = contentType.split('boundary=')[1]
      expect(body).toBe(`--${batchBoundary}--${CRLF}`)
      expect(CONSUMER_CHANGESET_BOUNDARY_PATTERN.test(body)).toBe(false)
      expect(countMatches(body, /HTTP\/1\.1/g)).toBe(0)
    })

    test('adds OData-EntityId only to 204 parts among successful parts', () => {
      const { body } = buildBatchResponse(
        [{ contentId: '1', status: 200, entitySet: 'incidents', id: CASE_ID }],
        { baseUrl: BASE_URL }
      )

      expect(body).toContain(`HTTP/1.1 200 OK${CRLF}`)
      expect(body).not.toContain('OData-EntityId')
    })

    test('omits the Content-ID header for a part without a content id', () => {
      const { body } = buildBatchResponse(
        [{ contentId: null, status: 204, entitySet: 'incidents', id: CASE_ID }],
        { baseUrl: BASE_URL }
      )

      expect(body).not.toContain('Content-ID')
      expect(body).toContain('HTTP/1.1 204 No Content')
    })
  })
})
