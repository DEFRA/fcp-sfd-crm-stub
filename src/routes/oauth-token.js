import Joi from 'joi'

const HTTP_STATUS_OK = 200
const TOKEN_LIFETIME_SECONDS = 3600

const tokenRequestSchema = Joi.object({
  client_id: Joi.string().required(),
  client_secret: Joi.string().allow('').required(),
  grant_type: Joi.string().valid('client_credentials').required(),
  scope: Joi.string().required()
})

export const oauthTokenPost = {
  method: 'POST',
  path: '/oauth2/v2.0/token',
  options: {
    validate: {
      payload: tokenRequestSchema
    }
  },
  handler: (_request, h) => h.response({
    access_token: 'stub-access-token',
    token_type: 'Bearer',
    expires_in: TOKEN_LIFETIME_SECONDS
  }).code(HTTP_STATUS_OK)
}
