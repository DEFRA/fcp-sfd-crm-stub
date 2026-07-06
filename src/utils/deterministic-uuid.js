import { createHash } from 'node:crypto'

const UUID_SEGMENT_OFFSETS = [0, 8, 12, 16, 20, 32]

export function deterministicUuid(input) {
  const hash = createHash('sha256').update(String(input)).digest('hex')
  return UUID_SEGMENT_OFFSETS.slice(0, -1)
    .map((start, i) => hash.slice(start, UUID_SEGMENT_OFFSETS[i + 1]))
    .join('-')
}
