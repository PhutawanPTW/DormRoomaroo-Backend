// ลบ Firebase user ที่ register ไม่สำเร็จ
const admin = require('../config/firebase').default;

async function deleteFirebaseUserByEmail(email) {
  try {
    console.log(`Looking for Firebase user with email: ${email}`);
    const user = await admin.auth().getUserByEmail(email);
    console.log(`Found user: ${user.uid}`);
    
    await admin.auth().deleteUser(user.uid);
    console.log(`✅ Successfully deleted Firebase user: ${email}`);
    
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log(`ℹ️  User ${email} not found in Firebase - already clean`);
    } else {
      console.error(`❌ Error deleting user ${email}:`, error.message);
    }
  }
}

// รัน script
async function main() {
  const emailToDelete = 'heekuytad@mailto.plus';
  await deleteFirebaseUserByEmail(emailToDelete);
  process.exit(0);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { deleteFirebaseUserByEmail };
