export interface DecodeResult {
	status: boolean;
	decodedUrl?: string;
	method?: 'base64' | 'api';
	message?: string;
}

export type HttpRequestFn = (options: {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string;
}) => Promise<string>;

/**
 * Extract the base64-encoded article ID from a Google News URL.
 */
export function extractBase64FromUrl(sourceUrl: string): string | null {
	try {
		const url = new URL(sourceUrl);
		if (url.hostname !== 'news.google.com') return null;

		const pathParts = url.pathname.split('/');
		const articleIndex = pathParts.findIndex(
			(p) => p === 'articles' || p === 'read',
		);
		if (articleIndex === -1 || articleIndex + 1 >= pathParts.length) return null;

		return pathParts[articleIndex + 1];
	} catch {
		return null;
	}
}

/**
 * Try to decode the URL directly from the base64 payload (old format).
 * Old-format Google News URLs embed the article URL directly in protobuf field 2.
 */
export function tryDirectDecode(base64Str: string): string | null {
	try {
		const buf = Buffer.from(base64Str, 'base64');
		const str = buf.toString('utf8');

		// Look for an http URL in the decoded bytes
		const httpIdx = str.indexOf('http');
		if (httpIdx === -1) return null;

		// Extract the URL - it runs until we hit a non-URL character
		const urlCandidate = str.substring(httpIdx);
		// URL ends at first control char or non-printable
		const match = urlCandidate.match(/^https?:\/\/[^\x00-\x1f\x7f]+/);
		if (!match) return null;

		// Validate it's a real URL
		try {
			new URL(match[0]);
			return match[0];
		} catch {
			return null;
		}
	} catch {
		return null;
	}
}

/**
 * Extract signature and timestamp from Google News article page HTML.
 */
function extractDecodingParams(html: string): {
	signature: string;
	timestamp: string;
} | null {
	// Look for data-n-a-sg and data-n-a-ts attributes
	const sigMatch = html.match(/data-n-a-sg="([^"]+)"/);
	const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);

	if (!sigMatch || !tsMatch) return null;

	return {
		signature: sigMatch[1],
		timestamp: tsMatch[1],
	};
}

/**
 * Decode a Google News URL using Google's batchexecute API.
 * This is the primary method that works for both old and new format URLs.
 *
 * Steps:
 * 1. Fetch the article page to get signing parameters (signature + timestamp)
 * 2. POST to Google's batchexecute API with those params to get the real URL
 */
export async function decodeViaApi(
	base64Str: string,
	httpRequest: HttpRequestFn,
): Promise<string | null> {
	// Step 1: Fetch the article page to get data-n-a-sg and data-n-a-ts
	let params: { signature: string; timestamp: string } | null = null;

	// Try /articles/ first, then /rss/articles/
	for (const prefix of ['articles', 'rss/articles']) {
		try {
			const html = await httpRequest({
				method: 'GET',
				url: `https://news.google.com/${prefix}/${base64Str}`,
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
				},
			});
			params = extractDecodingParams(html);
			if (params) break;
		} catch {
			continue;
		}
	}

	if (!params) return null;

	// Step 2: Call batchexecute API
	const payload = [
		'Fbv4je',
		`["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${params.timestamp},"${params.signature}"]`,
	];

	const body = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

	const response = await httpRequest({
		method: 'POST',
		url: 'https://news.google.com/_/DotsSplashUi/data/batchexecute',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		},
		body,
	});

	// Parse the response - format is two sections separated by \n\n
	const sections = response.split('\n\n');
	if (sections.length < 2) return null;

	const data = JSON.parse(sections[1]);
	const decodedUrl = JSON.parse(data[0][2])[1];

	if (typeof decodedUrl === 'string' && decodedUrl.startsWith('http')) {
		return decodedUrl;
	}

	return null;
}

/**
 * Decode a Google News URL to its original article URL.
 *
 * Tries direct base64 decoding first (old format), then falls back to
 * Google's batchexecute API (new format).
 */
export async function decodeGoogleNewsUrl(
	sourceUrl: string,
	httpRequest: HttpRequestFn,
): Promise<DecodeResult> {
	const base64Str = extractBase64FromUrl(sourceUrl);
	if (!base64Str) {
		return { status: false, message: 'Invalid Google News URL format.' };
	}

	// Try direct base64 decode first (fast, no network)
	const directUrl = tryDirectDecode(base64Str);
	if (directUrl) {
		return { status: true, decodedUrl: directUrl, method: 'base64' };
	}

	// Fall back to API-based decoding
	try {
		const apiUrl = await decodeViaApi(base64Str, httpRequest);
		if (apiUrl) {
			return { status: true, decodedUrl: apiUrl, method: 'api' };
		}
		return {
			status: false,
			message: 'Failed to decode URL via API. Could not extract parameters from Google News page.',
		};
	} catch (error) {
		return {
			status: false,
			message: `API decode error: ${(error as Error).message}`,
		};
	}
}
