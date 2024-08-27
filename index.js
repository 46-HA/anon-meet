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
const END_REACTION = 'end';
const ARCHIVE_TIMER_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const ARCHIVE_AFTER_HOURS = 24; // Number of hours after which the channel will be archived

let allUsers = [];
let matchedPairs = new Set(); // Track matched pairs
let channelMapping = new Map(); // Track channels and their corresponding users

const questions = [
  'What programming languages do you use? (e.g., JavaScript, Python, C, etc.)',
  'What is your technology stack? (e.g., Web Development, Game Development, AI/ML, etc.)',
  'Do you engage in or enjoy activities like design, writing, music, or art?',
  'Top 5 favorite songs or Spotify integration?',
  'Favorite games/game genres?',
  'Books you like?',
  'Sports/Clubs (Hack Club, XC, Track)?',
  'What hackathons have you attended? (Trail, Summit, Boreal, Outernet, Wonderland)',
  'What foods do you like?',
  'Do you speak any other languages? If so, which ones?'
];

app.post('/slack/commands', async (req, res) => {
  const { user_id, trigger_id, command } = req.body;
  res.status(200).send(); // Acknowledge Slack command immediately

  if (command === '/form') {
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
      }
    } catch (error) {
      console.error('Error opening modal:', error.message);
    }
  }
});

app.post('/slack/events', async (req, res) => {
  try {
    if (req.body.type === 'url_verification') {
      // Respond to Slack's URL verification challenge
      res.send(req.body.challenge);
    } else if (req.body.event) {
      const event = req.body.event;
      // Handle message events in channels
      if (event.type === 'message' && !event.subtype && channelMapping.has(event.channel)) {
        await handleMessageEvent(event);
      }
      // Handle reaction added events
      if (event.type === 'reaction_added' && event.reaction === END_REACTION) {
        await handleEndReaction(event);
      }
      res.status(200).send(); // Acknowledge event
    } else if (req.body.payload) {
      // Handle interactive components
      const payload = JSON.parse(req.body.payload);

      if (payload.type === 'view_submission') {
        const userId = payload.user.id;
        const answers = Object.values(payload.view.state.values).map(valueObj => Object.values(valueObj)[0].value);

        // Respond promptly to avoid timeouts
        res.json({ "response_action": "clear" });

        allUsers.push({ userId, answers });

        await logResponsesToChannel(userId, answers);
        await analyzeAndLogConnections();
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

        if (matchResult && parseInt(matchResult.match(/(\d+)%/)[1], 10) >= 60) {
          const uniqueChannelName = generateValidChannelName();
          
          await createPrivateChannelsAndNotify(user1.userId, user2.userId, uniqueChannelName, matchResult);
          
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

async function createPrivateChannelsAndNotify(user1Id, user2Id, baseChannelName, matchResult) {
  const channelNameA = `${baseChannelName}-a`;
  const channelNameB = `${baseChannelName}-b`;

  // Create two separate private channels
  const channelIdA = await createPrivateChannel(channelNameA);
  const channelIdB = await createPrivateChannel(channelNameB);

  if (channelIdA && channelIdB) {
    // Map channels to users for relaying messages
    channelMapping.set(channelIdA, { user: user1Id, partner: user2Id, relayChannel: channelIdB });
    channelMapping.set(channelIdB, { user: user2Id, partner: user1Id, relayChannel: channelIdA });

    // Invite the bot and the users separately to their respective channels
    await inviteUserToChannel(channelIdA, user1Id);
    await inviteUserToChannel(channelIdB, user2Id);

    // Notify both users with match reason and instructions
    const matchMessage = `Hey! There's a match for you! Use this channel to communicate anonymously.\n\n*Match Reason:*\n${matchResult}\n\nTo end the conversation and reveal the identity of your partner, react to this message with :end: or include ':end:' in your message. The conversation will end, and both identities will be revealed. The channel will be archived automatically in 24 hours if no action is taken.`;

    await sendMessageToChannel(channelIdA, matchMessage);
    await sendMessageToChannel(channelIdB, matchMessage);

    await sendDM(user1Id, `Hey, there's a match for you! You can talk to the person in <#${channelIdA}>.\n\n*Match Reason:*\n${matchResult}\n\nTo end the conversation and reveal the identity of your partner, react to this message with :end: or include ':end:' in your message. The conversation will end, and both identities will be revealed. The channel will be archived automatically in 24 hours if no action is taken.`);
    await sendDM(user2Id, `Hey, there's a match for you! You can talk to the person in <#${channelIdB}>.\n\n*Match Reason:*\n${matchResult}\n\nTo end the conversation and reveal the identity of your partner, react to this message with :end: or include ':end:' in your message. The conversation will end, and both identities will be revealed. The channel will be archived automatically in 24 hours if no action is taken.`);

    // Start archive timer with hourly updates
    startArchiveTimer(channelIdA, channelIdB, user1Id, user2Id, ARCHIVE_AFTER_HOURS);
  }
}

async function startArchiveTimer(channelIdA, channelIdB, user1Id, user2Id, hoursLeft) {
  // Notify users of the time left
  if (hoursLeft > 0) {
    const timeMessage = `This channel will be archived in ${hoursLeft} hour(s).`;
    await sendMessageToChannel(channelIdA, timeMessage);
    await sendMessageToChannel(channelIdB, timeMessage);

    // Update every hour
    setTimeout(() => startArchiveTimer(channelIdA, channelIdB, user1Id, user2Id, hoursLeft - 1), ARCHIVE_TIMER_INTERVAL);
  } else {
    // Archive both channels after the time runs out
    await archiveChannels(channelIdA, channelIdB, user1Id, user2Id);
  }
}

async function archiveChannels(channelIdA, channelIdB, user1Id, user2Id) {
  // Notify users before archiving
  await sendMessageToChannel(channelIdA, `The conversation is now being archived. Your partner was <@${user2Id}>.`);
  await sendMessageToChannel(channelIdB, `The conversation is now being archived. Your partner was <@${user1Id}>.`);

  // Archive both channels
  await archiveChannel(channelIdA);
  await archiveChannel(channelIdB);
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

async function handleMessageEvent(event) {
  const { channel, user, text, bot_id } = event;

  // Prevent relay of messages sent by the bot
  if (bot_id) return;

  if (channelMapping.has(channel)) {
    const { user: initiatingUser, partner, relayChannel } = channelMapping.get(channel);

    // Relay the message to the other channel with the receiving user's mention
    const relayMessage = `${text} - <@${partner}>`;
    await sendMessageToChannel(relayChannel, relayMessage);
    
    // Log the message exchange in the #anon-logs channel
    const logText = `User <@${initiatingUser}> sent "${text}" to channel <#${relayChannel}>`;
    await sendMessageToChannel(ANON_LOGS_CHANNEL, logText);

    // Check for ':end:' in the message content
    if (text.includes(':end:')) {
      await endConversation(initiatingUser);
    }
  }
}

async function handleEndReaction(event) {
  const { item: { channel, ts }, user, item_user } = event;

  // Check if the reaction is to a bot's message
  if (channelMapping.has(channel) && item_user === null) {
    await endConversation(user);
  }
}

async function archiveChannel(channelId) {
  try {
    await axios.post(
      'https://slack.com/api/conversations.archive',
      { channel: channelId },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error('Error archiving channel:', error.message);
  }
}

async function sendMessageToChannel(channelId, text) {
  try {
    await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channelId,
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
    console.error('Error sending message to channel:', error.message);
  }
}

async function endConversation(initiatingUserId) {
  for (const [channelId, { user, partner, relayChannel }] of channelMapping.entries()) {
    if (user === initiatingUserId) {
      const targetUser = partner;

      // Notify users of ending and set a timer to archive in 1 hour
      await sendMessageToChannel(channelId, `The conversation will end now. Your partner was <@${targetUser}>. The channel will be archived in 1 hour.`);
      await sendMessageToChannel(relayChannel, `The conversation will end now. Your partner was <@${initiatingUserId}>. The channel will be archived in 1 hour.`);

      setTimeout(() => archiveChannels(channelId, relayChannel, initiatingUserId, targetUser), ARCHIVE_TIMER_INTERVAL);

      break;
    }
  }
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
