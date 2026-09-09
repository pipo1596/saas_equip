import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormGroup,
  FormControl,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

type RequestForm = FormGroup<{
  email: FormControl<string>;
}>;

type ResetForm = FormGroup<{
  code: FormControl<string>;
  newPassword: FormControl<string>;
  confirmPassword: FormControl<string>;
}>;

type Step = 'request' | 'reset' | 'done';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
  step = signal<Step>('request');
  error = signal<string | null>(null);
  loading = signal(false);
  showPassword = signal(false);
  submittedEmail = signal<string | null>(null);

  requestForm: RequestForm;
  resetForm: ResetForm;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
  ) {
    this.requestForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
    });
    this.resetForm = this.fb.nonNullable.group({
      code: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    });
  }

  get emailControl() {
    return this.requestForm.controls.email;
  }

  get codeControl() {
    return this.resetForm.controls.code;
  }

  get newPasswordControl() {
    return this.resetForm.controls.newPassword;
  }

  get confirmPasswordControl() {
    return this.resetForm.controls.confirmPassword;
  }

  get passwordsMismatch(): boolean {
    const { newPassword, confirmPassword } = this.resetForm.getRawValue();
    return !!confirmPassword && newPassword !== confirmPassword;
  }

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }

  async submitRequest(): Promise<void> {
    if (this.requestForm.invalid) {
      this.requestForm.markAllAsTouched();
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    try {
      const { email } = this.requestForm.getRawValue();
      await this.auth.requestPasswordReset(email);
      this.submittedEmail.set(email);
      this.step.set('reset');
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Unable to send a reset code.');
    } finally {
      this.loading.set(false);
    }
  }

  async submitReset(): Promise<void> {
    if (this.resetForm.invalid || this.passwordsMismatch) {
      this.resetForm.markAllAsTouched();
      return;
    }
    const email = this.submittedEmail();
    if (!email) return;

    this.error.set(null);
    this.loading.set(true);
    try {
      const { code, newPassword } = this.resetForm.getRawValue();
      await this.auth.resetPassword(email, code, newPassword);
      this.step.set('done');
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Unable to reset your password.');
    } finally {
      this.loading.set(false);
    }
  }

  async resendCode(): Promise<void> {
    const email = this.submittedEmail();
    if (!email) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.requestPasswordReset(email);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Unable to send a reset code.');
    } finally {
      this.loading.set(false);
    }
  }

  backToRequest(): void {
    this.step.set('request');
    this.error.set(null);
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
