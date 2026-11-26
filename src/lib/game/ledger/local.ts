/**
 * Local/offline ledger adapter. The worker's LedgerAgent remains the writer for
 * local matches and replay; online rooms use SpacetimeLedgerSource instead.
 */
export { LedgerAgent as LocalMatchLedger } from './agent';
export type {
	LedgerAdvanceResult,
	LedgerBlock,
	LedgerSubmitResult as LocalLedgerSubmitResult
} from './agent';
