import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
let client: MongoClient | null = null;
let db: Db | null = null;

async function ensureMongoClient(): Promise<MongoClient> {
  if (client) {
    try {
      await client.db("admin").command({ ping: 1 });
      return client;
    } catch {
      client = null;
      db = null;
    }
  }

  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  client = new MongoClient(uri);
  await client.connect();
  return client;
}

export async function getMongoClient(): Promise<MongoClient> {
  return ensureMongoClient();
}

export async function getDb(): Promise<Db> {
  if (db) {
    try {
      await db.command({ ping: 1 });
      return db;
    } catch {
      db = null;
      client = null;
    }
  }

  const mongoClient = await ensureMongoClient();
  db = mongoClient.db("omsons");
  return db;
}
