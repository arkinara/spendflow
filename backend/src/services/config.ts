import { and, asc, eq, lte } from "drizzle-orm";
import {
  approvalRoutesTable,
  approvalStepsTable,
  categoriesTable,
  policiesTable,
} from "../db/schema.js";
import type { DB } from "../db/index.js";
import type {
  ApprovalRouteConfig,
  RoutingStep,
} from "./approval-engine.js";
import type { CategoryCap, PolicyConfig } from "./policy.js";

/* -------------------------------------------------------- config loaders -- */

/** Active categories, ordered by name. */
export function listActiveCategories(db: DB): CategoryCap[] {
  return db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.active, true))
    .orderBy(asc(categoriesTable.name))
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      perItemCap: r.perItemCap,
      receiptThreshold: r.receiptThreshold,
    }));
}

/**
 * Active policies effective on/before the given ISO date (YYYY-MM-DD).
 * `effective_date` is stored as text "YYYY-MM-DD" so lexicographic `<=` is a
 * correct range check.
 */
export function listActivePolicies(db: DB, asOfIso: string): PolicyConfig[] {
  return db
    .select()
    .from(policiesTable)
    .where(
      and(
        eq(policiesTable.active, true),
        lte(policiesTable.effectiveDate, asOfIso)
      )
    )
    .all()
    .map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      limitAmount: r.limitAmount,
      receiptRequiredAbove: r.receiptRequiredAbove,
      receiptRequired: r.receiptRequired,
      justificationRequiredAbove: r.justificationRequiredAbove,
    }));
}

/**
 * Load the active + fallback routes with their ordered steps, normalised into
 * the shape the pure routing engine consumes.
 */
export function loadApprovalRoutes(db: DB): ApprovalRouteConfig[] {
  const routes = db
    .select()
    .from(approvalRoutesTable)
    .where(eq(approvalRoutesTable.active, true))
    .orderBy(asc(approvalRoutesTable.createdAt))
    .all();
  if (routes.length === 0) return [];
  const steps = db
    .select()
    .from(approvalStepsTable)
    .orderBy(asc(approvalStepsTable.orderIndex))
    .all();
  return routes.map((r) => {
    const routeSteps: RoutingStep[] = steps
      .filter((s) => s.routeId === r.id)
      .map((s) => ({
        id: s.id,
        approverType: s.approverType,
        approverId: s.approverId,
        label: s.label,
        orderIndex: s.orderIndex,
      }));
    return {
      id: r.id,
      name: r.name,
      active: r.active,
      isFallback: r.isFallback,
      match: {
        minAmount: r.matchMinAmount,
        maxAmount: r.matchMaxAmount,
        categoryId: r.matchCategoryId,
        department: r.matchDepartment,
      },
      steps: routeSteps,
    };
  });
}
