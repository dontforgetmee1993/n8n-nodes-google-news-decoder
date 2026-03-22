import { extractBase64FromUrl, tryDirectDecode, decodeGoogleNewsUrl } from '../nodes/GoogleNewsDecode/utils/decoder';

describe('extractBase64FromUrl', () => {
	it('should extract base64 from /rss/articles/ URL', () => {
		const url = 'https://news.google.com/rss/articles/CBMiXXXX?oc=5';
		expect(extractBase64FromUrl(url)).toBe('CBMiXXXX');
	});

	it('should extract base64 from /articles/ URL', () => {
		const url = 'https://news.google.com/articles/CBMiXXXX?oc=5';
		expect(extractBase64FromUrl(url)).toBe('CBMiXXXX');
	});

	it('should extract base64 from /read/ URL', () => {
		const url = 'https://news.google.com/read/CBMiXXXX';
		expect(extractBase64FromUrl(url)).toBe('CBMiXXXX');
	});

	it('should return null for non-Google News URL', () => {
		expect(extractBase64FromUrl('https://example.com/articles/CBMiXXXX')).toBeNull();
	});

	it('should return null for invalid URL', () => {
		expect(extractBase64FromUrl('not-a-url')).toBeNull();
	});

	it('should return null for Google News URL without article path', () => {
		expect(extractBase64FromUrl('https://news.google.com/')).toBeNull();
	});
});

describe('tryDirectDecode', () => {
	it('should decode old-format URLs with embedded http link', () => {
		// Create a fake old-format payload: protobuf field 1 (varint) + field 2 (string with URL)
		const url = 'https://example.com/article/123';
		// Build a simple protobuf-like structure
		const urlBuf = Buffer.from(url, 'utf8');
		const header = Buffer.from([0x08, 0x13, 0x22, urlBuf.length]);
		const fullBuf = Buffer.concat([header, urlBuf]);
		const base64 = fullBuf.toString('base64');

		expect(tryDirectDecode(base64)).toBe(url);
	});

	it('should return null for new-format encoded payloads', () => {
		// The example URL from the user - this is new format (no direct URL)
		const base64 = 'CBMipwFBVV95cUxNbi1yOHRaeUxfaEsybERxemxZYU9zYzhxU18zaHpsc1R4MDVfZ0F1RDNiVWhtTVR4NXZkVk5jblBRU3ZIeUJHOHJLUldMMF9vNUZHRm1UTTN3UENpZmJ5UC1kTnFsejdDMXlzSC1yZV8zYjVXcUZ6ZnFPYXQ2WUs1bEJyT09KYUUzRkt3Ulo0aDIyYWx6dUhqeDdUTXdSSEl1d3g5d2dvaw';
		expect(tryDirectDecode(base64)).toBeNull();
	});

	it('should return null for invalid base64', () => {
		expect(tryDirectDecode('!!!invalid!!!')).toBeNull();
	});
});

describe('decodeGoogleNewsUrl', () => {
	it('should return error for invalid URL', async () => {
		const mockHttp = jest.fn();
		const result = await decodeGoogleNewsUrl('https://example.com', mockHttp);
		expect(result.status).toBe(false);
		expect(result.message).toContain('Invalid Google News URL');
		expect(mockHttp).not.toHaveBeenCalled();
	});

	it('should decode old-format URL without network calls', async () => {
		const url = 'https://example.com/article/test';
		const urlBuf = Buffer.from(url, 'utf8');
		const header = Buffer.from([0x08, 0x13, 0x22, urlBuf.length]);
		const fullBuf = Buffer.concat([header, urlBuf]);
		const base64 = fullBuf.toString('base64');

		const googleUrl = `https://news.google.com/rss/articles/${base64}?oc=5`;
		const mockHttp = jest.fn();

		const result = await decodeGoogleNewsUrl(googleUrl, mockHttp);
		expect(result.status).toBe(true);
		expect(result.decodedUrl).toBe(url);
		expect(result.method).toBe('base64');
		expect(mockHttp).not.toHaveBeenCalled();
	});

	it('should fall back to API for new-format URLs', async () => {
		const base64 = 'CBMipwFBVV95cUxNbi1yOHRaeUxfaEsybERxemxZYU9zYzhxU18zaHpsc1R4MDVfZ0F1RDNiVWhtTVR4NXZkVk5jblBRU3ZIeUJHOHJLUldMMF9vNUZHRm1UTTN3UENpZmJ5UC1kTnFsejdDMXlzSC1yZV8zYjVXcUZ6ZnFPYXQ2WUs1bEJyT09KYUUzRkt3Ulo0aDIyYWx6dUhqeDdUTXdSSEl1d3g5d2dvaw';
		const googleUrl = `https://news.google.com/rss/articles/${base64}?oc=5`;
		const expectedUrl = 'https://vtcnews.vn/hezbollah-phuc-kich-du-doi-nhieu-xe-tang-merkava-cua-israel-bi-pha-huy-ar1008899.html';

		const batchResponse = `)]}'\n\n` + JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', expectedUrl, 1]), null, null, null, ''], ['di', 20]]);

		const mockHttp = jest.fn()
			// First call: GET article page -> returns HTML with data attributes
			.mockResolvedValueOnce(
				'<html><body><c-wiz><div jscontroller="x" data-n-a-sg="test-sig" data-n-a-ts="12345"></div></c-wiz></body></html>'
			)
			// Second call: POST batchexecute -> returns decoded URL
			.mockResolvedValueOnce(batchResponse);

		const result = await decodeGoogleNewsUrl(googleUrl, mockHttp);

		expect(result.status).toBe(true);
		expect(result.decodedUrl).toBe(expectedUrl);
		expect(result.method).toBe('api');
		expect(mockHttp).toHaveBeenCalledTimes(2);
	});
});
