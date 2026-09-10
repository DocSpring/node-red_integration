'use strict';

// Region → API host. `sync` selects the low-latency host used for synchronous PDF
// generation (Generate PDF / Combine PDFs with ?wait=true). Self-hosted installs use
// a single custom origin for both.
function resolveBaseUrl(region, customHost, sync) {
	region = (region || 'us').toLowerCase();

	if (region === 'self_hosted') {
		const host = (customHost || '').trim();
		if (!host) {
			throw new Error(
				'A Self-Hosted Host is required for the Self-Hosted / Enterprise region ' +
					'(e.g. https://docspring.example.com).',
			);
		}
		return host.includes('://') ? host : 'https://' + host;
	}

	const hosts = {
		us: { host: 'api.docspring.com', sync: 'sync.api.docspring.com' },
		eu: { host: 'api-eu.docspring.com', sync: 'sync.api-eu.docspring.com' },
	};
	const entry = hosts[region] || hosts.us;
	return 'https://' + (sync ? entry.sync : entry.host);
}

module.exports = { resolveBaseUrl };
