import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../../../src/server.js'

describe('#crm-lookups', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('returns contactid for CRN filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/contacts?$select=contactid&$filter=rpa_capcustomerid eq '2024001'"
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.value).toHaveLength(1)
    expect(payload.value[0]).toEqual({
      contactid: expect.any(String)
    })
  })

  test('returns accountid for SBI filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/accounts?$select=accountid&$filter=rpa_sbinumber eq '123456789'"
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.value).toHaveLength(1)
    expect(payload.value[0]).toEqual({
      accountid: expect.any(String)
    })
  })

  test('returns document metadata for document type filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/rpa_documenttypeses?$select=_rpa_scheme_value,_rpa_subject_value,rpa_documenttypesid&$filter=rpa_documenttype eq 'Common Licence'"
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.value).toHaveLength(1)
    expect(payload.value[0]).toEqual({
      _rpa_scheme_value: expect.any(String),
      _rpa_subject_value: expect.any(String),
      rpa_documenttypesid: expect.any(String)
    })
  })

  test('supports escaped single quotes in document type filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/rpa_documenttypeses?$select=rpa_documenttypesid&$filter=rpa_documenttype eq 'Farmer''s Record'"
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.value).toHaveLength(1)
    expect(payload.value[0]).toEqual({
      rpa_documenttypesid: expect.any(String)
    })
  })

  test('returns empty value array for malformed filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/data/v9.2/contacts?$select=contactid&$filter=invalid eq'
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload).toEqual({ value: [] })
  })

  test('returns empty value array for unsupported filter field', async () => {
    const response = await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/accounts?$select=accountid&$filter=unknown_field eq '123456789'"
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload).toEqual({ value: [] })
  })

  test('returns full default record when $select is omitted', async () => {
    const response = await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/contacts?$filter=rpa_capcustomerid eq '2024001'"
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.value).toHaveLength(1)
    expect(payload.value[0]).toEqual({
      contactid: expect.any(String)
    })
  })

  test('returns empty value array for malformed document type filter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/data/v9.2/rpa_documenttypeses?$select=rpa_documenttypesid&$filter=broken filter'
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload).toEqual({ value: [] })
  })

  test('returns deterministic ids for repeated queries', async () => {
    const url = "/api/data/v9.2/contacts?$select=contactid&$filter=rpa_capcustomerid eq '2024001'"

    const responseOne = await server.inject({
      method: 'GET',
      url
    })
    const responseTwo = await server.inject({
      method: 'GET',
      url
    })

    const payloadOne = JSON.parse(responseOne.payload)
    const payloadTwo = JSON.parse(responseTwo.payload)

    expect(payloadOne.value[0].contactid).toBe(payloadTwo.value[0].contactid)
  })
})