/**
 * Rule engine for automatic collection membership.
 *
 * Rules are evaluated against:
 *   - Product document (for scope = "product")
 *   - Variant sub-documents (for scope = "variant")
 *   - Inventory rows (when a rule has locationIds or locationScope set)
 *
 * All operators are case-sensitive strings. Field names are dot-paths.
 */

// ---------------------------------------------------------------------------
// Field whitelists
// ---------------------------------------------------------------------------

const PRODUCT_FIELDS = new Set([
  "name",
  "sku",
  "description",
  "vendor",
  "productType",
  "status",
  "type",
  "serviceKind",
  "trackInventory",
  "published",
  "price",
  "compareAtPrice",
  "cost",
  "weight",
  "tags",
  "handle",
]);

const VARIANT_FIELDS = new Set([
  "sku",
  "sourceSku",
  "barcode",
  "price",
  "compareAtPrice",
  "cost",
  "weight",
  "trackInventory",
  "continueSellingWhenOutOfStock",
  "status",
]);

// Location-aware fields only valid when the rule has locationIds/locationScope.
const LOCATION_FIELDS = new Set([
  "availableAtLocation",
  "onHandAtLocation",
  "committedAtLocation",
]);

const VALID_OPERATORS = new Set([
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_true",
  "is_false",
  "is_set",
  "is_not_set",
]);

// ---------------------------------------------------------------------------
// Rule validation
// ---------------------------------------------------------------------------

/**
 * Throws on an invalid rule. Returns the rule on success.
 * Called by the Collection controller on save so bad rules can't be stored.
 */
function validateRule(rule, { index } = {}) {
  const where = index !== undefined ? ` (rule ${index + 1})` : "";
  if (!rule || typeof rule !== "object") {
    throw new Error(`Invalid rule${where}: not an object`);
  }
  if (!rule.field || typeof rule.field !== "string") {
    throw new Error(`Invalid rule${where}: field is required`);
  }
  if (!rule.operator || !VALID_OPERATORS.has(rule.operator)) {
    throw new Error(
      `Invalid rule${where}: operator must be one of ${[...VALID_OPERATORS].join(", ")}`,
    );
  }
  const scope = rule.scope || "product";

  if (rule.quantifier === "count") {
    const validCountOps = [
      "equals",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
    ];
    if (!validCountOps.includes(rule.countOperator)) {
      throw new Error(
        `Invalid rule${where}: quantifier "count" requires countOperator`,
      );
    }
    if (typeof rule.countValue !== "number" || !Number.isFinite(rule.countValue)) {
      throw new Error(
        `Invalid rule${where}: quantifier "count" requires numeric countValue`,
      );
    }
  }

  const isLocationField = LOCATION_FIELDS.has(rule.field);

  if (isLocationField) {
    if (scope !== "variant") {
      throw new Error(
        `Invalid rule${where}: location-aware fields require scope = "variant"`,
      );
    }
    if (
      rule.locationScope !== "any" &&
      rule.locationScope !== "specified"
    ) {
      throw new Error(
        `Invalid rule${where}: location-aware rules require locationScope ("any" or "specified")`,
      );
    }
    if (
      rule.locationScope === "specified" &&
      (!Array.isArray(rule.locationIds) || rule.locationIds.length === 0)
    ) {
      throw new Error(
        `Invalid rule${where}: locationScope = "specified" requires locationIds`,
      );
    }
  } else if (scope === "product") {
    if (!PRODUCT_FIELDS.has(rule.field)) {
      throw new Error(
        `Invalid rule${where}: unknown product field "${rule.field}"`,
      );
    }
  } else if (scope === "variant") {
    if (!VARIANT_FIELDS.has(rule.field)) {
      throw new Error(
        `Invalid rule${where}: unknown variant field "${rule.field}"`,
      );
    }
  } else {
    throw new Error(`Invalid rule${where}: unknown scope "${scope}"`);
  }

  return rule;
}

// ---------------------------------------------------------------------------
// Value readers
// ---------------------------------------------------------------------------

function readPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function asString(v) {
  if (v == null) return "";
  return String(v);
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function isSet(v) {
  if (v == null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Operator implementations
// ---------------------------------------------------------------------------

/**
 * Apply one operator. `actual` is the value read from the document.
 * `expected` is rule.value.
 * Returns boolean.
 */
function applyOperator(operator, actual, expected) {
  switch (operator) {
    case "is_set":
      return isSet(actual);
    case "is_not_set":
      return !isSet(actual);

    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false;

    case "equals": {
      if (Array.isArray(actual)) {
        // Array equals: any element equals expected
        return actual.some((el) => asString(el) === asString(expected));
      }
      if (typeof actual === "number" || typeof expected === "number") {
        const a = asNumber(actual);
        const e = asNumber(expected);
        return Number.isFinite(a) && Number.isFinite(e) && a === e;
      }
      return asString(actual).toLowerCase() === asString(expected).toLowerCase();
    }

    case "not_equals": {
      if (Array.isArray(actual)) {
        return !actual.some((el) => asString(el) === asString(expected));
      }
      if (typeof actual === "number" || typeof expected === "number") {
        const a = asNumber(actual);
        const e = asNumber(expected);
        return !(Number.isFinite(a) && Number.isFinite(e) && a === e);
      }
      return asString(actual).toLowerCase() !== asString(expected).toLowerCase();
    }

    case "contains": {
      if (Array.isArray(actual)) {
        const needle = asString(expected).toLowerCase();
        return actual.some((el) => asString(el).toLowerCase().includes(needle));
      }
      return asString(actual).toLowerCase().includes(asString(expected).toLowerCase());
    }

    case "not_contains": {
      if (Array.isArray(actual)) {
        const needle = asString(expected).toLowerCase();
        return !actual.some((el) => asString(el).toLowerCase().includes(needle));
      }
      return !asString(actual).toLowerCase().includes(asString(expected).toLowerCase());
    }

    case "starts_with":
      return asString(actual).toLowerCase().startsWith(asString(expected).toLowerCase());

    case "ends_with":
      return asString(actual).toLowerCase().endsWith(asString(expected).toLowerCase());

    case "greater_than": {
      const a = asNumber(actual);
      const e = asNumber(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a > e;
    }
    case "greater_than_or_equal": {
      const a = asNumber(actual);
      const e = asNumber(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a >= e;
    }
    case "less_than": {
      const a = asNumber(actual);
      const e = asNumber(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a < e;
    }
    case "less_than_or_equal": {
      const a = asNumber(actual);
      const e = asNumber(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a <= e;
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------

function evaluateProductRule(product, rule) {
  const actual = readPath(product, rule.field);
  return applyOperator(rule.operator, actual, rule.value);
}

function evaluateVariantRule(variants, rule) {
  const matches = (variant) => {
    const actual = readPath(variant, rule.field);
    return applyOperator(rule.operator, actual, rule.value);
  };

  const quantifier = rule.quantifier || "any";

  if (quantifier === "any") {
    return variants.some(matches);
  }
  if (quantifier === "all") {
    return variants.length > 0 && variants.every(matches);
  }
  if (quantifier === "count") {
    const count = variants.filter(matches).length;
    const op = rule.countOperator || "greater_than_or_equal";
    const threshold = Number(rule.countValue) || 0;
    return applyOperator(op, count, threshold);
  }
  return false;
}

function evaluateLocationRule(variants, inventoryByVariantId, rule) {
  const matchesVariantAtAnyLocation = (variant) => {
    const perLocation = inventoryByVariantId.get(String(variant._id));
    if (!perLocation || perLocation.size === 0) return false;

    const locationsToCheck =
      rule.locationScope === "specified" && Array.isArray(rule.locationIds)
        ? rule.locationIds.map(String)
        : [...perLocation.keys()];

    for (const locId of locationsToCheck) {
      const inv = perLocation.get(String(locId));
      if (!inv) continue;

      let actual;
      if (rule.field === "availableAtLocation") actual = inv.available;
      else if (rule.field === "onHandAtLocation") actual = inv.onHand;
      else if (rule.field === "committedAtLocation") actual = inv.committed;
      else actual = undefined;

      if (applyOperator(rule.operator, actual, rule.value)) return true;
    }
    return false;
  };

  const quantifier = rule.quantifier || "any";

  if (quantifier === "any") {
    return variants.some(matchesVariantAtAnyLocation);
  }
  if (quantifier === "all") {
    return variants.length > 0 && variants.every(matchesVariantAtAnyLocation);
  }
  if (quantifier === "count") {
    const count = variants.filter(matchesVariantAtAnyLocation).length;
    const op = rule.countOperator || "greater_than_or_equal";
    const threshold = Number(rule.countValue) || 0;
    return applyOperator(op, count, threshold);
  }
  return false;
}

/**
 * Evaluate one rule against a product with its variants and inventory.
 *
 * @param {object} product - Product document (lean or Mongoose)
 * @param {Array} variants - Variant documents for this product
 * @param {Map} inventoryByVariantId - Map<variantId, Map<locationId, inventoryRow>>
 * @param {object} rule
 * @returns {boolean}
 */
function evaluateRule(product, variants, inventoryByVariantId, rule) {
  const isLocationField = LOCATION_FIELDS.has(rule.field);

  if (isLocationField) {
    return evaluateLocationRule(variants, inventoryByVariantId, rule);
  }

  const scope = rule.scope || "product";
  if (scope === "product") {
    return evaluateProductRule(product, rule);
  }
  return evaluateVariantRule(variants, rule);
}

/**
 * Evaluate a full rule set with AND/OR logic.
 * Empty rules = no match (misconfigured automatic collection).
 */
function evaluateRuleSet(product, variants, inventoryByVariantId, rules, ruleLogic) {
  if (!Array.isArray(rules) || rules.length === 0) return false;

  const results = rules.map((rule) =>
    evaluateRule(product, variants, inventoryByVariantId, rule),
  );

  if (ruleLogic === "OR") return results.some(Boolean);
  return results.every(Boolean);
}

// ---------------------------------------------------------------------------
// Change detection helpers
// ---------------------------------------------------------------------------

/**
 * Given a set of changed field names, return which rule fields might be affected.
 * Used for targeted recompute — if none of the changed fields appear in a
 * collection's rules, we can skip re-evaluating it.
 */
function fieldsOverlap(changedFields, rules) {
  if (!Array.isArray(changedFields) || changedFields.length === 0) return true;
  if (!Array.isArray(rules) || rules.length === 0) return false;

  const changedSet = new Set(changedFields.map((f) => String(f)));

  for (const rule of rules) {
    if (changedSet.has(rule.field)) return true;
    // Location-aware rule — any inventory change could affect it
    if (LOCATION_FIELDS.has(rule.field)) return true;
    // Product-scoped rule and the product was touched
    if ((rule.scope || "product") === "product" && changedSet.has("__product__")) {
      return true;
    }
    if (rule.scope === "variant" && changedSet.has("__variant__")) {
      return true;
    }
  }
  return false;
}

module.exports = {
  validateRule,
  evaluateRule,
  evaluateRuleSet,
  evaluateProductRule,
  evaluateVariantRule,
  evaluateLocationRule,
  applyOperator,
  fieldsOverlap,
  readPath,
  PRODUCT_FIELDS,
  VARIANT_FIELDS,
  LOCATION_FIELDS,
  VALID_OPERATORS,
};