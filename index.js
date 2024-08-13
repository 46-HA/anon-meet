const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4646;

let allUsers = [];

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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

// Function to create private channels and relay messages
async function createPrivateChannel(user1, user2) {
    const channel1Name = `anon-meet-${user1}-${user2}-1`;
    const channel2Name = `anon-meet-${user1}-${user2}-2`;

    // Create channels
    const createChannel1Response = await axios.post('https://slack.com/api/conversations.create', {
        name: channel1Name,
        is_private: true
    }, {
        headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
    });

    const createChannel2Response = await axios.post('https://slack.com/api/conversations.create', {
        name: channel2Name,
        is_private: true
    }, {
        headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
    });

    const channel1Id = createChannel1Response.data.channel.id;
    const channel2Id = createChannel2Response.data.channel.id;

    // Invite users to channels
    await axios.post('https://slack.com/api/conversations.invite', {
        channel: channel1Id,
        users: `${user1},${user2}`
    }, {
        headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
    });

    await axios.post('https://slack.com/api/conversations.invite', {
        channel: channel2Id,
        users: `${user2},${user1}`
    }, {
        headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
    });

    // Log channel creation
    await sendToSlack('#anon-logs', `Created channels ${channel1Name} and ${channel2Name} for users <@${user1}> and <@${user2}>.`);

    // Relay messages between channels
    const relayMessages = async (channelId, otherChannelId) => {
        await axios.post('https://slack.com/api/chat.postMessage', {
            channel: channelId,
            text: `You have been matched with someone! Your messages in this channel will be relayed to the other person. Type "end" to reveal identities and end the chat.`
        }, {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        // Listen for messages
        app.post(`/slack/events/${channelId}`, async (req, res) => {
            const { event } = req.body;

            if (event && event.type === 'message' && event.text !== 'end') {
                await axios.post('https://slack.com/api/chat.postMessage', {
                    channel: otherChannelId,
                    text: event.text
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                    }
                });
            } else if (event.text === 'end') {
                await axios.post('https://slack.com/api/chat.postMessage', {
                    channel: channelId,
                    text: `The chat has ended. You were chatting with <@${user2}>.`
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                    }
                });

                await axios.post('https://slack.com/api/chat.postMessage', {
                    channel: otherChannelId,
                    text: `The chat has ended. You were chatting with <@${user1}>.`
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                    }
                });

                // Archive channels
                await axios.post('https://slack.com/api/conversations.archive', {
                    channel: channelId
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                    }
                });

                await axios.post('https://slack.com/api/conversations.archive', {
                    channel: otherChannelId
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                    }
                });
            }

            res.status(200).send('');
        });

        // Archive channels after 12 hours of inactivity
        setTimeout(async () => {
            await axios.post('https://slack.com/api/conversations.archive', {
                channel: channelId
            }, {
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                }
            });

            await axios.post('https://slack.com/api/conversations.archive', {
                channel: otherChannelId
            }, {
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                }
            });

            await sendToSlack('#anon-logs', `Archived channels ${channel1Name} and ${channel2Name} due to inactivity.`);
        }, 12 * 60 * 60 * 1000); // 12 hours
    };

    // Set up message relaying
    relayMessages(channel1Id, channel2Id);
    relayMessages(channel2Id, channel1Id);
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

        // Send DM to user after form submission
        await sendToSlack(user_id, `Hey, you submitted your form! I'll keep you updated when someone matches with you.`);

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

            // Match with all previous users
            for (const user of allUsers) {
                if (user.id !== payload.user.id) {
                    const matchContent = await scoreMatch(user.response, combinedResponse);
                    const matchPercentage = parseInt(matchContent.match(/(\d+)%/)[1], 10);

                    if (matchPercentage >= 60 && matchPercentage <= 70) {
                        await createPrivateChannel(user.id, payload.user.id);
                    }

                    await sendToSlack('#possible-connections', `Match between <@${user.id}> and <@${payload.user.id}>:\n${matchContent}`);
                }
            }
        }
    } catch (error) {
        console.error('Error processing interaction:', error.message);
    }
});

// Start the Express server
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
