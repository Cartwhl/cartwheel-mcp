// Transport errors carry no response text, URLs, headers or credentials.
class ResponseTooLargeError extends Error {
  constructor() { super('Response too large'); }
}
class SceneListTooLargeError extends Error {
  constructor(args) {
    super('Scene listing exceeds the 1 MiB response limit.');
    const limit = args.limit;
    const suggestedLimit = limit === undefined ? 1 : Math.max(1, Math.floor(limit / 2));
    this.result = {
      code: 'scene_list_too_large', message: this.message, retryable: false,
      guidance: limit === 1
        ? 'Stop: list_scenes exceeded the response limit at limit 1. A single scene can exceed the cap; smaller-page retries cannot resolve this.'
        : `Retry list_scenes manually with limit ${suggestedLimit}, keeping the other arguments unchanged. Smaller pages may still exceed the cap; halve the limit again if needed, and stop at limit 1. Success is not guaranteed.`,
      ...(limit !== 1 ? { suggestedLimit } : {}),
    };
  }
}
module.exports = { ResponseTooLargeError, SceneListTooLargeError };
