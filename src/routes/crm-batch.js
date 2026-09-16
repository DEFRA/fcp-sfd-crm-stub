import Boom from '@hapi/boom'
import { record } from '#/store/request-history.js'
import {
  CONDITIONAL_UPSERT_ENTITY_SETS,
  commitConditionalCreates
} from '#/store/entities.js'
import {
  buildBatchResponse,
  parseChangesetRequest
} from '#/utils/odata-batch.js'

const WEB_API_PATH = '/api/data/v9.2'
const HTTP_STATUS_OK = 200
const HTTP_STATUS_NO_CONTENT = 204
const HTTP_STATUS_BAD_REQUEST = 400
const MULTIPART_MIXED = 'multipart/mixed'
const SUPPORTED_PART_METHOD = 'PATCH'
const IF_NONE_MATCH_ANY = '*'
const ODATA_VERSION = '4.0'
const NOT_REPORTED = null

const isJsonObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isConditionalCreate = (headers) =>
  headers['if-none-match'] === IF_NONE_MATCH_ANY &&
  headers['if-match'] === undefined

function findRefusalReason(part) {
  if (part.method !== SUPPORTED_PART_METHOD) {
    return 'the stub only supports PATCH requests in a $batch changeset'
  }
  if (!CONDITIONAL_UPSERT_ENTITY_SETS.includes(part.entitySet)) {
    return `entity set '${part.entitySet}' is not supported by the stub`
  }
  if (!isConditionalCreate(part.headers)) {
    return 'the stub does not emulate unconditional batch writes; every part must send If-None-Match: * and no If-Match'
  }
  if (!isJsonObject(part.body)) {
    return 'body must be a JSON object'
  }
  return null
}

function findRefusal(parts) {
  for (const [index, part] of parts.entries()) {
    const reason = findRefusalReason(part)
    if (reason) {
      return { index, message: `Part ${index + 1}: ${reason}` }
    }
  }
  return null
}

// One history entry per $batch request. Each part carries its own status;
// parts the response does not report on are recorded with a null status.
function recordBatchRequest(request, parts, partStatus, responseStatus) {
  record({
    method: request.method.toUpperCase(),
    endpoint: request.path,
    requestBody: parts
      ? {
          parts: parts.map((part, index) => ({
            ...part,
            responseStatus: partStatus(index)
          }))
        }
      : null,
    responseStatus
  })
}

function commitChangeset(parts) {
  const result = commitConditionalCreates(
    parts.map(({ entitySet, id, body }) => ({ entitySet, id, body }))
  )

  if (result.committed) {
    return {
      outerStatus: HTTP_STATUS_OK,
      partResults: parts.map((part) => ({
        ...part,
        status: HTTP_STATUS_NO_CONTENT
      })),
      partStatus: () => HTTP_STATUS_NO_CONTENT
    }
  }

  const failedPart = parts[result.failedIndex]
  return {
    outerStatus: result.status,
    partResults: [{ ...failedPart, status: result.status }],
    partStatus: (index) =>
      index === result.failedIndex ? result.status : NOT_REPORTED
  }
}

/**
 * Accepts a Dataverse `$batch` request holding one changeset of conditional
 * creates (`PATCH` with `If-None-Match: *`). Every record is created, or, when
 * any already exists, none is and the outer response is 412 with the failing
 * part. A body the parser reads as having no parts (for example bare LF
 * framing) is answered with 200 and an empty batch response.
 */
export const batchPost = {
  method: 'POST',
  path: `${WEB_API_PATH}/$batch`,
  options: {
    payload: {
      parse: false,
      output: 'data',
      allow: MULTIPART_MIXED
    }
  },
  handler: (request, h) => {
    const bodyText = request.payload?.toString('utf8') ?? ''
    const parsed = parseChangesetRequest(
      request.headers['content-type'],
      bodyText
    )

    if (parsed.error) {
      request.logger.warn(
        {
          event: {
            action: 'parse_batch',
            outcome: 'failure',
            reason: parsed.error
          }
        },
        'Unable to parse $batch request'
      )
      recordBatchRequest(request, null, null, HTTP_STATUS_BAD_REQUEST)
      throw Boom.badRequest(`Unable to parse $batch request: ${parsed.error}`)
    }

    const { parts } = parsed
    const refusal = findRefusal(parts)
    if (refusal) {
      recordBatchRequest(
        request,
        parts,
        (index) =>
          index === refusal.index ? HTTP_STATUS_BAD_REQUEST : NOT_REPORTED,
        HTTP_STATUS_BAD_REQUEST
      )
      throw Boom.badRequest(refusal.message)
    }

    const { outerStatus, partResults, partStatus } = commitChangeset(parts)
    const { contentType, body } = buildBatchResponse(partResults, {
      baseUrl: `${request.url.origin}${WEB_API_PATH}`
    })

    recordBatchRequest(request, parts, partStatus, outerStatus)
    return h
      .response(body)
      .type(contentType)
      .header('OData-Version', ODATA_VERSION)
      .code(outerStatus)
  }
}
