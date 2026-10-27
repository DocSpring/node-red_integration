'use strict';

const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/docspring-config.js');
const docspringNode = require('../nodes/docspring.js');
const catchNode = require('@node-red/nodes/core/common/25-catch.js');
const { MockFetch } = require('./support/mock_fetch');

helper.init(require.resolve('node-red'));

const creds = { c1: { tokenId: 'api_test_id', tokenSecret: 'secret' } };

function flow(operation) {
	return [
		{ id: 'c1', type: 'docspring-config', name: 'test', region: 'us' },
		{ id: 'n1', type: 'docspring', name: 't', operation, server: 'c1', wires: [['n2']] },
		{ id: 'n2', type: 'helper' },
	];
}

// Loads the flow, sends msg into the DocSpring node, and resolves with what it sent on
// (or rejects with the error it reported).
function runNode(operation, msg) {
	return new Promise((resolve, reject) => {
		helper.load([configNode, docspringNode], flow(operation), creds, function () {
			const n1 = helper.getNode('n1');
			const n2 = helper.getNode('n2');
			n2.on('input', resolve);
			n1.on('call:error', (call) => reject(call.firstArg));
			n1.receive(msg);
		});
	});
}

const processed = {
	id: 'sub_1',
	state: 'processed',
	signature_requests: [],
	files: { pdf: { state: 'processed', download_url: 'https://downloads.docspring.com/store/sub_1.pdf' } },
};

describe('DocSpring nodes', function () {
	const mock = new MockFetch();

	before(function (done) {
		mock.install();
		helper.startServer(done);
	});
	after(function (done) {
		mock.restore();
		helper.stopServer(done);
	});
	afterEach(function () {
		helper.unload();
		mock.assertDone();
		mock.reset();
	});

	it('loads the config and action nodes', function (done) {
		helper.load([configNode, docspringNode], flow('findTemplates'), creds, function () {
			try {
				helper.getNode('n1').should.have.property('type', 'docspring');
				helper.getNode('c1').should.have.property('region', 'us');
				done();
			} catch (e) {
				done(e);
			}
		});
	});

	it('errors (to a Catch) when the operation is unknown', async function () {
		const err = await runNode('nope', { payload: {} }).should.be.rejected();
		err.message.should.equal('Unknown DocSpring operation: nope');
	});

	it('runs the operation with msg.payload and writes the v2 response to msg.payload', async function () {
		mock.respond(201, processed);
		const msg = await runNode('generatePdf', { payload: { template_id: 'tpl_1', data: { first_name: 'Jane' } }, topic: 't' });
		msg.payload.files.pdf.download_url.should.equal('https://downloads.docspring.com/store/sub_1.pdf');
		msg.payload.should.not.have.property('download_url');
		msg.topic.should.equal('t');
		mock.last.url.toString().should.equal('https://sync.api.docspring.com/api/v2/templates/tpl_1/submissions?wait=true');
	});

	it('runs a saved 0.1.x createDataRequest node as Create Signature Request', async function () {
		mock.respond(201, Object.assign({}, processed, { signature_requests: [{ id: 'srq_1', state: 'pending' }] }));
		mock.respond(201, { id: 'tok_1', signature_request_url: 'https://app.docspring.com/sign/srq_1' });
		const msg = await runNode('createDataRequest', {
			payload: { template_id: 'tpl_1', data_requests: [{ email: 'jane@example.com', fields: 'signature' }] },
		});
		mock.calls[0].body.signature_requests.should.eql([
			{ email: 'jane@example.com', fields: ['signature'], auth_type: 'email_link' },
		]);
		msg.payload.first_signature_request_id.should.equal('srq_1');
		msg.payload.first_signing_url.should.equal('https://app.docspring.com/sign/srq_1');
	});

	it('takes the operation from msg.operation, old values included', async function () {
		mock.respond(200, { data: [], next_cursor: null });
		const msg = await runNode('generatePdf', { operation: 'findTemplate', payload: { query: 'Demo' } });
		msg.payload.should.eql({ data: [], next_cursor: null });
		mock.last.url.toString().should.equal('https://api.docspring.com/api/v2/templates?query=Demo');
	});

	it('runs a saved 0.1.x findSubmission node as Get Submission or Find Submissions', async function () {
		mock.respond(200, processed).respond(200, { data: [processed], next_cursor: null });
		(await runNode('findSubmission', { payload: { submission_id: 'sub_1' } })).payload.should.eql(processed);
		mock.last.url.toString().should.equal('https://api.docspring.com/api/v2/submissions/sub_1');
		await helper.unload();
		(await runNode('findSubmission', { payload: { type: 'test', limit: 5 } })).payload.data.length.should.equal(1);
		mock.last.url.toString().should.equal('https://api.docspring.com/api/v2/submissions?test=true&limit=5');
	});

	it("sends DocSpring's error, with its code, to a Catch node", async function () {
		mock.respond(422, {
			error: {
				code: 'invalid_data',
				message: "The data doesn't match the template's fields: /data/last_name is required",
				details: [{ code: 'required', message: 'is required', pointer: '/data/last_name' }],
				request_id: 'req_1',
				submission_id: 'sub_9',
			},
		});
		const statuses = [];
		const withCatch = flow('generatePdf').concat([
			{ id: 'catch1', type: 'catch', scope: null, wires: [['n3']] },
			{ id: 'n3', type: 'helper' },
		]);
		const caught = await new Promise((resolve) => {
			helper.load([configNode, docspringNode, catchNode], withCatch, creds, function () {
				const n1 = helper.getNode('n1');
				n1.on('call:status', (call) => statuses.push(call.firstArg));
				helper.getNode('n3').on('input', resolve);
				n1.receive({ payload: { template_id: 'tpl_1', data: {} } });
			});
		});
		caught.error.message.should.equal(
			"Error: DocSpring API error 422 invalid_data: The data doesn't match the template's fields: /data/last_name is required\n" +
				'/data/last_name: is required\nSubmission: sub_9\nRequest ID: req_1',
		);
		caught.error.code.should.equal('invalid_data');
		caught.payload.should.eql({ template_id: 'tpl_1', data: {} });
		statuses[statuses.length - 1].should.eql({ fill: 'red', shape: 'ring', text: 'HTTP 422 invalid_data' });
	});

	it("warns when a signing link can't be created, and still sends the submission on", async function () {
		mock.respond(201, Object.assign({}, processed, { signature_requests: [{ id: 'srq_1', state: 'pending' }] }));
		mock.respond(409, { error: { code: 'conflict', message: 'Finished', details: [], request_id: 'req_2' } });
		const warnings = [];
		const msg = await new Promise((resolve, reject) => {
			helper.load([configNode, docspringNode], flow('createSignatureRequest'), creds, function () {
				const n1 = helper.getNode('n1');
				n1.on('call:warn', (call) => warnings.push(call.firstArg));
				n1.on('call:error', (call) => reject(call.firstArg));
				helper.getNode('n2').on('input', resolve);
				n1.receive({
					payload: { template_id: 'tpl_1', signature_requests: [{ email: 'jane@example.com', fields: ['signature'] }] },
				});
			});
		});
		(msg.payload.first_signing_url === null).should.be.true();
		warnings.length.should.equal(1);
		warnings[0].should.startWith("Couldn't create a signing link for signature request srq_1");
	});

	it('errors when the connection has no credentials', async function () {
		const err = await new Promise((resolve) => {
			helper.load([configNode, docspringNode], flow('getSubmission'), {}, function () {
				const n1 = helper.getNode('n1');
				n1.on('call:error', (call) => resolve(call.firstArg));
				n1.receive({ payload: { submission_id: 'sub_1' } });
			});
		});
		err.message.should.equal('DocSpring connection is not configured (set the credential).');
	});
});
