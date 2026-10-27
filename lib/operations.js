'use strict';

const { docSpringRequest, failedStateError } = require('./docspring');
const I = require('./inputs');

// Each handler takes (conn, params, ctx): params come from msg.payload, ctx.warn reports a
// problem that doesn't fail the message. It returns the value written to msg.payload: the
// API v2 response as DocSpring returns it.

const FAILED_PDF_STATES = ['error', 'syntax_error', 'image_download_failed', 'image_processing_failed'];
const FAILED_DOCUMENT_STATES = ['password_required', 'malformed_pdf', 'unknown_error', 'download_failed'];

// The first value that isn't empty: the current payload key, then its 0.1.x name.
function first(value, oldValue) {
	return I.isEmpty(value) ? oldValue : value;
}

function id(name, value) {
	return I.toText(name, I.required(name, value));
}

// An ID for a request path, encoded so it stays one segment. `.` and `..` would still
// move the request to another endpoint, so they're rejected.
function encodePathId(name, value) {
	const trimmed = value.trim();
	if (trimmed === '.' || trimmed === '..') throw new Error(name + ' must be an ID, not "' + trimmed + '"');
	return encodeURIComponent(value);
}

function pathId(name, value) {
	return encodePathId(name, id(name, value));
}

// Sent only when true: API v2 rejects `test: false` from a test API token.
function testFlag(name, value) {
	return I.toBoolean(name, value) === true ? true : undefined;
}

// Operations that make a file go to the sync host and wait for it, unless wait is false.
function waitQs(p) {
	const wait = I.toBoolean('wait', p.wait);
	return { wait: wait === undefined ? true : wait };
}

// A folder ID where null means the root and leaving it out means "don't change".
function folderId(p) {
	return p.parent_folder_id === null ? null : I.toText('parent_folder_id', p.parent_folder_id);
}

function checkSubmission(submission) {
	if (submission && FAILED_PDF_STATES.includes(submission.state)) {
		throw failedStateError("The PDF couldn't be generated", submission.state, submission.error_message, [
			'Submission: ' + submission.id,
		]);
	}
	return submission;
}

function checkBatch(batch) {
	if (batch && batch.state === 'error') {
		const failed = (batch.submissions || []).filter(
			(s) => FAILED_PDF_STATES.includes(s.state) || s.state === 'invalid_data',
		);
		const lines = failed.map(
			(s) => 'Submission ' + s.id + ' (' + s.state + ')' + (s.error_message ? ': ' + s.error_message : ''),
		);
		throw failedStateError(
			'Some PDFs in the batch failed',
			batch.state,
			batch.error_count + ' of ' + batch.total_count + ' failed',
			lines.concat(['Submission batch: ' + batch.id]),
		);
	}
	return batch;
}

function checkCombinedPdf(combinedPdf) {
	if (combinedPdf && combinedPdf.state === 'error') {
		throw failedStateError("The PDFs couldn't be combined", combinedPdf.state, combinedPdf.error_message, [
			'Combined PDF: ' + combinedPdf.id,
		]);
	}
	return combinedPdf;
}

function checkTemplate(template) {
	const doc = template && template.document;
	if (doc && FAILED_DOCUMENT_STATES.includes(doc.state)) {
		throw failedStateError("The template's PDF couldn't be processed", doc.state, doc.error_message, [
			'Template: ' + template.id,
		]);
	}
	return template;
}

// --- Submissions ---

async function generatePdf(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	const body = I.compact({
		data: I.toObject('data', p.data),
		test: testFlag('test', p.test),
		metadata: I.toObject('metadata', p.metadata),
		output_formats: I.toNameList('output_formats', p.output_formats),
		password: I.toText('password', p.password),
		expires_in: I.toInteger('expires_in', p.expires_in),
		field_overrides: I.toObject('field_overrides', p.field_overrides),
		editable: I.toBoolean('editable', p.editable),
	});
	const qs = Object.assign({ version: I.toText('version', p.version) }, waitQs(p));
	const submission = await docSpringRequest(conn, 'POST', '/templates/' + templateId + '/submissions', {
		body,
		qs,
		sync: true,
	});
	return checkSubmission(submission);
}

function batchItem(item, i) {
	const n = 'submissions[' + i + ']';
	const s = I.toObject(n, item);
	if (!s) throw new Error(n + ' must be an object');
	return I.compact({
		template_id: I.toText(n + '.template_id', s.template_id),
		template_version: I.toText(n + '.template_version', first(s.template_version, s.version)),
		data: I.toObject(n + '.data', s.data),
		test: testFlag(n + '.test', s.test),
		metadata: I.toObject(n + '.metadata', s.metadata),
		output_formats: I.toNameList(n + '.output_formats', s.output_formats),
		password: I.toText(n + '.password', s.password),
		expires_in: I.toInteger(n + '.expires_in', s.expires_in),
		field_overrides: I.toObject(n + '.field_overrides', s.field_overrides),
		editable: I.toBoolean(n + '.editable', s.editable),
	});
}

async function createSubmissionBatch(conn, p) {
	const items = I.toArray('submissions', p.submissions);
	if (!items || !items.length) throw new Error('submissions is required: a list of up to 50 submissions');
	const body = I.compact({
		template_id: I.toText('template_id', p.template_id),
		template_version: I.toText('template_version', first(p.template_version, p.version)),
		test: testFlag('test', p.test),
		metadata: I.toObject('metadata', p.metadata),
		output_formats: I.toNameList('output_formats', p.output_formats),
		submissions: items.map(batchItem),
	});
	const batch = await docSpringRequest(conn, 'POST', '/submissions/batches', {
		body,
		qs: waitQs(p),
		sync: true,
	});
	return checkBatch(batch);
}

async function getSubmissionBatch(conn, p) {
	const batchId = pathId('submission_batch_id', p.submission_batch_id);
	return docSpringRequest(conn, 'GET', '/submissions/batches/' + batchId, {
		qs: { include_data: I.toBoolean('include_data', p.include_data) },
	});
}

// Signers for Create Signature Request and Check Data. `data_requests` is the 0.1.x key.
// A row without an email is left out, as 0.1.x did, so a blank row for an optional signer
// doesn't create a signature request nobody is sent. Errors name a row by its place in the
// list the flow sent.
function signatureRequestList(p, isRequired) {
	const rows = I.toArray('signature_requests', first(p.signature_requests, p.data_requests));
	if (!rows || !rows.length) {
		if (isRequired) {
			throw new Error('signature_requests is required: a list of signers, each with the fields they fill in');
		}
		return undefined;
	}
	const signers = [];
	rows.forEach((row, i) => {
		const n = 'signature_requests[' + i + ']';
		if (I.isEmpty(row)) return;
		const r = I.toObject(n, row);
		if (!r) throw new Error(n + ' must be an object');
		const email = I.toText(n + '.email', r.email);
		if (!email || !email.trim()) return;
		const fields = I.toNameList(n + '.fields', r.fields);
		if (!fields) throw new Error(n + '.fields is required: the names of the fields this signer fills in');
		signers.push(
			I.compact({
				name: I.toText(n + '.name', r.name),
				email,
				role: I.toText(n + '.role', r.role),
				fields,
				auth_type: I.toText(n + '.auth_type', r.auth_type) || 'email_link',
				auth_provider: I.toText(n + '.auth_provider', r.auth_provider),
				prefilled_values_editable: I.toBoolean(n + '.prefilled_values_editable', r.prefilled_values_editable),
				ignore_unknown_fields: I.toBoolean(n + '.ignore_unknown_fields', r.ignore_unknown_fields),
			}),
		);
	});
	if (!signers.length && isRequired) {
		throw new Error('signature_requests needs at least one signer with an email: rows without one are left out');
	}
	return signers.length ? signers : undefined;
}

async function checkData(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	const body = I.compact({
		data: I.toObject('data', p.data),
		test: testFlag('test', p.test),
		signature_requests: signatureRequestList(p, false),
	});
	return docSpringRequest(conn, 'POST', '/templates/' + templateId + '/submissions/validate', {
		body,
		qs: { version: I.toText('version', p.version) },
	});
}

async function getSubmission(conn, p) {
	const submissionId = pathId('submission_id', p.submission_id);
	return docSpringRequest(conn, 'GET', '/submissions/' + submissionId);
}

// `test`: true (test only), false (live only) or left out (both). Also takes "test", "live"
// and "any", and the 0.1.x key `type` ("test" or "live").
function testFilter(p) {
	if (!I.isEmpty(p.test)) {
		const v = typeof p.test === 'string' ? p.test.trim().toLowerCase() : p.test;
		if (v === 'any') return undefined;
		if (v === 'live') return false;
		if (v === 'test') return true;
		return I.toBoolean('test', p.test);
	}
	if (!I.isEmpty(p.type)) {
		const type = String(p.type).trim().toLowerCase();
		if (type === 'test') return true;
		if (type === 'live') return false;
		throw new Error('type must be test or live');
	}
	return undefined;
}

// Find Templates and Find Submissions: `limit` is how many items to return in all, as in
// 0.1.x, where it could be more than a page. Gets pages of up to 100 from `cursor` until it
// has `limit` items or there are no more, and returns them as one page: { data, next_cursor },
// next_cursor being the last page's. Without a limit it gets one page (the API's default size).
const MAX_PAGE_SIZE = 100;

async function listUpTo(conn, path, p, filters) {
	const limit = I.toInteger('limit', p.limit);
	let cursor = I.toText('cursor', p.cursor);
	if (limit === undefined) return docSpringRequest(conn, 'GET', path, { qs: Object.assign({}, filters, { cursor }) });
	if (limit < 1) throw new Error('limit must be 1 or more');

	const data = [];
	let page;
	do {
		const pageSize = Math.min(MAX_PAGE_SIZE, limit - data.length);
		page = await docSpringRequest(conn, 'GET', path, { qs: Object.assign({}, filters, { limit: pageSize, cursor }) });
		const items = page && Array.isArray(page.data) ? page.data : [];
		data.push(...items);
		cursor = page && page.next_cursor;
		if (!items.length) break;
	} while (cursor && data.length < limit);
	return Object.assign({}, page, { data });
}

async function findSubmissions(conn, p) {
	const templateId = I.toText('template_id', p.template_id);
	const path = templateId ? '/templates/' + encodePathId('template_id', templateId) + '/submissions' : '/submissions';
	return listUpTo(conn, path, p, {
		test: testFilter(p),
		created_after: I.toTime('created_after', p.created_after),
		created_before: I.toTime('created_before', p.created_before),
		include_data: I.toBoolean('include_data', p.include_data),
	});
}

async function generateSubmissionFiles(conn, p) {
	const submissionId = pathId('submission_id', p.submission_id);
	const formats = I.toNameList('formats', p.formats) || ['png'];
	const submission = await docSpringRequest(conn, 'POST', '/submissions/' + submissionId + '/generate_files', {
		body: { formats },
		qs: waitQs(p),
		sync: true,
	});
	for (const format of formats) {
		const file = submission && submission.files && submission.files[format];
		if (file && file.state === 'error') {
			throw failedStateError("The " + format + " files couldn't be made", file.state, file.error_message, [
				'Submission: ' + submission.id,
			]);
		}
	}
	return submission;
}

async function expireSubmission(conn, p) {
	const submissionId = pathId('submission_id', p.submission_id);
	return docSpringRequest(conn, 'DELETE', '/submissions/' + submissionId);
}

// --- Combined PDFs ---

function sourcePdf(row, i) {
	const n = 'source_pdfs[' + i + ']';
	const r = I.toObject(n, row);
	if (!r) throw new Error(n + ' must be an object');
	let type = I.toText(n + '.type', r.type) || 'submission';
	if (type === 'combined_submission') type = 'combined_pdf';
	if (type === 'url') return { type, url: id(n + '.url', r.url) };
	const entry = { type, id: id(n + '.id', r.id) };
	if (type === 'template') {
		Object.assign(
			entry,
			I.compact({
				template_version: I.toText(n + '.template_version', r.template_version),
				processed: I.toBoolean(n + '.processed', r.processed),
			}),
		);
	}
	return entry;
}

async function combinePdfs(conn, p) {
	const rows = I.toArray('source_pdfs', p.source_pdfs);
	if (!rows || !rows.length) throw new Error('source_pdfs is required: the PDFs to combine, in order');
	const body = I.compact({
		source_pdfs: rows.map(sourcePdf),
		metadata: I.toObject('metadata', p.metadata),
		password: I.toText('password', p.password),
		expires_in: I.toInteger('expires_in', p.expires_in),
	});
	const combinedPdf = await docSpringRequest(conn, 'POST', '/combined_pdfs', { body, qs: waitQs(p), sync: true });
	return checkCombinedPdf(combinedPdf);
}

async function getCombinedPdf(conn, p) {
	const combinedPdfId = pathId('combined_pdf_id', p.combined_pdf_id);
	return docSpringRequest(conn, 'GET', '/combined_pdfs/' + combinedPdfId);
}

// --- Signature requests ---

function linkType(name, value, fallback, allowed) {
	const type = I.toText(name, value);
	if (type === undefined) return fallback;
	if (!allowed.includes(type)) throw new Error(name + ' must be ' + allowed.join(', ').replace(/, (\w+)$/, ' or $1'));
	return type;
}

async function createSignatureRequest(conn, p, ctx) {
	const templateId = pathId('template_id', p.template_id);
	const signingLinkType = linkType('signing_link_type', p.signing_link_type, 'email', ['api', 'email', 'none']);
	const body = I.compact({
		data: I.toObject('data', p.data),
		test: testFlag('test', p.test),
		metadata: I.toObject('metadata', p.metadata),
		expires_in: I.toInteger('expires_in', p.expires_in),
		signature_requests: signatureRequestList(p, true),
	});
	const submission = await docSpringRequest(conn, 'POST', '/templates/' + templateId + '/submissions', {
		body,
		qs: { version: I.toText('version', p.version) },
	});

	// A signing link per signature request. One that fails doesn't fail the others: the
	// submission exists, so the message carries on with a warning.
	const signatureRequests = [];
	for (const sr of submission.signature_requests || []) {
		let signingUrl = null;
		if (signingLinkType !== 'none' && sr.id && sr.state === 'pending') {
			try {
				const token = await docSpringRequest(conn, 'POST', '/signature_requests/' + pathId('signature_request_id', sr.id) + '/tokens', {
					body: { type: signingLinkType },
				});
				signingUrl = token.signature_request_url || null;
			} catch (e) {
				if (ctx && ctx.warn) {
					ctx.warn("Couldn't create a signing link for signature request " + sr.id + ': ' + e.message);
				}
			}
		}
		signatureRequests.push(Object.assign({}, sr, { signing_url: signingUrl }));
	}
	const firstRequest = signatureRequests[0] || {};
	return Object.assign({}, submission, {
		signature_requests: signatureRequests,
		first_signature_request_id: firstRequest.id || null,
		first_signing_url: firstRequest.signing_url || null,
	});
}

// `data_request_id` and `token_type` are the 0.1.x keys.
async function createSigningLink(conn, p) {
	const signatureRequestId = pathId('signature_request_id', first(p.signature_request_id, p.data_request_id));
	const type = linkType('type', first(p.type, p.token_type), 'email', ['api', 'email']);
	return docSpringRequest(conn, 'POST', '/signature_requests/' + signatureRequestId + '/tokens', {
		body: { type },
	});
}

async function getSignatureRequest(conn, p) {
	const signatureRequestId = pathId('signature_request_id', first(p.signature_request_id, p.data_request_id));
	return docSpringRequest(conn, 'GET', '/signature_requests/' + signatureRequestId);
}

// --- Templates ---

async function findTemplates(conn, p) {
	return listUpTo(conn, '/templates', p, {
		query: I.toText('query', p.query),
		parent_folder_id: I.toText('parent_folder_id', p.parent_folder_id),
	});
}

async function getTemplate(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	return docSpringRequest(conn, 'GET', '/templates/' + templateId);
}

function documentBody(p) {
	return {
		document_url: I.toText('document_url', p.document_url),
		document_base64: I.toBase64('document_base64', p.document_base64),
		filename: I.toText('filename', p.filename),
	};
}

async function createTemplate(conn, p) {
	if (I.isEmpty(p.template_type)) throw new Error('template_type is required: pdf or html');
	const body = I.compact(
		Object.assign(
			{
				name: I.toText('name', p.name),
				template_type: I.toText('template_type', p.template_type),
				parent_folder_id: folderId(p),
			},
			documentBody(p),
			{
				detect_fields: I.toBoolean('detect_fields', p.detect_fields),
				field_source: I.toText('field_source', p.field_source),
				field_naming: I.toText('field_naming', p.field_naming),
				field_logic: I.toText('field_logic', p.field_logic),
				html: I.toText('html', p.html),
				scss: I.toText('scss', p.scss),
				header_html: I.toText('header_html', p.header_html),
				footer_html: I.toText('footer_html', p.footer_html),
			},
		),
	);
	const template = await docSpringRequest(conn, 'POST', '/templates', { body, qs: waitQs(p), sync: true });
	return checkTemplate(template);
}

async function replaceTemplatePdf(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	const body = I.compact(
		Object.assign(documentBody(p), { reimport_fields: I.toBoolean('reimport_fields', p.reimport_fields) }),
	);
	const template = await docSpringRequest(conn, 'PUT', '/templates/' + templateId + '/document', {
		body,
		qs: waitQs(p),
		sync: true,
	});
	return checkTemplate(template);
}

async function copyTemplate(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	const body = I.compact({
		name: I.toText('name', p.name),
		parent_folder_id: folderId(p),
		version: I.toText('version', p.version),
	});
	return docSpringRequest(conn, 'POST', '/templates/' + templateId + '/copy', { body });
}

async function moveTemplate(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	if (p.parent_folder_id === undefined || p.parent_folder_id === '') {
		throw new Error('parent_folder_id is required: a folder ID, or null for the root');
	}
	return docSpringRequest(conn, 'POST', '/templates/' + templateId + '/move', {
		body: { parent_folder_id: folderId(p) },
	});
}

async function publishTemplateVersion(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	if (I.isEmpty(p.version_type)) throw new Error('version_type is required: patch, minor or major');
	const body = I.compact({
		version_type: I.toText('version_type', p.version_type),
		description: I.toText('description', p.description),
	});
	return docSpringRequest(conn, 'POST', '/templates/' + templateId + '/publish_version', { body });
}

async function listTemplateFields(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	return docSpringRequest(conn, 'GET', '/templates/' + templateId + '/fields', {
		qs: { version: I.toText('version', p.version) },
	});
}

function fieldList(p) {
	const fields = I.toArray('fields', p.fields);
	if (!fields || !fields.length) throw new Error('fields is required: a list of fields');
	return fields;
}

async function addTemplateFields(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	return docSpringRequest(conn, 'POST', '/templates/' + templateId + '/fields', {
		body: { fields: fieldList(p) },
	});
}

async function updateTemplateFields(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	return docSpringRequest(conn, 'PUT', '/templates/' + templateId + '/fields', {
		body: { fields: fieldList(p) },
	});
}

async function removeTemplateFields(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	const fieldIds = I.toIntegerList('field_ids', p.field_ids);
	if (!fieldIds) throw new Error('field_ids is required: the IDs of the fields to remove');
	return docSpringRequest(conn, 'POST', '/templates/' + templateId + '/fields/remove', {
		body: { field_ids: fieldIds },
	});
}

async function getTemplatePageImages(conn, p) {
	const templateId = pathId('template_id', p.template_id);
	return docSpringRequest(conn, 'GET', '/templates/' + templateId + '/page_images', {
		qs: { version: I.toText('version', p.version) },
	});
}

// --- Folders ---

async function listFolders(conn, p) {
	return docSpringRequest(conn, 'GET', '/folders', {
		qs: {
			parent_folder_id: I.toText('parent_folder_id', p.parent_folder_id),
			limit: I.toInteger('limit', p.limit),
			cursor: I.toText('cursor', p.cursor),
		},
	});
}

async function createFolder(conn, p) {
	const body = I.compact({ name: id('name', p.name), parent_folder_id: folderId(p) });
	return docSpringRequest(conn, 'POST', '/folders', { body });
}

// --- Make an API Call ---

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const PATH_HELP = 'path is relative to /api/v2, such as /templates';

async function apiCall(conn, p) {
	const method = (I.toText('method', p.method) || 'GET').toUpperCase();
	if (!METHODS.includes(method)) throw new Error('method must be GET, POST, PUT or DELETE');

	let path = id('path', p.path).trim();
	if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error(PATH_HELP);
	if (!path.startsWith('/')) path = '/' + path;
	if (/^\/api\/v2(?=[/?#]|$)/.test(path)) path = path.slice('/api/v2'.length);
	else if (/^\/api(?=[/?#]|$)/.test(path)) throw new Error(PATH_HELP);
	if (path.split(/[?#]/)[0].split('/').some((s) => s === '..' || s === '.')) throw new Error(PATH_HELP);

	const qs = {};
	for (const [k, v] of Object.entries(I.toObject('query', p.query) || {})) {
		if (v !== null && typeof v === 'object') throw new Error('query.' + k + ' must be text, a number or true/false');
		qs[k] = v;
	}

	let body;
	if (!I.isEmpty(p.body)) {
		if (method === 'GET') throw new Error("A GET request can't have a body: use query");
		if (typeof p.body === 'string') {
			try {
				body = JSON.parse(p.body);
			} catch (_e) {
				throw new Error('body must be an object or a list (or a JSON string of one)');
			}
		} else {
			body = p.body;
		}
	}
	return docSpringRequest(conn, method, path, { qs, body });
}

const OPERATIONS = {
	generatePdf,
	createSubmissionBatch,
	getSubmissionBatch,
	checkData,
	getSubmission,
	findSubmissions,
	generateSubmissionFiles,
	expireSubmission,
	combinePdfs,
	getCombinedPdf,
	createSignatureRequest,
	createSigningLink,
	getSignatureRequest,
	findTemplates,
	getTemplate,
	createTemplate,
	replaceTemplatePdf,
	copyTemplate,
	moveTemplate,
	publishTemplateVersion,
	listTemplateFields,
	addTemplateFields,
	updateTemplateFields,
	removeTemplateFields,
	getTemplatePageImages,
	listFolders,
	createFolder,
	apiCall,
};

const OPERATION_LABELS = {
	generatePdf: 'Generate PDF',
	createSubmissionBatch: 'Generate PDFs in a Batch',
	getSubmissionBatch: 'Get Submission Batch',
	checkData: 'Check Data',
	getSubmission: 'Get Submission',
	findSubmissions: 'Find Submissions',
	generateSubmissionFiles: 'Generate Submission Files',
	expireSubmission: 'Expire Submission',
	combinePdfs: 'Combine PDFs',
	getCombinedPdf: 'Get Combined PDF',
	createSignatureRequest: 'Create Signature Request',
	createSigningLink: 'Create Signing Link',
	getSignatureRequest: 'Get Signature Request',
	findTemplates: 'Find Templates',
	getTemplate: 'Get Template',
	createTemplate: 'Create Template',
	replaceTemplatePdf: 'Replace Template PDF',
	copyTemplate: 'Copy Template',
	moveTemplate: 'Move Template',
	publishTemplateVersion: 'Publish Template Version',
	listTemplateFields: 'List Template Fields',
	addTemplateFields: 'Add Template Fields',
	updateTemplateFields: 'Update Template Fields',
	removeTemplateFields: 'Remove Template Fields',
	getTemplatePageImages: 'Get Template Page Images',
	listFolders: 'List Folders',
	createFolder: 'Create Folder',
	apiCall: 'Make an API Call',
};

// Operation values from 0.1.x, which saved flows and msg.operation still use.
// findSubmission was one operation for one submission (with submission_id) or a list.
const OPERATION_ALIASES = {
	createDataRequest: 'createSignatureRequest',
	findTemplate: 'findTemplates',
	findSubmission: (p) => (I.isEmpty(p.submission_id) ? 'findSubmissions' : 'getSubmission'),
};

// The operation to run for an operation value (current or 0.1.x), or null for an unknown one.
function resolveOperation(name, params) {
	const alias = Object.prototype.hasOwnProperty.call(OPERATION_ALIASES, name) ? OPERATION_ALIASES[name] : null;
	const resolved = typeof alias === 'function' ? alias(params || {}) : alias || name;
	return Object.prototype.hasOwnProperty.call(OPERATIONS, resolved) ? resolved : null;
}

module.exports = { OPERATIONS, OPERATION_LABELS, OPERATION_ALIASES, resolveOperation };
