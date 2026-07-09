import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI!;
let client: MongoClient;
let db: Db;

export async function getMongoClient(): Promise<MongoClient> {
  if (client) return client;
  client = new MongoClient(uri);
  await client.connect();
  return client;
}

export async function getDb(): Promise<Db> {
  if (db) return db;
  const mongoClient = await getMongoClient();
  db = mongoClient.db("omsons");
  return db;
}
