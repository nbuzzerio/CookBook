import { z } from 'zod'
import { exchangeSchema, spaceSchema, type ExchangeRequest, type Space } from './protocol'

const sessionSchema = z.object({ principalId: z.uuid(), csrfToken: z.string().min(1), expiresAt: z.number().int() })
export class ApiError extends Error {
  status: number; code: string; retryAfter: number
  constructor(status: number, code: string, retryAfter = 0) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: 'Incorrect household password.',
      UNAUTHENTICATED: 'Sign in to your household to resume synchronization.',
      RATE_LIMITED: 'The service is busy. Your saved changes will retry automatically.',
    }
    super(messages[code] ?? 'Sync service returned ' + code)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}
export class SyncApi {
  session: z.infer<typeof sessionSchema> | null = null
  private passwordRequired = false
  private restoring?: Promise<z.infer<typeof sessionSchema>>
  get authState(): 'signed-in' | 'signed-out' | 'unknown' {
    if (this.session) return 'signed-in'
    return this.passwordRequired ? 'signed-out' : 'unknown'
  }
  private controllers = new Set<AbortController>()
  private readonly request: typeof fetch
  constructor(request: typeof fetch = (...args) => fetch(...args)) { this.request = request }
  cancel() {
    this.restoring = undefined
    for (const controller of this.controllers.keys()) controller.abort()
    this.session = null
  }
  async call(path: string, body?: unknown): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path')
    const sentSession = this.session
    const controller = new AbortController(); this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await this.request(`/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.session ? { 'X-CSRF-Token': this.session.csrfToken } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: { code?: string } } | null
        controller.signal.throwIfAborted()
        if (this.session === sentSession && (response.status === 401 || error?.error?.code === 'CSRF_REQUIRED')) {
          this.session = null
          this.passwordRequired = response.status === 401
        }
        const retry = response.headers.get('Retry-After')
        throw new ApiError(response.status, error?.error?.code ?? `HTTP_${response.status}`, retry ? Math.max(0, Number(retry) * 1000 || Date.parse(retry) - Date.now()) : 0)
      }
      const value = response.status === 204 ? undefined : await response.json()
      controller.signal.throwIfAborted()
      return value
    } finally { clearTimeout(timer); this.controllers.delete(controller) }
  }
  async login(password: string) {
    this.session = sessionSchema.parse(await this.call('/auth/household-login', { password }))
    this.restoring = undefined
    this.passwordRequired = false
    return this.session
  }
  restore() {
    if (!this.restoring) {
      const pending = this.call('/auth/session').then(value => {
        if (this.restoring !== pending) throw new DOMException('Session check superseded', 'AbortError')
        this.session = sessionSchema.parse(value)
        this.passwordRequired = false
        return this.session
      }).finally(() => { if (this.restoring === pending) this.restoring = undefined })
      this.restoring = pending
    }
    return this.restoring
  }
  async logout() {
    if (!this.session) await this.restore()
    await this.call('/auth/logout', {})
    this.cancel()
    this.passwordRequired = true
  }
  async exchange(request: ExchangeRequest) { return exchangeSchema.parse(await this.call('/apps/recipes/exchange', request)) }
  async directoryChanges(cursor: string | null) {
    return z.object({
      protocolVersion: z.literal(1), cursor: z.string().min(1), hasMore: z.boolean(),
      changes: z.array(z.object({ entityType: z.string(), value: z.unknown() })),
    }).parse(await this.call('/common/changes', { protocolVersion: 1, cursor, limit: 100 }));
  }
  async spaces(): Promise<Space[]> {
    const spaces: Space[] = [];
    let after: string | null = null;
    do {
      const url: string = '/spaces?limit=100' + (after ? '&after=' + encodeURIComponent(after) : '');
      const page = z.object({ items: z.array(spaceSchema), hasMore: z.boolean(), after: z.string().nullable() }).parse(await this.call(url));
      spaces.push(...page.items.filter(space => space.kind === 'shared' && !space.archived));
      if (page.hasMore && (!page.after || after === page.after)) throw new Error('Invalid Space directory page.');
      after = page.hasMore ? page.after : null;
    } while (after);
    return spaces;
  }
}
