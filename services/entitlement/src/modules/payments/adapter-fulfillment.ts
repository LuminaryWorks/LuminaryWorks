/** External adapters may not fulfill unless the signature, amount, and idempotency checks all pass. */
export function fulfillmentAllowed(input: {
  signatureOk: boolean;
  amountMatches: boolean;
  duplicate: boolean;
}): boolean {
  return input.signatureOk && input.amountMatches && !input.duplicate;
}
