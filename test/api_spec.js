'use strict';

require('should');
const { MockFetch } = require('./support/mock_fetch');
const { docSpringRequest, formatApiError } = require('../lib/docspring');
const I = require('../lib/inputs');
const { version } = require('../package.json');

const US = { region: 'us', tokenId: 'api_test_id', tokenSecret: 'secret' };

describe('DocSpring API v2 requests', function () {
	const mock = new MockFetch();
	before(() => mock.install());
	after(() => mock.restore());
	afterEach(function () {
		mock.assertDone();
		mock.reset();
	});

	it('calls /api/v2 on the standard host with Basic auth, JSON and the User-Agent', async function () {
		mock.respond(200, { authenticated: true });
		const result = await docSpringRequest(US, 'GET', '/authentication');
		result.should.eql({ authenticated: true });
		const call = mock.last;
		call.method.should.equal('GET');
		call.url.toString().should.equal('https://api.docspring.com/api/v2/authentication');
		call.headers.Authorization.should.equal('Basic ' + Buffer.from('api_test_id:secret').toString('base64'));
		call.headers.Accept.should.equal('application/json');
		call.headers['User-Agent'].should.equal('docspring-node-red/' + version);
		call.headers.should.not.have.property('Content-Type');
	});

	it('uses the sync hosts for the US and EU, and the custom host for both when self-hosted', async function () {
		mock.respond(200, {}).respond(200, {}).respond(200, {}).respond(200, {}).respond(200, {});
		await docSpringRequest(US, 'GET', '/x', { sync: true });
		await docSpringRequest(Object.assign({}, US, { region: 'eu' }), 'GET', '/x');
		await docSpringRequest(Object.assign({}, US, { region: 'eu' }), 'GET', '/x', { sync: true });
		const selfHosted = Object.assign({}, US, { region: 'self_hosted', customHost: 'docspring.example.com/' });
		await docSpringRequest(selfHosted, 'GET', '/x');
		await docSpringRequest(selfHosted, 'GET', '/x', { sync: true });
		mock.calls
			.map((c) => c.url.toString())
			.should.eql([
				'https://sync.api.docspring.com/api/v2/x',
				'https://api-eu.docspring.com/api/v2/x',
				'https://sync.api-eu.docspring.com/api/v2/x',
				'https://docspring.example.com/api/v2/x',
				'https://docspring.example.com/api/v2/x',
			]);
	});

	it('sends JSON bodies and leaves empty query values out', async function () {
		mock.respond(201, { id: 'x' });
		await docSpringRequest(US, 'POST', '/things', {
			body: { a: 1 },
			qs: { wait: true, test: false, version: undefined, cursor: null, query: '' },
		});
		mock.last.headers['Content-Type'].should.equal('application/json');
		mock.last.body.should.eql({ a: 1 });
		mock.last.query.should.eql({ wait: 'true', test: 'false' });
	});

	it('formats a v2 error with its code, details, record ID and request ID', async function () {
		mock.respond(422, {
			error: {
				code: 'invalid_data',
				message: "The data doesn't match the template's fields: /data/last_name is required",
				details: [
					{ code: 'required', message: 'is required', pointer: '/data/last_name' },
					{ code: 'type', message: 'must be an integer', parameter: 'limit' },
					{ code: 'other', message: 'is not allowed here', pointer: '' },
				],
				request_id: 'req_1',
				submission_id: 'sub_1',
			},
		});
		const err = await docSpringRequest(US, 'POST', '/x', { body: {} }).should.be.rejected();
		err.message.should.equal(
			[
				"DocSpring API error 422 invalid_data: The data doesn't match the template's fields: /data/last_name is required",
				'/data/last_name: is required',
				'limit: must be an integer',
				'is not allowed here',
				'Submission: sub_1',
				'Request ID: req_1',
			].join('\n'),
		);
		err.message.should.not.containEql('[object Object]');
		err.statusCode.should.equal(422);
		err.code.should.equal('invalid_data');
	});

	it('names the other record IDs a v2 error can have', function () {
		const body = (extra) => ({ error: Object.assign({ code: 'c', message: 'm', details: [], request_id: null }, extra) });
		formatApiError(402, body({ submission_batch_id: 'sbb_1' })).should.equal(
			'DocSpring API error 402 c: m\nSubmission batch: sbb_1',
		);
		formatApiError(402, body({ combined_pdf_id: 'com_1' })).should.equal('DocSpring API error 402 c: m\nCombined PDF: com_1');
	});

	it('says how to get a PDF that was not ready in time (504 polling_timeout)', function () {
		const timeout = (extra) => ({
			error: Object.assign({ code: 'polling_timeout', message: 'Timed out', details: [], request_id: 'req_9' }, extra),
		});
		formatApiError(504, timeout({ submission_id: 'sub_1' })).should.equal(
			"The PDF wasn't ready in time. Get it later with Get Submission (sub_1).\nRequest ID: req_9",
		);
		formatApiError(504, timeout({ submission_batch_id: 'sbb_1' })).should.startWith(
			"The PDF wasn't ready in time. Get it later with Get Submission Batch (sbb_1).",
		);
		formatApiError(504, timeout({ combined_pdf_id: 'com_1' })).should.startWith(
			"The PDF wasn't ready in time. Get it later with Get Combined PDF (com_1).",
		);
		formatApiError(504, timeout({ template_id: 'tpl_1' })).should.startWith(
			"The PDF wasn't ready in time. Get it later with Get Template (tpl_1).",
		);
	});

	it('formats errors that are not v2 errors without [object Object]', async function () {
		mock.respond(502, '<html>Bad gateway</html>').respond(404, { error: 'Not found' }).respond(500, {});
		(await docSpringRequest(US, 'GET', '/x').should.be.rejected()).message.should.equal(
			'DocSpring API error 502: <html>Bad gateway</html>',
		);
		(await docSpringRequest(US, 'GET', '/x').should.be.rejected()).message.should.equal(
			'DocSpring API error 404: Not found',
		);
		(await docSpringRequest(US, 'GET', '/x').should.be.rejected()).message.should.equal('DocSpring API error 500');
	});

	it('says which host it could not reach', async function () {
		mock.fail(new Error('getaddrinfo ENOTFOUND api.docspring.com'));
		const err = await docSpringRequest(US, 'GET', '/x').should.be.rejected();
		err.message.should.equal("Couldn't reach DocSpring at https://api.docspring.com: getaddrinfo ENOTFOUND api.docspring.com");
	});

	it('needs a host for the self-hosted region', async function () {
		await docSpringRequest(Object.assign({}, US, { region: 'self_hosted' }), 'GET', '/x').should.be.rejectedWith(
			/Self-Hosted Host is required/,
		);
	});
});

describe('Payload values', function () {
	it('converts true/false and whole numbers from strings, and rejects what it cannot convert', function () {
		I.toBoolean('test', 'TRUE').should.equal(true);
		I.toBoolean('test', ' false ').should.equal(false);
		I.toBoolean('test', false).should.equal(false);
		(I.toBoolean('test', '') === undefined).should.be.true();
		(() => I.toBoolean('test', 'yes')).should.throw('test must be true or false');
		(() => I.toBoolean('test', 1)).should.throw('test must be true or false');
		I.toInteger('expires_in', '3600').should.equal(3600);
		I.toInteger('expires_in', 60).should.equal(60);
		(() => I.toInteger('expires_in', '1.5')).should.throw('expires_in must be a whole number');
		(() => I.toInteger('expires_in', 1.5)).should.throw('expires_in must be a whole number');
	});

	it('takes objects and lists as JSON strings, and names the key it rejects', function () {
		I.toObject('data', '{"a":1}').should.eql({ a: 1 });
		(() => I.toObject('data', '[1]')).should.throw('data must be an object (or a JSON string of one)');
		(() => I.toObject('data', '{oops')).should.throw('data must be an object (or a JSON string of one)');
		I.toArray('fields', '[{"name":"a"}]').should.eql([{ name: 'a' }]);
		I.toNameList('fields', 'first_name, last_name\nsignature').should.eql(['first_name', 'last_name', 'signature']);
		I.toNameList('fields', [' a ', '', 'b']).should.eql(['a', 'b']);
		(I.toNameList('fields', ' , ') === undefined).should.be.true();
		I.toIntegerList('field_ids', '1, 2').should.eql([1, 2]);
		(() => I.toIntegerList('field_ids', 'a')).should.throw('field_ids[0] must be a whole number');
	});

	it('encodes a Buffer as base64 and a Date as RFC 3339', function () {
		I.toBase64('document_base64', Buffer.from('%PDF-1.7')).should.equal(Buffer.from('%PDF-1.7').toString('base64'));
		I.toTime('created_after', new Date('2026-01-31T09:00:00Z')).should.equal('2026-01-31T09:00:00.000Z');
	});
});
