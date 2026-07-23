import { health } from '#/routes/health.js'
import {
  accountsGet,
  contactsGet,
  documentTypesGet
} from '#/routes/crm-lookups.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([
        health,
        contactsGet,
        accountsGet,
        documentTypesGet
      ])
    }
  }
}
