// realtime-voice-backend/server.js
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { PassThrough } from 'stream';
import { Configuration, OpenAIApi } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://[::1]:8000' // IPv6 localhost
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        if (!allowedOrigins.includes(origin)){
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    }
}));

app.use(express.json());

// Initialize OpenAI API
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// In-memory storage for conversations (for demonstration purposes)
const conversations = {};

/**
 * Endpoint to create ephemeral sessions
 */
app.post('/api/ephemeral_sessions', async (req, res) => {
    const { model, voice } = req.body;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/realtime/sessions',
            {
                model,
                voice
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Error creating ephemeral session:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: error.response?.data || 'Failed to create ephemeral session'
        });
    }
});

/**
 * Endpoint to handle WebRTC offer and relay to OpenAI Realtime API
 */
app.post('/api/realtime', async (req, res) => {
    const { model, sdp } = req.body;

    try {
        const response = await axios.post(
            `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
            sdp,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/sdp',
                },
            }
        );

        // Initialize transcription stream
        const transcriptionStream = new PassThrough();

        /**
         * NOTE:
         * The following code assumes that you have a WebRTC setup that allows
         * the server to handle RTCPeerConnection (pc) and RTCDataChannel (dc).
         * Node.js does not have built-in support for WebRTC. You might need to use
         * a library like 'wrtc' to enable WebRTC in Node.js.
         *
         * For demonstration purposes, this code focuses on fixing the import issue.
         * Ensure that your WebRTC setup is correctly implemented.
         */

        // Placeholder for RTCPeerConnection and Data Channel
        // You need to initialize 'pc' and 'dc' appropriately.
        // Example using 'wrtc' (not included here):
        // import { RTCPeerConnection } from 'wrtc';
        // const pc = new RTCPeerConnection();
        // const dc = pc.createDataChannel("oai-events");

        // Example initialization (replace with actual implementation)
        // const { RTCPeerConnection, RTCDataChannel } = require('wrtc'); // Use ESM equivalent if using 'wrtc'
        // For the sake of this example, we'll assume pc and dc are already initialized.

        // Function to handle incoming messages and structure outputs
        const handleMessage = (message) => {
            try {
                const structuredOutput = parseConversation(message);

                // Save the conversation
                if (!conversations[structuredOutput.session_id]) {
                    conversations[structuredOutput.session_id] = {
                        messages: []
                    };
                }
                conversations[structuredOutput.session_id].messages.push(...structuredOutput.messages);

                // Send structured output to the frontend via Data Channel
                dc.send(JSON.stringify(structuredOutput.messages));
            } catch (error) {
                console.error('Error handling message:', error.message);
            }
        };

        // Listen to incoming messages on the Data Channel
        // Ensure 'dc' is properly initialized and accessible here
        dc.onmessage = (event) => {
            const message = event.data;
            handleMessage(message);
        };

        res.send(response.data);
    } catch (error) {
        console.error('Error initializing WebRTC:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: error.response?.data || 'Failed to initialize WebRTC connection'
        });
    }
});

/**
 * Function to parse conversation into structured format
 */
function parseConversation(text) {
    const lines = text.split('\n').filter(line => line.trim() !== '');
    const messages = [];

    lines.forEach((line, index) => {
        const sender = index % 2 === 0 ? 'User' : 'Assistant'; // Changed 'Nova' to 'Assistant' for consistency
        messages.push({
            sender: sender,
            message: line.trim(),
            timestamp: new Date().toISOString() // Optional: Add timestamp for each message
        });
    });

    return {
        messages: messages,
        session_id: Math.random().toString(36).substring(2, 15) // Generate a unique session ID
    };
}

/**
 * Endpoint to retrieve saved conversations
 */
app.get('/api/conversations/:session_id', (req, res) => {
    const { session_id } = req.params;
    const conversation = conversations[session_id];

    if (conversation) {
        res.json(conversation);
    } else {
        res.status(404).json({ error: 'Conversation not found' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});