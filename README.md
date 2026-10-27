# @docspring/node-red-docspring

[Node-RED](https://nodered.org) nodes for [DocSpring](https://docspring.com) — turn
structured data into filled, downloadable, and **signable** PDFs from your flows.

Version 1.0 calls DocSpring API v2. Upgrading from 0.1? See [Upgrading from 0.1](#upgrading-from-01).

## Install

From the Node-RED editor: **Menu → Manage palette → Install**, search for
`@docspring/node-red-docspring`. Or from your Node-RED user directory:

```bash
cd ~/.node-red
npm install @docspring/node-red-docspring
```

Restart Node-RED. The **DocSpring** node appears in the palette.

## Credentials

Add a **DocSpring** configuration (on the node, or via the config-nodes list):
choose your **Region** (US / EU / Self-hosted), and paste the **Token ID** and
**Token Secret** from the DocSpring web app (**Settings → API Tokens**). Click
**Test connection** to confirm it works. Credentials are stored encrypted by
Node-RED and never leave your instance.

Self-hosted (Enterprise) servers need a DocSpring release with API v2. If **Test connection** says your server
doesn't have API v2 yet, upgrade it, or keep using version 0.1.0 of these nodes until you do.

## Usage

Drop a **DocSpring** node into a flow, pick an **Operation**, and pass its inputs in `msg.payload`. The API's
response is written back to `msg.payload`. Errors go to a **Catch** node, with DocSpring's message in
`msg.error.message` and its error code in `msg.error.code`. You can override the operation per message with
`msg.operation` (the value in brackets below).

| Operation | `msg.payload` in | out |
|---|---|---|
| **Generate PDF** (`generatePdf`) | `{ template_id, data: {…}, version?, test?, metadata?, output_formats?, password?, expires_in?, field_overrides?, editable?, wait? }` | the submission; `files.pdf.download_url` is the PDF |
| **Generate PDFs in a Batch** (`createSubmissionBatch`) | `{ template_id?, template_version?, test?, metadata?, output_formats?, submissions: [{ data, metadata?, field_overrides?, … }], wait? }` | the batch |
| **Get Submission Batch** (`getSubmissionBatch`) | `{ submission_batch_id, include_data? }` | the batch |
| **Check Data** (`checkData`) | `{ template_id, data, version?, test?, signature_requests? }` | `{ valid, error? }` |
| **Get Submission** (`getSubmission`) | `{ submission_id }` | the submission |
| **Find Submissions** (`findSubmissions`) | `{ template_id?, test?, created_after?, created_before?, include_data?, limit?, cursor? }` | `{ data, next_cursor }` |
| **Generate Submission Files** (`generateSubmissionFiles`) | `{ submission_id, formats?: ["png"], wait? }` | the submission, with `files.png` |
| **Expire Submission** (`expireSubmission`) | `{ submission_id }` | the expired submission |
| **Combine PDFs** (`combinePdfs`) | `{ source_pdfs: [{ type, id \| url, template_version?, processed? }], metadata?, password?, expires_in?, wait? }` | the combined PDF |
| **Get Combined PDF** (`getCombinedPdf`) | `{ combined_pdf_id }` | the combined PDF |
| **Create Signature Request** (`createSignatureRequest`) | `{ template_id, data?, version?, test?, metadata?, signature_requests: [{ name?, email?, role?, fields, auth_type?, auth_provider?, prefilled_values_editable?, ignore_unknown_fields? }], signing_link_type? }` | the submission, with a `signing_url` per signature request |
| **Create Signing Link** (`createSigningLink`) | `{ signature_request_id, type?: "email" \| "api" }` | the token; `signature_request_url` is the link |
| **Get Signature Request** (`getSignatureRequest`) | `{ signature_request_id }` | the signature request |
| **Find Templates** (`findTemplates`) | `{ query?, parent_folder_id?, limit?, cursor? }` | `{ data, next_cursor }` |
| **Get Template** (`getTemplate`) | `{ template_id }` | the template |
| **Create Template** (`createTemplate`) | `{ template_type: "pdf" \| "html", name?, document_url? \| document_base64?, filename?, detect_fields?, html?, scss?, … }` | the template |
| **Replace Template PDF** (`replaceTemplatePdf`) | `{ template_id, document_url? \| document_base64?, filename?, reimport_fields?, wait? }` | the template |
| **Copy Template** (`copyTemplate`) | `{ template_id, name?, parent_folder_id?, version? }` | the copy |
| **Move Template** (`moveTemplate`) | `{ template_id, parent_folder_id }` (`null` = the root) | the template |
| **Publish Template Version** (`publishTemplateVersion`) | `{ template_id, version_type: "patch" \| "minor" \| "major", description? }` | the template |
| **List Template Fields** (`listTemplateFields`) | `{ template_id, version? }` | `{ template_id, version, fields }` |
| **Add Template Fields** (`addTemplateFields`) | `{ template_id, fields: [{ name, type, page, x, y, width, height, … }] }` | the fields |
| **Update Template Fields** (`updateTemplateFields`) | `{ template_id, fields: [{ id, … }] }` | the fields |
| **Remove Template Fields** (`removeTemplateFields`) | `{ template_id, field_ids: [1, 2] }` | the fields |
| **Get Template Page Images** (`getTemplatePageImages`) | `{ template_id, version? }` | an image of each page |
| **List Folders** (`listFolders`) | `{ parent_folder_id?, limit?, cursor? }` | `{ data, next_cursor }` |
| **Create Folder** (`createFolder`) | `{ name, parent_folder_id? }` | the folder |
| **Make an API Call** (`apiCall`) | `{ method?, path, query?, body? }` (`path` relative to `/api/v2`) | the response |

The node's help (in the editor's Help sidebar) explains each input. A few that apply throughout:

- `true`/`false` and numbers can be strings, and objects and lists can be JSON strings.
- `version` is a published template version such as `1.2.0`, `latest` (the default for making PDFs) or `draft`.
  Dates in `data` are `YYYY-MM-DD`.
- Operations that make a PDF wait for it. `wait: false` returns the record straight away, still `pending`.
- Each signer in a signature request needs `fields`: the names of the fields they fill in. Email signing links
  last 7 days, API links 24 hours.
- Lists return a page: pass `next_cursor` back as `cursor` for the next one.

### Example — generate a PDF

An **inject** node with this payload, wired into a **DocSpring** node (Operation:
*Generate PDF*):

```json
{ "template_id": "tpl_xxxxxxxxxxxxxxxxxxxx",
  "data": { "first_name": "Jane", "last_name": "Doe" },
  "test": true }
```

`msg.payload` then contains the submission; `msg.payload.files.pdf.download_url` is a link to the PDF.

## Upgrading from 0.1

1.0 uses DocSpring API v2, so the output of each operation changes. Flows saved with 0.1 keep their operations and
inputs:

- `createDataRequest`, `findTemplate` and `findSubmission` still work, as operation values and in `msg.operation`.
- The payload keys `data_requests`, `data_request_id` and `token_type`, `type: "live" | "test"` and the
  `combined_submission` source type still work.

Check the nodes that read the output:

- The PDF link is `files.pdf.download_url` (it was `download_url`).
- Data requests are now called signature requests: `signature_requests` and `first_signature_request_id` (were
  `data_requests` and `first_data_request_id`). Each signer needs `fields`.
- Find Templates and Find Submissions return a page, `{ data, next_cursor }`, instead of an array.
- Create Signing Link returns the token: the link is `signature_request_url`.

The [API v2 migration guide](https://docspring.com/docs/api-guide/migrating-to-api-v2/) lists everything that
changed.

## Resources

- [DocSpring documentation](https://docspring.com/docs)
- [API v2 reference](https://docspring.com/docs/api/)
- [Node-RED community nodes](https://flows.nodered.org)

## License

[MIT](LICENSE.md)
