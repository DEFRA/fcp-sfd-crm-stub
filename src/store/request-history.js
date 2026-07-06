import { config } from '#/config.js'

const history = []

export function record({ method, endpoint, requestBody, responseStatus }) {
  const entry = { method, endpoint, timestamp: new Date().toISOString(), requestBody, responseStatus }

  history.push(entry)

  const maxSize = config.get('requestHistory.maxSize')
  if (history.length > maxSize) {
    history.shift()
  }
}

export function getAll({ since } = {}) {
  const cutoff = since instanceof Date
    ? since
    : new Date(Date.now() - config.get('requestHistory.windowMinutes') * 60 * 1000)

  return history.filter((entry) => new Date(entry.timestamp) >= cutoff)
}

export function reset() {
  history.length = 0
}
