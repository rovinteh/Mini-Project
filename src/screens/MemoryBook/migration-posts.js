// migrate-posts.js
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  // OR use serviceAccount if you prefer
});

const db = admin.firestore();

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

async function run() {
  const snap = await db.collection("posts").get();
  console.log("Total posts:", snap.size);

  let batch = db.batch();
  let count = 0;
  let committed = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // Skip if already migrated (has mood + albums + albumIds)
    const hasMood = !!data.mood?.date && !!data.mood?.monthKey;
    const hasAlbums = Array.isArray(data.albums);
    const hasAlbumIds = Array.isArray(data.albumIds);

    if (hasMood && hasAlbums && hasAlbumIds) continue;

    // Use createdAt if exists, else fallback to "now"
    let d = new Date();
    const createdAt = data.createdAt;
    if (createdAt && typeof createdAt.toDate === "function") {
      d = createdAt.toDate();
    } else if (typeof createdAt === "string" || typeof createdAt === "number") {
      const tmp = new Date(createdAt);
      if (!isNaN(tmp.getTime())) d = tmp;
    }

    const update = {
      albums: hasAlbums ? data.albums : [],
      albumIds: hasAlbumIds ? data.albumIds : [],
      mood: hasMood
        ? data.mood
        : {
            date: dateKeyFromDate(d),
            monthKey: monthKeyFromDate(d),
            emoji: "😐",
          },
    };

    batch.update(docSnap.ref, update);
    count++;

    // Firestore batch limit is 500 operations
    if (count % 450 === 0) {
      await batch.commit();
      committed += 1;
      console.log(`Committed batch #${committed}, updated ${count} posts so far...`);
      batch = db.batch();
    }
  }

  // commit remaining
  await batch.commit();
  console.log("DONE. Updated posts:", count);
}

run().catch(console.error);
