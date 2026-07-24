import { health } from '#/routes/health.js'
import {
  accountsGet,
  contactsGet,
  documentTypesGet
} from '#/routes/crm-lookups.js'
import { incidentsGet, incidentsPost } from '#/routes/crm-incidents.js'
import { requestsGet, resetPost } from '#/routes/stub-admin.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([
        health,
        contactsGet,
        accountsGet,
        documentTypesGet,
        incidentsPost,
        incidentsGet,
        requestsGet,
        resetPost
      ])
    }
  }
}
