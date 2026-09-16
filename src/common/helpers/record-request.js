import { record } from '#/store/request-history.js'

/**
 * Records a CRM request in the stub's request history.
 * @param {import('@hapi/hapi').Request} request - the handled request
 * @param {number} responseStatus - the HTTP status returned to the caller
 */
export function recordRequest(request, responseStatus) {
  record({
    method: request.method.toUpperCase(),
    endpoint: request.path,
    requestBody: request.payload ?? null,
    responseStatus
  })
}
