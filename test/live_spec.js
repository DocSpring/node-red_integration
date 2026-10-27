'use strict';

// Runs against the live DocSpring API with a test API token, only when DOCSPRING_TOKEN_ID
// and DOCSPRING_TOKEN_SECRET are set (see .env.example). Skipped otherwise.

const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/docspring-config.js');
const docspringNode = require('../nodes/docspring.js');

helper.init(require.resolve('node-red'));

const HAS_CREDS = !!(process.env.DOCSPRING_TOKEN_ID && process.env.DOCSPRING_TOKEN_SECRET);
const creds = {
	c1: {
		tokenId: process.env.DOCSPRING_TOKEN_ID,
		tokenSecret: process.env.DOCSPRING_TOKEN_SECRET,
	},
};
const REGION = process.env.DOCSPRING_REGION || 'us';
const TEMPLATE = 'tpl_ZFjT3TMsEmHqh4QLch';

function runLive(operation, payload) {
	const flow = [
		{ id: 'c1', type: 'docspring-config', name: 'test', region: REGION },
		{ id: 'n1', type: 'docspring', name: 't', operation, server: 'c1', wires: [['n2']] },
		{ id: 'n2', type: 'helper' },
	];
	return new Promise((resolve, reject) => {
		helper.load([configNode, docspringNode], flow, creds, function () {
			helper.getNode('n2').on('input', resolve);
			helper.getNode('n1').on('call:error', (call) => reject(call.firstArg));
			helper.getNode('n1').receive({ payload });
		});
	});
}

(HAS_CREDS ? describe : describe.skip)('DocSpring nodes against the live API', function () {
	this.timeout(60000);

	before(function (done) {
		helper.startServer(done);
	});
	after(function (done) {
		helper.stopServer(done);
	});
	afterEach(function () {
		helper.unload();
	});

	it('runs Find Templates', async function () {
		const msg = await runLive('findTemplates', { query: 'Demo', limit: 5 });
		msg.payload.data.should.be.an.Array();
		msg.payload.should.have.property('next_cursor');
	});

	it('generates a test PDF', async function () {
		const msg = await runLive('generatePdf', {
			template_id: TEMPLATE,
			data: { first_name: 'Node', last_name: 'RED', favorite_color: 'green' },
			test: true,
		});
		msg.payload.should.have.property('state', 'processed');
		msg.payload.files.pdf.download_url.should.be.a.String();
	});
});
