import { Wallet, LedgerEntry } from '../models/Money.js';
import { ApiError } from '../utils/ApiError.js';

/*
 * Wallet design
 * -------------
 * wallet.available is the fast balance. Every change is also written to the append-only ledger with a unique
 * idempotencyKey. Credits write the ledger first, debits take the money first (conditional on funds), so a
 * retry or replay never applies twice and a debit can never overdraw. reconcile() proves the two agree.
 */

export async function getWallet(orgId) {
  return Wallet.findOneAndUpdate({ orgId }, { $setOnInsert: { orgId, available: 0 } }, { upsert: true, new: true });
}

const isDup = (err) => err?.code === 11000;

export async function credit(orgId, amount, { key, type = 'fund', ref, note }) {
  if (!Number.isInteger(amount) || amount <= 0) throw ApiError.badRequest('Invalid amount');
  try {
    await LedgerEntry.create({ orgId, type, delta: amount, idempotencyKey: key, ref, note });
  } catch (err) {
    if (isDup(err)) return { applied: false };
    throw err;
  }
  const inc = { available: amount };
  if (type === 'fund') inc.totalFunded = amount;
  await Wallet.updateOne({ orgId }, { $inc: inc }, { upsert: true });
  return { applied: true };
}

export async function debit(orgId, amount, { key, type, ref, note }) {
  if (!Number.isInteger(amount) || amount <= 0) throw ApiError.badRequest('Invalid amount');
  const inc = { available: -amount };
  if (type === 'payout') inc.totalPaidOut = amount;
  const wallet = await Wallet.findOneAndUpdate({ orgId, available: { $gte: amount } }, { $inc: inc }, { new: true });
  if (!wallet) throw new ApiError(402, 'Not enough funds in the event wallet. Add funds and try again.');
  try {
    await LedgerEntry.create({ orgId, type, delta: -amount, idempotencyKey: key, ref, note });
  } catch (err) {
    // Same key already applied: undo this duplicate deduction.
    await Wallet.updateOne({ orgId }, { $inc: { available: amount, ...(type === 'payout' ? { totalPaidOut: -amount } : {}) } });
    if (isDup(err)) throw ApiError.conflict('This transaction was already processed');
    throw err;
  }
  return wallet;
}

export async function reconcile(orgId) {
  const entries = await LedgerEntry.find({ orgId }).select('delta');
  const ledgerTotal = entries.reduce((s, e) => s + e.delta, 0);
  const wallet = await getWallet(orgId);
  return { ledgerTotal, walletAvailable: wallet.available, ok: ledgerTotal === wallet.available, entries: entries.length };
}
