import Joi from 'joi'
import { deterministicUuid } from '#/utils/deterministic-uuid.js'
import { parseEqFilter, parseSelect, pickSelected } from '#/utils/odata.js'

const querySchema = Joi.object({
  $select: Joi.string(),
  $filter: Joi.string()
}).unknown(true)

const asLookupResponse = (record) => ({
  value: record ? [record] : []
})

const getContactRecord = (query) => {
  const crn = parseEqFilter(query.$filter, 'rpa_capcustomerid')
  if (!crn) {
    return null
  }

  const selectedFields = parseSelect(query.$select)
  const record = {
    contactid: deterministicUuid(`contact:${crn}`)
  }

  return pickSelected(record, selectedFields)
}

const getAccountRecord = (query) => {
  const sbi = parseEqFilter(query.$filter, 'rpa_sbinumber')
  if (!sbi) {
    return null
  }

  const selectedFields = parseSelect(query.$select)
  const record = {
    accountid: deterministicUuid(`account:${sbi}`)
  }

  return pickSelected(record, selectedFields)
}

const getDocumentTypeRecord = (query) => {
  const documentType = parseEqFilter(query.$filter, 'rpa_documenttype')
  if (!documentType) {
    return null
  }

  const selectedFields = parseSelect(query.$select)
  const record = {
    _rpa_scheme_value: deterministicUuid(`scheme:${documentType}`),
    _rpa_subject_value: deterministicUuid(`subject:${documentType}`),
    rpa_documenttypesid: deterministicUuid(`document-type:${documentType}`)
  }

  return pickSelected(record, selectedFields)
}

export const contactsGet = {
  method: 'GET',
  path: '/api/data/v9.2/contacts',
  options: {
    validate: {
      query: querySchema
    }
  },
  handler: (request, h) => {
    const record = getContactRecord(request.query)
    return h.response(asLookupResponse(record)).code(200)
  }
}

export const accountsGet = {
  method: 'GET',
  path: '/api/data/v9.2/accounts',
  options: {
    validate: {
      query: querySchema
    }
  },
  handler: (request, h) => {
    const record = getAccountRecord(request.query)
    return h.response(asLookupResponse(record)).code(200)
  }
}

export const documentTypesGet = {
  method: 'GET',
  path: '/api/data/v9.2/rpa_documenttypeses',
  options: {
    validate: {
      query: querySchema
    }
  },
  handler: (request, h) => {
    const record = getDocumentTypeRecord(request.query)
    return h.response(asLookupResponse(record)).code(200)
  }
}