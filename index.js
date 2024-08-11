const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4646;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post('/anon-meeter/slack/commands', async (req, res) => {
  console.log('Received command:', req.body);
  const { trigger_id } = req.body;

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
            type: 'input',
            block_id: 'languages_input',
            element: {
              type: 'plain_text_input',
              action_id: 'languages'
            },
            label: {
              type: 'plain_text',
              text: 'What programming languages do you use? (JS, Python, C, C++, Rust, Ruby, etc.)',
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
              text: "What's your tech stack? (Web Dev, Game Dev, AI/ML, Cyber Security, Hardware/PCBs, Linux)",
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
              text: 'Do you do/like design, writing, music, art?',
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
              text: 'Top 5 favorite songs or Spotify integration?',
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
              text: 'Favorite games/game genres?',
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
              text: 'Books you like?',
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
              text: 'Sports/Clubs (Hack Club, XC, Track)?',
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
              text: 'What hackathons have you attended? (Trail, Summit, Boreal, Outernet, Wonderland)',
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
            element: {
              type: 'plain_text_input',
              action_id: 'languages_spoken'
            },
            label: {
              type: 'plain_text',
              text: 'Do you speak other languages? If so, which ones?',
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

    console.log('Modal opened successfully');
  } catch (error) {
    console.error('Error opening modal:', error.response ? error.response.data : error.message);
  }
});

app.post('/anon-meeter/slack/interactions', async (req, res) => {
  res.status(200).send(''); // Acknowledge immediately

  try {
    const payload = JSON.parse(req.body.payload);
    console.log('Interaction received:', payload);

    if (payload.type === 'view_submission') {
      const formData = payload.view.state.values;
      const user = `<@${payload.user.id}>`;
      const timestamp = new Date().toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + ' ' + new Date().toLocaleDateString('en-US');

      // Simplify the form data into a readable format
      let formattedData = `*Form submitted by:* ${user}\n*Time:* ${timestamp}\n\n`;
      formattedData += `*What programming languages do you use?*\n${formData.languages_input.languages.value}\n\n`;
      formattedData += `*What's your tech stack?*\n${formData.techstack_input.techstack.value}\n\n`;
      formattedData += `*Do you do/like design, writing, music, art?*\n${formData.creative_input.creative.value}\n\n`;
      formattedData += `*Top 5 favorite songs or Spotify integration?*\n${formData.music_input.music.value}\n\n`;
      formattedData += `*Favorite games/game genres?*\n${formData.games_input.games.value}\n\n`;
      formattedData += `*Books you like?*\n${formData.books_input.books.value}\n\n`;
      formattedData += `*Sports/Clubs?*\n${formData.sports_input.sports.value}\n\n`;
      formattedData += `*Hackathons attended?*\n${formData.hackathons_input.hackathons.value}\n\n`;
      formattedData += `*What foods do you like?*\n${formData.foods_input.foods.value}\n\n`;
      formattedData += `*Do you speak other languages?*\n${formData.languages_spoken_input.languages_spoken.value}\n`;

      // Send the simplified form data to #anon-logs channel
      await axios.post('https://slack.com/api/chat.postMessage', {
        channel: '#anon-logs',
        text: `*Form data received:*\n\n${formattedData}`
      }, {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
      });

      console.log('Form data sent to #anon-logs');
    }
  } catch (error) {
    console.error('Error processing interaction:', error.message);
  }
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});
