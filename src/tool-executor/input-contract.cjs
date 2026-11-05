// Bounds belong to the canonical catalog, not a transport-specific dialect.
function boundedInput(schema, key = '') {
  const result = { ...schema };
  for (const branch of ['allOf', 'anyOf', 'oneOf']) {
    if (schema[branch]) result[branch] = schema[branch].map(child => boundedInput(child, key));
  }
  if (schema.type === 'string' && !schema.enum) {
    result.maxLength ??= key === 'nextToken' ? 4096 : key.endsWith('ID') || key === 'referenceName' ? 256 : 4000;
    result.minLength ??= 1;
    // Normal prompt whitespace (tab, LF, CRLF) is valid; reject other C0 controls and DEL.
    result.pattern ??= '^(?![\\s\\S]*[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f])[\\s\\S]*\\S[\\s\\S]*$';
    if (key.endsWith('ID')) result.pattern = '^[A-Za-z0-9][A-Za-z0-9_.:-]*$';
  }
  if (schema.type === 'array') {
    result.maxItems ??= 100;
    if (key === 'prompts') result.minItems ??= 1;
    if (schema.items) result.items = boundedInput(schema.items);
  }
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, boundedInput(v, k)]));
  if (['list_characters', 'list_scenes'].includes(key)) {
    result.properties.limit = { ...result.properties.limit, minimum: 1, maximum: 100 };
  }
  return result;
}
module.exports = { boundedInput };
