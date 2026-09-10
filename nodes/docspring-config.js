module.exports = function (RED) {
	'use strict';

	// Config node holding the DocSpring connection: region + custom host (non-secret)
	// and the API token id/secret (stored encrypted as Node-RED credentials).
	function DocSpringConfigNode(n) {
		RED.nodes.createNode(this, n);
		this.name = n.name;
		this.region = n.region || 'us';
		this.customHost = n.customHost || '';
	}

	RED.nodes.registerType('docspring-config', DocSpringConfigNode, {
		credentials: {
			tokenId: { type: 'text' },
			tokenSecret: { type: 'password' },
		},
	});

	// Admin endpoint for the "Test connection" button in the config editor.
	// Hits GET /authentication with the entered (or already-saved) credentials.
	RED.httpAdmin.post(
		'/docspring-config/:id/test',
		RED.auth.needsPermission('docspring-config.read'),
		function (req, res) {
			const { resolveBaseUrl } = require('../lib/regions');
			const body = req.body || {};
			const node = RED.nodes.getNode(req.params.id);

			const tokenId = body.tokenId || (node && node.credentials && node.credentials.tokenId);
			const tokenSecret =
				body.tokenSecret || (node && node.credentials && node.credentials.tokenSecret);
			const region = body.region || (node && node.region) || 'us';
			const customHost = body.customHost || (node && node.customHost) || '';

			if (!tokenId || !tokenSecret) {
				res.json({ ok: false, message: 'Enter a Token ID and Token Secret first.' });
				return;
			}

			let baseUrl;
			try {
				baseUrl = resolveBaseUrl(region, customHost, false);
			} catch (e) {
				res.json({ ok: false, message: e.message });
				return;
			}

			const headers = {
				Authorization: 'Basic ' + Buffer.from(tokenId + ':' + tokenSecret).toString('base64'),
				Accept: 'application/json',
			};
			fetch(baseUrl + '/api/v1/authentication', { headers })
				.then((r) => r.json().then((d) => ({ status: r.status, d })))
				.then(({ status, d }) => {
					if (status === 200 && d && d.status === 'success') {
						res.json({ ok: true, message: 'Connection successful.' });
					} else {
						res.json({
							ok: false,
							message: '[' + status + '] Invalid DocSpring API token. Check your ID, secret, and region.',
						});
					}
				})
				.catch((err) => res.json({ ok: false, message: err.message }));
		},
	);
};
