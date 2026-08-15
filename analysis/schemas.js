import { WEAKNESS_CATEGORIES } from '../data/themeMapping.js';

const CATEGORY_SET = new Set(WEAKNESS_CATEGORIES);
const SEVERITIES = new Set(['low', 'medium', 'high']);
const TRENDS = new Set(['improved', 'unchanged', 'worsened']);

export class SchemaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SchemaValidationError(`${label} must be a JSON object.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SchemaValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function category(value, label = 'category') {
  if (!CATEGORY_SET.has(value)) {
    throw new SchemaValidationError(`${label} must be one of: ${WEAKNESS_CATEGORIES.join(', ')}.`);
  }
  return value;
}

function uniqueBy(values, key, label) {
  const seen = new Set();
  for (const value of values) {
    const token = key(value);
    if (seen.has(token)) throw new SchemaValidationError(`${label} contains duplicate value: ${token}.`);
    seen.add(token);
  }
}

export function validateMoveClassification(value) {
  const result = object(value, 'classification');
  category(result.category);
  if (!SEVERITIES.has(result.severity)) {
    throw new SchemaValidationError('severity must be low, medium, or high.');
  }
  return {
    category: result.category,
    severity: result.severity,
    rationale: nonEmptyString(result.rationale, 'rationale'),
  };
}

export function validateWeaknessRanking(value, { eligiblePuzzleIds = [], evidenceCounts = null } = {}) {
  const result = object(value, 'ranking');
  if (!Array.isArray(result.ranked_weaknesses)) {
    throw new SchemaValidationError('ranked_weaknesses must be an array.');
  }
  if (!Array.isArray(result.selected_puzzle_ids)) {
    throw new SchemaValidationError('selected_puzzle_ids must be an array.');
  }

  const ranked = result.ranked_weaknesses.map((entry, index) => {
    object(entry, `ranked_weaknesses[${index}]`);
    category(entry.category, `ranked_weaknesses[${index}].category`);
    if (!Number.isInteger(entry.evidence_count) || entry.evidence_count < 0) {
      throw new SchemaValidationError(`ranked_weaknesses[${index}].evidence_count must be a non-negative integer.`);
    }
    if (evidenceCounts && evidenceCounts[entry.category] !== entry.evidence_count) {
      throw new SchemaValidationError(
        `ranked_weaknesses[${index}].evidence_count must equal supplied evidence count ${evidenceCounts[entry.category] ?? 0}.`,
      );
    }
    return { category: entry.category, evidence_count: entry.evidence_count };
  });
  uniqueBy(ranked, (entry) => entry.category, 'ranked_weaknesses');
  if (evidenceCounts) {
    const suppliedCategories = Object.entries(evidenceCounts)
      .filter(([, count]) => count > 0)
      .map(([name]) => name);
    const rankedCategories = new Set(ranked.map((entry) => entry.category));
    for (const supplied of suppliedCategories) {
      if (!rankedCategories.has(supplied)) {
        throw new SchemaValidationError(`ranked_weaknesses omitted supplied evidence category: ${supplied}.`);
      }
    }
  }

  const eligible = new Set(eligiblePuzzleIds);
  const selected = result.selected_puzzle_ids.map((id, index) => {
    const normalized = nonEmptyString(id, `selected_puzzle_ids[${index}]`);
    if (!eligible.has(normalized)) {
      throw new SchemaValidationError(`selected_puzzle_ids contains ineligible puzzle: ${normalized}.`);
    }
    return normalized;
  });
  uniqueBy(selected, (id) => id, 'selected_puzzle_ids');
  return { ranked_weaknesses: ranked, selected_puzzle_ids: selected };
}

export function validateProgressReview(value) {
  const result = object(value, 'progress review');
  if (!Array.isArray(result.categories)) {
    throw new SchemaValidationError('categories must be an array.');
  }
  const categories = result.categories.map((entry, index) => {
    object(entry, `categories[${index}]`);
    category(entry.category, `categories[${index}].category`);
    if (!TRENDS.has(entry.trend)) {
      throw new SchemaValidationError(`categories[${index}].trend must be improved, unchanged, or worsened.`);
    }
    return {
      category: entry.category,
      trend: entry.trend,
      evidence: nonEmptyString(entry.evidence, `categories[${index}].evidence`),
    };
  });
  uniqueBy(categories, (entry) => entry.category, 'categories');
  return { categories };
}
