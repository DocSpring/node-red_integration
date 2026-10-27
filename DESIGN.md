# DocSpring Node-RED Nodes — Design Notes

Design notes for the DocSpring **Node-RED** integration (`@docspring/node-red-docspring`). Version 1.0.0 calls
**DocSpring API v2** (sc-5981). The other integrations (Zapier, Make, n8n, Pipedream, Bubble) follow the same
build spec, so the operations, inputs and error messages read the same; this doc records what's specific to
Node-RED, where nodes are a **`.js` runtime + `.html` editor** and everything is message-driven.

## Package shape

An npm module discovered by the Node-RED flow library via the `node-red` keyword + the `node-red.nodes` map in
`package.json`. Node-RED loads each node's `.js` (runtime) and `.html` (palette entry + edit dialog + help).

```
nodes/docspring-config.js / .html   # config node: connection (region + token id/secret), Test connection
nodes/docspring.js        / .html   # action node: operation selector, msg-driven
lib/regions.js                      # region → host + sync host
lib/docspring.js                    # HTTP helper: /api/v2, Basic auth, User-Agent, v2 error messages
lib/inputs.js                       # msg.payload values → what v2 accepts (booleans, integers, JSON)
lib/operations.js                   # one handler per operation, labels, 0.1.x aliases
icons/docspring.svg
```

No runtime dependencies: requests use the global `fetch` (Node 18+, which Node-RED 3.1+/4 require).

## Config node — `docspring-config`

- Properties: `region` (US / EU / Self-hosted), `customHost`. Credentials (stored encrypted by Node-RED):
  `tokenId` (text), `tokenSecret` (password).
- Hosts: US `api.docspring.com` / `sync.api.docspring.com`, EU `api-eu.docspring.com` /
  `sync.api-eu.docspring.com`, self-hosted the custom host for both (`https://` prepended when there's no scheme,
  trailing slashes dropped). Path prefix `/api/v2`.
- Auth: HTTP Basic, token ID as the username and the secret as the password, on every request, with
  `User-Agent: docspring-node-red/<package version>` so DocSpring's API logs can count Node-RED users.
- **Test connection** (`POST /docspring-config/:id/test`, an admin endpoint): `GET /api/v2/authentication`, OK when
  the response has `authenticated: true`. A 401 says the token is invalid. A 404 from a self-hosted host says:
  "This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, or use version 0.1.0 of this
  integration." The editor sends `__PWRD__` for a saved secret it doesn't show. The endpoint then uses the saved
  secret, but only when the request's region and host resolve to the saved config's API host (compared as
  normalised URLs); otherwise it answers "Type the Token Secret again to test a different region or host." without
  calling anything. The endpoint needs only `docspring-config.read`, and the region and host come from the request,
  so without that check anyone who can read the config could send the saved secret to a host of their choosing.

## Action node — `docspring`

One node with an **Operation** dropdown (grouped: Submissions, Combined PDFs, Signature requests, Templates,
Folders, Other). Inputs come from `msg.payload` (the node's config has only the operation and connection);
`msg.operation` overrides the operation. The API's response is written to `msg.payload`. `node.status()` shows the
operation while it runs, green "done", or red `HTTP <status> <code>` on an error.

Operations (`msg.operation` value → request; "sync" = the sync host with `?wait=true`, or `wait=false` when the
payload sets `wait: false`):

| Operation | Value | Request |
|---|---|---|
| Generate PDF | `generatePdf` | `POST /templates/{template_id}/submissions?version=` (sync) |
| Generate PDFs in a Batch | `createSubmissionBatch` | `POST /submissions/batches` (sync) |
| Get Submission Batch | `getSubmissionBatch` | `GET /submissions/batches/{id}?include_data=` |
| Check Data | `checkData` | `POST /templates/{template_id}/submissions/validate?version=` |
| Get Submission | `getSubmission` | `GET /submissions/{id}` |
| Find Submissions | `findSubmissions` | `GET /submissions` or `GET /templates/{template_id}/submissions` |
| Generate Submission Files | `generateSubmissionFiles` | `POST /submissions/{id}/generate_files` (sync) |
| Expire Submission | `expireSubmission` | `DELETE /submissions/{id}` |
| Combine PDFs | `combinePdfs` | `POST /combined_pdfs` (sync) |
| Get Combined PDF | `getCombinedPdf` | `GET /combined_pdfs/{id}` |
| Create Signature Request | `createSignatureRequest` | `POST /templates/{template_id}/submissions` with `signature_requests` (standard host), then `POST /signature_requests/{id}/tokens` per signer |
| Create Signing Link | `createSigningLink` | `POST /signature_requests/{id}/tokens` (`type` in the body) |
| Get Signature Request | `getSignatureRequest` | `GET /signature_requests/{id}` |
| Find Templates | `findTemplates` | `GET /templates?query=&parent_folder_id=&limit=&cursor=` |
| Get Template | `getTemplate` | `GET /templates/{id}` |
| Create Template | `createTemplate` | `POST /templates` (sync) |
| Replace Template PDF | `replaceTemplatePdf` | `PUT /templates/{id}/document` (sync) |
| Copy Template | `copyTemplate` | `POST /templates/{id}/copy` |
| Move Template | `moveTemplate` | `POST /templates/{id}/move` |
| Publish Template Version | `publishTemplateVersion` | `POST /templates/{id}/publish_version` |
| List Template Fields | `listTemplateFields` | `GET /templates/{id}/fields?version=` |
| Add Template Fields | `addTemplateFields` | `POST /templates/{id}/fields` |
| Update Template Fields | `updateTemplateFields` | `PUT /templates/{id}/fields` |
| Remove Template Fields | `removeTemplateFields` | `POST /templates/{id}/fields/remove` |
| Get Template Page Images | `getTemplatePageImages` | `GET /templates/{id}/page_images?version=` |
| List Folders | `listFolders` | `GET /folders?parent_folder_id=&limit=&cursor=` |
| Create Folder | `createFolder` | `POST /folders` |
| Make an API Call | `apiCall` | any `/api/v2` path on the standard host (`method`, `path`, `query`, `body`) |

The payload of each operation is documented in the node's help (`nodes/docspring.html`) and the README.

### Inputs

- Payload keys are API v2's names (`template_id`, `signature_requests`, `source_pdfs`, …). Each handler copies only
  the keys it knows, so other keys in `msg.payload` are ignored and never sent (v2 rejects unknown properties).
- Values are converted to what v2 accepts and rejected with an error naming the key when they can't be:
  `"true"`/`"false"` → booleans, `"3600"` → integers, JSON strings → objects and lists, comma-separated text →
  lists of names (`fields`, `output_formats`), a Buffer → base64 (`document_base64`), a Date → RFC 3339.
- Empty values (`undefined`, `null`, `""`) are left out, except `parent_folder_id: null`, which means the root
  (Copy Template, Move Template, Create Template, Create Folder).
- An ID in a request path is encoded with `encodeURIComponent`, so `../templates/tpl_x` stays one segment. An ID
  that is `.` or `..` (after trimming) is an error before any request: encoded, it would still move the request to
  another endpoint (`DELETE /submissions/..` is `DELETE /api/v2/`).
- `test` is sent only when it's true: v2 rejects `test: false` from a test API token. Find Submissions is the
  exception, where `test: false` filters live submissions.
- `version` is a query parameter. Making a PDF uses `latest` by default (the latest published version); List
  Template Fields and Get Template Page Images use the draft. Generate PDFs in a Batch sends it as the body's
  `template_version`.
- Create Signature Request needs `fields` for every signer (v2 requires them), defaults `auth_type` to
  `email_link`, and makes an `email` signing link per signer unless `signing_link_type` is `api` or `none`.
- Signer rows without an email (missing, empty or blank) are left out, under `signature_requests` and 0.1.x's
  `data_requests` alike, in Create Signature Request and Check Data. 0.1.x did this, and flows rely on it: a blank
  row for an optional signer would otherwise create a signature request nobody is sent, and the submission would
  wait for it. v2 itself allows a signer without an email; such signers need Make an API Call. With no signer left,
  Create Signature Request fails before calling the API. An error about a row names its place in the list the flow
  sent.

### Outputs

The v2 resource as the API returns it (`files.pdf.download_url`, `signature_requests`, `{ data, next_cursor }`
pages). The only additions: Create Signature Request adds `signing_url` to each signature request, plus
`first_signature_request_id` and `first_signing_url`. A signing link that can't be created leaves `signing_url`
null and reports a `node.warn()`; the message still goes on, because the submission exists.

Lists return `{ data, next_cursor }`, and a flow passes `next_cursor` back as `cursor` for the next items. In Find
Templates and Find Submissions, `limit` is a total, as it was in 0.1.x (where it could be any size): the node gets
pages of up to 100 (v2's maximum) from `cursor`, each asking for what's still missing, until it has `limit` items or
`next_cursor` is null, and returns them with the last page's `next_cursor`. Without a `limit` it gets one page (v2's
default of 50; 0.1.x's default was 20). List Folders is new, so its `limit` is v2's page size (1 to 100).

### Errors

Errors go to `done(err)`, so Catch nodes get them. `err.code` (copied to `msg.error.code` by Node-RED) is
DocSpring's error code, or the failure state.

- An HTTP error: `DocSpring API error <status> <code>: <message>`, a line per detail (`<pointer or parameter>:
  <message>`), the record ID (`Submission: …`, `Submission batch: …`, `Combined PDF: …`, `Template: …`) and
  `Request ID: …`. Non-v2 bodies are shown as text; never `[object Object]`.
- A 201 whose `state` is a failure (`error`, `syntax_error`, `image_download_failed`, `image_processing_failed`;
  a template `document.state` of `password_required`, `malformed_pdf`, `unknown_error` or `download_failed`; a
  batch in `error`, naming each failed submission; a Generate Submission Files format in `error`): the state, the
  `error_message` and the record ID.
- A 429 (rate limit): DocSpring didn't process the request, so `docSpringRequest` sends it again, POSTs included,
  after `Retry-After` seconds (at least 1), up to 3 times, while each wait is 60 seconds or less. Then it fails with
  the usual error (`rate_limited`). Every request goes through it, so this covers each page of a large `limit` and
  the signing links made after a signature request's submission exists. Tests replace `clock.sleep`.
- A 504 `polling_timeout`: "The PDF wasn't ready in time. Get it later with Get Submission (<id>)." (or Get
  Submission Batch, Get Combined PDF, Get Template). Node-RED has no trigger node, so there's no trigger to point
  to.
- Make an API Call only calls `/api/v2` paths on the connection's host: it rejects `/api/v1`, absolute URLs and
  `..` segments.

### Flows saved with 0.1.x

Flows store only the `operation` value and the config node. Updates install by hand from the palette manager, which
warns about a major version, and installs pin `~0.1.x`, so 1.0.0 is a deliberate upgrade. Old names still work:

- Operation values: `createDataRequest` → Create Signature Request, `findTemplate` → Find Templates,
  `findSubmission` → Get Submission when the payload has `submission_id`, otherwise Find Submissions.
  The editor shows the new operation when it opens an old node; a `findSubmission` node keeps its value (shown as
  "Find Submission (Get Submission or Find Submissions)") until someone picks one.
- Payload keys: `data_requests` → `signature_requests`, `data_request_id` → `signature_request_id`, `token_type`
  → `type`, `type: "live" | "test"` → `test` (Find Submissions), source type `combined_submission` →
  `combined_pdf`.
- `limit` (Find Templates, Find Submissions) is still a total, and signer rows without an email are still left out
  (see Inputs and Outputs above).
- Outputs are v2's, not 0.1.x's: `download_url` is `files.pdf.download_url`, `data_requests` is
  `signature_requests`, `first_data_request_id` is `first_signature_request_id`, and Find Templates / Find
  Submissions return `{ data, next_cursor }` instead of an array.

## No trigger node (not planned)

The other integrations have a trigger that registers a DocSpring webhook through the webhooks API. Node-RED doesn't:
it usually runs on an internal network, so DocSpring can't reach it to deliver webhooks. To act on DocSpring events,
poll with an Inject node and **Find Submissions** (`created_after`). A Node-RED instance with a public URL can use
a core HTTP-In node and a webhook added in the DocSpring dashboard.

## Testing & publishing

- `npm test` (mocha + `node-red-node-test-helper`). `test/support/mock_fetch.js` replaces the global `fetch`, and
  any request a test didn't queue a response for fails, so the unit tests never reach the network.
  `test/live_spec.js` runs against the live API only when `DOCSPRING_TOKEN_ID` and `DOCSPRING_TOKEN_SECRET` are set
  (a test API token; see `.env.example`), and is skipped otherwise.
- `test/editor_spec.js` keeps `nodes/docspring.html` in step with `lib/operations.js`: the dropdown, labels, help
  sections and the editor's handling of 0.1.x values.
- Local: `npm link` into `~/.node-red`, run Node-RED, wire a flow against the DocSpring test account.
- Publish `@docspring/node-red-docspring` to npm with the `node-red` keyword → it auto-lists in the Node-RED flow
  library (flows.nodered.org).
