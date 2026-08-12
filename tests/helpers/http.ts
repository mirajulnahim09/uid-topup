/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ কুকি-জার সহ HTTP ক্লায়েন্ট — আসল লগইন পথ (Group D)
 *
 *   প্রতিটি `Client` একজন ব্রাউজার-ব্যবহারকারীর সমতুল্য: নিজস্ব
 *   কুকি-জার, নিজস্ব সেশন। তাই দুটি আলাদা `Client` = দুটি আলাদা
 *   ট্যাব/ডিভাইস, আর একই `Client` থেকে সমান্তরাল অনুরোধ = একজন
 *   ব্যবহারকারীর দুটি ট্যাব — double-spend টেস্ট ঠিক এটিই।
 *
 *   ⚠️ সেশন সাইন করা হয় **সার্ভারের** `NEXTAUTH_SECRET` দিয়ে; টেস্ট
 *   কখনো নিজে টোকেন বানায় না। JWT হাতে সাইন করলে `authorize()`,
 *   ব্রুট-ফোর্স গার্ড ও 2FA গেট পুরোপুরি বাদ পড়ত — অথচ C4/C5 ঠিক
 *   ওই স্তরগুলোরই টেস্ট।
 * ═══════════════════════════════════════════════════════════
 */

export type ApiResult<T = any> = {
  status: number;
  body: T;
  headers: Headers;
};

export class Client {
  /** name → value। ডোমেইন/পাথ আলাদা করার দরকার নেই — একটাই origin। */
  private jar = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** ★ Set-Cookie শোষণ। খালি মান = সার্ভার কুকি মুছতে বলছে (লগআউট)। */
  private absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  /**
   * ★ `redirect: 'manual'` — middleware `/account`/`/admin` থেকে
   *   `/login` এ redirect করে। স্বয়ংক্রিয় follow করলে টেস্ট 200 দেখে
   *   ভাবত অ্যাক্সেস দেওয়া হয়েছে, অথচ আসলে লগইন পাতা এসেছে।
   */
  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookies = this.cookieHeader();
    if (cookies) headers.set('cookie', cookies);

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });
    this.absorb(res);
    return res;
  }

  async get<T = any>(path: string): Promise<ApiResult<T>> {
    return this.toResult<T>(await this.raw(path));
  }

  async post<T = any>(path: string, data: unknown): Promise<ApiResult<T>> {
    return this.toResult<T>(
      await this.raw(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    );
  }

  /** ★ Group I (৪) — টিকিট বন্ধ করা PATCH ব্যবহার করে */
  async patch<T = any>(path: string, data: unknown): Promise<ApiResult<T>> {
    return this.toResult<T>(
      await this.raw(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    );
  }

  /** ★ Group I (৩) — `/api/admin/otp` এর "Test connection" PUT ব্যবহার করে */
  async put<T = any>(path: string, data: unknown): Promise<ApiResult<T>> {
    return this.toResult<T>(
      await this.raw(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    );
  }

  private async toResult<T>(res: Response): Promise<ApiResult<T>> {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* HTML/redirect বডি — কাঁচা টেক্সটই থাক */
    }
    return { status: res.status, body: body as T, headers: res.headers };
  }

  get hasSession(): boolean {
    return this.jar.has('next-auth.session-token');
  }

  /**
   * ★★★ আসল credentials লগইন — NextAuth ক্লায়েন্ট যা করে হুবহু তাই।
   *
   *   ১. `GET /api/auth/csrf` → টোকেন + csrf কুকি
   *   ২. `POST /api/auth/callback/credentials` — form-encoded, `json=true`
   *
   *   ⚠️ CSRF ধাপটি বাদ দেওয়া যায় না: NextAuth বডির `csrfToken` ও
   *   কুকির হ্যাশ মিলিয়ে দেখে, না মিললে নীরবে লগইন ব্যর্থ হয়।
   *
   *   @returns সফল হলে `true` (সেশন কুকি পাওয়া গেছে)
   */
  async login(email: string, password: string, totp?: string): Promise<boolean> {
    const csrfRes = await this.get<{ csrfToken: string }>('/api/auth/csrf');
    const csrfToken = csrfRes.body?.csrfToken;
    if (!csrfToken) throw new Error('csrfToken পাওয়া যায়নি — সার্ভার প্রস্তুত?');

    const form = new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: this.baseUrl,
      json: 'true',
    });
    if (totp) form.set('totp', totp);

    await this.raw('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    return this.hasSession;
  }

  /** ★ লগইন ব্যর্থ হলে টেস্ট সেখানেই থামুক — পরে অস্পষ্ট 401 নয় */
  async loginOrThrow(email: string, password: string): Promise<void> {
    if (!(await this.login(email, password))) {
      throw new Error(`লগইন ব্যর্থ: ${email}`);
    }
  }
}

/** ★ n জন একসাথে — সমান্তরালতা টেস্টের মূল হাতিয়ার */
export function newClient(baseUrl: string): Client {
  return new Client(baseUrl);
}
