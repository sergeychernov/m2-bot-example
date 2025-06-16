export function iam(context?: any): string | null {
	if (context && context.token) {
		if (typeof context.token === 'string') {
			return context.token;
		} else if (context.token.access_token) {
			return context.token.access_token;
		} else {
			console.error('Invalid token format in context:', context.token);
			return null;
		}
		console.log('IAM token received from function context and set for gpt.ts');
	} else {
		console.error('IAM token not found in function context');
		return null;
	}
}