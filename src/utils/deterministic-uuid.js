import { createHash } from 'node:crypto'

export function deterministicUuid(input) {
  const hash = createHash('sha256').update(String(input)).digest('hex')
  return [
    hash.slice(0, 8), // NOSONAR
    hash.slice(8, 12), // NOSONAR
    hash.slice(12, 16), // NOSONAR
    hash.slice(16, 20), // NOSONAR
    hash.slice(20, 32) // NOSONAR
  ].join('-')
}
