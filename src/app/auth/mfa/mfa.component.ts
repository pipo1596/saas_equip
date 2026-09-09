import { AfterViewInit, Component, ElementRef, QueryList, signal, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-mfa',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './mfa.component.html',
})
export class MfaComponent implements AfterViewInit {
  @ViewChildren('codeInput') inputs!: QueryList<ElementRef<HTMLInputElement>>;

  error = signal<string | null>(null);
  loading = signal(false);
  form!: FormGroup;

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      d0: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d1: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d2: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d3: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d4: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d5: ['', [Validators.required, Validators.pattern(/^\d$/)]],
    });

    if (!auth.pendingMfa() && !auth.isAuthenticated()) {
      this.router.navigate(['/login']);
    }
  }

  onFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  onInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const digit = input.value.replace(/\D/g, '').slice(-1);
    this.control(index).setValue(digit, { emitEvent: false });
    input.value = digit;
    if (digit && index < 5) {
      this.focusInput(index + 1);
    }
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace' && !this.control(index).value && index > 0) {
      this.control(index - 1).setValue('');
      this.focusInput(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusInput(index - 1);
    } else if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault();
      this.focusInput(index + 1);
    }
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const digits = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6).split('');
    digits.forEach((digit, i) => this.control(i).setValue(digit));
    this.focusInput(Math.min(digits.length, 5));
  }

  private control(index: number): AbstractControl {
    return this.form.get(`d${index}`) as AbstractControl;
  }

  ngAfterViewInit(): void {
    this.focusInput(0);
  }

  private focusInput(index: number): void {
    const el = this.inputs.toArray()[index]?.nativeElement;
    el?.focus();
    el?.select();
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    try {
      const { d0, d1, d2, d3, d4, d5 } = this.form.value;
      await this.auth.verifyMfa(`${d0}${d1}${d2}${d3}${d4}${d5}`);
      await this.router.navigate(this.auth.postAuthRoute());
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Verification failed.');
    } finally {
      this.loading.set(false);
    }
  }
}
