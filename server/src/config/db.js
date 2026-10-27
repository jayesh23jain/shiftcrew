import mongoose from 'mongoose';
import { env } from './env.js';

let isConnected = false;

export async function connectDB() {
  if (mongoose.connection.readyState >= 1) return mongoose.connection;
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI);
  isConnected = true;
  console.log('MongoDB connected');
  return mongoose.connection;
}

