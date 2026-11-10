import { getDb, schema } from "./client";

// Opening the database runs migrations and the seed; then print what is there.
const db = await getDb();
const members = await db.select().from(schema.members);
const places = await db.select().from(schema.places);
console.log(`Database ready: ${members.length} members, ${places.length} places.`);
process.exit(0);
