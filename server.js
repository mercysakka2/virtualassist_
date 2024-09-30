// Import modul-modul yang diperlukan
const express = require('express');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const xmlescape = require('xml-escape');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');

// Muat konfigurasi dari file .env
dotenv.config();

// Inisialisasi aplikasi Express
const app = express();
app.use(express.static('public')); // Serve file statis dari folder 'public'
app.use(express.json()); // Middleware untuk parsing JSON

// Konfigurasi aplikasi
const config = {
    defaultVoice: 'id-ID-ArdiNeural', // Suara default untuk TTS
    fallbackVoices: ['id-ID-ArdiNeural', 'en-US-AnaNeural'], // Suara cadangan jika default gagal
    port: process.env.PORT || 3000, // Port server, gunakan dari env atau default 3000
    outputFormat: OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3 // Format output audio
};

// Inisialisasi Google Generative AI dengan API key dari .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fungsi untuk logging dengan timestamp
const log = (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] ${message}`, JSON.stringify(data, null, 2));
};

// Fungsi untuk menginisialisasi TTS dengan suara tertentu
const initTTS = async (voice) => {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, config.outputFormat);
    return tts;
};

// Fungsi untuk menghasilkan audio dari teks
const generateAudio = async (text, voice) => {
    const tts = await initTTS(voice);
    
    return new Promise((resolve, reject) => {
        const escapedText = xmlescape(text); // Escape karakter khusus XML
        const readable = tts.toStream(escapedText);

        let data64 = '';

        readable.on('data', (chunk) => {
            data64 += chunk.toString('base64'); // Konversi chunk audio ke base64
        });

        readable.on('end', () => {
            const audioUrl = `data:audio/mpeg;base64,${data64}`; // Buat URL data untuk audio
            resolve(audioUrl);
        });

        readable.on('error', reject);
    });
};

// Endpoint untuk memproses ucapan
app.post('/process-speech', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Teks diperlukan' });
    }

    log('Received speech processing request', { text });

    try {
        // Proses dengan Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(text);
        const response = await result.response;
        const geminiResponse = response.text();

        log('Received Gemini response', { geminiResponse });

        // Generate audio dari respons Gemini
        const voices = [config.defaultVoice, ...config.fallbackVoices];
        let audioUrl;

        // Coba generate audio dengan setiap suara sampai berhasil
        for (const voice of voices) {
            try {
                audioUrl = await generateAudio(geminiResponse, voice);
                break;
            } catch (err) {
                log('Error generating audio for Gemini response', { voice, error: err.message });
            }
        }

        if (!audioUrl) {
            throw new Error('Gagal menghasilkan audio untuk respons Gemini');
        }

        res.json({ text: geminiResponse, audioUrl, autoplay: true });
    } catch (err) {
        log('Error processing speech or generating Gemini response', { error: err.message });
        res.status(500).json({ error: 'Gagal memproses ucapan atau mendapatkan respons dari Gemini' });
    }
});

// Endpoint untuk health check
app.get('/health', (req, res) => {
    log('Health check requested');
    res.json({ 
        status: 'OK', 
        defaultVoice: config.defaultVoice,
        fallbackVoices: config.fallbackVoices
    });
});

// Mulai server
app.listen(config.port, () => {
    log(`Server berjalan di port ${config.port}`);
});