import mongoose from 'mongoose';

const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    userAgent: String,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['volunteer', 'organizer', 'admin'], default: 'volunteer' },
    phone: { type: String, trim: true },
    city: { type: String, trim: true },
    bio: { type: String, maxlength: 500 },
    skills: [{ type: String, trim: true }],
    languages: [{ type: String, trim: true }],
    emergencyContact: { name: String, phone: String },
    emailNotifications: { type: Boolean, default: true },
    reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
    emailVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    failedLogins: { type: Number, default: 0 },
    lockUntil: Date,
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.refreshTokens;
    delete ret.failedLogins;
    delete ret.lockUntil;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
