# fcp-sfd-crm-stub

Lightweight CRM stub service for SFD automated testing.

This service mimics the subset of Dynamics 365 CRM endpoints used by `fcp-sfd-crm` and provides admin endpoints for asserting and resetting received request history between tests.

## Prerequisites

- Docker
- Docker Compose
- Node.js v24+ (for local non-docker runs)

## Run and Test

Run locally in Docker:

```bash
npm run docker:dev
```

Run full lint + tests in Docker (CI-equivalent):

```bash
npm run docker:test
```

Run tests in watch mode:

```bash
npm run docker:test:watch
```

## API Endpoints

### Health

| Method | Endpoint  | Description |
|--------|-----------|-------------|
| `GET`  | `/health` | Health check |

Response:

```json
{ "message": "success" }
```

### CRM Lookup Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/data/v9.2/contacts` | Contact lookup by CRN |
| `GET` | `/api/data/v9.2/accounts` | Account lookup by SBI |
| `GET` | `/api/data/v9.2/rpa_documenttypeses` | Document type metadata lookup |

#### Supported query parameters

- `$filter` with `eq` only
- `$select` comma-separated field projection

Supported filter forms:

- `rpa_capcustomerid eq '...'
- `rpa_sbinumber eq '...'
- `rpa_documenttype eq '...'`

Escaped single quotes are supported in filter values (`''` -> `'`).

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

curl -s "http://localhost:3001/api/data/v9.2/rpa_documenttypeses?\$select=_rpa_scheme_value,_rpa_subject_value,rpa_documenttypesid&\$filter=rpa_documenttype%20eq%20%27Common%20Licence%27"
```

### CRM Incident Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/data/v9.2/incidents` | Create an incident record |
| `GET` | `/api/data/v9.2/incidents({incidentid})` | Retrieve incident details |

Create response:

```json
{ "incidentid": "<uuid>" }
```

Supported query parameters on GET:

- `$select` for top-level fields (`incidentid`, `title`, `description`)
- `$expand` for online submissions

Supported expand forms:

- `incident_rpa_onlinesubmissions`
- `incident_rpa_onlinesubmissions($select=rpa_onlinesubmissionid)`

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
curl -s "http://localhost:3001/api/data/v9.2/incidents(<incidentid>)?\$select=incidentid,title&\$expand=incident_rpa_onlinesubmissions(\$select=rpa_onlinesubmissionid)"
```

### Stub Admin Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/stub/requests` | Return request history |
| `POST` | `/stub/reset` | Clear request history |

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

Reset returns `204 No Content`.

#### Examples

```bash
curl -s "http://localhost:3001/stub/requests" | jq
curl -i -X POST "http://localhost:3001/stub/reset"
curl -s "http://localhost:3001/stub/requests" | jq
```

## Retention and Concurrency Settings

The service uses in-memory stores for request history and incidents.

### Request history

- `REQUEST_HISTORY_MAX_SIZE` (default: `1000`)
- `REQUEST_HISTORY_WINDOW_MINUTES` (default: `10`)

When history exceeds max size, oldest entries are evicted first.

### Incident store

- `INCIDENT_STORE_MAX_SIZE` (default: `1000`)
- `INCIDENT_STORE_MAX_AGE_MINUTES` (default: `0`)

Behavior:

- Max-size eviction is FIFO (oldest incidents removed first).
- Age-based expiry is disabled when `INCIDENT_STORE_MAX_AGE_MINUTES=0`.
- When enabled (`>0`), incidents older than the configured age are purged on create/get operations.

## License

This project is licensed under the Open Government Licence v3.
