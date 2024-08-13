const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4646;

let allUsers = [];
let channelPairs = {};
let matchedPairs = new Set(); // To store already matched pairs

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Function to generate a random string of lowercase letters and numbers
function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// Function to sanitize the channel name to meet Slack's requirements
function sanitizeChannelName(name) {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 21); // Limit to 21 characters to be safe
}

// Function to call GPT-3.5 Turbo for scoring the match
async function scoreMatch(user1Response, user2Response) {
    const match = await fetch('https://jamsapi.hackclub.dev/openai/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer E9JB8HRONZ8KM6LLK0GY4CNQCG0HPC77P5E4EITB7BJT35HB8SHQO9NC3P7GZDW7'
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'user',
                    content: `Compare the following user interests, being as fair and balanced as possible. Provide a match percentage based on genuine common interests, but avoid making up connections. Focus on shared interests without being overly harsh.\n\nUser 1's interests: ${user1Response}\nUser 2's interests: ${user2Response}\n\nPlease provide the match percentage and explain the reasons for the match.`
                }
            ]
        })
    });

    const response = await match.json();
    return response.choices[0].message.content;
}

// Function to send messages to Slack channels
async function sendToSlack(channel, text) {
    await axios.post('https://slack.com/api/chat.postMessage', {
        channel: channel,
        text: text
    }, {
        headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
    });
}

// Function to create a private channel for each user and set up message relaying
async function createPrivateChannels(user1, user2, matchInfo) {
    // Generate unique and sanitized channel names
    const channel1Name = sanitizeChannelName(`anon-meet-${user1}-${generateRandomString(5)}`);
    const channel2Name = sanitizeChannelName(`anon-meet-${user2}-${generateRandomString(5)}`);

    try {
        // Create first private channel for user1
        const createChannel1Response = await axios.post('https://slack.com/api/conversations.create', {
            name: channel1Name,
            is_private: true
        }, {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        if (!createChannel1Response.data.ok) {
            throw new Error(`Failed to create channel: ${createChannel1Response.data.error}`);
        }

        const channel1Id = createChannel1Response.data.channel.id;

        // Create second private channel for user2
        const createChannel2Response = await axios.post('https://slack.com/api/conversations.create', {
            name: channel2Name,
            is_private: true
        }, {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        if (!createChannel2Response.data.ok) {
            throw new Error(`Failed to create channel: ${createChannel2Response.data.error}`);
        }

        const channel2Id = createChannel2Response.data.channel.id;

        // Invite user1 to their private channel
        const inviteResponse1 = await axios.post('https://slack.com/api/conversations.invite', {
            channel: channel1Id,
            users: user1
        }, {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        if (!inviteResponse1.data.ok) {
            throw new Error(`Failed to invite user to channel: ${inviteResponse1.data.error}`);
        }

        // Invite user2 to their private channel
        const inviteResponse2 = await axios.post('https://slack.com/api/conversations.invite', {
            channel: channel2Id,
            users: user2
        }, {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        if (!inviteResponse2.data.ok) {
            throw new Error(`Failed to invite user to channel: ${inviteResponse2.data.error}`);
        }

        // Log channel creation
        await sendToSlack('#anon-logs', `Created private channels ${channel1Name} and ${channel2Name} for users <@${user1}> and <@${user2}>.`);

        // DM users with match information
        await sendToSlack(user1, `You have been matched with someone! Here is why: ${matchInfo}. Check your private channel.`);
        await sendToSlack(user2, `You have been matched with someone! Here is why: ${matchInfo}. Check your private channel.`);

        // Store channel pairs for message relaying
        channelPairs[channel1Id] = channel2Id;
        channelPairs[channel2Id] = channel1Id;

        // Log that the bot is listening on these channels
        console.log(`Listening on channel ${channel1Id}`);
        console.log(`Listening on channel ${channel2Id}`);

    } catch (error) {
        console.error('Error creating private channels:', error.message);
        throw error;
    }
}

// Function to relay messages between the two channels
async function relayMessages(event) {
    const { channel, text, user } = event;

    if (channelPairs[channel]) {
        const targetChannel = channelPairs[channel];
        console.log(`Relaying message from channel ${channel} to channel ${targetChannel}: "${text}"`);
        await sendToSlack(targetChannel, `<@${user}> said: ${text}`);
    }
}

// Route to handle Slack command
app.post('/anon-meeter/slack/commands', async (req, res) => {
    const { trigger_id, user_id } = req.body;

    // Remove previous form submission if exists
    allUsers = allUsers.filter(user => user.id !== user_id);

    res.status(200).send(''); // Acknowledge immediately

    try {
        await axios.post('https://slack.com/api/views.open', {
            trigger_id: trigger_id,
            view: {
                type: 'modal',
                title: {
                    type: 'plain_text',
                    text: 'Interest Form',
                    emoji: true
                },
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*Please be as detailed as possible.* \n *If you like Anon Meet, join #the-hen-coop!*'
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'languages_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'languages'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What programming languages do you use? For example, JavaScript, Python, C, C++, Rust, Ruby, etc.',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'techstack_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'techstack'
                        },
                        label: {
                            type: 'plain_text',
                            text: "What is your technology stack? For example, Web Development, Game Development, AI/ML, Cyber Security, Hardware/PCBs, Linux.",
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'creative_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'creative'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'Do you engage in or enjoy activities like design, writing, music, or art?',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'music_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'music'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What are your top 5 favorite songs?',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'games_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'games'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What are your favorite games or game genres?',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'books_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'books'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What books do you like to read?',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'sports_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'sports'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What sports or clubs are you involved in? For example, Hack Club, cross country, or track.',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'hackathons_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'hackathons'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What hackathons have you attended? For example, Trail, Summit, Boreal, Outernet, Wonderland.',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'foods_input',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'foods'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'What foods do you like?',
                            emoji: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'languages_spoken_input',
                        optional: true, // Only this question is marked optional
                        element: {
                            type: 'plain_text_input',
                            action_id: 'languages_spoken'
                        },
                        label: {
                            type: 'plain_text',
                            text: 'Do you speak any other languages? If so, which ones?',
                            emoji: true
                        }
                    }
                ],
                submit: {
                    type: 'plain_text',
                    text: 'Submit',
                    emoji: true
                },
                callback_id: 'form_submission'
            }
        }, {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

    } catch (error) {
        console.error('Error opening modal:', error.response ? error.response.data : error.message);
    }
});

// Route to handle Slack interactions
app.post('/anon-meeter/slack/interactions', async (req, res) => {
    res.status(200).send(''); // Acknowledge immediately

    try {
        const payload = JSON.parse(req.body.payload);

        if (payload.type === 'view_submission') {
            const formData = payload.view.state.values;
            const userResponse = {
                languages: formData.languages_input.languages.value,
                techstack: formData.techstack_input.techstack.value,
                creative: formData.creative_input.creative.value,
                music: formData.music_input.music.value,
                games: formData.games_input.games.value,
                books: formData.books_input.books.value,
                sports: formData.sports_input.sports.value,
                hackathons: formData.hackathons_input.hackathons.value,
                foods: formData.foods_input.foods.value,
                languages_spoken: formData.languages_spoken_input.languages_spoken.value
            };

            const combinedResponse = Object.values(userResponse).join(' ');

            // Send form data to #anon-logs
            let logText = `*Form submitted by:* <@${payload.user.id}>\n`;
            for (const [key, value] of Object.entries(userResponse)) {
                logText += `*${key.replace(/_/g, ' ')}:* ${value}\n`;
            }
            await sendToSlack('#anon-logs', logText);

            // Store the user's response
            allUsers.push({ id: payload.user.id, response: combinedResponse });

            // DM the user after they submit the form
            await sendToSlack(payload.user.id, `Hey, you submitted your form! I'll keep you updated when someone matches with you.`);

            // Match with all previous users
            for (const user of allUsers) {
                if (user.id !== payload.user.id) {
                    const matchKey = `${user.id}-${payload.user.id}`;
                    const reverseMatchKey = `${payload.user.id}-${user.id}`;

                    if (matchedPairs.has(matchKey) || matchedPairs.has(reverseMatchKey)) {
                        continue; // Skip if these two users were already matched
                    }

                    const matchContent = await scoreMatch(user.response, combinedResponse);
                    const matchPercentage = parseInt(matchContent.match(/(\d+)%/)[1], 10);

                    if (matchPercentage >= 60) {
                        await createPrivateChannels(user.id, payload.user.id, matchContent);
                        matchedPairs.add(matchKey);
                    }

                    await sendToSlack('#possible-connections', `Match between <@${user.id}> and <@${payload.user.id}>:\n${matchContent}`);
                }
            }
        }
    } catch (error) {
        console.error('Error processing interaction:', error.message);
    }
});

// Route to handle Slack events
app.post('/slack/events', async (req, res) => {
    const { event } = req.body;

    if (event && event.type === 'message' && !event.bot_id) {
        console.log(`Received message in channel ${event.channel} from user <@${event.user}>: ${event.text}`);
        await relayMessages(event);
    }

    res.status(200).send(''); // Acknowledge immediately
});

// Start the Express server
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
