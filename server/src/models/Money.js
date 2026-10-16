import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (ref) => ({ type: Schema.Types.ObjectId, ref });

// All amounts are integers in paise.
const walletSchema = new Schema(
  {
    orgId: { ...oid('Organization'), required: true, unique: true },
    available: { type: Number, default: 0, min: 0 },
    totalFunded: { type: Number, default: 0 },
    totalPaidOut: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const Wallet = mongoose.model('Wallet', walletSchema);

// Append-only. The unique idempotencyKey means a replayed webhook or double click can never apply twice.
const ledgerSchema = new Schema(
  {
    orgId: { ...oid('Organization'), required: true, index: true },
    type: {
      type: String,
      enum: ['fund', 'payout', 'fee', 'payout_reversal', 'fee_reversal', 'withdrawal'],
      required: true,
    },
    delta: { type: Number, required: true }, // signed change to wallet.available
    idempotencyKey: { type: String, required: true, unique: true },
    ref: {
      eventId: oid('Event'),
      payoutId: oid('Payout'),
      paymentId: oid('Payment'),
      userId: oid('User'),
    },
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ledgerSchema.index({ orgId: 1, createdAt: -1 });
export const LedgerEntry = mongoose.model('LedgerEntry', ledgerSchema);

const paymentSchema = new Schema(
  {
    orgId: { ...oid('Organization'), required: true, index: true },
    createdBy: oid('User'),
    provider: { type: String, enum: ['mock', 'razorpay'], required: true },
    orderId: { type: String, required: true, unique: true },
    paymentId: String,
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['created', 'captured', 'failed'], default: 'created' },
    capturedAt: Date,
    failureReason: String,
  },
  { timestamps: true }
);
export const Payment = mongoose.model('Payment', paymentSchema);

const payableSchema = new Schema(
  {
    attendanceId: { ...oid('Attendance'), required: true, unique: true },
    signupId: oid('Signup'),
    shiftId: oid('Shift'),
    eventId: { ...oid('Event'), required: true, index: true },
    orgId: { ...oid('Organization'), required: true },
    userId: { ...oid('User'), required: true, index: true },
    minutes: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['approved', 'processing', 'paid'], default: 'approved' },
    payoutId: oid('Payout'),
  },
  { timestamps: true }
);
export const Payable = mongoose.model('Payable', payableSchema);

const payoutSchema = new Schema(
  {
    orgId: { ...oid('Organization'), required: true, index: true },
    eventId: { ...oid('Event'), required: true, index: true },
    userId: { ...oid('User'), required: true, index: true },
    payableIds: [oid('Payable')],
    amount: { type: Number, required: true },
    fee: { type: Number, default: 0 },
    status: { type: String, enum: ['queued', 'processing', 'paid', 'failed'], default: 'queued' },
    failureReason: String,
    providerRef: String,
    receiptNo: String,
    upiMasked: String,
    requestedBy: oid('User'),
    paidAt: Date,
  },
  { timestamps: true }
);
export const Payout = mongoose.model('Payout', payoutSchema);

const payoutMethodSchema = new Schema(
  {
    userId: { ...oid('User'), required: true, unique: true },
    type: { type: String, enum: ['upi'], default: 'upi' },
    holderName: { type: String, trim: true },
    upiEnc: { type: String, required: true },
    upiMasked: { type: String, required: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);
export const PayoutMethod = mongoose.model('PayoutMethod', payoutMethodSchema);
