"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Send,
  MapPin,
  Wallet,
  AlertTriangle,
  RefreshCw,
  Plane,
  BedDouble,
  Utensils,
  Car,
  Route as RouteIcon,
  Receipt as ReceiptIcon,
  Download,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { useSnackbar } from "@/components/ui/Snackbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stepper } from "@/components/ui/Stepper";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  categories,
  getCategory,
  MILEAGE_RATE,
} from "@/lib/mock/mock_data";
import type { ExpenseCategoryId } from "@/lib/types";
import {
  evaluatePolicy,
  violationsForLine,
  deriveException,
  type PolicyViolation,
} from "@/lib/mock/policy";
import { useSubmitClaim } from "@/lib/mock/useSubmitClaim";
import type { ClaimInput, ClaimLineInput } from "@/lib/mock/useSubmitClaim";
import { formatCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ types -- */

interface DraftLine {
  id: string;
  categoryId: ExpenseCategoryId;
  merchant: string;
  description: string;
  date: string;
  amount: string; // for mileage: computed from distance × rate, editable
  currency: CurrencyCode;
  distance: string; // km — mileage only
  rate: string; // per-km — mileage only
  attachment?: UploadedFile;
  attachmentError?: string;
  /** Real in-session File picked by the user (uploaded on submit, #18). */
  file?: File;
}

const STEPS = [
  { label: "Trip details" },
  { label: "Expenses" },
  { label: "Review & submit" },
];

const CATEGORY_OPTIONS = categories.map((c) => ({ value: c.id, label: c.name }));
const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: "IDR", label: "IDR — Indonesian Rupiah" },
  { value: "USD", label: "USD — US Dollar" },
];

const CATEGORY_ICON: Record<ExpenseCategoryId, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  meals: Utensils,
  taxi: Car,
  mileage: RouteIcon,
  other: ReceiptIcon,
};

let lineCounter = 0;
function newLine(defaultCurrency: CurrencyCode): DraftLine {
  lineCounter += 1;
  return {
    id: `draft-${lineCounter}`,
    categoryId: "flight",
    merchant: "",
    description: "",
    date: "",
    amount: "",
    currency: defaultCurrency,
    distance: "",
    rate: String(MILEAGE_RATE),
    attachment: undefined,
    attachmentError: undefined,
  };
}

const ATTACHMENT_EXTENSIONS = /\.(pdf|png|jpe?g)$/i;
function detectMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

/* ----------------------------------------------------------------- helpers -- */

function lineAmount(l: DraftLine): number {
  if (l.categoryId === "mileage") {
    const explicit = Number(l.amount);
    if (Number.isFinite(explicit) && explicit !== 0) return explicit;
    const km = Number(l.distance) || 0;
    const r = Number(l.rate) || 0;
    return Math.round(km * r);
  }
  const a = Number(l.amount);
  return Number.isFinite(a) ? a : 0;
}

function recalcMileage(l: DraftLine): DraftLine {
  if (l.categoryId !== "mileage") return l;
  const km = Number(l.distance) || 0;
  const r = Number(l.rate) || 0;
  return { ...l, amount: String(Math.round(km * r)) };
}

/* ------------------------------------------------------------------- page --- */

export default function NewClaimPage() {
  const router = useRouter();
  const { user } = useRole();
  const { show } = useSnackbar();
  const { state: submitState, submit, reset } = useSubmitClaim();

  const [step, setStep] = React.useState(0);

  const [title, setTitle] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [tripStart, setTripStart] = React.useState("");
  const [tripEnd, setTripEnd] = React.useState("");
  const [claimCurrency, setClaimCurrency] = React.useState<CurrencyCode>("IDR");

  const [lines, setLines] = React.useState<DraftLine[]>([newLine("IDR")]);
  const [touched, setTouched] = React.useState(false);

  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  const policyViolations: PolicyViolation[] = React.useMemo(
    () =>
      evaluatePolicy(
        lines.map((l) => ({
          id: l.id,
          categoryId: l.categoryId,
          amount: lineAmount(l),
          currency: l.currency,
          hasAttachment: !!l.attachment,
        })),
        claimCurrency
      ),
    [lines, claimCurrency]
  );

  const step1Valid =
    title.trim() &&
    purpose.trim() &&
    destination.trim() &&
    tripStart &&
    tripEnd &&
    (!tripStart || !tripEnd || tripEnd >= tripStart);

  const everyLineValid = lines.every(
    (l) =>
      l.date &&
      l.description.trim() &&
      lineAmount(l) > 0
  );
  const step2Valid = lines.length > 0 && everyLineValid;

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function changeCategory(id: string, categoryId: ExpenseCategoryId) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next: DraftLine = { ...l, categoryId };
        if (categoryId === "mileage" && !l.rate) {
          next.rate = String(MILEAGE_RATE);
        }
        return recalcMileage(next);
      })
    );
  }

  function changeDistance(id: string, distance: string) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? recalcMileage({ ...l, distance }) : l))
    );
  }

  function changeRate(id: string, rate: string) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? recalcMileage({ ...l, rate }) : l))
    );
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine(claimCurrency)]);
  }

  function addAttachment(id: string, fileName: string, file?: File) {
    if (!ATTACHMENT_EXTENSIONS.test(fileName)) {
      updateLine(id, {
        attachmentError: "Unsupported file type. Use PDF, JPG or PNG.",
        attachment: undefined,
        file: undefined,
      });
      return;
    }
    updateLine(id, {
      attachment: {
        id: `${id}-att`,
        fileName,
        sizeKb: file ? Math.max(1, Math.round(file.size / 1024)) : 320,
        mimeType: file?.type || detectMime(fileName),
      },
      attachmentError: undefined,
      file,
    });
  }
  function removeAttachment(id: string) {
    // Only clear the attachment — manually entered merchant/amount/date stay intact.
    updateLine(id, { attachment: undefined, attachmentError: undefined, file: undefined });
  }

  function goBack() {
    setTouched(false);
    setStep((s) => Math.max(0, s - 1));
  }

  function next() {
    setTouched(true);
    if (step === 0 && !step1Valid) {
      show("Please complete all trip details.", { tone: "error" });
      return;
    }
    if (step === 1 && !step2Valid) {
      show("Each expense needs a description, date and amount.", { tone: "error" });
      return;
    }
    setTouched(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function buildInput(): ClaimInput {
    return {
      employeeId: user.id,
      title,
      purpose,
      destination,
      tripStart,
      tripEnd,
      currency: claimCurrency,
      exception: deriveException(policyViolations),
      lines: lines.map<ClaimLineInput>((l) => {
        const cat = getCategory(l.categoryId);
        const base: ClaimLineInput = {
          categoryId: l.categoryId,
          description: l.description.trim(),
          date: l.date,
          amount: lineAmount(l),
          currency: l.currency,
          merchant: l.merchant.trim() || undefined,
          attachment: l.attachment,
          file: l.file,
        };
        if (l.categoryId === "mileage") {
          base.quantity = Number(l.distance) || 0;
          base.unitLabel = "km";
          base.unitRate = Number(l.rate) || 0;
        } else if (cat?.id === "hotel") {
          base.quantity = 1;
          base.unitLabel = "nights";
        }
        return base;
      }),
    };
  }

  function onSubmit() {
    setTouched(true);
    if (!step2Valid) {
      show("Resolve the expense errors before submitting.", { tone: "error" });
      return;
    }
    submit(buildInput());
  }

  // Navigate to the new claim once the mock store confirms persistence.
  React.useEffect(() => {
    if (submitState.status === "success") {
      show("Claim submitted for approval.", { tone: "success" });
      router.push(`/employee/claims/${submitState.claimId}`);
    }
  }, [submitState.status, router, show]);

  const submitting = submitState.status === "submitting";

  return (
    <AppShell>
      <div className="mx-0 max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Button href="/employee/claims" variant="text" size="sm" icon={ArrowLeft}>
            Back
          </Button>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">
            New expense claim
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Submitting as {user.name} · routes to Dewi Anggraeni for approval.
          </p>
        </div>

        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <Card title="Trip details" subtitle="What was this trip for?">
            <div className="space-y-4">
              <TextField
                label="Claim title"
                placeholder="e.g. Q2 Client Visit – Jakarta"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                error={touched && !title.trim() ? "A title is required." : undefined}
                required
              />
              <TextArea
                label="Purpose"
                placeholder="Briefly describe the business reason for the trip."
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                error={touched && !purpose.trim() ? "A purpose is required." : undefined}
                required
              />
              <TextField
                label="Destination"
                iconLeft={MapPin}
                placeholder="e.g. Jakarta"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                error={
                  touched && !destination.trim() ? "A destination is required." : undefined
                }
                required
              />
              <Select
                label="Claim currency"
                helper="Line items in another currency will warn a mismatch."
                options={CURRENCY_OPTIONS}
                value={claimCurrency}
                onChange={(v) => {
                  const next = v as CurrencyCode;
                  setClaimCurrency(next);
                  // default new line currencies to the claim currency
                  setLines((prev) =>
                    prev.map((l) => (l.currency ? l : { ...l, currency: next }))
                  );
                }}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DateField
                  label="Trip start"
                  value={tripStart}
                  onChange={(e) => setTripStart(e.target.value)}
                  error={touched && !tripStart ? "Required." : undefined}
                  required
                />
                <DateField
                  label="Trip end"
                  value={tripEnd}
                  onChange={(e) => setTripEnd(e.target.value)}
                  error={
                    touched
                      ? !tripEnd
                        ? "Required."
                        : tripStart && tripEnd < tripStart
                        ? "End must be on or after the start."
                        : undefined
                      : undefined
                  }
                  required
                />
              </div>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Card
              title="Expense lines"
              subtitle="Add each expense from the trip, with its receipt."
            >
              {lines.length === 0 ? (
                <div
                  role="alert"
                  className="rounded-xl border border-warning/40 bg-warning-container/30 p-4 text-sm text-on-surface"
                >
                  At least one line item is required. Add an expense to continue.
                </div>
              ) : (
                <div className="space-y-4">
                  {lines.map((l, idx) => (
                    <LineItemEditor
                      key={l.id}
                      line={l}
                      index={idx}
                      canRemove={lines.length > 0}
                      touched={touched}
                      violations={violationsForLine(policyViolations, l.id)}
                      onChangeCategory={changeCategory}
                      onUpdate={updateLine}
                      onChangeDistance={changeDistance}
                      onChangeRate={changeRate}
                      onRemove={removeLine}
                      onAddAttachment={addAttachment}
                      onRemoveAttachment={removeAttachment}
                    />
                  ))}
                </div>
              )}
              <div className="mt-4">
                <Button variant="tonal" icon={Plus} onClick={addLine}>
                  Add another expense
                </Button>
              </div>
            </Card>
          </div>
        )}

        {step === 2 && (
          <ReviewStep
            title={title}
            purpose={purpose}
            destination={destination}
            tripStart={tripStart}
            tripEnd={tripEnd}
            claimCurrency={claimCurrency}
            lines={lines}
            total={total}
            violations={policyViolations}
            submitState={submitState}
            onSubmit={onSubmit}
            onRetry={reset}
          />
        )}

        {submitting && (
          <SubmitSkeleton progress={submitState.status === "submitting" ? submitState.progress : undefined} />
        )}

        {/* Wizard nav */}
        {!submitting && step < STEPS.length - 1 && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="text" icon={ArrowLeft} onClick={goBack} disabled={step === 0}>
              Back
            </Button>
            <Button iconRight={ArrowRight} onClick={next}>
              Continue
            </Button>
          </div>
        )}
        {!submitting && step === STEPS.length - 1 && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="text" icon={ArrowLeft} onClick={goBack}>
              Back
            </Button>
            <Button
              icon={Send}
              onClick={onSubmit}
              disabled={lines.length === 0 || !everyLineValid}
            >
              Submit claim
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------- line item editor -- */

interface LineItemEditorProps {
  line: DraftLine;
  index: number;
  canRemove: boolean;
  touched: boolean;
  violations: PolicyViolation[];
  onChangeCategory: (id: string, c: ExpenseCategoryId) => void;
  onUpdate: (id: string, patch: Partial<DraftLine>) => void;
  onChangeDistance: (id: string, v: string) => void;
  onChangeRate: (id: string, v: string) => void;
  onRemove: (id: string) => void;
  onAddAttachment: (id: string, fileName: string, file?: File) => void;
  onRemoveAttachment: (id: string) => void;
}

function LineItemEditor({
  line,
  index,
  canRemove,
  touched,
  violations,
  onChangeCategory,
  onUpdate,
  onChangeDistance,
  onChangeRate,
  onRemove,
  onAddAttachment,
  onRemoveAttachment,
}: LineItemEditorProps) {
  const isMileage = line.categoryId === "mileage";
  const cat = getCategory(line.categoryId);
  const Icon = CATEGORY_ICON[line.categoryId];
  const amount = lineAmount(line);
  const hasMissingReceipt = violations.some((v) => v.type === "missing_receipt");
  const hasOverCap = violations.some((v) => v.type === "over_category_max");
  const hasMismatch = violations.some((v) => v.type === "currency_mismatch");

  return (
    <div
      className="rounded-xl border border-outline-variant bg-surface-container-low p-4"
      aria-label={`Expense ${index + 1}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          Expense {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(line.id)}
            aria-label={`Remove expense ${index + 1}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Category"
          options={CATEGORY_OPTIONS}
          value={line.categoryId}
          onChange={(v) => onChangeCategory(line.id, v as ExpenseCategoryId)}
          required
        />
        <DateField
          label="Date"
          value={line.date}
          onChange={(e) => onUpdate(line.id, { date: e.target.value })}
          error={touched && !line.date ? "Required." : undefined}
          required
        />
        <TextField
          label="Merchant"
          placeholder="e.g. Garuda Indonesia, Hotel Mulia"
          value={line.merchant}
          onChange={(e) => onUpdate(line.id, { merchant: e.target.value })}
          helper="Enter the merchant manually — nothing is read from the file."
        />
        <Select
          label="Currency"
          options={CURRENCY_OPTIONS}
          value={line.currency}
          onChange={(v) => onUpdate(line.id, { currency: v as CurrencyCode })}
          required
        />
        <TextField
          containerClassName="sm:col-span-2"
          label="Description"
          placeholder={isMileage ? "e.g. Personal car to airport" : "e.g. Return flight CGK ⇄ SUB"}
          value={line.description}
          onChange={(e) => onUpdate(line.id, { description: e.target.value })}
          error={touched && !line.description.trim() ? "Required." : undefined}
          required
        />

        {isMileage ? (
          <>
            <TextField
              label="Distance (km)"
              type="number"
              inputMode="numeric"
              value={line.distance}
              onChange={(e) => onChangeDistance(line.id, e.target.value)}
              error={touched && amount <= 0 ? "Enter a distance." : undefined}
            />
            <TextField
              label={`Rate (${line.currency}/km)`}
              type="number"
              inputMode="numeric"
              value={line.rate}
              onChange={(e) => onChangeRate(line.id, e.target.value)}
              helper={`Default ${formatCurrency(MILEAGE_RATE)}/km`}
            />
            <TextField
              containerClassName="sm:col-span-2"
              label="Amount (computed — editable)"
              type="number"
              inputMode="numeric"
              value={line.amount}
              onChange={(e) => onUpdate(line.id, { amount: e.target.value })}
              helper={`Distance × rate = ${formatCurrency(amount, line.currency)}`}
              error={touched && amount <= 0 ? "Enter an amount." : undefined}
            />
          </>
        ) : (
          <TextField
            containerClassName="sm:col-span-2"
            label={`Amount (${line.currency})`}
            type="number"
            inputMode="numeric"
            value={line.amount}
            onChange={(e) => onUpdate(line.id, { amount: e.target.value })}
            error={touched && amount <= 0 ? "Enter an amount." : undefined}
            required
          />
        )}

        <div className="sm:col-span-2">
          <FileUpload
            files={line.attachment ? [line.attachment] : []}
            label="Receipt"
            helper="PDF, JPG or PNG. Attach a receipt for this expense."
            onAdd={(name, file) => onAddAttachment(line.id, name, file)}
            onRemove={() => onRemoveAttachment(line.id)}
          />
          {line.attachmentError && (
            <p role="alert" className="mt-1 text-xs text-error">
              {line.attachmentError}
            </p>
          )}
        </div>
      </div>

      {violations.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={`Policy warnings for expense ${index + 1}`}>
          {hasMissingReceipt && (
            <PolicyWarning>
              {violations.find((v) => v.type === "missing_receipt")!.message}
            </PolicyWarning>
          )}
          {hasOverCap && (
            <PolicyWarning>
              {violations.find((v) => v.type === "over_category_max")!.message}
            </PolicyWarning>
          )}
          {hasMismatch && (
            <PolicyWarning>
              {violations.find((v) => v.type === "currency_mismatch")!.message}
            </PolicyWarning>
          )}
        </ul>
      )}

      {cat && (
        <p className="mt-3 text-xs text-on-surface-variant">
          {cat.name}
          {cat.perItemCap ? ` · cap ${formatCurrency(cat.perItemCap)}` : ""}
          {cat.receiptThreshold > 0
            ? ` · receipt required above ${formatCurrency(cat.receiptThreshold)}`
            : ""}
        </p>
      )}
    </div>
  );
}

function PolicyWarning({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-container/30 px-3 py-2 text-xs text-on-surface">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/* ------------------------------------------------------------ review step -- */

interface ReviewStepProps {
  title: string;
  purpose: string;
  destination: string;
  tripStart: string;
  tripEnd: string;
  claimCurrency: CurrencyCode;
  lines: DraftLine[];
  total: number;
  violations: PolicyViolation[];
  submitState: ReturnType<typeof useSubmitClaim>["state"];
  onSubmit: () => void;
  onRetry: () => void;
}

function ReviewStep({
  title,
  purpose,
  destination,
  tripStart,
  tripEnd,
  claimCurrency,
  lines,
  total,
  violations,
  submitState,
  onSubmit,
  onRetry,
}: ReviewStepProps) {
  const hasWarnings = violations.length > 0;
  const allAttachments = lines.filter((l) => l.attachment);

  return (
    <div className="space-y-4">
      <Card title={title || "Untitled claim"} subtitle={`${destination || "—"} · ${tripStart || "—"} → ${tripEnd || "—"}`}>
        <p className="text-sm text-on-surface-variant">{purpose}</p>
      </Card>

      {hasWarnings && (
        <Card className="border-warning/40 bg-warning-container/30" role="alert">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
            <div>
              <p className="text-sm font-semibold text-on-surface">
                {violations.length} policy warning{violations.length > 1 ? "s" : ""} to review
              </p>
              <p className="text-sm text-on-surface-variant">
                You can still submit. Flagged line items will be marked for exception review by Finance.
              </p>
            </div>
          </div>
        </Card>
      )}

      {submitState.status === "error" && (
        <Card className="border-error/40 bg-error-container/40" role="alert">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
              <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">Couldn&rsquo;t submit your claim</p>
              <p className="text-sm text-on-surface-variant">
                {submitState.message} Your entries are saved — try again.
              </p>
            </div>
            <Button variant="outlined" icon={RefreshCw} onClick={onRetry}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      <Card title="Expense summary" padded={false}>
        {lines.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-on-surface-variant">
            No line items yet. Go back and add at least one expense.
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant px-2 py-1">
            {lines.map((l, idx) => {
              const lineVs = violationsForLine(violations, l.id);
              const flagged = lineVs.length > 0;
              return (
                <li key={l.id} className="px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-on-surface">
                        {l.description || getCategory(l.categoryId)?.name}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {getCategory(l.categoryId)?.name} · {l.date || "no date"}
                        {l.merchant ? ` · ${l.merchant}` : ""}
                        {l.categoryId === "mileage"
                          ? ` · ${l.distance || 0} km`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {flagged && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-container px-2 py-0.5 text-[11px] font-medium text-on-surface">
                          <AlertTriangle className="h-3 w-3 text-warning" strokeWidth={1.75} aria-hidden />
                          Flagged
                        </span>
                      )}
                      <span className="text-sm font-semibold text-on-surface">
                        {formatCurrency(lineAmount(l), l.currency)}
                      </span>
                    </div>
                  </div>
                  {l.attachment && (
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      aria-label={`View receipt ${l.attachment.fileName} for expense ${idx + 1}`}
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                      {l.attachment.fileName}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-outline-variant px-5 py-4">
          <span className="text-sm font-medium text-on-surface-variant">
            Total ({claimCurrency})
          </span>
          <span className="text-lg font-bold text-on-surface">{formatCurrency(total, claimCurrency)}</span>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <Wallet className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
          <p className="text-sm text-on-surface-variant">
            {allAttachments.length} receipt{allAttachments.length === 1 ? "" : "s"} attached
            {hasWarnings ? " · warnings will route this to Finance review" : ""}
            {" · will route to Dewi Anggraeni"}.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- submitting -- */

function SubmitSkeleton({ progress }: { progress?: string }) {
  return (
    <div aria-busy="true" role="status" aria-label="Submitting claim" className="space-y-4">
      <Card title="Expense summary" padded={false}>
        <Skeleton variant="list" lines={2} />
        <div className="border-t border-outline-variant px-5 py-4">
          <Skeleton className="h-6 w-40" />
        </div>
      </Card>
      <p className="text-center text-sm text-on-surface-variant">
        {progress || "Submitting your claim…"}
      </p>
    </div>
  );
}
