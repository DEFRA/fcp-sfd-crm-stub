import { getAll, getStats, reset } from '#/store/request-history.js'
import { resetEntities } from '#/store/entities.js'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_NO_CONTENT = 204

export const requestsGet = {
  method: 'GET',
  path: '/stub/requests',
  handler: (_request, h) => h.response(getAll({ since: new Date(0) })).code(HTTP_STATUS_OK)
}

export const statsGet = {
  method: 'GET',
  path: '/stub/stats',
  handler: (_request, h) => h.response(getStats()).code(HTTP_STATUS_OK)
}

export const resetPost = {
  method: 'POST',
  path: '/stub/reset',
  handler: (_request, h) => {
    reset()
    resetEntities()
    return h.response().code(HTTP_STATUS_NO_CONTENT)
  }
}