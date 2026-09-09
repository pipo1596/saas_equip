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

type LoginForm = FormGroup<{
  email: FormControl<string>;
  password: FormControl<string>;
}>;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  error = signal<string | null>(null);
  loading = signal(false);
  showPassword = signal(false);

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }

  form: LoginForm;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router
  ) {
    this.form = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
  }

  get emailControl() {
    return this.form.controls.email;
  }

  get passwordControl() {
    return this.form.controls.password;
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    try {
      const { email, password } = this.form.getRawValue();

      await this.auth.login(email, password);

      if (this.auth.pendingMfa()) {
        await this.router.navigate(['/mfa']);
      } else {
        await this.router.navigate(['/dashboard']);
      }
    } catch (error: unknown) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Unable to sign in.'
      );
    } finally {
      this.loading.set(false);
    }
  }
}