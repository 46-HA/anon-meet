// database.js
const sqlite3 = require('sqlite3').verbose();

// Create a new SQLite database or open an existing one
const db = new sqlite3.Database('./anon_meet.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Initialize the user responses table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS user_responses (
    user_id TEXT PRIMARY KEY,
    answers TEXT
  )`);
});

function saveUserResponse(userId, answers) {
  return new Promise((resolve, reject) => {
    const answersStr = JSON.stringify(answers);
    db.run(
      `INSERT OR REPLACE INTO user_responses (user_id, answers) VALUES (?, ?)`,
      [userId, answersStr],
      function (err) {
        if (err) {
          reject('Error saving user response: ' + err.message);
        } else {
          resolve();
        }
      }
    );
  });
}

function getAllUserResponses() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM user_responses`, [], (err, rows) => {
      if (err) {
        reject('Error fetching user responses: ' + err.message);
      } else {
        const userResponses = rows.map(row => ({
          userId: row.user_id,
          answers: JSON.parse(row.answers),
        }));
        resolve(userResponses);
      }
    });
  });
}

module.exports = {
  saveUserResponse,
  getAllUserResponses,
};
