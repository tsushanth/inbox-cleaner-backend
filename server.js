// Minimal working server.js for Cloud Run deployment
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// Initialize services only if env vars are available
let stripe = null;
let emailTransporter = null;

// Initialize Stripe if key is available
if (process.env.STRIPE_SECRET_KEY) {
    try {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        console.log('✅ Stripe initialized');
    } catch (error) {
        console.warn('⚠️ Stripe initialization failed:', error.message);
    }
}

// Initialize Nodemailer if credentials are available
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
        const nodemailer = require('nodemailer');
        emailTransporter = nodemailer.createTransporter({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });
        console.log('✅ Email service initialized');
    } catch (error) {
        console.warn('⚠️ Email service initialization failed:', error.message);
    }
}

// In-memory storage
const userBillingData = new Map();

// =======================
// ROUTES
// =======================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            stripe: !!stripe,
            email: !!emailTransporter
        }
    });
});

// Root route
app.get('/', (req, res) => {
    res.json({
        name: 'Inbox Cleaner Pro API',
        version: '1.0.0',
        status: 'running'
    });
});

// Payment processing
app.post('/api/process-payment', async (req, res) => {
    if (!stripe) {
        return res.status(503).json({
            success: false,
            error: 'Payment service not configured'
        });
    }

    try {
        const { amount, currency = 'usd', userId } = req.body;

        if (!amount || amount < 0.5 || !userId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payment data'
            });
        }

        // For demo purposes, we'll just simulate a successful payment
        const paymentRecord = {
            userId,
            amount,
            currency,
            transactionId: 'sim_' + Date.now(),
            timestamp: new Date().toISOString(),
            status: 'completed'
        };

        // Update user billing data
        const userData = userBillingData.get(userId) || { payments: [] };
        userData.payments = userData.payments || [];
        userData.payments.push(paymentRecord);
        userData.tier = 'paid';
        userBillingData.set(userId, userData);

        res.json({
            success: true,
            transactionId: paymentRecord.transactionId,
            amount: amount
        });

    } catch (error) {
        console.error('Payment processing failed:', error);
        res.status(500).json({
            success: false,
            error: 'Payment processing failed'
        });
    }
});

// Send usage summary email
app.post('/api/send-usage-summary', async (req, res) => {
    if (!emailTransporter) {
        return res.status(503).json({ 
            success: false,
            error: 'Email service not configured' 
        });
    }

    try {
        const { to, subject, html } = req.body;

        if (!to || !subject || !html) {
            return res.status(400).json({
                success: false,
                error: 'Missing required email fields'
            });
        }

        const mailOptions = {
            from: `"Inbox Cleaner Pro" <${process.env.GMAIL_USER}>`,
            to: to,
            subject: subject,
            html: html
        };

        const info = await emailTransporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            messageId: info.messageId 
        });

    } catch (error) {
        console.error('Failed to send email:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to send email' 
        });
    }
});

// Get user billing data
app.get('/api/user/:userId/billing', (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId || userId.length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }

        const userData = userBillingData.get(userId) || {
            tier: 'free',
            payments: [],
            totalUsage: 0
        };
        
        res.json({
            success: true,
            data: userData
        });
    } catch (error) {
        console.error('Failed to get user billing data:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to retrieve billing data' 
        });
    }
});

// Update user billing data
app.post('/api/user/:userId/billing', (req, res) => {
    try {
        const { userId } = req.params;
        const billingData = req.body;
        
        if (!userId || userId.length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }
        
        userBillingData.set(userId, billingData);
        
        res.json({
            success: true,
            message: 'Billing data updated'
        });
    } catch (error) {
        console.error('Failed to update user billing data:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update billing data' 
        });
    }
});

// Track usage analytics
app.post('/api/analytics/usage', (req, res) => {
    try {
        const { userId, emailsClassified, actions, timestamp } = req.body;
        
        console.log('📊 Usage tracked:', {
            userId,
            emailsClassified,
            actions,
            timestamp: timestamp || new Date().toISOString()
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to track usage:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to track usage' 
        });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Email service: ${emailTransporter ? '✅' : '❌'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});

module.exports = app;