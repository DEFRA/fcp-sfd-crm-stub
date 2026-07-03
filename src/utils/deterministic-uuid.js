import { createHash } from 'node:crypto'

export function deterministicUuid(input) {
  const hash = createHash('sha256').update(String(input)).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-')
}
