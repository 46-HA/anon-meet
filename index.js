const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 56503;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ANON_LOGS_CHANNEL = '#anon-logs'; // Replace with your actual channel ID

let userStates = {}; // { userId: { step: number, answers: {} } }

const questions = [
  'What programming languages do you use? (e.g., JavaScript, Python, C, etc.)',
  'What is your technology stack? (e.g., Web Development, Game Development, AI/ML, etc.)',
  'Do you engage in or enjoy activities like design, writing, music, or art?',
];

async function sendDM(userId, text) {
  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: userId,
        text: text,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );

    if (!response.data.ok) {
      console.error('Error sending DM:', response.data.error);
    } else {
      console.log('DM sent successfully:', response.data);
    }
  } catch (error) {
    console.error('Error sending DM:', error.message);
  }
}

async function logResponsesToChannel(userId, answers) {
  const text = `User <@${userId}> submitted their form:\n\n` +
    questions.map((q, i) => `${i + 1}. **${q}**\n   - ${answers[i]}`).join('\n\n');

  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: ANON_LOGS_CHANNEL,
        text: text,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );

    if (!response.data.ok) {
      console.error('Error logging responses:', response.data.error);
    }
  } catch (error) {
    console.error('Error logging responses:', error.message);
  }
}

// Handle Slack command to initiate form
app.post('/slack/commands', async (req, res) => {
  console.log('Received Slack command payload:', req.body);
  res.status(200).send(); // Respond to Slack immediately

  const { user_id, command } = req.body;
  if (command === '/form') {
    userStates[user_id] = { step: 0, answers: {} }; // Initialize or reset the user's state
    await sendDM(user_id, `Hey! Please answer the following questions:\n\n1. ${questions[0]}`); // Send greeting and first question in one message
  }
});

// Handle Slack events (DM interactions)
app.post('/slack/events', async (req, res) => {
  if (req.body.type === 'url_verification') {
    res.send(req.body.challenge); // Respond with the challenge token from Slack
  } else if (req.body.event && req.body.event.type === 'message' && !req.body.event.subtype) {
    const userId = req.body.event.user;
    const text = req.body.event.text;

    if (userStates[userId]) {
      const userState = userStates[userId];
      const currentStep = userState.step;

      // Save the user's answer to the current question
      if (text) {
        userState.answers[currentStep] = text; 
      }

      // Check if there are more questions to ask
      if (userState.step < questions.length - 1) {
        userState.step += 1; // Move to next question
        await sendDM(userId, `${userState.step + 1}. ${questions[userState.step]}`); // Ask next question
      } else {
        await logResponsesToChannel(userId, userState.answers); // Log responses
        delete userStates[userId]; // Clear user state after completion
        await sendDM(userId, 'Thank you for completing the form! Your responses have been logged.');
      }
    }

    res.status(200).send(); // Respond immediately to avoid timeout
  } else {
    res.status(200).send(); // For all other events, respond with a 200 status
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
