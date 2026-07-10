import { MongoClient, Db, MongoClientOptions, ServerApiVersion } from "mongodb";

const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB_NAME?.trim() || "omsons";

type MongoGlobalCache = {
  client?: MongoClient;
  clientPromise?: Promise<MongoClient>;
  db?: Db;
};

const mongoGlobal = globalThis as typeof globalThis & {
  __omsonsMongoCache?: MongoGlobalCache;
};

const cache = mongoGlobal.__omsonsMongoCache ?? (mongoGlobal.__omsonsMongoCache = {});
const MONGO_TIMEOUT_MS = 5000;

function readBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function buildMongoClientOptions(connectionString: string): MongoClientOptions {
  const isAtlasSrv = connectionString.startsWith("mongodb+srv://");
  const allowInvalidCertificates = readBooleanEnv("MONGODB_TLS_ALLOW_INVALID_CERTIFICATES");
  const allowInvalidHostnames = readBooleanEnv("MONGODB_TLS_ALLOW_INVALID_HOSTNAMES");

  return {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    // Node 24 can negotiate TLS differently than older runtimes; pin Atlas-style
    // SRV connections to TLS 1.2 unless the URI already provides its own override.
    ...(isAtlasSrv ? { secureProtocol: "TLSv1_2_method" } : {}),
    ...(allowInvalidCertificates !== undefined ? { tlsAllowInvalidCertificates: allowInvalidCertificates } : {}),
    ...(allowInvalidHostnames !== undefined ? { tlsAllowInvalidHostnames: allowInvalidHostnames } : {}),
  };
}

function withMongoTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out`)), MONGO_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function ensureMongoClient(): Promise<MongoClient> {
  if (cache.client) {
    try {
      await withMongoTimeout(cache.client.db("admin").command({ ping: 1 }), "Mongo ping");
      return cache.client;
    } catch {
      cache.client = undefined;
      cache.clientPromise = undefined;
      cache.db = undefined;
    }
  }

  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (!cache.clientPromise) {
    const client = new MongoClient(uri, buildMongoClientOptions(uri));
    cache.clientPromise = withMongoTimeout(client.connect(), "Mongo connection").then((connectedClient) => {
      cache.client = connectedClient;
      return connectedClient;
    }).catch((error) => {
      cache.client = undefined;
      cache.clientPromise = undefined;
      cache.db = undefined;
      throw error;
    });
  }

  return cache.clientPromise;
}

export async function getMongoClient(): Promise<MongoClient> {
  return ensureMongoClient();
}

export async function getDb(): Promise<Db> {
  if (cache.db) {
    try {
      await withMongoTimeout(cache.db.command({ ping: 1 }), "Mongo ping");
      return cache.db;
    } catch {
      cache.db = undefined;
      cache.client = undefined;
      cache.clientPromise = undefined;
    }
  }

  const mongoClient = await ensureMongoClient();
  cache.db = mongoClient.db(dbName);
  return cache.db;
}

export function isMongoDependencyError(error: unknown): boolean {
  if (error instanceof Error && error.message === "MONGODB_URI is not configured") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Mongo(ServerSelection|Network|Timeout|Topology|Parse)|server selection timed out|querySrv|ETIMEOUT|ECONNRESET|TLS|timed out/i.test(message);
}
