const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4646;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from the /anon-meeter directory
app.use('/anon-meeter', express.static('anon-meeter'));

// Main Slack slash command endpoint
app.post('/anon-meeter/slack/commands', async (req, res) => {
  console.log('Received command:', req.body); // Log incoming data for debugging
  
  const { user_id } = req.body;  // Ensure you're extracting user_id correctly from the request

  // Send a DM to the user who triggered the command
  try {
    const response = await axios.post('https://slack.com/api/chat.postMessage', {
      channel: user_id,  // Use user_id as the channel to send a direct message
      text: 'Hello! This is your form. Please fill it out.',
    }, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
      }
    });

    console.log('DM sent successfully:', response.data);
    res.status(200).send('');
  } catch (error) {
    console.error('Error sending DM:', error.response ? error.response.data : error.message);
    res.status(500).send('Failed to send DM');
  }
});

// Test POST route for verification
app.post('/test', (req, res) => {
  console.log('Test POST route hit:', req.body);
  res.send('Test POST route works!');
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});
