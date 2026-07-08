export function parseSelect(select) {
  if (!select || typeof select !== 'string') {
    return null
  }

  const fields = select
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)

  return fields.length > 0 ? new Set(fields) : null
}

export function pickSelected(record, selectedFields) {
  if (!selectedFields) {
    return record
  }

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => selectedFields.has(key))
  )
}

export function parseEqFilter(filter, fieldName) {
  if (!filter || typeof filter !== 'string') {
    return null
  }

  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  const pattern = new RegExp(
    String.raw`^\s*` + escapedFieldName + String.raw`\s+eq\s+'((?:''|[^'])*)'` + String.raw`\s*$`
  )
  const match = pattern.exec(filter)

  if (!match) {
    return null
  }

  return match[1].replace("''", "'")
}