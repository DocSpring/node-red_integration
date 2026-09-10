module.exports = function (RED) {
	'use strict';

	const { OPERATIONS, OPERATION_LABELS } = require('../lib/operations');

	// One action node with an Operation selector. Request parameters come from
	// msg.payload (or msg.operation overrides the configured operation); the API
	// response is written back to msg.payload.
	function DocSpringNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;
		node.operation = config.operation;
		node.server = RED.nodes.getNode(config.server);

		node.on('input', function (msg, send, done) {
			send =
				send ||
				function () {
					node.send.apply(node, arguments);
				};
			const fail = function (err) {
				node.status({ fill: 'red', shape: 'ring', text: String(err.message || err).slice(0, 20) });
				if (done) done(err);
				else node.error(err, msg);
			};

			const operation = msg.operation || node.operation;
			const handler = OPERATIONS[operation];
			if (!handler) {
				fail(new Error('Unknown DocSpring operation: ' + operation));
				return;
			}
			if (!node.server || !node.server.credentials || !node.server.credentials.tokenId) {
				fail(new Error('DocSpring connection is not configured (set the credential).'));
				return;
			}

			const conn = {
				region: node.server.region,
				customHost: node.server.customHost,
				tokenId: node.server.credentials.tokenId,
				tokenSecret: node.server.credentials.tokenSecret,
			};
			const params =
				msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
					? msg.payload
					: {};

			node.status({ fill: 'blue', shape: 'dot', text: OPERATION_LABELS[operation] || operation });
			Promise.resolve(handler(conn, params))
				.then(function (result) {
					msg.payload = result;
					node.status({ fill: 'green', shape: 'dot', text: 'done' });
					send(msg);
					if (done) done();
				})
				.catch(fail);
		});

		node.on('close', function () {
			node.status({});
		});
	}

	RED.nodes.registerType('docspring', DocSpringNode);
};
