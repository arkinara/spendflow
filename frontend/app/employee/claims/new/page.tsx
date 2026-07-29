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
import { StatusChip } from "@/components/ui/StatusChip";
import { categories, getCategory, MILEAGE_RATE, type ExpenseCategoryId } from "@/lib/mock/mock_data";
import { formatCurrency } from "@/lib/format";

interface DraftLine {
  id: string;
  categoryId: ExpenseCategoryId;
  description: string;
  date: string;
  amount: string;
  quantity: string;
  hasReceipt: boolean;
}

const STEPS = [
  { label: "Trip details" },
  { label: "Expenses" },
  { label: "Review & submit" },
];

let lineCounter = 0;
function newLine(): DraftLine {
  lineCounter += 1;
  return {
    id: `draft-${lineCounter}`,
    categoryId: "flight",
    description: "",
    date: "",
    amount: "",
    quantity: "1",
    hasReceipt: false,
  };
}

const CATEGORY_OPTIONS = categories.map((c) => ({ value: c.id, label: c.name }));

export default function NewClaimPage() {
  const router = useRouter();
  const { user } = useRole();
  const { show } = useSnackbar();

  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [tripStart, setTripStart] = React.useState("");
  const [tripEnd, setTripEnd] = React.useState("");

  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [touched, setTouched] = React.useState(false);

  function lineAmount(l: DraftLine): number {
    if (l.categoryId === "mileage") {
      const km = Number(l.quantity) || 0;
      return km * MILEAGE_RATE;
    }
    return Number(l.amount) || 0;
  }
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  const step1Valid = title.trim() && purpose.trim() && destination.trim() && tripStart && tripEnd;
  const step2Valid =
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && l.date && lineAmount(l) > 0);

  // Receipt policy warnings for the review step.
  const receiptWarnings = lines.filter((l) => {
    const cat = getCategory(l.categoryId);
    if (!cat) return false;
    return cat.requiresReceipt && lineAmount(l) > cat.receiptThreshold && !l.hasReceipt;
  });

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
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

  function submit() {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      show("Claim submitted for approval.", {
        tone: "success",
        action: { label: "View", onClick: () => router.push("/employee/claims") },
      });
      router.push("/employee/claims");
    }, 900);
  }

  return (
    <AppShell>
      <div className="mx-0 max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Button href="/employee/claims" variant="text" size="sm" icon={ArrowLeft}>
            Back
          </Button>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">New expense claim</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Submitting as {user.name} · routes to {"Dewi Anggraeni"} for approval.
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
                error={touched && !destination.trim() ? "A destination is required." : undefined}
                required
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
                  error={touched && !tripEnd ? "Required." : undefined}
                  required
                />
              </div>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Card title="Expense lines" subtitle="Add each expense from the trip.">
              <div className="space-y-4">
                {lines.map((l, idx) => {
                  const isMileage = l.categoryId === "mileage";
                  const cat = getCategory(l.categoryId);
                  return (
                    <div
                      key={l.id}
                      className="rounded-xl border border-outline-variant bg-surface-container-low p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                          Expense {idx + 1}
                        </span>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            aria-label={`Remove expense ${idx + 1}`}
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
                          value={l.categoryId}
                          onChange={(v) => updateLine(l.id, { categoryId: v as ExpenseCategoryId })}
                        />
                        <DateField
                          label="Date"
                          value={l.date}
                          onChange={(e) => updateLine(l.id, { date: e.target.value })}
                          error={touched && !l.date ? "Required." : undefined}
                        />
                        <TextField
                          containerClassName="sm:col-span-2"
                          label="Description"
                          placeholder={isMileage ? "e.g. Personal car to airport" : "e.g. Return flight CGK ⇄ SUB"}
                          value={l.description}
                          onChange={(e) => updateLine(l.id, { description: e.target.value })}
                          error={touched && !l.description.trim() ? "Required." : undefined}
                        />
                        {isMileage ? (
                          <TextField
                            label="Distance (km)"
                            type="number"
                            inputMode="numeric"
                            value={l.quantity}
                            onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                            helper={`Reimbursed at ${formatCurrency(MILEAGE_RATE)} / km = ${formatCurrency(lineAmount(l))}`}
                          />
                        ) : (
                          <TextField
                            label="Amount (IDR)"
                            type="number"
                            inputMode="numeric"
                            value={l.amount}
                            onChange={(e) => updateLine(l.id, { amount: e.target.value })}
                            error={touched && lineAmount(l) <= 0 ? "Enter an amount." : undefined}
                          />
                        )}
                        <label className="flex items-center gap-3 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={l.hasReceipt}
                            onChange={(e) => updateLine(l.id, { hasReceipt: e.target.checked })}
                            className="h-5 w-5 rounded border-2 border-outline accent-primary"
                          />
                          <span className="text-sm text-on-surface">
                            I have a receipt for this expense
                            {cat && cat.requiresReceipt && (
                              <span className="text-on-surface-variant">
                                {" "}
                                (required above {formatCurrency(cat.receiptThreshold)})
                              </span>
                            )}
                          </span>
                        </label>
                      </div>
                    </div>
                  );
                })}
                <Button variant="tonal" icon={Plus} onClick={() => setLines((p) => [...p, newLine()])}>
                  Add another expense
                </Button>
              </div>
            </Card>

            <Card title="Receipts">
              <FileUpload
                files={files}
                onAdd={(name) =>
                  setFiles((f) => [
                    ...f,
                    {
                      id: `f-${f.length + 1}-${name}`,
                      fileName: name,
                      sizeKb: 320,
                      mimeType: name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg",
                    },
                  ])
                }
                onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))}
              />
            </Card>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Card title={title || "Untitled claim"} subtitle={`${destination} · ${tripStart} → ${tripEnd}`}>
              <p className="text-sm text-on-surface-variant">{purpose}</p>
            </Card>

            {receiptWarnings.length > 0 && (
              <Card className="border-warning/40 bg-warning-container/30">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">
                      {receiptWarnings.length} expense{receiptWarnings.length > 1 ? "s" : ""} may need a receipt
                    </p>
                    <p className="text-sm text-on-surface-variant">
                      These exceed the receipt threshold without an attached receipt and may be flagged for review.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            <Card title="Expense summary" padded={false}>
              <ul className="divide-y divide-outline-variant px-2 py-1">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-on-surface">
                        {l.description || getCategory(l.categoryId)?.name}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {getCategory(l.categoryId)?.name} · {l.date || "no date"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.hasReceipt ? (
                        <StatusChip status="approved" size="sm" />
                      ) : (
                        <span className="text-xs text-on-surface-variant">no receipt</span>
                      )}
                      <span className="text-sm font-semibold text-on-surface">
                        {formatCurrency(lineAmount(l))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-outline-variant px-5 py-4">
                <span className="text-sm font-medium text-on-surface-variant">Total</span>
                <span className="text-lg font-bold text-on-surface">{formatCurrency(total)}</span>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
                <p className="text-sm text-on-surface-variant">
                  {files.length} receipt{files.length === 1 ? "" : "s"} attached · will route to Dewi Anggraeni.
                </p>
              </div>
            </Card>
          </div>
        )}

        {/* Wizard nav */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="text"
            icon={ArrowLeft}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button iconRight={ArrowRight} onClick={next}>
              Continue
            </Button>
          ) : (
            <Button icon={Send} onClick={submit} loading={submitting}>
              Submit claim
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
