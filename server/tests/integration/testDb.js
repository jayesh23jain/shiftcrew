import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod = null;

export async function connectTestDb() {
  if (process.env.TEST_MONGO_URI) {
    await mongoose.connect(process.env.TEST_MONGO_URI);
    return;
  }

  // Try local MongoDB first (fast check)
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/shiftcrew_test', {
      serverSelectionTimeoutMS: 800,
    });
    return;
  } catch {
    // Fall back to in-memory MongoDB
    if (!mongod) {
      mongod = await MongoMemoryServer.create();
    }
    await mongoose.connect(mongod.getUri());
  }
}

export async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.connection.dropDatabase();
    } catch {}
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}
