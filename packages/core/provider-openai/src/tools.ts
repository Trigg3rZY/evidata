/**
 * Tool/function definitions + the system prompt. The model drives the loop by
 * calling exactly one of these per turn (tool_choice='required', or pinned to
 * final_answer on the last budget step); the AgentRunner — not the model — runs
 * the SafetyGate + execution behind `run_sql`.
 */
import type { AgentInput } from '@evidata/agent';
import type { ToolDef } from './types';

const MISSING_KINDS = [
  'business_object',
  'time_range',
  'authorization',
  'mutation_required',
  'ambiguous_definition',
  'unverified_mapping',
  'insufficient_results',
];

export const AGENT_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description:
        'Execute ONE read-only SELECT against the data source and get a bounded, redacted result back (referenced as the next evidence id, e.g. "E1"). Only SELECT is permitted; any write is rejected by the safety gate.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          purpose: {
            type: 'string',
            description: 'Short reason for this query, shown to the user.',
          },
          sql: { type: 'string', description: 'A single read-only SELECT statement.' },
        },
        required: ['purpose', 'sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cannot_answer',
      description:
        'Declare that you cannot give a reliable answer, and exactly what is missing (e.g. an unverified mapping, a time range, an ambiguous definition).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          missing: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: MISSING_KINDS },
                description: { type: 'string' },
              },
              required: ['kind', 'description'],
            },
          },
        },
        required: ['missing'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'final_answer',
      description:
        'Produce the final, evidence-backed answer. Every key finding must cite at least one evidence id returned by run_sql.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['Answered'] },
          directAnswer: { type: 'string' },
          confidence: { type: 'string', enum: ['High', 'Medium', 'Low', 'CannotDetermine'] },
          confidenceReason: { type: 'string' },
          keyFindings: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string' },
                evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
              },
              required: ['text', 'evidenceIds'],
            },
          },
          assumptions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
          caveats: { type: 'array', items: { type: 'string' } },
          recommendedFollowups: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { question: { type: 'string' } },
              required: ['question'],
            },
          },
        },
        required: ['status', 'directAnswer', 'confidence', 'confidenceReason', 'keyFindings'],
      },
    },
  },
];

function schemaText(input: AgentInput): string {
  return input.schema.tables
    .map((t) => {
      const cols = t.columns
        .map((c) => {
          const flags = [
            c.primaryKey ? 'pk' : '',
            c.references ? `fk→${c.references.table}.${c.references.column}` : '',
            c.nullable ? '' : 'not null',
          ]
            .filter(Boolean)
            .join(', ');
          return `    ${c.name} ${c.dataType}${flags ? ` (${flags})` : ''}${c.comment ? ` -- ${c.comment}` : ''}`;
        })
        .join('\n');
      return `  ${t.name}${t.comment ? ` -- ${t.comment}` : ''}\n${cols}`;
    })
    .join('\n');
}

export function buildSystemPrompt(input: AgentInput): string {
  const { context } = input;
  const glossary = context.glossary.map((g) => `  - ${g.term}: ${g.definition}`).join('\n');
  const mappings = context.mappings.map((m) => `  - ${m.from} → ${m.to}`).join('\n');
  return [
    'You are a careful data analyst for a trusted, evidence-backed answer system.',
    'Rules:',
    '- You may ONLY read. Propose a single read-only SELECT via the run_sql tool; the app enforces a SQL safety gate and rejects any write.',
    '- Be decisive and efficient: most questions need only 1–4 queries. As soon as the evidence supports a conclusion, call final_answer. Do NOT keep exploring — there is a small per-turn query budget, and exhausting it ends the turn with NO answer. Prefer one well-aggregated query over many small ones.',
    '- Every key finding MUST cite at least one evidence id (E1, E2, …) returned by run_sql.',
    '- If a tool result has an "error" field, the query failed — read the message, fix the SQL, and try again (do not cite a failed query).',
    '- Use ONLY the verified glossary and entity mappings below. Do NOT invent joins on mappings that are not listed (if you need one, call cannot_answer with kind "unverified_mapping").',
    '- If a time range or business object is missing or a definition is ambiguous, call cannot_answer rather than guessing.',
    `- Write all user-facing text in the question's language: ${input.language}.`,
    '- In final_answer text fields, write plain prose: no Markdown, and do NOT put ASCII double-quotes (") inside the text — use 「」 or 《》 (or no quotes) for names so the tool arguments stay valid JSON.',
    '',
    `Data source overview: ${context.overview}`,
    '',
    'Verified glossary:',
    glossary || '  (none)',
    'Verified entity mappings:',
    mappings || '  (none)',
    '',
    'Schema (tables and columns):',
    schemaText(input),
  ].join('\n');
}
