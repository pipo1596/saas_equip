import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerApprovalLevelsService } from './customer-approval-levels.service';
import { ApprovalLevelRoleRef, ApprovalOverrideRole, ApprovalSimulation, LevelSyncItem } from './customer-approval-level.model';

// Local editable row — levelNo/minAmount aren't stored here, they're derived
// from the row's position in the array (levelNo = index+1; minAmount = the
// previous row's maxAmount, 0 for the first row). The last row is always
// forced to "No limit", matching "the top level always has no limit".
interface LevelRow {
  levelId: number; // 0 = new, sent as levelId: 0 on *SYNC
  maxAmount: number | null; // null while noLimit is true
  noLimit: boolean;
  escalationDays: number;
  roles: ApprovalLevelRoleRef[]; // read-only, empty for a not-yet-saved row
  approverCount: number;
}

@Component({
  selector: 'app-customer-approval-levels',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './customer-approval-levels.component.html',
})
export class CustomerApprovalLevelsComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerApprovalLevelsService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  readonly overrideRoles = signal<ApprovalOverrideRole[]>([]);
  readonly rows = signal<LevelRow[]>([]);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saved = signal(false);

  readonly simAmount = signal<number | null>(null);
  readonly simResult = signal<ApprovalSimulation | null>(null);
  readonly simLoading = signal(false);
  readonly simError = signal<string | null>(null);

  // Remove/reorder are destructive to the row layout (renumbers every level
  // below), so both are confirmed before applying — the change still only
  // takes effect locally until Save is clicked.
  readonly confirmAction = signal<{ kind: 'remove' | 'up' | 'down'; index: number } | null>(null);

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    await this.load();
  }

  async load(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const ladder = await this.service.list(tpId, custId);
      this.warnings.set(ladder.warnings);
      this.overrideRoles.set(ladder.overrideRoles);
      this.rows.set(
        ladder.levels
          .slice()
          .sort((a, b) => a.levelNo - b.levelNo)
          .map(l => ({
            levelId: l.levelId,
            maxAmount: l.maxAmount,
            noLimit: l.maxAmount == null,
            escalationDays: l.escalationDays,
            roles: l.roles,
            approverCount: l.approverCount,
          })),
      );
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load approval levels.');
    } finally {
      this.loading.set(false);
    }
  }

  // Preview-only "Over" figure for a row at this position — the server is
  // the final authority once saved (minAmount isn't sent on *SYNC).
  minAmountFor(index: number): number {
    if (index === 0) return 0;
    return this.rows()[index - 1].maxAmount ?? 0;
  }

  isLastRow(index: number): boolean {
    return index === this.rows().length - 1;
  }

  roleNamesFor(row: LevelRow): string {
    return row.roles.length ? row.roles.map(r => r.roleName).join(', ') : '—';
  }

  onMaxAmountChange(index: number, value: string): void {
    const amount = value === '' ? null : Math.max(0, Number(value));
    this.rows.update(rows => {
      const next = [...rows];
      next[index] = { ...next[index], maxAmount: amount };
      return next;
    });
  }

  onEscalationDaysChange(index: number, value: string): void {
    const days = Math.max(1, Math.min(60, parseInt(value, 10) || 1));
    this.rows.update(rows => {
      const next = [...rows];
      next[index] = { ...next[index], escalationDays: days };
      return next;
    });
  }

  // Adding a level inserts it just below the current top row, so the top
  // stays the unlimited one.
  addLevel(): void {
    this.rows.update(rows => {
      const insertAt = Math.max(0, rows.length - 1);
      const prevAmount = insertAt > 0 ? (rows[insertAt - 1].maxAmount ?? 0) : 0;
      const newRow: LevelRow = {
        levelId: 0, maxAmount: prevAmount, noLimit: false, escalationDays: 3, roles: [], approverCount: 0,
      };
      const next = [...rows];
      next.splice(insertAt, 0, newRow);
      return next;
    });
  }

  // No minimum enforced client-side — removing the last row empties the
  // ladder entirely; the server is the authority on whether that's allowed
  // (its rejection rules don't list a minimum level count).
  private removeLevel(index: number): void {
    this.rows.update(rows => rows.filter((_, i) => i !== index));
  }

  private moveUp(index: number): void {
    if (index === 0) return;
    this.rows.update(rows => {
      const next = [...rows];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  private moveDown(index: number): void {
    if (index === this.rows().length - 1) return;
    this.rows.update(rows => {
      const next = [...rows];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  requestRemove(index: number): void {
    this.confirmAction.set({ kind: 'remove', index });
  }

  requestMoveUp(index: number): void {
    if (index === 0) return;
    this.confirmAction.set({ kind: 'up', index });
  }

  requestMoveDown(index: number): void {
    if (index === this.rows().length - 1) return;
    this.confirmAction.set({ kind: 'down', index });
  }

  cancelConfirm(): void {
    this.confirmAction.set(null);
  }

  confirmProceed(): void {
    const action = this.confirmAction();
    if (!action) return;
    if (action.kind === 'remove') this.removeLevel(action.index);
    if (action.kind === 'up') this.moveUp(action.index);
    if (action.kind === 'down') this.moveDown(action.index);
    this.confirmAction.set(null);
  }

  confirmTitle(): string {
    switch (this.confirmAction()?.kind) {
      case 'remove': return 'Remove Level';
      case 'up': return 'Move Level Up';
      case 'down': return 'Move Level Down';
      default: return '';
    }
  }

  confirmMessage(): string {
    const action = this.confirmAction();
    if (!action) return '';
    const levelNo = action.index + 1;
    switch (action.kind) {
      case 'remove':
        return `Remove Level ${levelNo}? The levels below it will shift up to fill the gap. This only takes effect once you save.`;
      case 'up':
        return `Move Level ${levelNo} up one position? The affected levels will be renumbered. This only takes effect once you save.`;
      case 'down':
        return `Move Level ${levelNo} down one position? The affected levels will be renumbered. This only takes effect once you save.`;
      default:
        return '';
    }
  }

  async save(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saved.set(false);
    try {
      const items: LevelSyncItem[] = this.rows().map((row, i) => ({
        levelId: row.levelId,
        levelNo: i + 1,
        maxAmount: this.isLastRow(i) || row.noLimit ? 0 : (row.maxAmount ?? 0),
        escalationDays: row.escalationDays,
      }));
      await this.service.sync(tpId, custId, items);
      await this.load();
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2500);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save approval levels.');
    } finally {
      this.saving.set(false);
    }
  }

  async runSimulation(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const amount = this.simAmount();
    if (!tpId || !custId || !amount || amount <= 0) return;
    this.simLoading.set(true);
    this.simError.set(null);
    try {
      const result = await this.service.simulate(tpId, custId, amount, 0);
      this.simResult.set(result.simulation ?? null);
    } catch (err) {
      this.simError.set(err instanceof Error ? err.message : 'Failed to simulate.');
    } finally {
      this.simLoading.set(false);
    }
  }

  simulationSentence(): string {
    const sim = this.simResult();
    if (!sim) return '';
    const steps = sim.path.map(s => {
      if (s.willSkip === 'Y') return `${s.roleNames ?? 'Level ' + s.levelNo} (skipped, nobody assigned)`;
      return `${s.roleNames ?? 'Level ' + s.levelNo} (${s.escalationDays}d)`;
    });
    const prefix = `A $${sim.amount.toFixed(2)} order needs: `;
    if (sim.endsWith === 'NONE') return `${prefix}nobody can approve this order.`;
    const suffix = sim.endsWith === 'OVERRIDE' ? ' → an administrator (override)' : '';
    return `${prefix}${steps.join(' → ')}${suffix}.`;
  }
}
