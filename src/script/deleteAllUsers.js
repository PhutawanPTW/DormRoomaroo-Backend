const admin = require('firebase-admin');
const pool = require('../db');
const path = require('path');
const fs = require('fs');

// Load Firebase service account key
let serviceAccount;
try {
  const keyPath = path.resolve(__dirname, '../../firebase-admin-key.json');
  if (fs.existsSync(keyPath)) {
    serviceAccount = require(keyPath);
  } else {
    console.error('Firebase service account key not found');
    process.exit(1);
  }
} catch (error) {
  console.error('Error loading Firebase service account:', error);
  process.exit(1);
}

// Initialize the Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function deleteAllUsers(nextPageToken) {
  try {
    // Get a batch of users from Firebase Auth
    const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
    const users = listUsersResult.users;
    const uidsToDelete = users.map(user => user.uid);
    
    if (uidsToDelete.length) {
      // First delete related records with foreign keys
      try {
        console.log('Deleting related records from PostgreSQL database...');
        
        // Step 1: Log the UIDs we're trying to delete for debugging
        console.log('Firebase UIDs to delete:', uidsToDelete);
        
        // Step 2: First check if these users exist in the database
        const checkQuery = `SELECT firebase_uid, id FROM users WHERE firebase_uid = ANY($1::text[])`;
        const checkResult = await pool.query(checkQuery, [uidsToDelete]);
        console.log(`Found ${checkResult.rowCount} matching users in PostgreSQL`);
        
        if (checkResult.rowCount > 0) {
          // Step 3: Get user IDs for foreign key references
          const userIds = checkResult.rows.map(row => row.id);
          console.log('PostgreSQL user IDs to delete:', userIds);
          
          // Step 4: Delete from related tables first (handle foreign key constraints)
          const relatedTables = [
            'membership_requests',
            'reviews',
            // Add other tables with foreign keys to users
          ];
          
          for (const table of relatedTables) {
            try {
              const relatedQuery = `DELETE FROM ${table} WHERE user_id = ANY($1::integer[])`;
              const relatedResult = await pool.query(relatedQuery, [userIds]);
              console.log(`Deleted ${relatedResult.rowCount} rows from ${table}`);
            } catch (tableError) {
              console.error(`Error deleting from ${table}:`, tableError);
            }
          }
          
          // Step 5: Now delete the users
          const deleteQuery = `DELETE FROM users WHERE id = ANY($1::integer[])`;
          const dbResult = await pool.query(deleteQuery, [userIds]);
          console.log(`Deleted ${dbResult.rowCount} users from PostgreSQL database`);
        }
      } catch (dbError) {
        console.error('Error deleting users from database:', dbError);
      }
      
      // Then delete from Firebase Auth
      await admin.auth().deleteUsers(uidsToDelete);
      console.log(`Deleted ${uidsToDelete.length} users from Firebase Authentication`);
    }

    // If there are more users, continue with the next batch
    if (listUsersResult.pageToken) {
      await deleteAllUsers(listUsersResult.pageToken);
    } else {
      console.log('All users have been deleted');
      process.exit(0); // Exit when done
    }
  } catch (error) {
    console.error('Error deleting users:', error);
    process.exit(1);
  }
}

// Start the deletion process
deleteAllUsers()
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
