import { z } from 'zod';
import type { Recipe } from '../domain/schema';

export type Kind = 'recipe' | 'shopping-note';
export type Value = Recipe | { note: string };
export type Association = { personId: string; role: string };
export type Operation = { operationId: string; kind: Kind; recordId: string; baseServerVersion: string | null } & (
  { type: 'put'; schemaVersion: 1; value: Value; people: Association[]; resurrect?: true } | { type: 'delete' });
const version = z.string().regex(/^[1-9][0-9]*$/);
const snapshotSchema = z.object({
  kind: z.string(), recordId: z.string(), schemaVersion: z.number(), value: z.unknown(),
  people: z.array(z.object({ personId: z.uuid(), role: z.string() })), deleted: z.boolean(),
  serverVersion: version, updatedBy: z.uuid(), deviceId: z.uuid(), createdAt: z.string(), updatedAt: z.string(),
}).passthrough();
export type Snapshot = z.infer<typeof snapshotSchema>;
const result = z.discriminatedUnion('status', [
  z.object({ operationId: z.uuid(), status: z.literal('accepted'), serverVersion: version }),
  z.object({ operationId: z.uuid().nullable(), status: z.literal('rejected'), code: z.string() }),
  z.object({ operationId: z.uuid(), status: z.literal('conflict'), code: z.literal('VERSION_CONFLICT'), current: snapshotSchema.nullable(), serverVersion: version.nullable() }),
]);
export const exchangeSchema = z.object({
  protocolVersion: z.literal(1), results: z.array(result), acceptedOperationIds: z.array(z.uuid()),
  rejected: z.array(result), conflicts: z.array(result), changes: z.array(snapshotSchema), cursor: z.string().min(1), hasMore: z.boolean(),
});
export type Page = z.infer<typeof exchangeSchema>;
export type ExchangeRequest = { protocolVersion: 1; appId: 'recipes'; deviceId: string; spaceId: string; cursor: string | null; limit: number; changes: Operation[] };
export const spaceSchema = z.object({ id: z.uuid(), name: z.string(), kind: z.enum(['personal', 'shared']), archived: z.boolean(), serverVersion: version });
export type Space = z.infer<typeof spaceSchema>;
export const keyOf = (kind: string, id: string) => kind + ':' + id;
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const entries = Object.entries(a);
  return entries.length === Object.keys(b).length && entries.every(([key, value]) => Object.hasOwn(b, key) && same(value, (b as Record<string, unknown>)[key]));
}
export const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function exceedsDepth(value: unknown, depth: number): boolean {
  return depth > 32 || (!!value && typeof value === 'object' && Object.values(value).some(child => exceedsDepth(child, depth + 1)));
}
export function uploadProblem(op: Operation) {
  if (op.type === 'put' && bytes(op.value) > 65536) return 'This record exceeds the 64 KiB sharing limit. The complete original is saved here and can be exported.';
  if (exceedsDepth(op, 2)) return 'This record exceeds the service nesting limit. Export the original for review.';
  return '';
}
