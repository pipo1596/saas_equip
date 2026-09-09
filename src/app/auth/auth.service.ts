import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { PartnerModeService } from '../partner/partner-mode.service';
import { TenantPartnersService } from '../admin/tenant-partners/tenant-partners.service';

export interface AuthState {
  authenticated: boolean;
  mfaRequired: boolean;
  pendingSessionId: string | null;
  email: string | null;
  userid: string | null;
  firstName: string | null;
  lastName: string | null;
  token: string | null;
  // Only meaningful for a level-2 (Tenant Partner) login — the one tpId
  // this session is authorized for. Null for level-1 (Platform Admin)
  // sessions, which aren't restricted to a single partner.
  tpId: number | null;
  error: string | null;
  loading: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'saas-equip-auth';
  private readonly sessionKey = 'saas-equip-session';

  private readonly partnerMode = inject(PartnerModeService);
  private readonly tenantPartnersService = inject(TenantPartnersService);

  private readonly loginEndpoint =
    `${environment.apiBaseUrl}${environment.endpoints.login}`;

  private readonly state = signal<AuthState>({
    authenticated: false,
    mfaRequired: false,
    pendingSessionId: null,
    email: null,
    userid: null,
    firstName: null,
    lastName: null,
    token: null,
    tpId: null,
    error: null,
    loading: false,
  });

  readonly isAuthenticated = computed(() => this.state().authenticated);
  readonly pendingMfa = computed(() => this.state().mfaRequired);
  readonly loading = computed(() => this.state().loading);
  readonly errorMessage = computed(() => this.state().error);
  readonly tpId = computed(() => this.state().tpId);
  // Where to send the user right after a successful login/MFA — their own
  // partner dashboard for a level-2 session, the regular admin dashboard
  // otherwise.
  readonly postAuthRoute = computed<string[]>(() => {
    const tpId = this.state().tpId;
    return this.isPartnerLogin() && tpId != null ? ['/partner', String(tpId), 'dashboard'] : ['/dashboard'];
  });
  readonly displayName = computed(() => {
    const state = this.state();
    if (state.firstName) {
      const lastInitial = state.lastName ? ` ${state.lastName[0].toUpperCase()}.` : '';
      return `${state.firstName}${lastInitial}`;
    }
    if (state.email) {
      return state.email.split('@')[0];
    }
    return 'Admin';
  });
  readonly initials = computed(() => {
    const name = this.displayName();
    return name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join('');
  });

  // Which login screen to render — 1 = Platform Admin (default, current
  // behavior), 2 = Tenant Partner. Determined by the MODE action, which
  // presumably keys off the requesting hostname (e.g. a partner's
  // white-label subdomain) — not yet confirmed against the real backend.
  private readonly loginLevelSignal = signal<1 | 2>(1);
  private loginModeLoaded = false;
  readonly loginLevel = computed(() => this.loginLevelSignal());
  readonly isPartnerLogin = computed(() => this.loginLevelSignal() === 2);
  readonly portalTitle = computed(() => this.isPartnerLogin() ? 'Tenant Partner Portal' : 'Platform Admin Portal');
  // False until fetchLoginMode() has resolved (success or failure) — lets
  // the login/forgot-password pages hold off rendering the title so it
  // never flashes as "Platform Admin Portal" before switching to "Tenant
  // Partner Portal" once the real mode comes back.
  readonly modeReady = signal(false);

  constructor() {
    this.restoreState();
  }

  get email() {
    return this.state().email;
  }

  // LOGIN/MFA/FORGOT/RESET all have a level-1 and level-2 variant
  // (LOGIN1/LOGIN2, etc.) — this suffixes the base action name with
  // whichever login level this screen resolved to via MODE.
  private actionFor(base: string): string {
    return `${base}${this.loginLevelSignal()}`;
  }

  // Determines which login screen (Platform Admin vs Tenant Partner) to
  // render. Cached for the life of the app — the login mode isn't expected
  // to change mid-session, so repeat calls (e.g. visiting /login then
  // /forgot-password) skip the network round-trip.
  async fetchLoginMode(): Promise<void> {
    if (this.loginModeLoaded) return;
    try {
      const body = { action: 'MODE', hostname: window.location.hostname };
      const response = await fetch(this.loginEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const raw = await response.text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const level = this.extractLoginLevel(parsed);
      if (level === 2) {
        this.loginLevelSignal.set(2);
      } else if (level !== 1) {
        // Response parsed fine but didn't contain a recognizable level
        // field — log the raw shape so the actual contract can be matched.
        console.warn('AuthService: MODE response did not contain a recognizable loginlevel field, got', parsed);
      }
      this.loginModeLoaded = true;
    } catch {
      // Fall back to the default Platform Admin screen (level 1) — leave
      // loginModeLoaded false so a later call can retry.
    } finally {
      // Reveal the title either way — a failed MODE call shouldn't leave
      // the page stuck hiding it forever, it just falls back to level 1.
      this.modeReady.set(true);
    }
  }

  // Tolerant of several plausible response shapes for MODE, since the exact
  // contract isn't confirmed — checks common field-name casings at the top
  // level and under a nested `data` object, coercing string values too.
  private extractLoginLevel(payload: Record<string, unknown>): 1 | 2 | null {
    const candidates: unknown[] = [
      payload['loginlevel'], payload['loginLevel'], payload['LOGINLEVEL'], payload['level'],
    ];
    const data = payload['data'];
    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;
      candidates.push(nested['loginlevel'], nested['loginLevel'], nested['LOGINLEVEL'], nested['level']);
    }
    for (const candidate of candidates) {
      const num = Number(candidate);
      if (num === 1 || num === 2) return num;
    }
    return null;
  }

  // Tolerant of several plausible field names for the tenant partner ID a
  // level-2 login response carries — exact contract not yet confirmed.
  private extractTpId(payload: Record<string, unknown>): number | null {
    const candidates: unknown[] = [
      payload['tpId'], payload['tenantPartnerId'], payload['partnerId'], payload['TPID'],
    ];
    for (const candidate of candidates) {
      const num = Number(candidate);
      if (Number.isFinite(num) && num > 0) return num;
    }
    return null;
  }

  // For a level-2 (Tenant Partner) session, auto-enters that partner's mode
  // right after authentication so the user lands straight in their own
  // /partner/:tpId area — they never see or pick from the tenant-partners
  // list. Fetches the partner's display details (name/logo); falls back to
  // entering with just the id if that lookup fails, so routing/guards still
  // work even without the display niceties.
  private async syncPartnerMode(): Promise<void> {
    const tpId = this.state().tpId;
    if (!this.isPartnerLogin() || tpId == null) return;
    try {
      const partner = await this.tenantPartnersService.get(tpId);
      this.partnerMode.enter({ tpId: partner.tpId, tpName: partner.tpName, logoUrl: partner.logoUrl });
    } catch {
      this.partnerMode.enter({ tpId, tpName: '', logoUrl: null });
    }
  }

  async login(email: string, password: string) {
    this.patch({ loading: true, error: null });
    const action = this.actionFor('LOGIN');
    try {
      const body = {
        email,
        password,
        action
        };

      const response = await fetch(this.loginEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      const raw = await response.text();
      const payload = this.parseResponse(raw);
      const tpId = this.extractTpId(payload as unknown as Record<string, unknown>);

      if (!response.ok || payload.success === false) {
        throw new Error(payload.message ?? 'Email or password is invalid.');
      }

      if (payload.mfaRequired ?? true) {
        this.patch({
          authenticated: false,
          mfaRequired: true,
          pendingSessionId: payload.sessionId ?? null,
          email,
          userid: payload.userid ?? null,
          firstName: payload.firstName ?? null,
          lastName: payload.lastName ?? null,
          token: null,
          tpId,
          loading: false,
        });
        return;
      }

      this.patch({
        authenticated: true,
        mfaRequired: false,
        pendingSessionId: null,
        email,
        userid: payload.userid ?? null,
        firstName: payload.firstName ?? null,
        lastName: payload.lastName ?? null,
        token: payload.token ?? null,
        tpId,
        loading: false,
      });
      await this.syncPartnerMode();
    } catch (error: unknown) {
      this.patch({
        loading: false,
        error: error instanceof Error ? error.message : 'Login failed.',
      });
      throw error;
    }
  }

  async verifyMfa(code: string) {
    this.patch({ loading: true, error: null });
    const action = this.actionFor('MFA');
    try {
      
      const body = {
        action,
        userid: this.state().userid ?? '',
        code,
        sessionId: this.state().pendingSessionId ?? ''
        };

      const response = await fetch(this.loginEndpoint, {
       method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      const raw = await response.text();
      const payload = this.parseResponse(raw);

      if (!response || !response.ok || payload.success !== true) {
        throw new Error(payload.message ?? 'The verification code is invalid.');
      }

      // MFA responses may or may not repeat tpId — keep whatever login()
      // already captured if this one doesn't include it.
      const tpId = this.extractTpId(payload as unknown as Record<string, unknown>) ?? this.state().tpId;

      this.patch({
        authenticated: true,
        mfaRequired: false,
        pendingSessionId: null,
        firstName: payload.firstName ?? this.state().firstName ?? null,
        lastName: payload.lastName ?? this.state().lastName ?? null,
        token: payload.token ?? null,
        tpId,
        loading: false,
      });
      await this.syncPartnerMode();
    } catch (error: unknown) {
      this.patch({
        loading: false,
        error: error instanceof Error ? error.message : 'MFA validation failed.',
      });
      throw error;
    }
  }

  // Pre-authentication actions — deliberately don't touch `state`/persistState,
  // since there's no authenticated session yet at this point.

  async requestPasswordReset(email: string): Promise<void> {
    const body = { action: this.actionFor('FORGOT'), email };
    const response = await fetch(this.loginEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    const raw = await response.text();
    const payload = this.parseSimpleResponse(raw);
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message ?? 'Unable to send a reset code. Please try again.');
    }
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const body = { action: this.actionFor('RESET'), email, code, newPassword };
    const response = await fetch(this.loginEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    const raw = await response.text();
    const payload = this.parseSimpleResponse(raw);
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message ?? 'Unable to reset your password. Please check the code and try again.');
    }
  }

  private parseSimpleResponse(raw: string): { success?: boolean; message?: string } {
    try {
      return JSON.parse(raw) as { success?: boolean; message?: string };
    } catch {
      return { success: false, message: undefined };
    }
  }

  logout() {
    this.state.set({
      authenticated: false,
      mfaRequired: false,
      pendingSessionId: null,
      email: null,
      userid: null,
      firstName: null,
      lastName: null,
      token: null,
      tpId: null,
      error: null,
      loading: false,
    });
    this.persistState();
    this.partnerMode.exit();
  }

  private patch(partial: Partial<AuthState>) {
    this.state.set({ ...this.state(), ...partial });
    this.persistState();
  }

  private parseResponse(raw: string) {
    try {
      return JSON.parse(raw) as {
        userid?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        success?: boolean;
        mfaRequired?: boolean;
        sessionId?: string | null;
        token?: string | null;
        message?: string;
      };
    } catch {
      return {
        userid: null,
        firstName: null,
        lastName: null,
        success: false,
        mfaRequired: false,
        sessionId: null,
        token: null,
        message: undefined,
      };
    }
  }

  private isBrowser(): boolean {
    return typeof window !== 'undefined' &&
           typeof localStorage !== 'undefined' &&
           typeof sessionStorage !== 'undefined';
  }

  private persistState() {
    if (!this.isBrowser()) {
      return;
    }

    const payload = {
      authenticated: this.state().authenticated,
      token: this.state().token,
      email: this.state().email,
      userid: this.state().userid,
      firstName: this.state().firstName,
      lastName: this.state().lastName,
      tpId: this.state().tpId,
    };

    localStorage.setItem(this.storageKey, JSON.stringify(payload));

    if (this.state().authenticated) {
      sessionStorage.setItem(this.sessionKey, '1');
    } else {
      sessionStorage.removeItem(this.sessionKey);
    }
  }

  private restoreState() {
    if (!this.isBrowser()) {
      return;
    }

    // Session sentinel is set on login and survives F5, but cleared when the
    // browser closes. Without it, skip restore so closing the browser logs out.
    if (!sessionStorage.getItem(this.sessionKey)) {
      return;
    }

    const raw = localStorage.getItem(this.storageKey);

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        lastName: null;
        firstName: null;
        authenticated?: boolean;
        token?: string | null;
        email?: string | null;
        userid?: string | null;
        tpId?: number | null;
      };

      if (parsed.authenticated) {
        this.state.set({
          authenticated: true,
          mfaRequired: false,
          pendingSessionId: null,
          email: parsed.email ?? null,
          userid: parsed.userid ?? null,
          firstName: parsed.firstName ?? null,
          lastName: parsed.lastName ?? null,
          token: parsed.token ?? null,
          tpId: parsed.tpId ?? null,
          error: null,
          loading: false,
        });
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }
}