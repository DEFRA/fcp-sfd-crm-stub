import Joi from 'joi'
import { deterministicUuid } from '#/utils/deterministic-uuid.js'
import { parseEqFilter, parseSelect, pickSelected } from '#/utils/odata.js'

const HTTP_STATUS_OK = 200

const querySchema = Joi.object({
  $select: Joi.string(),
  $filter: Joi.string()
  // Allow unvalidated OData parameters ($orderby, $skip, etc.) to mimic real CRM behavior
}).unknown(true)

const asLookupResponse = (record) => ({
  value: record ? [record] : []
})

const buildRecord = (query, filterField, recordBuilder) => {
  const value = parseEqFilter(query.$filter, filterField)
  if (value === null) {
    return null
  }

  const selectedFields = parseSelect(query.$select)
  const record = recordBuilder(value)
  return pickSelected(record, selectedFields)
}

const getContactRecord = (query) =>
  buildRecord(query, 'rpa_capcustomerid', (crn) => ({
    contactid: deterministicUuid(`contact:${crn}`)
  }))

const getAccountRecord = (query) =>
  buildRecord(query, 'rpa_sbinumber', (sbi) => ({
    accountid: deterministicUuid(`account:${sbi}`)
  }))

const getDocumentTypeRecord = (query) =>
  buildRecord(query, 'rpa_documenttype', (documentType) => ({
    _rpa_scheme_value: deterministicUuid(`scheme:${documentType}`),
    _rpa_subject_value: deterministicUuid(`subject:${documentType}`),
    rpa_documenttypesid: deterministicUuid(`document-type:${documentType}`)
  }))

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
    return h.response(asLookupResponse(record)).code(HTTP_STATUS_OK)
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
    return h.response(asLookupResponse(record)).code(HTTP_STATUS_OK)
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
    return h.response(asLookupResponse(record)).code(HTTP_STATUS_OK)
  }
}