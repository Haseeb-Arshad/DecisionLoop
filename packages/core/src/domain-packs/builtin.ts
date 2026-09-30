import { financePack, procurementPack, productPack } from "./business";
import { engineeringPack } from "./engineering";
import type { DomainPack } from "./pack";

/** The domains that ship with DecisionLoop. Profiles loaded at startup are added to (or replace) these. */
export const BUILTIN_PACKS: DomainPack[] = [engineeringPack, procurementPack, productPack, financePack];
