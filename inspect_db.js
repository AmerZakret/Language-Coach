const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is required.');
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  
  // 1. Fetch Users
  const users = await db.collection('users').find({}).toArray();
  console.log('\n--- USERS ---');
  for (const user of users) {
    console.log({
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      totalXp: user.totalXp,
      xpPerLanguage: user.xpPerLanguage,
      levelPerLanguage: user.levelPerLanguage,
    });
  }

  // 2. Fetch Progress
  const progressList = await db.collection('progresses').find({}).toArray();
  console.log('\n--- PROGRESSES ---');
  for (const p of progressList) {
    console.log({
      _id: p._id.toString(),
      userId: p.userId,
      lessonId: p.lessonId,
      score: p.score,
      status: p.status,
      targetLanguage: p.targetLanguage,
    });
  }

  await mongoose.disconnect();
  console.log('\nDisconnected.');
}

run().catch(console.error);
