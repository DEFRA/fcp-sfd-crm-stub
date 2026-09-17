import { health } from '#/routes/health.js'
import {
  accountsGet,
  contactsGet,
  documentTypesGet
} from '#/routes/crm-lookups.js'
import { incidentsGet, incidentsPost } from '#/routes/crm-incidents.js'
import { batchPost } from '#/routes/crm-batch.js'
import { conditionalUpsertRoutes } from '#/routes/crm-upserts.js'
import { oauthTokenPost } from '#/routes/oauth-token.js'
import { requestsGet, resetPost, statsGet } from '#/routes/stub-admin.js'

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
        ...conditionalUpsertRoutes,
        batchPost,
        oauthTokenPost,
        requestsGet,
        statsGet,
        resetPost
      ])
    }
  }
}
