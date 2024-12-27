// realtime-voice-backend/server.js
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { PassThrough } from 'stream';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { RTCPeerConnection } from 'wrtc';

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
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

        // Initialize WebRTC Peer Connection
        const pc = new RTCPeerConnection();

        // Create Data Channel
        const dc = pc.createDataChannel("oai-events");

        // Handle Data Channel events
        dc.onopen = () => {
            console.log('Data channel is open');
        };

        dc.onmessage = (event) => {
            const message = event.data;
            handleMessage(message);
        };

        /**
         * Function to handle incoming messages and structure outputs
         */
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

        // Set remote description
        const remoteDesc = { type: 'offer', sdp };
        await pc.setRemoteDescription(remoteDesc);

        // Create and set local description
        const localDesc = await pc.createAnswer();
        await pc.setLocalDescription(localDesc);

        // Send the answer back to the client
        res.json({ sdp: pc.localDescription });

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