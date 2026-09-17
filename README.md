# fcp-sfd-crm-stub

Lightweight CRM stub service for SFD automated testing.

This service mimics the subset of Dynamics 365 CRM (Dataverse Web API) endpoints used by `fcp-sfd-crm` and provides admin endpoints for asserting on received requests and resetting the stub between tests.

Records are held in memory only. The stub is not a Dataverse emulator: see [Known differences from Dataverse](#known-differences-from-dataverse) before relying on any behaviour not described here.

## Prerequisites

- Docker
- Docker Compose
- Node.js v24+ (for local non-docker runs)

## Run and Test

Run locally in Docker:

```bash
npm run docker:dev
```

Run locally in Docker, also attached to the `fcp-sfd` network used by `fcp-sfd-crm` (see [Running alongside fcp-sfd-crm in Docker](#running-alongside-fcp-sfd-crm-in-docker)):

```bash
npm run docker:dev:link
```

Run full lint + tests in Docker (CI-equivalent):

```bash
npm run docker:test
```

Run tests in watch mode:

```bash
npm run docker:test:watch
```

## Pointing fcp-sfd-crm at the stub

Set these values in the `fcp-sfd-crm` environment, where `<host>` is the host name at which `fcp-sfd-crm` can reach this stub:

| Variable                      | Value                                  |
| ----------------------------- | -------------------------------------- |
| `CRM_API_BASE_URL`            | `http://<host>:3001/api/data/v9.2`     |
| `CRM_AUTH_ENDPOINT`           | `http://<host>:3001/oauth2/v2.0/token` |
| `CRM_AUTH_FEDERATED_DISABLED` | `true`                                 |
| `CRM_AUTH_CLIENT_ID`          | any non-empty value                    |
| `CRM_AUTH_CLIENT_SECRET`      | any non-empty value                    |
| `CRM_AUTH_SCOPE`              | any non-empty value                    |

`CRM_AUTH_FEDERATED_DISABLED=true` makes `fcp-sfd-crm` use the client secret flow, which is the only token flow the stub implements.

### Running alongside fcp-sfd-crm in Docker

`npm run docker:dev` attaches the stub to its own `cdp-tenant` network only, so a `fcp-sfd-crm` container cannot reach it by name. To run both in Docker:

1. Start `fcp-sfd-crm` with `npm run docker:dev` in that repository. Its compose project creates the `fcp-sfd` network.
2. Start the stub with `npm run docker:dev:link`. This applies `compose.link.yml` on top of `compose.yml`, which attaches the stub to the existing `fcp-sfd` network as well as `cdp-tenant`, with the alias `fcp-sfd-crm-stub`.
3. In the `fcp-sfd-crm` environment, use `fcp-sfd-crm-stub` as `<host>` in the values above, for example `CRM_API_BASE_URL=http://fcp-sfd-crm-stub:3001/api/data/v9.2`.

If the `fcp-sfd` network does not exist, `npm run docker:dev:link` fails; `compose.link.yml` declares the network as external and does not create it. The stub remains reachable from the host at `http://localhost:3001` either way.

The flow `fcp-sfd-crm` follows against the stub is:

1. `POST /oauth2/v2.0/token`
2. Contact, account and document type lookups
3. `POST /api/data/v9.2/$batch` to create the case, online submission and first metadata record together
4. `GET /api/data/v9.2/incidents({id})` with `$expand` to read the online submission `activityid` before writing metadata for a later file
5. `PATCH /api/data/v9.2/rpa_activitymetadatas({id})` with `If-None-Match: *` for each later file, and for the first file when a redelivered changeset is refused with `412`
6. `PATCH /api/data/v9.2/rpa_integrationinboundqueues({id})` with `If-None-Match: *` for a triage record, only when `CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY` is set and a failure is classified as terminal

`test/unit/routes/consumer-flow.test.js` replays steps 1 to 5 for two files and a redelivery.

## API Endpoints

### Health

| Method | Endpoint  | Description  |
| ------ | --------- | ------------ |
| `GET`  | `/health` | Health check |

Response:

```json
{ "message": "success" }
```

### OAuth Token Endpoint

| Method | Endpoint             | Purpose                                                    |
| ------ | -------------------- | ---------------------------------------------------------- |
| `POST` | `/oauth2/v2.0/token` | Return a stub access token for the client credentials flow |

The endpoint accepts an `application/x-www-form-urlencoded` request containing
`client_id`, `client_secret`, `grant_type=client_credentials` and `scope`.

Response:

```json
{
  "access_token": "stub-access-token",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### CRM Lookup Endpoints

| Method | Endpoint                             | Purpose                       |
| ------ | ------------------------------------ | ----------------------------- |
| `GET`  | `/api/data/v9.2/contacts`            | Contact lookup by CRN         |
| `GET`  | `/api/data/v9.2/accounts`            | Account lookup by SBI         |
| `GET`  | `/api/data/v9.2/rpa_documenttypeses` | Document type metadata lookup |

#### Supported query parameters

- `$filter` with `eq` only
- `$select` comma-separated field projection

Supported filter forms:

- `rpa_capcustomerid eq '...'
- `rpa_sbinumber eq '...'
- `rpa_documenttype eq '...'`

Escaped single quotes are supported in filter values (`''` -> `'`).

Document type lookups return `_rpa_scheme_value`, `_rpa_subject_value`,
`_rpa_teamrouting_value` and `rpa_documenttypesid`. Each value is a UUID derived
deterministically from the document type, so repeated lookups return the same ids.

Lookup responses use an OData-like envelope:

```json
{ "value": [ ... ] }
```

Invalid/unsupported filters return:

```json
{ "value": [] }
```

#### Examples

```bash
curl -s "http://localhost:3001/api/data/v9.2/contacts?\$select=contactid&\$filter=rpa_capcustomerid%20eq%20%272024001%27"

curl -s "http://localhost:3001/api/data/v9.2/accounts?\$select=accountid&\$filter=rpa_sbinumber%20eq%20%27123456789%27"

curl -s "http://localhost:3001/api/data/v9.2/rpa_documenttypeses?\$select=_rpa_scheme_value,_rpa_subject_value,_rpa_teamrouting_value,rpa_documenttypesid&\$filter=rpa_documenttype%20eq%20%27Common%20Licence%27"
```

### CRM Incident Endpoints

| Method | Endpoint                                 | Purpose                            |
| ------ | ---------------------------------------- | ---------------------------------- |
| `POST` | `/api/data/v9.2/incidents`               | Create an incident record (legacy) |
| `GET`  | `/api/data/v9.2/incidents({incidentid})` | Retrieve incident details          |

`POST /api/data/v9.2/incidents` is legacy. `fcp-sfd-crm` no longer calls it, and creates cases with `$batch` instead. It still works, and stores the incident and each nested online submission as separate records, in the same way as the conditional upsert and `$batch` endpoints.

`GET` returns incidents created by any of the three routes. Online submissions are linked to an incident by their `regardingobjectid_incident_rpa_onlinesubmission@odata.bind` value, `/incidents(<incidentid>)`.

Create response:

```json
{ "incidentid": "<uuid>" }
```

Supported query parameters on GET:

- `$select` for top-level fields (`incidentid`, `title`, `description`)
- `$expand` for online submissions

Supported expand forms:

- `incident_rpa_onlinesubmissions`
- `incident_rpa_onlinesubmissions($select=activityid,rpa_onlinesubmissionid)`

Each expanded online submission has `activityid`, which is its record id, and the fields it was created with. `@odata.bind` annotations are not returned. An incident with no online submissions returns an empty array under `$expand`.

Unknown incident id returns `404` with message `Incident not found`.

#### Examples

Create:

```bash
curl -s -X POST "http://localhost:3001/api/data/v9.2/incidents" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Document Upload - SBI 123456789",
    "description": "Online submission with attached documents",
    "incident_rpa_onlinesubmissions": [{
      "subject": "Document Upload",
      "description": "Test submission"
    }]
  }'
```

Retrieve with select + expand:

```bash
curl -s "http://localhost:3001/api/data/v9.2/incidents(<incidentid>)?\$select=incidentid,title&\$expand=incident_rpa_onlinesubmissions(\$select=activityid,rpa_onlinesubmissionid)"
```

### CRM Conditional Upsert Endpoints

| Method  | Endpoint                                            | Purpose                               |
| ------- | --------------------------------------------------- | ------------------------------------- |
| `PATCH` | `/api/data/v9.2/incidents({id})`                    | Create or update an incident          |
| `PATCH` | `/api/data/v9.2/rpa_onlinesubmissions({id})`        | Create or update an online submission |
| `PATCH` | `/api/data/v9.2/rpa_activitymetadatas({id})`        | Create or update a metadata record    |
| `PATCH` | `/api/data/v9.2/rpa_integrationinboundqueues({id})` | Create or update a triage record      |

The request body must be a JSON object. It is stored as received. `@odata.bind` values are stored verbatim and not checked against any other record.

| Request            | Record         | Response                                       |
| ------------------ | -------------- | ---------------------------------------------- |
| `If-None-Match: *` | does not exist | `204`, record created                          |
| `If-None-Match: *` | exists         | `412` with a JSON error body, record unchanged |
| no `If-None-Match` | does not exist | `204`, record created                          |
| no `If-None-Match` | exists         | `204`, body shallow merged into the record     |

Successful responses carry `OData-EntityId: <origin>/api/data/v9.2/<entitySet>(<id>)`.

The stub returns `400` for a body that is not a JSON object, for `If-None-Match` with any value other than `*`, and for any `If-Match` header. Other entity sets return `404`.

#### Example

```bash
curl -i -X PATCH "http://localhost:3001/api/data/v9.2/rpa_activitymetadatas(33333333-3333-4333-8333-333333333333)" \
  -H "Content-Type: application/json" \
  -H "If-None-Match: *" \
  -d '{ "rpa_name": "file.pdf" }'
```

### CRM Batch Endpoint

| Method | Endpoint                | Purpose                                          |
| ------ | ----------------------- | ------------------------------------------------ |
| `POST` | `/api/data/v9.2/$batch` | Create several records together in one changeset |

#### Request

The request `Content-Type` must be `multipart/mixed;boundary=<batch boundary>`; any other content type returns `415`. The body holds one changeset, framed with CRLF line endings, in the form `fcp-sfd-crm` sends:

```text
--batch_<uuid>
Content-Type: multipart/mixed;boundary=changeset_<uuid>

--changeset_<uuid>
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 1

PATCH http://<host>:3001/api/data/v9.2/incidents(<id>) HTTP/1.1
Content-Type: application/json
If-None-Match: *

{"title":"..."}
--changeset_<uuid>--
--batch_<uuid>--
```

Every part must:

- use `PATCH`
- address one record in a supported entity set (see [CRM Conditional Upsert Endpoints](#crm-conditional-upsert-endpoints)), with an absolute or relative URL
- send `If-None-Match: *` and no `If-Match`
- have a JSON object body

A changeset holds at most 1000 parts.

#### Response

| Case                                                     | Status | Body                                                                                                              |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| No record exists                                         | `200`  | One `204 No Content` part per request part, each with `Content-ID` and `OData-EntityId`                           |
| Any record already exists                                | `412`  | Only the first failing part, as `412 Precondition Failed` with a JSON error body. No record is created or changed |
| No parts found, for example a body framed with bare LF   | `200`  | An empty batch response                                                                                           |
| A part breaks a rule above, or the body cannot be parsed | `400`  | JSON error naming the problem. No record is created                                                               |

Response boundaries are named `batchresponse_<uuid>` and `changesetresponse_<uuid>`, as `parseBatchResponse` in `fcp-sfd-crm` expects. `fcp-sfd-crm` treats an empty batch response as a failure, not as success.

All records in a changeset are created, or none is.

A changeset that addresses the same record twice is refused with an outer `412` naming the repeated part, even when neither write would have conflicted with a stored record. Whether Dataverse does the same is not confirmed; see [Known differences from Dataverse](#known-differences-from-dataverse).

#### Keeping the stub in step with fcp-sfd-crm

`test/fixtures/consumer-changeset.txt` is a copy of the output of `buildChangesetRequest` in `fcp-sfd-crm` (`src/repos/dataverse-batch.js`), and `test/unit/odata-batch.test.js` copies the patterns `parseBatchResponse` uses to read the response. Neither updates itself. When `src/repos/dataverse-batch.js` changes, regenerate the fixture, update the copied patterns, and rerun `test/unit/routes/consumer-flow.test.js` and an end to end check against `fcp-sfd-crm`. The fixture must keep its CRLF line endings; `.gitattributes` and `.editorconfig` exclude it from line ending conversion.

### Stub Admin Endpoints

| Method | Endpoint         | Purpose                                                      |
| ------ | ---------------- | ------------------------------------------------------------ |
| `GET`  | `/stub/requests` | Return request history                                       |
| `GET`  | `/stub/stats`    | Return request totals                                        |
| `POST` | `/stub/reset`    | Clear request history, request totals and all stored records |

History entry schema:

```json
{
  "method": "GET|POST",
  "endpoint": "/api/...",
  "timestamp": "ISO-8601",
  "requestBody": {},
  "responseStatus": 200
}
```

A `$batch` request is recorded as one entry. Its `requestBody` lists the parsed parts, each with its own `responseStatus`:

```json
{
  "method": "POST",
  "endpoint": "/api/data/v9.2/$batch",
  "timestamp": "ISO-8601",
  "requestBody": {
    "parts": [
      {
        "contentId": "1",
        "method": "PATCH",
        "url": "http://<host>:3001/api/data/v9.2/incidents(<id>)",
        "entitySet": "incidents",
        "id": "<id>",
        "headers": { "content-type": "application/json", "if-none-match": "*" },
        "body": {},
        "responseStatus": 204
      }
    ]
  },
  "responseStatus": 200
}
```

Part header names are lower case. A part the response does not report on, such as the parts that did not fail in a `412` changeset, has `"responseStatus": null`. A `$batch` body that cannot be parsed is recorded with `"requestBody": null`.

Requests refused before reaching a handler, such as `400` validation failures on the upsert endpoints, `404` for unknown routes and `415` for `$batch`, are not recorded. The token endpoint does not record requests.

`GET /stub/requests` is unauthenticated, as is every other endpoint, and returns request bodies verbatim. A `$batch` entry therefore holds the whole case payload, including the case title, which in `fcp-sfd-crm` messages contains an SBI. Send the stub synthetic data only. It must not be pointed at anything derived from real customer data.

Stats response schema:

```json
{
  "total": 3,
  "firstRequestAt": "ISO-8601",
  "lastRequestAt": "ISO-8601",
  "byRoute": [
    { "method": "POST", "route": "/api/data/v9.2/$batch", "status": 200, "count": 2 },
    { "method": "PATCH", "route": "/api/data/v9.2/incidents({id})", "status": 204, "count": 1 }
  ]
}
```

`GET /stub/stats` counts the same requests as request history, but is not limited by `REQUEST_HISTORY_MAX_SIZE`, so it suits load tests. Totals are grouped by method, route pattern and status, so requests to different records on one entity set share a line. A `$batch` request counts once, whatever parts it holds. Before any request is recorded, `total` is `0`, both times are `null` and `byRoute` is empty.

Totals are held in memory by each stub instance from start up or the last reset. When more than one instance runs, each reports only its own requests, and a restart loses them. For a count across instances, use the stub's logs in OpenSearch.

Reset returns `204 No Content`. It clears request history, request totals and every stored record, including incidents, online submissions, metadata and triage records. Record ids sent by `fcp-sfd-crm` are derived from the message `correlationId`, so a test that reuses a message after a reset starts from an empty stub rather than meeting `412`.

#### Examples

```bash
curl -s "http://localhost:3001/stub/requests" | jq
curl -s "http://localhost:3001/stub/stats" | jq
curl -i -X POST "http://localhost:3001/stub/reset"
curl -s "http://localhost:3001/stub/requests" | jq
```

## Retention and Concurrency Settings

The service uses in-memory stores for request history and entity records.

### Request history

- `REQUEST_HISTORY_MAX_SIZE` (default: `1000`)
- `REQUEST_HISTORY_WINDOW_MINUTES` (default: `10`)

When history exceeds max size, oldest entries are evicted first. Request totals from `GET /stub/stats` are not evicted.

### Entity store

- `INCIDENT_STORE_MAX_SIZE` (default: `1000`)
- `INCIDENT_STORE_MAX_AGE_MINUTES` (default: `0`)

Despite their names, both settings apply to each entity set separately: `incidents`, `rpa_onlinesubmissions`, `rpa_activitymetadatas` and `rpa_integrationinboundqueues`.

Behavior:

- `INCIDENT_STORE_MAX_SIZE` must be 1 or more. The service refuses to start on `0`, which would evict every record as it was written and make conditional creates never conflict.
- Max-size eviction is FIFO within each entity set (oldest records removed first). Updating a record does not change its position.
- A `$batch` changeset that would write more records to one entity set than the limit allows is refused rather than half-applied, because eviction cannot tell which records the changeset itself wrote.
- Age-based expiry is disabled when `INCIDENT_STORE_MAX_AGE_MINUTES=0`.
- When enabled (`>0`), records older than the configured age are purged when their entity set is read or written.
- Because limits apply per entity set, an incident can be evicted while its online submission remains. At the default size this does not arise in normal test runs; call `POST /stub/reset` between suites.

## Known differences from Dataverse

The following Dataverse behaviours are not confirmed by `fcp-sfd-crm`, its ADRs or any captured response. The stub takes the approach shown until each is confirmed. Do not treat the stub's behaviour here as evidence of how Dataverse behaves.

| Question                                                                                                                                                                                                                                                                                                                                                                                                                      | Stub approach until confirmed                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The exact body and `Content-Type` of an outer `412` `$batch` response, and whether a conflict on a part other than the first also produces an outer `412`. [`fcp-sfd-crm` ADR](https://eaflood.atlassian.net/wiki/spaces/SFD/pages/6576832627/fcp-sfd-crm+Use+a+Dataverse+batch+changeset+of+conditional+upserts+instead+of+a+deep+insert+for+case+creation) records an outer `412` only for an identical repeated changeset. | Outer `412` with a multipart body holding only the failing part, whichever part conflicts.                                                                                                                                                                                   |
| The error `code` and `message` Dataverse returns for a conditional create conflict.                                                                                                                                                                                                                                                                                                                                           | A JSON OData error with code `STUB_GENERATED_ERROR` and a message stating it was generated by the stub. `fcp-sfd-crm` only logs the text.                                                                                                                                    |
| Whether Dataverse accepts relative as well as absolute part URLs in a changeset.                                                                                                                                                                                                                                                                                                                                              | Both are accepted. `fcp-sfd-crm` sends absolute URLs.                                                                                                                                                                                                                        |
| Upsert semantics for `PATCH` without `If-None-Match`, believed to be create or update. `fcp-sfd-crm` never sends this.                                                                                                                                                                                                                                                                                                        | Create, or shallow merge into the existing record, returning `204`.                                                                                                                                                                                                          |
| The maximum number of requests in one `$batch`, believed to be 1000 but not verified.                                                                                                                                                                                                                                                                                                                                         | At most 1000 parts.                                                                                                                                                                                                                                                          |
| The `OData-EntityId` value for a record addressed by a client-supplied key.                                                                                                                                                                                                                                                                                                                                                   | `<origin>/api/data/v9.2/<entitySet>(<id>)`.                                                                                                                                                                                                                                  |
| Whether an online submission created in a changeset is returned at once by the expanded incident `GET`. `fcp-sfd-crm` treats a miss as transient.                                                                                                                                                                                                                                                                             | Returned at once; the delay path is not reproduced.                                                                                                                                                                                                                          |
| Whether Dataverse refuses a changeset that addresses the same record twice, or applies both writes. `fcp-sfd-crm` never sends this.                                                                                                                                                                                                                                                                                           | Outer `412` reporting the repeated part.                                                                                                                                                                                                                                     |
| The error envelope Dataverse uses for rejections other than a conditional create conflict.                                                                                                                                                                                                                                                                                                                                    | Only `412` bodies are OData-shaped. Every other error (`400`, `404`, `415`) uses the hapi envelope, `{"statusCode":...,"error":...,"message":...}`, which Dataverse never emits. `fcp-sfd-crm` captures the body as text and logs it, so nothing depends on the shape today. |

Other limitations:

- Lookups always return a match, so `fcp-sfd-crm` paths for missing contacts, accounts or document types, and the triage records they lead to, cannot be exercised end to end.
- The stub cannot return `5xx`, `429` or slow responses, so retry and timeout behaviour cannot be exercised.
- Only `incidents` can be read back through the Web API. Other entity sets can be written but not read; use `GET /stub/requests` to assert on what was sent.
- `@odata.bind` values are not checked against other records.

## Decision records

- [Decision Records](https://eaflood.atlassian.net/wiki/spaces/SFD/pages/6370394134/Decision+Records) hold the five decisions taken bringing the stub to `$batch` changeset parity with `fcp-sfd-crm`: retention settings, reset scope, `$batch` request history shape, local networking and the malformed changeset body. Two of them are still awaiting sign-off from their owners.

## License

This project is licensed under the Open Government Licence v3.
