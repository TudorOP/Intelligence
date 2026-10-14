import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv2019 from 'ajv/dist/2019.js';
import addFormats from 'ajv-formats';
const validators = new WeakMap();
const token = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export class ToolCallError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}
function trimCommas(text) {
  let result = '',
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!quoted && c === ',' && /^[\s]*[}\]]/.test(text.slice(i + 1))) continue;
    result += c;
    if (quoted && escaped) {
      escaped = false;
      continue;
    }
    if (quoted && c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
  }
  return result;
}
function normalize(value, schema, repairs, path = '', depth = 0) {
  if (depth > 24) throw new ToolCallError('Tool arguments are nested too deeply');
  const types = Array.isArray(schema?.type) ? schema.type : [schema?.type];
  if (typeof value === 'string') {
    const s = value.trim();
    if (
      !types.includes('string') &&
      types.includes('integer') &&
      /^-?(0|[1-9]\d*)$/.test(s) &&
      Number.isSafeInteger(Number(s))
    ) {
      repairs.push(`${path}: integer string`);
      return Number(s);
    }
    if (
      !types.includes('string') &&
      types.includes('number') &&
      /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s) &&
      Number.isFinite(Number(s))
    ) {
      repairs.push(`${path}: number string`);
      return Number(s);
    }
    if (!types.includes('string') && types.includes('boolean') && ['true', 'false'].includes(s)) {
      repairs.push(`${path}: boolean string`);
      return s === 'true';
    }
  }
  if (Array.isArray(value))
    return value.map((v, i) =>
      normalize(v, schema?.items ?? {}, repairs, `${path}[${i}]`, depth + 1),
    );
  if (value && typeof value === 'object') {
    const properties = schema?.properties ?? {},
      entries = [];
    for (const [key, v] of Object.entries(value)) {
      const matches = Object.keys(properties).filter((k) => token(k) === token(key));
      const next =
        !(key in properties) && matches.length === 1 && !(matches[0] in value) ? matches[0] : key;
      if (next !== key) repairs.push(`${path}.${key}: property spelling`);
      entries.push([
        next,
        normalize(v, properties[next] ?? {}, repairs, path + '.' + next, depth + 1),
      ]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}
export function prepareToolCall(call, tools, { repair = true } = {}) {
  const repairs = [];
  const requested = call?.function?.name;
  if (typeof requested !== 'string' || requested.length > 250)
    throw new ToolCallError('A tool call needs a valid function name');
  let tool = tools.find((t) => t.function.name === requested);
  if (!tool && repair) {
    const matches = tools.filter((t) => token(t.function.name) === token(requested));
    if (matches.length === 1) {
      tool = matches[0];
      repairs.push('Function name spelling');
    }
  }
  if (!tool)
    throw new ToolCallError(
      'Tool is unavailable; use the exact name from the supplied tools or discover permitted MCP tools first',
      { availableTools: tools.map((t) => t.function.name).slice(0, 60) },
    );
  const schema = tool.function.parameters ?? { type: 'object' };
  let args = call.function.arguments ?? {};
  try {
    if (typeof args === 'string') {
      if (args.length > 2 * 1024 * 1024) throw new Error('Arguments exceed 2 MB');
      let text = args.trim() || '{}';
      if (repair && /^```(?:json)?\s*[\s\S]*```$/i.test(text)) {
        text = text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```$/, '')
          .trim();
        repairs.push('Removed JSON fences');
      }
      try {
        args = JSON.parse(text);
      } catch (error) {
        if (!repair) throw error;
        args = JSON.parse(trimCommas(text));
        repairs.push('Removed trailing commas');
      }
      if (repair && typeof args === 'string') {
        args = JSON.parse(args);
        repairs.push('Decoded nested JSON');
      }
    }
    if (!args || Array.isArray(args) || typeof args !== 'object')
      throw new Error('Arguments must be a JSON object');
    if (repair) args = normalize(args, schema, repairs);
    let validate = validators.get(schema);
    if (!validate) {
      let engine;
      if (schema.$schema?.includes('2020-12'))
        engine = new Ajv2020({ strict: false, allErrors: true });
      else if (schema.$schema?.includes('2019-09'))
        engine = new Ajv2019({ strict: false, allErrors: true });
      if (engine) addFormats(engine);
      validate = new AjvJsonSchemaValidator(engine).getValidator(schema);
      validators.set(schema, validate);
    }
    const checked = validate(args);
    if (!checked.valid) throw new Error(checked.errorMessage);
  } catch (error) {
    throw new ToolCallError(
      'Tool arguments need correction: ' + String(error.message).slice(0, 1800),
      {
        tool: tool.function.name,
        schema: JSON.stringify(schema).slice(0, 12000),
        hint: 'Correct the call using this schema. Supply missing values from the user or tool evidence. Do not repeat a denied action or guess IDs, paths, revisions, or credentials.',
      },
    );
  }
  return { name: tool.function.name, args, repairs };
}
export const repairInstruction =
  'Tool calls must match the supplied function name and JSON schema. The harness can normalize simple formatting mistakes. A tool validation error means the action was not executed: read its schema and correct the next call. Use discovery for MCP tools; never invent IDs or required values. After an execution or permission error, inspect the cause before considering another action. Never automatically repeat a side-effecting action whose outcome is uncertain.';
