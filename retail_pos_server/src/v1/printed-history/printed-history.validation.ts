import { BadRequestException } from "../../libs/exceptions";
import {
  PRINTED_HISTORY_ENTITY_TYPES,
  type PrintedHistoryBody,
  type PrintedHistoryEntityType,
  type PrintedHistoryQuery,
} from "./printed-history.types";

const POSTGRES_INT_MAX = 2147483647;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrintedHistoryEntityType(
  value: string,
): value is PrintedHistoryEntityType {
  return PRINTED_HISTORY_ENTITY_TYPES.some((entityType) => entityType === value);
}

function parseEntityType(value: unknown): PrintedHistoryEntityType {
  if (
    typeof value !== "string" ||
    !isPrintedHistoryEntityType(value)
  ) {
    throw new BadRequestException(
      "entityType must be a supported printed history entity type",
    );
  }

  return value;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    parsed > POSTGRES_INT_MAX
  ) {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

export function parsePrintedHistoryBody(body: unknown): PrintedHistoryBody {
  if (!isObject(body)) {
    throw new BadRequestException("body must be an object");
  }

  return {
    entityType: parseEntityType(body.entityType),
    entityId: parsePositiveInteger(body.entityId, "entityId"),
  };
}

export function parsePrintedHistoryQuery(
  query: Record<string, unknown>,
): PrintedHistoryQuery {
  const entityType = parseEntityType(query.entityType);

  if (typeof query.entityIds !== "string" || query.entityIds.trim() === "") {
    throw new BadRequestException("entityIds must be a comma-separated list");
  }

  const entityIds = [
    ...new Set(
      query.entityIds
        .split(",")
        .map((rawId) => parsePositiveInteger(rawId.trim(), "entityIds")),
    ),
  ];

  if (entityIds.length === 0) {
    throw new BadRequestException("entityIds must be a comma-separated list");
  }

  return { entityType, entityIds };
}
