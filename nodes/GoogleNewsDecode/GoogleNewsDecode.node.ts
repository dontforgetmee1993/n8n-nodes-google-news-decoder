import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { decodeGoogleNewsUrl } from './utils/decoder';

export class GoogleNewsDecode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google News Decode',
		name: 'googleNewsDecode',
		icon: 'file:googleNewsDecode.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Decode Google News URLs',
		description:
			'Decode Google News RSS article URLs to their original source URLs',
		defaults: {
			name: 'Google News Decode',
		},
		inputs: ['main'] as any,
		outputs: ['main'] as any,
		properties: [
			{
				displayName: 'URL Field',
				name: 'urlField',
				type: 'string',
				default: 'link',
				required: true,
				description:
					'The name of the input field containing the Google News URL, or a direct URL starting with https://',
			},
			{
				displayName: 'Output Field',
				name: 'outputField',
				type: 'string',
				default: 'decodedUrl',
				description:
					'The name of the output field to store the decoded URL',
			},
			{
				displayName: 'Request Delay (ms)',
				name: 'delay',
				type: 'number',
				default: 0,
				description:
					'Delay between decoding requests in milliseconds (helps avoid rate limiting when processing many URLs)',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const urlField = this.getNodeParameter('urlField', i) as string;
				const outputField = this.getNodeParameter('outputField', i) as string;
				const delay = this.getNodeParameter('delay', i, 0) as number;
				let googleNewsUrl: string;

				// If urlField looks like a URL, use it directly; otherwise treat as field name
				if (urlField.startsWith('http://') || urlField.startsWith('https://')) {
					googleNewsUrl = urlField;
				} else {
					googleNewsUrl = items[i].json[urlField] as string;
					if (!googleNewsUrl) {
						throw new Error(
							`Field "${urlField}" is empty or missing in item ${i}`,
						);
					}
				}

				const result = await decodeGoogleNewsUrl(
					googleNewsUrl,
					async (options) => {
						const response = await this.helpers.httpRequest({
							method: options.method as 'GET' | 'POST',
							url: options.url,
							headers: options.headers,
							body: options.body,
							returnFullResponse: false,
						});
						return typeof response === 'string'
							? response
							: JSON.stringify(response);
					},
				);

				if (result.status && result.decodedUrl) {
					returnData.push({
						json: {
							...items[i].json,
							[outputField]: result.decodedUrl,
							_decodeMethod: result.method,
						},
						pairedItem: { item: i },
					});
				} else {
					if (this.continueOnFail()) {
						returnData.push({
							json: {
								...items[i].json,
								[outputField]: null,
								_decodeError: result.message,
							},
							pairedItem: { item: i },
						});
					} else {
						throw new Error(result.message || 'Failed to decode URL');
					}
				}

				// Apply delay between requests if configured
				if (delay > 0 && i < items.length - 1) {
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							...items[i].json,
							_decodeError: (error as Error).message,
						},
						pairedItem: { item: i },
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}
