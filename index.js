const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 56503;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const OPENAI_API_TOKEN = process.env.OPENAI_API_TOKEN;
const ANON_LOGS_CHANNEL = '#anon-logs';

let allUsers = [];
let matchedPairs = new Set(); // Track matched pairs

const questions = [
  'What programming languages do you use? (e.g., JavaScript, Python, C, etc.)',
  'What is your technology stack? (e.g., Web Development, Game Development, AI/ML, etc.)',
  'Do you engage in or enjoy activities like design, writing, music, or art?',
];

app.post('/slack/commands', async (req, res) => {
  console.log('Received Slack command payload:', req.body);
  res.status(200).send(); // Acknowledge Slack command immediately

  const { user_id, trigger_id } = req.body;

  // Remove previous submission if user submits form again
  allUsers = allUsers.filter(user => user.userId !== user_id);

  // Create a form modal view
  const modalView = {
    type: 'modal',
    callback_id: 'submit_form',
    title: {
      type: 'plain_text',
      text: 'Anon Meet Form',
      emoji: true
    },
    submit: {
      type: 'plain_text',
      text: 'Submit',
      emoji: true
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true
    },
    blocks: questions.map((question, index) => ({
      type: 'input',
      block_id: `question_${index + 1}`,
      element: {
        type: 'plain_text_input',
        action_id: `answer_${index + 1}`
      },
      label: {
        type: 'plain_text',
        text: question,
        emoji: true
      }
    }))
  };

  try {
    // Open the modal using Slack's views.open API
    const response = await axios.post('https://slack.com/api/views.open', {
      trigger_id: trigger_id,
      view: modalView
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
    });

    if (!response.data.ok) {
      console.error('Error opening modal:', response.data.error);
      console.error('Full response:', response.data);
    } else {
      console.log('Modal opened successfully.');
    }
  } catch (error) {
    console.error('Error opening modal:', error.message);
  }
});

app.post('/slack/events', async (req, res) => {
  try {
    if (req.body.type === 'url_verification') {
      // Respond to Slack's URL verification challenge
      res.send(req.body.challenge);
    } else if (req.body.payload) {
      // Handle interactive components
      const payload = JSON.parse(req.body.payload);

      if (payload.type === 'view_submission') {
        const userId = payload.user.id;
        const answers = Object.values(payload.view.state.values).map(valueObj => Object.values(valueObj)[0].value);

        allUsers.push({ userId, answers });

        await logResponsesToChannel(userId, answers);
        await analyzeAndLogConnections();

        res.json({ "response_action": "clear" }); // Acknowledge the form submission and clear the modal
      } else {
        res.status(200).send(); // Default response for other actions
      }
    } else {
      res.status(200).send(); // Default response for other events
    }
  } catch (error) {
    console.error('Error processing Slack event:', error);
    res.status(500).send('Server error');
  }
});

async function logResponsesToChannel(user_id, answers) {
  const text = `User <@${user_id}> submitted their form:\n\n` +
    questions.map((q, i) => `${i + 1}. ${q}\n   - ${answers[i]}`).join('\n\n');

  try {
    await axios.post(
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
  } catch (error) {
    console.error('Error logging responses:', error.message);
  }
}

async function analyzeAndLogConnections() {
  if (allUsers.length < 2) return; // Need at least two users to find connections

  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      const user1 = allUsers[i];
      const user2 = allUsers[j];

      const userPairKey = `${user1.userId}:${user2.userId}`; // Unique key for each pair

      if (!matchedPairs.has(userPairKey) && user1.userId !== user2.userId) {
        const user1Answers = user1.answers.join(' ');
        const user2Answers = user2.answers.join(' ');

        const matchResult = await getMatchPercentage(user1Answers, user2Answers);

        if (matchResult) {
          const uniqueChannelName = generateValidChannelName();
          
          await createPrivateChannelsAndNotify(user1.userId, user2.userId, uniqueChannelName);
          
          matchedPairs.add(userPairKey); // Mark this pair as matched
          matchedPairs.add(`${user2.userId}:${user1.userId}`); // Also mark the reverse pair as matched
        }
      }
    }
  }
}

async function getMatchPercentage(user1Answers, user2Answers) {
  try {
    const response = await fetch('https://jamsapi.hackclub.dev/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_TOKEN}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: `Compare the following user interests and provide a match percentage based on shared interests. Focus on positive matches:

User 1: ${user1Answers}
User 2: ${user2Answers}

Provide the match percentage and reasons for the match.`,
          },
        ],
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI API:', error.message);
    return null;
  }
}

function generateValidChannelName() {
  let name = 'anonmeet-' + Math.random().toString(36).substring(2, 10);
  // Ensure name meets Slack's channel naming rules: lowercase, hyphens allowed, no spaces or special characters
  name = name.replace(/[^a-z0-9-]/g, '').toLowerCase(); 
  return name;
}

async function createPrivateChannelsAndNotify(user1Id, user2Id, baseChannelName) {
  const channelNameA = `${baseChannelName}-a`;
  const channelNameB = `${baseChannelName}-b`;

  // Create two separate private channels
  const channelIdA = await createPrivateChannel(channelNameA);
  const channelIdB = await createPrivateChannel(channelNameB);

  if (channelIdA && channelIdB) {
    // Invite the bot and the users separately to their respective channels
    await inviteUserToChannel(channelIdA, user1Id);
    await inviteUserToChannel(channelIdB, user2Id);

    // Notify both users
    await sendDM(user1Id, `Hey, there's a match for you! Talk to the person in <#${channelIdA}>.`);
    await sendDM(user2Id, `Hey, there's a match for you! Talk to the person in <#${channelIdB}>.`);
  }
}

async function createPrivateChannel(channelName) {
  try {
    const response = await axios.post(
      'https://slack.com/api/conversations.create',
      {
        name: channelName,
        is_private: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );

    if (response.data.ok) {
      return response.data.channel.id;
    } else {
      console.error('Error creating private channel:', response.data.error);
      return null;
    }
  } catch (error) {
    console.error('Error creating private channel:', error.message);
    return null;
  }
}

async function inviteUserToChannel(channelId, userId) {
  try {
    const response = await axios.post(
      'https://slack.com/api/conversations.invite',
      {
        channel: channelId,
        users: userId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );

    if (!response.data.ok) {
      console.error('Error inviting user to channel:', response.data.error);
    }
  } catch (error) {
    console.error('Error inviting user to channel:', error.message);
  }
}

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
    }
  } catch (error) {
    console.error('Error sending DM:', error.message);
  }
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
