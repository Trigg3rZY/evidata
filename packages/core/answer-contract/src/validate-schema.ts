/**
 * Runtime JSON Schema validation of an Answer, compiled from the committed
 * `answer-contract.schema.json`. The AgentRunner uses this (alongside the
 * structural `validateAnswer`) before persisting any Answer (spec 03/06, G3).
 */
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import schemaJson from './answer-contract.schema.json';

// `strict: false` keeps Ajv tolerant of annotation keywords ($comment) and of
// `format` used purely descriptively; ajv-formats supplies real `date-time`.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const compiled: ValidateFunction = ajv.compile(schemaJson);

export interface SchemaValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

/** Validate arbitrary data against the Answer Contract JSON Schema. */
export function validateAnswerSchema(data: unknown): SchemaValidationResult {
  const valid = compiled(data);
  return { valid, errors: compiled.errors ?? [] };
}

/** The committed Answer Contract JSON Schema (for tooling and tests). */
export const answerSchema = schemaJson;
