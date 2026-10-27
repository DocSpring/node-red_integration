'use strict';

require('should');
const { MockFetch } = require('./support/mock_fetch');
const { OPERATIONS, OPERATION_LABELS, resolveOperation } = require('../lib/operations');

const US = { region: 'us', tokenId: 'api_test_id', tokenSecret: 'secret' };
const API = 'https://api.docspring.com/api/v2';
const SYNC = 'https://sync.api.docspring.com/api/v2';

function submission(extra) {
	return Object.assign(
		{
			id: 'sub_1',
			template_id: 'tpl_1',
			state: 'processed',
			test: true,
			data: { first_name: 'Jane' },
			error_message: null,
			signature_requests: [],
			files: {
				pdf: {
					state: 'processed',
					download_url: 'https://downloads.docspring.com/store/sub_1.pdf',
					permanent_url: 'https://app.docspring.com/submissions/sub_1/files/pdf',
					sha256: 'abc',
				},
			},
		},
		extra,
	);
}

function signatureRequest(id, extra) {
	return Object.assign({ id, submission_id: 'sub_1', state: 'pending', role: 'Signer 1', fields: ['signature'] }, extra);
}

function token(signatureRequestId, type) {
	return {
		id: 'tok_' + signatureRequestId,
		signature_request_id: signatureRequestId,
		type,
		secret: 'tok_secret',
		signature_request_url: 'https://app.docspring.com/signature_requests/' + signatureRequestId + '?token=x',
		expires_at: '2026-11-03T00:00:00Z',
		created_at: '2026-10-27T00:00:00Z',
	};
}

function run(operation, payload, ctx) {
	return OPERATIONS[operation](US, payload, ctx);
}

describe('DocSpring operations', function () {
	const mock = new MockFetch();
	before(() => mock.install());
	after(() => mock.restore());
	afterEach(function () {
		mock.assertDone();
		mock.reset();
	});

	it('has an operation for every row of the spec, each with a label', function () {
		Object.keys(OPERATIONS).should.eql([
			'generatePdf',
			'createSubmissionBatch',
			'getSubmissionBatch',
			'checkData',
			'getSubmission',
			'findSubmissions',
			'generateSubmissionFiles',
			'expireSubmission',
			'combinePdfs',
			'getCombinedPdf',
			'createSignatureRequest',
			'createSigningLink',
			'getSignatureRequest',
			'findTemplates',
			'getTemplate',
			'createTemplate',
			'replaceTemplatePdf',
			'copyTemplate',
			'moveTemplate',
			'publishTemplateVersion',
			'listTemplateFields',
			'addTemplateFields',
			'updateTemplateFields',
			'removeTemplateFields',
			'getTemplatePageImages',
			'listFolders',
			'createFolder',
			'apiCall',
		]);
		Object.keys(OPERATION_LABELS).should.eql(Object.keys(OPERATIONS));
	});

	describe('operation aliases from 0.1.x', function () {
		it('maps the old operation values to the new operations', function () {
			resolveOperation('createDataRequest', {}).should.equal('createSignatureRequest');
			resolveOperation('findTemplate', {}).should.equal('findTemplates');
			resolveOperation('findSubmission', { submission_id: 'sub_1' }).should.equal('getSubmission');
			resolveOperation('findSubmission', { limit: 5 }).should.equal('findSubmissions');
			resolveOperation('generatePdf', {}).should.equal('generatePdf');
			(resolveOperation('nope', {}) === null).should.be.true();
			(resolveOperation('toString', {}) === null).should.be.true();
		});
	});

	describe('IDs in paths', function () {
		// Every operation that puts an ID in the request path, and the payload key it takes it from.
		const PATH_IDS = [
			['generatePdf', 'template_id'],
			['getSubmissionBatch', 'submission_batch_id'],
			['checkData', 'template_id'],
			['getSubmission', 'submission_id'],
			['findSubmissions', 'template_id'],
			['generateSubmissionFiles', 'submission_id'],
			['expireSubmission', 'submission_id'],
			['getCombinedPdf', 'combined_pdf_id'],
			['createSignatureRequest', 'template_id'],
			['createSigningLink', 'signature_request_id'],
			['getSignatureRequest', 'signature_request_id'],
			['getTemplate', 'template_id'],
			['replaceTemplatePdf', 'template_id'],
			['copyTemplate', 'template_id'],
			['moveTemplate', 'template_id'],
			['publishTemplateVersion', 'template_id'],
			['listTemplateFields', 'template_id'],
			['addTemplateFields', 'template_id'],
			['updateTemplateFields', 'template_id'],
			['removeTemplateFields', 'template_id'],
			['getTemplatePageImages', 'template_id'],
		];

		it('rejects . and .. as an ID before sending anything', async function () {
			for (const [operation, key] of PATH_IDS) {
				for (const value of ['..', ' . ']) {
					const expected = key + ' must be an ID, not "' + value.trim() + '"';
					await run(operation, { [key]: value }).should.be.rejectedWith(expected);
				}
			}
			await run('getSignatureRequest', { data_request_id: '..' }).should.be.rejectedWith(
				'signature_request_id must be an ID, not ".."',
			);
			mock.calls.length.should.equal(0);
		});

		it('encodes an ID, so it stays one path segment', async function () {
			mock.respond(200, submission());
			await run('expireSubmission', { submission_id: '../templates/tpl_x' });
			mock.last.method.should.equal('DELETE');
			mock.last.path.should.equal('/api/v2/submissions/..%2Ftemplates%2Ftpl_x');
		});
	});

	describe('Generate PDF', function () {
		it('posts to the sync host with version and wait in the query, and returns the submission', async function () {
			mock.respond(201, submission());
			const result = await run('generatePdf', {
				template_id: 'tpl_1',
				data: { first_name: 'Jane' },
				version: 2,
				test: 'true',
				metadata: '{"user_id": 42}',
				output_formats: 'pdf, png',
				password: 'pw',
				expires_in: '3600',
				field_overrides: { first_name: { required: false } },
				editable: false,
				unknown_key: 'ignored',
			});
			result.should.eql(submission());
			const call = mock.last;
			call.method.should.equal('POST');
			call.url.toString().should.equal(SYNC + '/templates/tpl_1/submissions?version=2&wait=true');
			call.body.should.eql({
				data: { first_name: 'Jane' },
				test: true,
				metadata: { user_id: 42 },
				output_formats: ['pdf', 'png'],
				password: 'pw',
				expires_in: 3600,
				field_overrides: { first_name: { required: false } },
				editable: false,
			});
		});

		it("leaves test out unless it's true, and empty values out", async function () {
			mock.respond(201, submission()).respond(201, submission());
			await run('generatePdf', { template_id: 'tpl_1', data: {}, test: false, password: '', metadata: null });
			mock.last.body.should.eql({ data: {} });
			mock.last.query.should.eql({ wait: 'true' });
			await run('generatePdf', { template_id: 'tpl_1', test: 'false', wait: false });
			mock.last.body.should.eql({});
			mock.last.query.should.eql({ wait: 'false' });
		});

		it('rejects values it cannot convert, before sending anything', async function () {
			await run('generatePdf', { template_id: 'tpl_1', test: 'maybe' }).should.be.rejectedWith('test must be true or false');
			await run('generatePdf', { template_id: 'tpl_1', expires_in: 'soon' }).should.be.rejectedWith(
				'expires_in must be a whole number',
			);
			await run('generatePdf', { data: {} }).should.be.rejectedWith('template_id is required');
			mock.calls.length.should.equal(0);
		});

		it('fails when the PDF was not generated (a 201 with a failure state)', async function () {
			mock.respond(
				201,
				submission({ state: 'image_download_failed', error_message: "Couldn't download https://example.com/logo.png", files: {} }),
			);
			const err = await run('generatePdf', { template_id: 'tpl_1', data: {} }).should.be.rejected();
			err.message.should.equal(
				"The PDF couldn't be generated (state: image_download_failed): Couldn't download https://example.com/logo.png\nSubmission: sub_1",
			);
			err.code.should.equal('image_download_failed');
		});

		it('names the submission in an invalid_data error', async function () {
			mock.respond(422, {
				error: {
					code: 'invalid_data',
					message: "The data doesn't match the template's fields: /data/last_name is required",
					details: [{ code: 'required', message: 'is required', pointer: '/data/last_name' }],
					request_id: 'req_1',
					submission_id: 'sub_9',
				},
			});
			const err = await run('generatePdf', { template_id: 'tpl_1', data: {} }).should.be.rejected();
			err.message.should.containEql('/data/last_name: is required\nSubmission: sub_9\nRequest ID: req_1');
		});
	});

	describe('Generate PDFs in a Batch', function () {
		const batch = (extra) =>
			Object.assign(
				{ id: 'sbb_1', state: 'processed', total_count: 2, error_count: 0, submissions: [submission(), submission({ id: 'sub_2' })] },
				extra,
			);

		it('posts the submissions to the sync host and waits', async function () {
			mock.respond(201, batch());
			const result = await run('createSubmissionBatch', {
				template_id: 'tpl_1',
				version: 'draft',
				test: true,
				metadata: { run: 1 },
				output_formats: ['pdf'],
				submissions: [
					{ data: { a: 1 }, metadata: { row: 1 }, field_overrides: { a: { required: false } }, test: false },
					{ template_id: 'tpl_2', version: '1.2.0', data: '{"b":2}', expires_in: '60', test: 'true' },
				],
			});
			result.should.eql(batch());
			mock.last.method.should.equal('POST');
			mock.last.url.toString().should.equal(SYNC + '/submissions/batches?wait=true');
			mock.last.body.should.eql({
				template_id: 'tpl_1',
				template_version: 'draft',
				test: true,
				metadata: { run: 1 },
				output_formats: ['pdf'],
				submissions: [
					{ data: { a: 1 }, metadata: { row: 1 }, field_overrides: { a: { required: false } } },
					{ template_id: 'tpl_2', template_version: '1.2.0', data: { b: 2 }, expires_in: 60, test: true },
				],
			});
		});

		it('fails naming the batch and each failed submission', async function () {
			mock.respond(
				201,
				batch({
					state: 'error',
					error_count: 1,
					submissions: [submission(), submission({ id: 'sub_2', state: 'syntax_error', error_message: 'Liquid error' })],
				}),
			);
			const err = await run('createSubmissionBatch', { template_id: 'tpl_1', submissions: [{ data: {} }, { data: {} }] }).should.be
				.rejected();
			err.message.should.equal(
				'Some PDFs in the batch failed (state: error): 1 of 2 failed\nSubmission sub_2 (syntax_error): Liquid error\nSubmission batch: sbb_1',
			);
		});

		it('needs submissions', async function () {
			await run('createSubmissionBatch', { template_id: 'tpl_1' }).should.be.rejectedWith(/submissions is required/);
		});
	});

	it('Get Submission Batch gets the batch, with include_data', async function () {
		mock.respond(200, { id: 'sbb_1' });
		(await run('getSubmissionBatch', { submission_batch_id: 'sbb_1', include_data: 'true' })).should.eql({ id: 'sbb_1' });
		mock.last.method.should.equal('GET');
		mock.last.url.toString().should.equal(API + '/submissions/batches/sbb_1?include_data=true');
	});

	describe('Check Data', function () {
		it("posts to validate and returns the result, even when it isn't valid", async function () {
			const invalid = {
				valid: false,
				template_id: 'tpl_1',
				template_version: null,
				error: { code: 'invalid_data', message: 'bad', details: [], request_id: 'req_1' },
			};
			mock.respond(200, invalid);
			const result = await run('checkData', {
				template_id: 'tpl_1',
				version: 'latest',
				data: { a: 1 },
				test: true,
				data_requests: [{ email: 'signer@example.com', fields: 'signature' }],
			});
			result.should.eql(invalid);
			mock.last.url.toString().should.equal(API + '/templates/tpl_1/submissions/validate?version=latest');
			mock.last.body.should.eql({
				data: { a: 1 },
				test: true,
				signature_requests: [{ email: 'signer@example.com', fields: ['signature'], auth_type: 'email_link' }],
			});
		});
	});

	it('Get Submission gets one submission', async function () {
		mock.respond(200, submission());
		(await run('getSubmission', { submission_id: 'sub_1' })).should.eql(submission());
		mock.last.url.toString().should.equal(API + '/submissions/sub_1');
	});

	describe('Find Submissions', function () {
		it('lists submissions and returns the page with next_cursor', async function () {
			const page = { data: [submission()], next_cursor: 'sub_1' };
			mock.respond(200, page);
			const result = await run('findSubmissions', {
				test: false,
				created_after: new Date('2026-01-31T09:00:00Z'),
				created_before: '2026-02-01T00:00:00Z',
				include_data: true,
				limit: '10',
				cursor: 'sub_0',
			});
			result.should.eql(page);
			mock.last.path.should.equal('/api/v2/submissions');
			mock.last.query.should.eql({
				test: 'false',
				created_after: '2026-01-31T09:00:00.000Z',
				created_before: '2026-02-01T00:00:00Z',
				include_data: 'true',
				limit: '10',
				cursor: 'sub_0',
			});
		});

		it("lists a template's submissions, and takes 0.1.x's type and the any/live/test values", async function () {
			mock.respond(200, { data: [], next_cursor: null }).respond(200, { data: [], next_cursor: null });
			mock.respond(200, { data: [], next_cursor: null }).respond(200, { data: [], next_cursor: null });
			await run('findSubmissions', { template_id: 'tpl_1', type: 'live' });
			mock.last.url.toString().should.equal(API + '/templates/tpl_1/submissions?test=false');
			await run('findSubmissions', { type: 'test' });
			mock.last.query.should.eql({ test: 'true' });
			await run('findSubmissions', { test: 'any' });
			mock.last.query.should.eql({});
			await run('findSubmissions', { test: 'live' });
			mock.last.query.should.eql({ test: 'false' });
			await run('findSubmissions', { type: 'all' }).should.be.rejectedWith('type must be test or live');
		});
	});

	describe('Generate Submission Files', function () {
		it('asks for png images on the sync host and waits', async function () {
			const withImages = submission({ files: { png: { state: 'processed', error_message: null, page_count: 1, pages: [] } } });
			mock.respond(200, withImages);
			(await run('generateSubmissionFiles', { submission_id: 'sub_1' })).should.eql(withImages);
			mock.last.method.should.equal('POST');
			mock.last.url.toString().should.equal(SYNC + '/submissions/sub_1/generate_files?wait=true');
			mock.last.body.should.eql({ formats: ['png'] });
		});

		it("fails when a format's files couldn't be made", async function () {
			mock.respond(200, submission({ files: { png: { state: 'error', error_message: 'Too many pages' } } }));
			await run('generateSubmissionFiles', { submission_id: 'sub_1', formats: ['png'] }).should.be.rejectedWith(
				"The png files couldn't be made (state: error): Too many pages\nSubmission: sub_1",
			);
		});
	});

	it('Expire Submission deletes the submission', async function () {
		mock.respond(200, submission({ expired: true }));
		(await run('expireSubmission', { submission_id: 'sub_1' })).expired.should.be.true();
		mock.last.method.should.equal('DELETE');
		mock.last.url.toString().should.equal(API + '/submissions/sub_1');
	});

	describe('Combine PDFs', function () {
		const combined = (extra) =>
			Object.assign({ id: 'com_1', state: 'processed', error_message: null, files: { pdf: { download_url: 'https://x/com_1.pdf' } } }, extra);

		it('posts each source with only its own properties to /combined_pdfs on the sync host', async function () {
			mock.respond(201, combined());
			const result = await run('combinePdfs', {
				source_pdfs: [
					{ id: 'sub_1', template_version: '1.0.0' },
					{ type: 'combined_submission', id: 'com_0' },
					{ type: 'template', id: 'tpl_1', template_version: 1, processed: 'false' },
					{ type: 'custom_file', id: 'cfi_1' },
					{ type: 'url', url: 'https://example.com/a.pdf', id: 'ignored' },
				],
				metadata: { a: 1 },
				password: 'pw',
				expires_in: 60,
			});
			result.should.eql(combined());
			mock.last.url.toString().should.equal(SYNC + '/combined_pdfs?wait=true');
			mock.last.body.should.eql({
				source_pdfs: [
					{ type: 'submission', id: 'sub_1' },
					{ type: 'combined_pdf', id: 'com_0' },
					{ type: 'template', id: 'tpl_1', template_version: '1', processed: false },
					{ type: 'custom_file', id: 'cfi_1' },
					{ type: 'url', url: 'https://example.com/a.pdf' },
				],
				metadata: { a: 1 },
				password: 'pw',
				expires_in: 60,
			});
		});

		it('fails when the PDFs could not be combined', async function () {
			mock.respond(201, combined({ state: 'error', error_message: 'A source PDF is encrypted', files: {} }));
			await run('combinePdfs', { source_pdfs: [{ id: 'sub_1' }] }).should.be.rejectedWith(
				"The PDFs couldn't be combined (state: error): A source PDF is encrypted\nCombined PDF: com_1",
			);
		});

		it('needs sources, and a url for a url source', async function () {
			await run('combinePdfs', {}).should.be.rejectedWith(/source_pdfs is required/);
			await run('combinePdfs', { source_pdfs: [{ type: 'url', id: 'x' }] }).should.be.rejectedWith('source_pdfs[0].url is required');
		});
	});

	it('Get Combined PDF gets the combined PDF', async function () {
		mock.respond(200, { id: 'com_1' });
		await run('getCombinedPdf', { combined_pdf_id: 'com_1' });
		mock.last.url.toString().should.equal(API + '/combined_pdfs/com_1');
	});

	describe('Create Signature Request', function () {
		it('creates the submission on the standard host, then an email signing link per signature request', async function () {
			const created = submission({
				state: 'waiting_for_signature_requests',
				signature_requests: [signatureRequest('srq_1'), signatureRequest('srq_2', { role: 'Signer 2' })],
			});
			mock.respond(201, created).respond(201, token('srq_1', 'email')).respond(201, token('srq_2', 'email'));
			const result = await run('createSignatureRequest', {
				template_id: 'tpl_1',
				version: 'draft',
				data: { first_name: 'Jane' },
				test: false,
				metadata: { a: 1 },
				expires_in: 600,
				signature_requests: [
					{ name: 'Jane', email: 'jane@example.com', fields: ['signature', 'first_name'], prefilled_values_editable: true },
					{
						email: 'sam@example.com',
						role: 'Signer 2',
						fields: 'signature_2',
						auth_type: 'oauth',
						auth_provider: 'google',
						ignore_unknown_fields: 'true',
						order: 2,
					},
				],
			});

			const [create, link1, link2] = mock.calls;
			create.url.toString().should.equal(API + '/templates/tpl_1/submissions?version=draft');
			create.body.should.eql({
				data: { first_name: 'Jane' },
				metadata: { a: 1 },
				expires_in: 600,
				signature_requests: [
					{
						name: 'Jane',
						email: 'jane@example.com',
						fields: ['signature', 'first_name'],
						auth_type: 'email_link',
						prefilled_values_editable: true,
					},
					{
						email: 'sam@example.com',
						role: 'Signer 2',
						fields: ['signature_2'],
						auth_type: 'oauth',
						auth_provider: 'google',
						ignore_unknown_fields: true,
					},
				],
			});
			link1.url.toString().should.equal(API + '/signature_requests/srq_1/tokens');
			link1.body.should.eql({ type: 'email' });
			link2.url.toString().should.equal(API + '/signature_requests/srq_2/tokens');

			result.state.should.equal('waiting_for_signature_requests');
			result.signature_requests[0].signing_url.should.equal(token('srq_1').signature_request_url);
			result.signature_requests[1].signing_url.should.equal(token('srq_2').signature_request_url);
			result.signature_requests[1].role.should.equal('Signer 2');
			result.first_signature_request_id.should.equal('srq_1');
			result.first_signing_url.should.equal(token('srq_1').signature_request_url);
			result.should.not.have.property('data_requests');
			result.should.not.have.property('first_data_request_id');
		});

		it("takes 0.1.x's data_requests key, and api or no signing links", async function () {
			const created = submission({ signature_requests: [signatureRequest('srq_1')] });
			mock.respond(201, created).respond(201, token('srq_1', 'api')).respond(201, created);
			await run('createSignatureRequest', {
				template_id: 'tpl_1',
				data_requests: [{ email: 'jane@example.com', fields: 'signature' }],
				signing_link_type: 'api',
			});
			mock.calls[0].body.signature_requests.should.eql([
				{ email: 'jane@example.com', fields: ['signature'], auth_type: 'email_link' },
			]);
			mock.calls[1].body.should.eql({ type: 'api' });

			const result = await run('createSignatureRequest', {
				template_id: 'tpl_1',
				signature_requests: [{ email: 'jane@example.com', fields: 'signature' }],
				signing_link_type: 'none',
			});
			mock.calls.length.should.equal(3);
			(result.first_signing_url === null).should.be.true();
			result.first_signature_request_id.should.equal('srq_1');
		});

		it("warns, and carries on, when a signing link can't be created", async function () {
			mock.respond(201, submission({ signature_requests: [signatureRequest('srq_1')] }));
			mock.respond(403, { error: { code: 'forbidden', message: 'A test API token', details: [], request_id: 'req_2' } });
			const warnings = [];
			const result = await run(
				'createSignatureRequest',
				{ template_id: 'tpl_1', signature_requests: [{ email: 'a@example.com', fields: ['signature'] }] },
				{ warn: (m) => warnings.push(m) },
			);
			(result.signature_requests[0].signing_url === null).should.be.true();
			warnings.length.should.equal(1);
			warnings[0].should.startWith("Couldn't create a signing link for signature request srq_1: DocSpring API error 403 forbidden");
		});

		it('needs signers, each with fields, before sending anything', async function () {
			await run('createSignatureRequest', { template_id: 'tpl_1' }).should.be.rejectedWith(/signature_requests is required/);
			await run('createSignatureRequest', {
				template_id: 'tpl_1',
				data_requests: [{ email: 'a@example.com' }],
			}).should.be.rejectedWith(/signature_requests\[0\]\.fields is required/);
			await run('createSignatureRequest', {
				template_id: 'tpl_1',
				signature_requests: [{ fields: 'a' }],
				signing_link_type: 'sms',
			}).should.be.rejectedWith('signing_link_type must be api, email or none');
			mock.calls.length.should.equal(0);
		});
	});

	describe('Create Signing Link', function () {
		it('sends the type in the body and returns the token', async function () {
			mock.respond(201, token('srq_1', 'api'));
			(await run('createSigningLink', { signature_request_id: 'srq_1', type: 'api' })).should.eql(token('srq_1', 'api'));
			mock.last.method.should.equal('POST');
			mock.last.url.toString().should.equal(API + '/signature_requests/srq_1/tokens');
			mock.last.body.should.eql({ type: 'api' });
		});

		it("takes 0.1.x's data_request_id and token_type, and makes email links by default", async function () {
			mock.respond(201, token('drq_1', 'api')).respond(201, token('drq_1', 'email'));
			await run('createSigningLink', { data_request_id: 'drq_1', token_type: 'api' });
			mock.last.url.toString().should.equal(API + '/signature_requests/drq_1/tokens');
			mock.last.body.should.eql({ type: 'api' });
			await run('createSigningLink', { data_request_id: 'drq_1' });
			mock.last.body.should.eql({ type: 'email' });
			await run('createSigningLink', {}).should.be.rejectedWith('signature_request_id is required');
		});
	});

	it("Get Signature Request gets it, also by 0.1.x's data_request_id", async function () {
		mock.respond(200, signatureRequest('srq_1')).respond(200, signatureRequest('drq_1'));
		await run('getSignatureRequest', { signature_request_id: 'srq_1' });
		mock.last.url.toString().should.equal(API + '/signature_requests/srq_1');
		await run('getSignatureRequest', { data_request_id: 'drq_1' });
		mock.last.url.toString().should.equal(API + '/signature_requests/drq_1');
	});

	it('Find Templates returns the page, with query, folder, limit and cursor', async function () {
		const page = { data: [{ id: 'tpl_1', name: 'Demo' }], next_cursor: null };
		mock.respond(200, page);
		(await run('findTemplates', { query: 'Demo', parent_folder_id: 'fld_1', limit: 5, cursor: 'tpl_0' })).should.eql(page);
		mock.last.url.toString().should.equal(API + '/templates?query=Demo&parent_folder_id=fld_1&limit=5&cursor=tpl_0');
	});

	it('Get Template gets the template', async function () {
		mock.respond(200, { id: 'tpl_1' });
		await run('getTemplate', { template_id: 'tpl_1' });
		mock.last.url.toString().should.equal(API + '/templates/tpl_1');
	});

	describe('Create Template', function () {
		const template = (extra) => Object.assign({ id: 'tpl_1', template_type: 'pdf', document: { state: 'processed' } }, extra);

		it('creates a PDF template from a Buffer on the sync host and waits', async function () {
			mock.respond(201, template());
			await run('createTemplate', {
				name: 'Contract',
				template_type: 'pdf',
				parent_folder_id: 'fld_1',
				document_base64: Buffer.from('%PDF-1.7'),
				filename: 'contract.pdf',
				detect_fields: true,
				field_source: 'auto',
				field_naming: 'ai',
				field_logic: 'none',
			});
			mock.last.url.toString().should.equal(SYNC + '/templates?wait=true');
			mock.last.body.should.eql({
				name: 'Contract',
				template_type: 'pdf',
				parent_folder_id: 'fld_1',
				document_base64: Buffer.from('%PDF-1.7').toString('base64'),
				filename: 'contract.pdf',
				detect_fields: true,
				field_source: 'auto',
				field_naming: 'ai',
				field_logic: 'none',
			});
		});

		it('creates an HTML template', async function () {
			mock.respond(201, template({ template_type: 'html', document: null }));
			await run('createTemplate', {
				template_type: 'html',
				name: 'Invoice',
				html: '<p>{{ name }}</p>',
				scss: 'p { color: red; }',
				header_html: '<b>Header</b>',
				footer_html: '<b>Footer</b>',
				wait: false,
			});
			mock.last.query.should.eql({ wait: 'false' });
			mock.last.body.should.eql({
				name: 'Invoice',
				template_type: 'html',
				html: '<p>{{ name }}</p>',
				scss: 'p { color: red; }',
				header_html: '<b>Header</b>',
				footer_html: '<b>Footer</b>',
			});
		});

		it("fails when the template's PDF couldn't be processed, and needs a template_type", async function () {
			mock.respond(201, template({ document: { state: 'malformed_pdf', error_message: "The PDF can't be read." } }));
			await run('createTemplate', { template_type: 'pdf', document_url: 'https://example.com/a.pdf' }).should.be.rejectedWith(
				"The template's PDF couldn't be processed (state: malformed_pdf): The PDF can't be read.\nTemplate: tpl_1",
			);
			await run('createTemplate', { name: 'x' }).should.be.rejectedWith('template_type is required: pdf or html');
		});
	});

	it('Replace Template PDF puts the new PDF on the sync host', async function () {
		mock.respond(200, { id: 'tpl_1', document: { state: 'processed' } });
		await run('replaceTemplatePdf', {
			template_id: 'tpl_1',
			document_url: 'https://example.com/b.pdf',
			reimport_fields: 'true',
		});
		mock.last.method.should.equal('PUT');
		mock.last.url.toString().should.equal(SYNC + '/templates/tpl_1/document?wait=true');
		mock.last.body.should.eql({ document_url: 'https://example.com/b.pdf', reimport_fields: true });
	});

	it('Copy Template sends null for the root, and leaves the folder out to keep it', async function () {
		mock.respond(201, { id: 'tpl_2' }).respond(201, { id: 'tpl_3' });
		await run('copyTemplate', { template_id: 'tpl_1', name: 'Copy', parent_folder_id: null, version: 1 });
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/copy');
		mock.last.body.should.eql({ name: 'Copy', parent_folder_id: null, version: '1' });
		await run('copyTemplate', { template_id: 'tpl_1' });
		mock.last.body.should.eql({});
	});

	it('Move Template moves to a folder or the root, and needs parent_folder_id', async function () {
		mock.respond(200, { id: 'tpl_1' }).respond(200, { id: 'tpl_1' });
		await run('moveTemplate', { template_id: 'tpl_1', parent_folder_id: 'fld_1' });
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/move');
		mock.last.body.should.eql({ parent_folder_id: 'fld_1' });
		await run('moveTemplate', { template_id: 'tpl_1', parent_folder_id: null });
		mock.last.body.should.eql({ parent_folder_id: null });
		await run('moveTemplate', { template_id: 'tpl_1' }).should.be.rejectedWith(/parent_folder_id is required/);
	});

	it('Publish Template Version publishes with the version type', async function () {
		mock.respond(201, { id: 'tpl_1', version: '1.1.0' });
		await run('publishTemplateVersion', { template_id: 'tpl_1', version_type: 'minor', description: 'New fields' });
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/publish_version');
		mock.last.body.should.eql({ version_type: 'minor', description: 'New fields' });
		await run('publishTemplateVersion', { template_id: 'tpl_1' }).should.be.rejectedWith(/version_type is required/);
	});

	it('List, Add, Update and Remove Template Fields', async function () {
		mock.respond(200, { template_id: 'tpl_1', version: null, fields: [] });
		mock.respond(201, { fields: [] }).respond(200, { fields: [] }).respond(200, { fields: [] });
		await run('listTemplateFields', { template_id: 'tpl_1', version: 'draft' });
		mock.last.method.should.equal('GET');
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/fields?version=draft');

		await run('addTemplateFields', { template_id: 'tpl_1', fields: '[{"name":"email","type":"email","page":1}]' });
		mock.last.method.should.equal('POST');
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/fields');
		mock.last.body.should.eql({ fields: [{ name: 'email', type: 'email', page: 1 }] });

		await run('updateTemplateFields', { template_id: 'tpl_1', fields: [{ id: 3, required: true }] });
		mock.last.method.should.equal('PUT');
		mock.last.body.should.eql({ fields: [{ id: 3, required: true }] });

		await run('removeTemplateFields', { template_id: 'tpl_1', field_ids: '3, 4' });
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/fields/remove');
		mock.last.body.should.eql({ field_ids: [3, 4] });

		await run('addTemplateFields', { template_id: 'tpl_1' }).should.be.rejectedWith(/fields is required/);
		await run('removeTemplateFields', { template_id: 'tpl_1' }).should.be.rejectedWith(/field_ids is required/);
	});

	it('Get Template Page Images gets the images of a version', async function () {
		mock.respond(200, { template_id: 'tpl_1', pages: [] });
		await run('getTemplatePageImages', { template_id: 'tpl_1', version: '1.0.0' });
		mock.last.url.toString().should.equal(API + '/templates/tpl_1/page_images?version=1.0.0');
	});

	it('List Folders and Create Folder', async function () {
		mock.respond(200, { data: [], next_cursor: null }).respond(201, { id: 'fld_2' }).respond(201, { id: 'fld_3' });
		await run('listFolders', { parent_folder_id: 'fld_1', limit: 100 });
		mock.last.url.toString().should.equal(API + '/folders?parent_folder_id=fld_1&limit=100');
		await run('createFolder', { name: 'Contracts', parent_folder_id: 'fld_1' });
		mock.last.method.should.equal('POST');
		mock.last.url.toString().should.equal(API + '/folders');
		mock.last.body.should.eql({ name: 'Contracts', parent_folder_id: 'fld_1' });
		await run('createFolder', { name: 'Root folder' });
		mock.last.body.should.eql({ name: 'Root folder' });
		await run('createFolder', {}).should.be.rejectedWith('name is required');
	});

	describe('Make an API Call', function () {
		it('calls any v2 path with the method, query and JSON body', async function () {
			mock.respond(200, { id: 'tpl_1' }).respond(200, { data: [] });
			const result = await run('apiCall', {
				method: 'put',
				path: 'templates/tpl_1',
				query: { a: 1, b: true },
				body: '{"name":"Renamed"}',
			});
			result.should.eql({ id: 'tpl_1' });
			mock.last.method.should.equal('PUT');
			mock.last.url.toString().should.equal(API + '/templates/tpl_1?a=1&b=true');
			mock.last.body.should.eql({ name: 'Renamed' });

			await run('apiCall', { path: '/api/v2/custom_files' });
			mock.last.method.should.equal('GET');
			mock.last.url.toString().should.equal(API + '/custom_files');
		});

		it('only calls API v2 paths on the connection host', async function () {
			await run('apiCall', { path: '/api/v1/templates' }).should.be.rejectedWith(/relative to \/api\/v2/);
			await run('apiCall', { path: 'https://example.com/x' }).should.be.rejectedWith(/relative to \/api\/v2/);
			await run('apiCall', { path: '/templates/../../v1/templates' }).should.be.rejectedWith(/relative to \/api\/v2/);
			await run('apiCall', { method: 'PATCH', path: '/templates' }).should.be.rejectedWith(/method must be/);
			await run('apiCall', { path: '/templates', body: { a: 1 } }).should.be.rejectedWith(/GET request can't have a body/);
			await run('apiCall', {}).should.be.rejectedWith('path is required');
			mock.calls.length.should.equal(0);
		});

		it('throws v2 errors like the other operations', async function () {
			mock.respond(404, { error: { code: 'not_found', message: 'No such template', details: [], request_id: 'req_3' } });
			await run('apiCall', { path: '/templates/tpl_x' }).should.be.rejectedWith(
				'DocSpring API error 404 not_found: No such template\nRequest ID: req_3',
			);
		});
	});
});
