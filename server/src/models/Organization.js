import mongoose from 'mongoose';

const { Schema } = mongoose;

const orgSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: {
      type: String,
      enum: ['college_club', 'ngo', 'fest_committee', 'company', 'other'],
      default: 'other',
    },
    description: { type: String, maxlength: 1000 },
    city: { type: String, trim: true },
    logoUrl: String,
    verified: { type: Boolean, default: false },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: ['owner', 'organizer'], default: 'organizer' },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

orgSchema.index({ 'members.userId': 1 });

export const Organization = mongoose.model('Organization', orgSchema);
