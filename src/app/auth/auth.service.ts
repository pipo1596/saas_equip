import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export interface AuthState {
  authenticated: boolean;
  mfaRequired: boolean;
  pendingSessionId: string | null;
  email: string | null;
  userid: string | null;
  firstName: string | null;
  lastName: string | null;
  token: string | null;
  error: string | null;
  loading: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'saas-equip-auth';
  private readonly sessionKey = 'saas-equip-session';

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
    error: null,
    loading: false,
  });

  readonly isAuthenticated = computed(() => this.state().authenticated);
  readonly pendingMfa = computed(() => this.state().mfaRequired);
  readonly loading = computed(() => this.state().loading);
  readonly errorMessage = computed(() => this.state().error);
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

  constructor() {
    this.restoreState();
  }

  get email() {
    return this.state().email;
  }

  async login(email: string, password: string) {
    this.patch({ loading: true, error: null });
    const action = 'LOGIN1';
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
        loading: false,
      });
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
    const action = 'MFA1';
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

      this.patch({
        authenticated: true,
        mfaRequired: false,
        pendingSessionId: null,
        firstName: payload.firstName ?? this.state().firstName ?? null,
        lastName: payload.lastName ?? this.state().lastName ?? null,
        token: payload.token ?? null,
        loading: false,
      });
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
    const body = { action: 'FORGOT1', email };
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
    const body = { action: 'RESET1', email, code, newPassword };
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
      error: null,
      loading: false,
    });
    this.persistState();
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
          error: null,
          loading: false,
        });
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }
}