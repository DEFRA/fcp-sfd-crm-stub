import Joi from 'joi'
import { recordRequest } from '#/common/helpers/record-request.js'
import {
  CONDITIONAL_UPSERT_ENTITY_SETS,
  hasEntity,
  upsertEntity
} from '#/store/entities.js'
import {
  ODATA_ERROR_CONTENT_TYPE,
  buildStubErrorBody
} from '#/utils/odata-error.js'
import { WEB_API_PATH } from '#/utils/web-api.js'

const HTTP_STATUS_NO_CONTENT = 204
const HTTP_STATUS_PRECONDITION_FAILED = 412
const IF_NONE_MATCH_ANY = '*'
const ODATA_VERSION = '4.0'

const headersSchema = Joi.object({
  'if-none-match': Joi.string().valid(IF_NONE_MATCH_ANY),
  'if-match': Joi.forbidden()
}).unknown(true)

const paramsSchema = Joi.object({
  id: Joi.string().required()
})

const payloadSchema = Joi.object().unknown(true).required()

const buildEntityIdUrl = (request, entitySet, id) =>
  `${request.url.origin}${WEB_API_PATH}/${entitySet}(${id})`

// With If-None-Match: * an existing record is refused with 412, as the
// consumer relies on. Without it, the stub creates or shallow merges the
// record; that this matches Dataverse upsert behaviour is not yet confirmed.
const buildUpsertRoute = (entitySet) => ({
  method: 'PATCH',
  path: `${WEB_API_PATH}/${entitySet}({id})`,
  options: {
    validate: {
      headers: headersSchema,
      params: paramsSchema,
      payload: payloadSchema
    }
  },
  handler: (request, h) => {
    const { id } = request.params
    const isConditionalCreate =
      request.headers['if-none-match'] === IF_NONE_MATCH_ANY

    if (isConditionalCreate && hasEntity(entitySet, id)) {
      recordRequest(request, HTTP_STATUS_PRECONDITION_FAILED)
      return h
        .response(buildStubErrorBody(HTTP_STATUS_PRECONDITION_FAILED))
        .type(ODATA_ERROR_CONTENT_TYPE)
        .header('OData-Version', ODATA_VERSION)
        .code(HTTP_STATUS_PRECONDITION_FAILED)
    }

    upsertEntity(entitySet, id, request.payload)
    recordRequest(request, HTTP_STATUS_NO_CONTENT)
    return h
      .response()
      .header('OData-Version', ODATA_VERSION)
      .header('OData-EntityId', buildEntityIdUrl(request, entitySet, id))
      .code(HTTP_STATUS_NO_CONTENT)
  }
})

/**
 * One PATCH route per supported entity set, so an unsupported entity set is
 * answered by the router with 404.
 */
export const conditionalUpsertRoutes =
  CONDITIONAL_UPSERT_ENTITY_SETS.map(buildUpsertRoute)
