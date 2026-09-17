import { config } from '#/config.js'

const history = []
const totals = new Map()
let firstRequestAt = null
let lastRequestAt = null

/**
 * Records a CRM request in the history and adds it to the running totals.
 * @param {object} entry - the request to record
 * @param {string} entry.method - the HTTP method
 * @param {string} entry.endpoint - the requested path
 * @param {string} [entry.route] - the route pattern the path matched, used to group totals; defaults to the endpoint
 * @param {object|null} entry.requestBody - the request payload
 * @param {number} entry.responseStatus - the HTTP status returned to the caller
 */
export function record({ method, endpoint, route = endpoint, requestBody, responseStatus }) {
  const entry = { method, endpoint, timestamp: new Date().toISOString(), requestBody, responseStatus }

  history.push(entry)
  addToTotals(method, route, responseStatus, entry.timestamp)

  const maxSize = config.get('requestHistory.maxSize')
  if (history.length > maxSize) {
    history.shift()
  }
}

// Totals are keyed by route pattern rather than path, so a path carrying a
// record id does not add a new key for every record.
function addToTotals(method, route, status, timestamp) {
  const key = `${method} ${route} ${status}`
  const existing = totals.get(key)

  if (existing) {
    existing.count++
  } else {
    totals.set(key, { method, route, status, count: 1 })
  }

  firstRequestAt ??= timestamp
  lastRequestAt = timestamp
}

export function getAll({ since } = {}) {
  const cutoff = since instanceof Date
    ? since
    : new Date(Date.now() - config.get('requestHistory.windowMinutes') * 60 * 1000)

  return history.filter((entry) => new Date(entry.timestamp) >= cutoff)
}

/**
 * Returns the request totals since the stub started or was last reset. Unlike
 * the history, the totals are not limited by requestHistory.maxSize.
 * @returns {{ total: number, firstRequestAt: string|null, lastRequestAt: string|null, byRoute: Array<{ method: string, route: string, status: number, count: number }> }}
 */
export function getStats() {
  const byRoute = [...totals.values()].map((routeTotal) => ({ ...routeTotal }))

  return {
    total: byRoute.reduce((sum, { count }) => sum + count, 0),
    firstRequestAt,
    lastRequestAt,
    byRoute
  }
}

export function reset() {
  history.length = 0
  totals.clear()
  firstRequestAt = null
  lastRequestAt = null
}
