# Changelog

## 1.0.0

A major version: the nodes now call DocSpring API v2, and each operation's output is API v2's. Flows saved with
0.1.0 keep most of their operations and inputs, but not the data request names (below); check the nodes that
read the output (see "Upgrading from 0.1" in the README).

- **API v2.** Every request goes to `/api/v2`. Self-hosted (Enterprise) servers need a DocSpring release with API
  v2: until yours has it, keep using 0.1.0. **Test connection** says so when the server doesn't have API v2.
- **Signature requests.** Data requests are now signature requests, and the old names no longer work: the
  `createDataRequest` operation value, and the `data_requests` and `data_request_id` payload keys. Open saved
  Create Signature Request nodes and pick the operation again, and send `signature_requests` and
  `signature_request_id`. Create Signature Request returns `signature_requests[].signing_url`,
  `first_signature_request_id` and `first_signing_url`. Each signer needs `fields` (API v2 requires them), and can
  have a `role`, `auth_provider`, `prefilled_values_editable` and `ignore_unknown_fields`. `email` is optional, and
  every signer is sent. `signing_link_type` picks `email` links (7 days, the default), `api` links (24 hours) or
  none.
- **Combined PDFs.** Combine PDFs calls `/combined_pdfs`; the `combined_submission` source type is `combined_pdf`.
- **Outputs.** The PDF link is `files.pdf.download_url`. Find Templates and Find Submissions return
  `{ data, next_cursor }`: pass `next_cursor` back as `cursor` for the next items. Their `limit` is still how many
  to return, of any size (the node gets pages of up to 100), but the default is now 50. Create Signing Link returns
  the token, whose `signature_request_url` is the link.
- **New operations:** Generate PDFs in a Batch, Get Submission Batch, Check Data, Get Submission, Find
  Submissions, Generate Submission Files, Expire Submission, Get Combined PDF, Get Signature Request, Get
  Template, Create Template, Replace Template PDF, Copy Template, Move Template, Publish Template Version, List,
  Add, Update and Remove Template Fields, Get Template Page Images, List Folders, Create Folder and Make an API
  Call.
- **Renamed operations.** Find Template is Find Templates, and Find Submission is two operations: Get Submission
  and Find Submissions. The 0.1.0 values `findTemplate` and `findSubmission` still work, and so do the payload
  keys `token_type` and `type` (`live` or `test`).
- **Inputs.** `version` picks the template version (`latest` by default, `draft`, or a published version).
  `true`/`false` and numbers can be strings, and objects and lists JSON strings; a value that can't be converted is
  an error naming its key, and so is an ID that is `.` or `..`. `test` is only sent when it's true, so test API
  tokens work. Generate PDF also takes `output_formats` (`png` page images) and `field_overrides`, and the
  operations that make a PDF take `wait: false`.
- **Errors.** Errors show DocSpring's error code, message, the details, the record's ID and the request ID, and a
  Catch node gets the code in `msg.error.code`. A PDF that couldn't be generated (a failure `state`) is an error
  too, and so is one that wasn't ready in time, which names the operation to get it later with. When the API
  rate limit is reached (a 429), a request waits as long as DocSpring asks (up to a minute) and is sent again, up
  to 3 times.
- **Test connection** works with a saved Token Secret (it sent a placeholder before), and uses it only with the
  saved region and host. To test a different region or host, type the Token Secret again.
- Each request sends `User-Agent: docspring-node-red/1.0.0`.

## 0.1.0

The first release, on DocSpring API v1: Generate PDF, Combine PDFs, Create Signature Request, Create Signing
Link, Find Template and Find Submission.
